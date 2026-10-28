<!-- Moved verbatim from CLAUDE.md on 2026-10-20 to keep every session's context small. CLAUDE.md points here; read this file before working on what it covers. -->

## The sync pipeline

`CrmProvider` (portal vocabulary) → handlers (`DEALS`, `STAGE_HISTORY`, …) →
`SyncEngine` (cursors, status, sweeps) → `PrismaSyncStore`. Bitrix24 field names
(`UF_CRM_*`, `CATEGORY_ID`, `crm.deal.list`) stay inside
`src/server/integrations/crm/bitrix24/` — a strong convention, not a lint rule.

- **The EMPLOYEES pass REPLACES each person's department memberships, and the
  delete and the insert are ONE transaction.** A person moved out of a unit
  leaves no record saying so, so anything absent from this pass's
  `UF_DEPARTMENT` is gone. But `fetchEmployees` returns the whole roster in a
  single page, so the delete empties `department_member` outright: as two
  statements that is a 20–150 ms window (measured 1.6 ms + 15.5 ms locally on
  298 rows, plus round trips) in which every card on the org chart reads zero
  members, once every thirty ticks and again on every restart and redeploy,
  with nothing erroring and nothing logged. A unit we never imported is dropped
  rather than guessed at: the FK would refuse the row and take the whole
  multi-row insert with it.
- **`batchWalk` uses id-chained seeks, never offsets.** 50 chained commands per
  `batch`, `filter[>ID]` + `start=-1`, 2 500 rows a round trip. Offsets were
  measured: `start=400000` ran 25 minutes and then got *every* `crm.contact.list`
  call in the account answered `OPERATION_TIME_LIMIT` for ten minutes.
- **`encodeParams` percent-encodes filter KEYS, not just values.** Get it wrong
  and the portal silently drops the filter and returns the whole table — 20 750
  fetched rows held 12 800 distinct ones. `>=DATE_MODIFY` is built the same way,
  so the same bug turns every incremental sync into a full one.
- **`skipped` must not block the watermark; `failed` must.** Stage history
  finishes `PARTIAL` on every run (2 346 of 193 344 rows point at things that no
  longer exist), and blocking on skips left the cursor permanently stuck,
  re-reading 191 000 transitions every tick to change nothing.
- **…but a run that skipped rewinds 35 minutes, for `DEALS` and
  `STAGE_HISTORY`.** Not every skip is permanent. The hot entities run in
  sequence, each capturing its own start, so a deal created between the DEALS
  read and the STAGE_HISTORY read has its arrival in `C4:NEW` skipped for an
  unresolvable `dealId` — and `>CREATED_TIME` then means that arrival is never
  offered again, which leaves the order off the confirmation board with nothing
  reporting a gap. Measured 2026-09-03: portal 44, the client's own bot board
  44, ours 43 (deal 935632), and 1–4 a day over the preceding days.
  `SKIP_LOOKBACK_MS` in `SyncEngine.ts` — applied only after a run that skipped,
  and always derived from that run's own start, so it advances every tick
  regardless.
- **…and `DEALS` / `STAGE_HISTORY` re-read the last three minutes on EVERY
  run — 2026-10-01.** The portal filters `>DATE_MODIFY` / `>CREATED_TIME` in
  whole seconds, strictly greater, so a row stamped in the watermark's own
  second that was not yet visible at the read is excluded forever, with no skip
  to trigger the rewind above. Deal 1050732 (C4:NEW at 06:15:07 UTC, the run
  started 06:15:07.054) was missing from Тасдиқлаш and FAKT 1 that way — one
  arrival in 3 339 since 1 September. `SETTLE_LOOKBACK_MS` in `SyncEngine.ts`.
- **A SELLER SNAPSHOT COPIED FROM AN OLDER DEAL IS DROPPED — 2026-10-19.**
  A repeat deal Bitrix24 opens off an older one carries that deal's
  «Фамилия имя ответсвенный» / «Организация сотрудника», and the portal never
  rewrites them: deal 1150184 (Ziyoda Ashirova 170, Baza) stood under
  «Davlatbek Sirojov 115 / Sevinch(ROP)». When the deal's creator is its owner
  and sits on a «(ROP)» team, a snapshot naming someone else is written as
  NULL — name, team and `operatorEmployeeId` together — so every reader falls
  back to the owner (`isCopiedOperatorSnapshot`). 1 of 12 870 deals
  01.05–19.10 matched; back office, registrar-opened and hand-over deals don't.
- **The upsert may not rewrite a row's primary key.** `rowId()` mints a fresh
  id per batch and the conflict target is the EXTERNAL key, so `id` has to be
  `insertOnly` — without it the update set carried `"id" = EXCLUDED."id"` and
  every re-import gave an existing row a new identity (proved on production:
  the one deal of nineteen the sync touched in 100 s came back under a new id).
  Children followed it — `deal_item` and `deal_stage_history` cascade on update
  — and `/deals/[id]` plus the confirmation trace panel address a deal by that
  column, so links went stale within a minute.
  `tests/integrations/bulkUpsert.test.ts` pins it, including for tables added
  later.
- **Only a FULL run may delete**, and only from `SUCCESS`. An incremental run
  sees just the changed records, so "not seen" says nothing about existence.
- **The production sweep bypasses the SyncEngine on purpose** — it collects ids
  and calls `deleteMissing` directly, because a FULL engine run also re-upserts
  all 434 000 deals. It must not run at tick 0.
- **THE TASDIQLASH QUEUE HAS ITS OWN DELETION CHECK — 2026-09-24**
  («bitrix24dan udalit qilinsa dashboarda shu narsa qolib ketayapti»). The
  daily sweep let a deleted order stand on the board for up to a day.
  `sweepRecentConfirmations` (`sync/recentDeletions.ts`) takes the deals that
  moved through a confirmation stage recently and asks the portal about THOSE
  ids only (`existingDealIds`, one `crm.deal.list` per 50 ids): the last 2
  days every 5 minutes, the last 62 days hourly (`RECENT_SWEEPS` in
  `syncWorker.ts`); since 2026-10-08 a third reach asks about every deal the
  portal OPENED in the last 2 days, any pipeline, every 30 minutes
  (`population: 'created'` — a test «Сарафан маркетинг» deal made and deleted
  the same day had stood on «Lidlar» all day); 300–400 invocations an hour
  together. It throws — deleting
  nothing — on a refused or missing command, on a row it did not ask for (an
  ignored ID filter), and when more than `goneLimit` deals look gone at once.
- **THE PORTAL NOW TELLS US — 2026-10-08** («Bitrix24ʼda oʻchirilsa srazi
  tasdiqlash navbatida oʻchirilishi kerak»). Every check above goes and asks;
  a Bitrix24 OUTGOING webhook (`ONCRMDEALADD/UPDATE/DELETE`) POSTs to
  `/api/bitrix24/events` (`bitrix24/outgoingEvent.ts`), which checks the
  application token (`BITRIX24_APP_TOKEN`, constant-time) and the portal
  domain and queues one `crm_event` row per (deal, event). The worker drains
  the queue every `SYNC_EVENTS_DRAIN_SEC` (10 s) INSIDE its end-of-tick wait
  (`sync/crmEvents.ts`): named deals are re-read by id and written through
  the ordinary upsert; deals the portal no longer returns are deleted — the
  ones it said it DELETED up to `confirmedGoneLimit` (100 / 10%), unreturned
  ADD/UPDATE ones up to `goneLimit`, the rest «held» for the nightly walk. At
  most 100 distinct deals (two invocations) per drain; a FLOOD (more pending
  than that — a robot mass-edit) applies only its DELETE events and leaves
  the updates to the tick's `>=DATE_MODIFY` pass. A rejected upsert does not
  keep its events pending (one bad deal would be re-read every 10 s for
  ever); rows older than an hour that still failed are let go. Without the
  token the endpoint answers 404 and the sync is polling only, as before.
- **THE REFERENCE PASS AND THE SWEEP RUN ON THE WALL CLOCK, NOT THE TICK
  COUNTER — 2026-09-17** (`sync/schedule.ts`). `tick` restarts at zero in every
  process, so every deploy re-ran the reference pass (sixteen a day against
  eight scheduled) and a day with two deploys never reached the sweep's tick
  720 — no sweep ran in the 48 hours before this was measured. The worker now
  reads when each last ran from `sync_log` at startup: the reference pass is
  dated by its first entity's row, and the sweep writes its own `DEALS` /
  `FULL` / `SUCCESS` row (`recordsRead` = portal deals, `recordsUpdated` =
  rows deleted). A failed sweep retries after an hour, never on the next tick.
  The env vars still count TICKS and are converted with `SYNC_INTERVAL_SEC`.
  **A deploy now costs the portal nothing beyond the hot tick.**
- **`sync_log` keeps 30 days**, and a `RUNNING` row older than a day (a process
  killed mid-pass) is deleted — at startup and after each sweep.
- **The sweep's temp table lives inside one interactive transaction.**
  `CREATE TEMP TABLE … ON COMMIT DROP` outside a transaction vanishes at commit;
  the next `TRUNCATE` then raised `42P01`, which the engine swallowed as a
  warning — deletions silently never happened.
- **`IdResolver.mapFor()`, not `map()`, on the hot path.** The full deal map is
  ~200 MB and the worker runs in a 512 MB container whose heap tops out near
  258 MB. `mapFor` deliberately does not cache: caching a partial view under the
  full map's key would be a silent wrong answer.
- **Empty string is the foreign-key trap.** `('' && map.get('')) ?? null` yields
  `''`, which fails the constraint and takes the whole multi-row insert with it.
  Closed at the provider edge (`nonEmpty`) and the handler edge (`link`).
- **One worker only**, enforced by `pg_try_advisory_lock` on a **dedicated**
  connection. A pooled connection returns to the pool and Postgres drops the
  lock with it — looks like it works, enforces nothing. A second worker waits
  rather than exiting, because exiting produces a platform restart loop.
- **Nothing in the worker may wait forever (2026-10-24).** Its pool has a 15 min
  `statement_timeout` and `idle_in_transaction_session_timeout`, a 60 s connect
  timeout, TCP keepalive and `application_name: 'sync'` (the web's lanes are
  `web` / `web-auth`). Before that it ran on `pg`'s defaults — no limit at all —
  so one statement stuck on a half-dead connection froze the sync and Meta until
  the next deploy. Fifteen minutes is past the ten-minute cap on its longest
  transactions; the limit exists to end a hang, never to bound real work.
- **`DEAL_ITEMS` reads in-memory state left by the `DEALS` pass** in the same
  process, and ignores `updatedSince`. Running it alone yields zero rows and
  reports `SUCCESS`.
- **AND IT HAS ITS OWN INDEX, because the chip is polled by every open tab.**
  `ORDER BY "finishedAt" DESC LIMIT 1` under a status filter was a sequential
  scan plus a top-N sort — **816 ms over 120 342 rows**, measured on production
  2026-09-14, and the endpoint ran it TWICE per request (the failure lookup
  re-read the success the caller had just fetched). Once a minute per open tab,
  on the one vCPU that answers every screen, that was enough for `/meta/alerts`
  to return `INTERNAL_ERROR` while the worker was catching up. Now
  `@@index([status, finishedAt(sort: Desc)])` serves both readers as a short
  backwards walk, and `findCurrentSyncFailure(lastSuccess)` takes the timestamp
  instead of re-reading it. If either the index or the parameter is removed, the
  header starts timing out again under exactly the conditions it exists to
  report on.
- **THE FRESHNESS CLOCK READS AN ALLOWLIST — `FRESHNESS_ENTITIES`, three of
  them.** «Necha daqiqa oldin» promises that the numbers on screen are current,
  and every number here is built from DEALS, STAGE_HISTORY and CUSTOMERS.
  `findLastSuccessfulSync` used to take the newest success of ANY entity, and
  on 2026-09-14 — four hours into a portal-wide `OVERLOAD_LIMIT` — two
  different passes made it lie in turn. `DEAL_ITEMS` makes no portal call at
  all (it reads what the DEALS pass left in memory), so with DEALS failing it
  finished SUCCESS once a minute and the header read «1 daqiqa oldin» over
  45-minute-old data: CUSTOMERS 11 failures, DEALS 11, STAGE_HISTORY 11,
  CALLS 9, DEAL_ITEMS 11 successes. Excluding it, `DEPARTMENTS` did the same
  more quietly — its method was still being answered while every deal call was
  refused — and the chip said «2 daqiqa oldin» over deals four hours old. Both
  readings were true and both were useless to the reader. THIS is what the
  client kept reporting as «avtomatik yangilanmayapti»: the refresh worked and
  the clock lied. A pass that read zero rows because nothing changed still
  counts — the portal answered for the data the chip is about.
- **`STORES` AND `STOCK` ARE NOT SCHEDULED AT ALL SINCE 2026-09-16; `CALLS`
  WAS UNSCHEDULED THE SAME AFTERNOON AND PUT BACK THE SAME EVENING.**
  `store` and `stock_level` are written by the sync and read by NOTHING —
  «Joʻnatish nuqtalari» was deleted, and `catalog.storeproduct.list` returns
  zero rows on this portal. `call_record` was in the same position at 15:32
  (`35a5354`) and gained a reader hours later: «Qoʻngʻiroqlar».
  So CALLS is back in `REFERENCE` — the path that commit's own comment
  prescribed — on the three-hourly reference clock, at roughly 60–120
  invocations a pass against the 15 000-an-hour `portalBudget`. Unscheduled,
  not deleted, for the other two: handlers, provider methods and tables stay,
  and `npm run bitrix:resync -- STORES` fills one the day a screen needs it.
- **«ЛИД НАЗОРАТИ» HAS TWO FEEDS OF ITS OWN ON A TWO-MINUTE CLOCK —
  2026-10-09** (`sync/leadWatchFeeds.ts`, `LEAD_WATCH_MS` in the worker): the
  calls of the last minutes (CALLS otherwise arrives every three hours) and
  the open-line chats a person holds open (`crm.activity`, never read
  before), into `call_record` and `open_line_chat`. 2 requests / 3 invocations
  an ordinary pass. See «Лид назорати» under the screens for the portal
  measurements and the guards; `lead_watch_sync` is their clock.
- The provider **ignores `pageSize`** and returns one page for most entities.
- Roistat is a second, unrelated source (a `var D = {…}` literal inside a 5.5 MB
  static page, parsed by brace-matching, not regex). It lands in its own tables
  and is spawned as a child process, hourly.
- **Meta (2026-10-22): every 15 minutes, beside the loop, with its whole
  history.** `SYNC_META_MIN` (default 15) — it was `SYNC_META_EVERY` ticks
  (the live spec's 30 × 120 s: hourly), which is now ignored. The pass is started,
  not awaited (`metaInFlight` in `syncWorker.ts`), so it never holds a Bitrix24
  tick or the events drain. Each pass re-reads every account's last 7 days;
  the first pass inside 01:00–06:00 Tashkent re-reads 37
  (`META_DEEP_REFRESH_DAYS`: Meta's 28-day attribution revises old days). And
  each pass spends up to `SYNC_META_HISTORY_SEC` (90) walking accounts back
  from 2026-07-01 to Insights' floor (`metaHistoryFloor`, 36 months),
  remembered per account and grain in `meta_history_read` — an account with no
  older spend is asked once. Meta's lead-form LEADS cannot go further back
  than Meta keeps them (90 days); Bitrix24 has the rest. The night pass also
  re-reads a week of every form Meta counts more leads on than we hold
  (closed ones too — `importMetaLeads` `deep`) and re-checks the forms of ads
  that spent in the last 3 days (`importMetaAdForms` `recheck`); it counts as
  the night's only when every account was read.
- **Roistat is on the wall clock too (2026-10-22)**: `SYNC_ROISTAT_MIN` (60)
  since the newest `marketing_snapshot.importedAt`. It was `tick % 60` — two
  hours at 120 s, and never on a day of deploys under two hours apart.
- **A Roistat blob with «резерв» for `rateDate` imports (2026-10-24,
  `isDatedRate` in `roistatSnapshot.ts`)**: the client's page publishes its typed
  reserve rate (12 650 that day, the bank 11 838.92) when it cannot reach
  cbu.uz, and the importer's DD.MM.YYYY check refused every hourly run. The
  reserve is never stored: the rate is asked of cbu.uz for `D.today`, else the
  stored rate stays; the rest of the blob is written. The log says which —
  `roistat: ok, kurs … (CBU — manbada zaxira kurs)` — and a failure now logs
  every issue line with the value that failed («keldi: …»), not just
  «The blob failed validation (1 issue(s)):».
- **«Mijoz qaytishi» is built by the worker and stored (2026-10-24,
  `cohortSnapshotRefresh.ts`, `cohort_snapshot`)**: the three matrices the page
  opens on (18 months; company, Collagen, Zextra) and the База card, one at a
  time, beside the loop (never beside Meta or Roistat), every 30 min in
  `WARM_HOURS`, every 3 h outside; each statement under a 5-min SET LOCAL
  limit. Log: `kohort: matrix:[18,null,false,null] 12.3 s · …`.
  `SYNC_COHORTS=0` turns it off and the screen builds live again.
- **Roistat's closed months are read by the worker and stored (2026-10-28,
  `monthScanRefresh.ts`, `month_scan`)**: every closed month from January of
  last year — the widest scan (`RoistatRepository.bitrix(month, now, 'all',
  true)`, every grouping set, brand-keyed; every shape and brand slice is cut
  from it, `bitrixRowsOfShape`) — and the queue cohort's team-days (FAKT) of
  this year's closed months and the month just closed. At most three months a
  pass, newest first, one at a time, beside the loop and never beside Meta,
  Roistat's import or a cohort pass; a month whose sales still open
  (`monthSettling`, its end + 35 days) every 30 min in `WARM_HOURS` and 3 h
  outside, an older one every 12 h; 5-min SET LOCAL limit per statement. The
  first fill after a deploy is spread over ~11 ticks. Log: `oy keshi:
  bitrix:2026-09 31.2 s · fakt:2026-09 6.0 s`. `SYNC_MONTH_SCANS=0` turns it
  off and «Kunlar boʻyicha» / Roistat read every month live again.
- **Bitrix24 dropdown labels age out every 3 h** (`ENUM_LABELS_TTL_MS`): a
  renamed «Проект» / targetolog / region item keeps its id, so only a miss
  re-read them before. **The deals already stored follow too**: the provider
  diffs each re-read against the last (`takeLabelRenames`) and the worker
  rewrites the text column (`sync/labelRenames.ts`; enum-read fields excluded).
  A rename made while no worker was running is not seen.
- **An optional link the maps lack is remembered (2026-10-22,
  `deal_pending_link`)**: source, lead ROP, «ROP KVAL LID», creator. The
  deals handler writes the deal with NULL and the portal id there; a new id
  asks for `RESOLVE` (20-min gap), and after any reference / `RESOLVE` pass
  `repairPendingLinks` fills the still-NULL columns in SQL. Ids that never
  arrive are dropped after a week.
- `crm_form_fill` deliberately never deletes — see `formFillFeed.ts`: a fill
  Meta counted stays counted.
- **«Безквал» is counted by the worker and stored (2026-10-24, `bezkvalRefresh.ts`,
  `bezkval_client` + `bezkval_day`)**: today and yesterday every 10 min, the 7
  days before every 3 h, every older day from 2026-09-01 once, ≤ 6 days a pass
  (`RegistrationRepository.computeBezkvalDay` → `storeBezkvalDay`, one
  transaction a day). The grid, the day card, «Guruhlar» and /rnp read the
  stored rows; computing the month per request ran past the web pool's 20 s
  statement timeout on production (22–24.10, «Lidlar» 500).
- **Where each deal was born (2026-10-22, `crm_deal_birth`, `dealBirthFeed.ts`)**:
  `crm.stagehistory.list` TYPE_ID 1 rows, every pipeline, read in id order
  every 5 min (`DEAL_BIRTHS_MS`, one chained batch, up to 2 500 rows; the
  backfill from 2026-08 runs `DEAL_BIRTH_BATCHES` a pass until caught up),
  bookmark in `lead_watch_sync` row 'births', append-only like the form fills.
  «Безквал» reads it: a Первичный отдел deal keeps its id into Тасдиклаш /
  Доставка, an «ИИ обработка» deal moves into Регистрация, so
  `deal.pipelineId` cannot say where a lead was born. Two deal columns came
  with it: `leadVia` (UF_CRM_LG_VIA) and `dealPhone`
  (UF_CRM_DEAL_1750679541518); the `DEALS_BACKFILL` of 2026-10-22 fills them
  since 2026-09-01. The migration also made `phone_nines(text[])` and the GIN
  index `customer_phone_nines_idx` over `phone_nines(phones || phone)` — not in
  schema.prisma, drift on `migrate dev` is expected.
- **Where each deal moved (2026-10-26, `crm_deal_move`, the same `dealBirthFeed.ts`
  pass, feed 'moves')**: the TYPE_ID 5 rows — a pipeline change each, with the
  pipeline moved INTO — read right after the births with their own bookmark
  (`lead_watch_sync` row 'moves'), backfilled from 2026-08 the same way. «Безквал»
  v2 counts an «ИИ обработка» → Регистрация move as a kirim of its day; the
  pipeline it came FROM is the category of the deal's previous births/moves row
  (history ids rise with time). `refreshBezkval` counts nothing until both
  feeds have reached the newest row once (`bezkvalReady`) — a day counted
  without its moves would be stored under the new `BEZKVAL_RULES` and never
  counted again.

- **THE PORTAL CAN BLOCK ITSELF, AND THE DASHBOARD NOW SAYS SO.** On
  2026-09-14 every REST call came back `401` with
  `OVERLOAD_LIMIT — REST API is blocked due to overload`: Bitrix24's own
  throttle, portal-wide, lifting on its own. Three things were wrong with how
  that played out, and all three are fixed.
  **The reason was thrown away.** A non-ok response reported «Bitrix24
  responded 401» and dropped the body, so the sync log read like a revoked
  token for fifteen minutes and diagnosing it needed a probe against the live
  portal. `Bitrix24CrmProvider` now appends the portal's own code and sentence.
  **The screen said nothing.** The freshness chip went orange, printed
  «13 daqiqa oldin» and left the reader to conclude the REFRESH BUTTON was
  broken — they pressed it, reloaded, cleared the cache, and none of it could
  help. `/meta/alerts` now carries `syncError` (the code, the entity, when),
  the chip prints «Bitrix24 band» for a throttle and «sinx xatosi» otherwise,
  and the tooltip says whether to wait or to call somebody.
  `findCurrentSyncFailure` only reports a failure NEWER than the last success,
  so a healthy dashboard never wears a red mark for last week.
  **AND ON 2026-09-15 IT GAINED THE TWO THINGS IT STILL COULD NOT SAY.**
  `syncError.since` is when the run of failures BEGAN — `at` is the newest
  failed tick, which during an outage is always seconds old, so a four-hour
  block and a four-minute blip read identically; the tooltip now says «06:05 dan
  beri». And `syncError.kind` classifies the refusal SERVER-SIDE
  (`bitrix24/refusal.ts`), replacing a two-element allowlist of Bitrix24 codes
  that sat inside `Shell.tsx` — the portal's vocabulary on the wrong side of
  the one rule, and unreachable from the worker that needs the same judgement.
  A `CREDENTIAL` failure skips the deliberate five-minute quiet period the chip
  gives a throttle, turns the dot critical and names the act («portalda yangi
  kalit ochilib, dashboardga qoʻyilishi kerak»): a revoked webhook will never
  clear on its own, so waiting it out is exactly wrong. On 2026-09-15 that
  silence ran from 06:10 until somebody happened to look.
  `/meta/alerts` also reads its two halves with `allSettled`, so a slow backlog
  aggregate can no longer take the freshness clock down with it — the moment the
  database is under strain is the moment the header most needs to answer.
  **The worker exited.** `process.exit(1)` on a failed startup health check
  turned a transient throttle into a restart loop that re-issued the refused
  call every cycle. It logs and starts the tick loop instead; the loop already
  backs off up to five minutes.
  **And the restart itself was expensive.** `historyBackfillCursor` re-read 45
  days of stage history on EVERY start — five deploys in two hours is five
  such passes. It now runs only when the cursor has been still for half an
  hour PLUS the 35 minutes the engine itself sets it back
  (`HISTORY_IDLE_MS` = 65 min), which is the case it was written for (a worker
  that was DOWN); a redeploy under a healthy sync is covered by
  `SKIP_LOOKBACK_MS`. **The bare half hour was wrong until 2026-09-23:**
  stage history skips rows on nearly every tick, so its stored watermark is
  `startedAt − 35 min` and read as idle the moment it was written — the deploy
  that day re-read 81 970 rows under a worker that had synced two minutes
  earlier.

**A REFUSED PORTAL IS NOT ASKED AGAIN UNTIL A PROBE SAYS IT IS —
`PortalGate`, and it replaced the flat ten-minute wait on 2026-09-15.**

The old `throttled` flag could not do the job it was written for: it is
computed from the RESULTS of `runAll`, so by the time it is true every entity
in that tick has already been refused. Measured that morning under a 401
`OVERLOAD_LIMIT` — a hot tick sent 3 requests of which **2 left after** the
portal had already said no, a reference tick sent 12 of which 11 did, and a
restart inside the block sent 11 more because tick 0 is always a reference
tick. Over a four-hour block, ~107 requests fired into a door already shut.

The gate sits inside `call()`, BEFORE the rate limiter, so it covers every
caller — the engine, the sweep, `scripts/import.ts`, a hand-run resync. The
first refusal shuts it; every later call in that tick throws locally with the
remembered code and sends nothing. `scripts/syncWorker.ts` then does no work at
all while it is shut, and asks ONE cheap `profile` question on a ladder:
**60 s, 120 s, 240 s, 480 s, then 600 s** for a throttle (the ten minutes
`THROTTLED_WAIT_MS` used to be, now the ladder's ceiling in `portalGate.ts`),
and a flat **300 s** for a credential failure, which will not clear on its own
and where backing off only delays noticing that somebody fixed it. A successful
probe closes the gate and runs a full tick at once, so recovery is 1–3 minutes
into any block instead of always ten.

**The four refusals are one vocabulary, in `bitrix24/refusal.ts`.** `THROTTLE`
(OVERLOAD_LIMIT, QUERY_LIMIT_EXCEEDED) and `CREDENTIAL` (a revoked webhook, and
any unparsable 401) shut the whole gate; `METHOD` (OPERATION_TIME_LIMIT) holds
ONE method for ten minutes and leaves the rest answering; `TRANSIENT` tolerates
two failures before shutting. **`null` is the fifth answer and the load-bearing
one** — `INVALID_ARG_VALUE` is how `batchWalk` learns a chain ran dry, so
classifying it as a refusal would shut the gate on every SUCCESSFUL pass.
Branch on the CODE, never on `error_description`, which arrives in the portal's
interface language.

**The worker starts already knowing.** `lastRefusal()` reads the newest FAILED
row against the last `FRESHNESS_ENTITIES` success — two index walks, no portal
call — and seeds the gate shut when a refusal newer than that success is under
fifteen minutes old. A restart inside a block cost ~11 requests
re-discovering it, ~17 times a day; seeded, it costs 0 until a probe is due.

**AND THE ERROR MESSAGE STOPPED LYING.** «failed after 4 attempts» was a
constant, false on every non-retryable error — a 401 breaks out after ONE
request. That sentence went into `sync_log`, the dashboard tooltip and the
2026-09-14 incident notes, and it is why that outage first read as «the client
is hammering the portal four times over». It reports the attempts it made. The
429/5xx branch also stopped dropping the response body, which is what hid a
`QUERY_LIMIT_EXCEEDED` behind a bare «Bitrix24 responded 503» and kept the
ten-minute wait from ever engaging: measured at 40 HTTP requests where 10 were
expected.

**THE ROOT CAUSE OF THE THREE BLOCKS, MEASURED — `npm run bitrix:cost`.**
`obey.bitrix24.kz` blocked this integration three mornings running: 2026-09-14
11:20 (six hours), 2026-09-15 10:50, 2026-09-16 11:53, all `OVERLOAD_LIMIT`.
Every investigation before this one counted REQUESTS and RECORDS — the numbers
our side of the wire can see — and by both the integration looked modest. The
cause was found only by asking a third question: **how long does the PORTAL
spend answering us.** `sync_log` had held the answer since the day it was
written, because `finishedAt − startedAt` on a pass is almost entirely the
portal's execution time. Nobody had summed it. Over the three days ending
2026-09-16:

| entity | passes | avg | **total portal time** | records read | **s per record** |
|---|---|---|---|---|---|
| **DEALS** | 1 968 | **31.8 s** | **17.4 h** | 32 778 | **1.91** |
| STAGE_HISTORY | 1 969 | 1.2 s | 38 min | 1 465 859 | 0.0015 |
| CUSTOMERS | 1 975 | 0.9 s | 30 min | 8 739 | 0.21 |

**DEALS read 45× fewer records than STAGE_HISTORY and spent 28× more of the
portal's time — 1 200× more per record.** The cost was not the data; it was the
fixed fifty-command chain, and it was specific to `crm.deal.list`, whose
`CATEGORY_ID` filter and wide `select` over 464 000 rows make each command cost
**~0.64 s** of portal execution against `crm.contact.list`'s ~0.018 s. Forty-eight
of those fifty existed only to learn there was nothing more to read. Sustained,
that was **145 s of portal time per ten minutes on one method, day and night** —
30% of the 480 s Bitrix24 nominally allows, and three times that before the tick
was slowed from 60 s to 180 s on 2026-09-14. **Every block landed between 10:50
and 11:59** because that is when the client's own sales floor is working
`crm.deal.*` hardest: our steady 30% plus their morning emptied the method's
basket. It is also why cutting our REQUEST volume 7× after the first block did
not stop the next two — the requests were never the expensive part.

**THE HISTORICAL CAUSE WAS DIFFERENT AND IS ALSO GONE.** Before 2026-09-14 the
worker restarted **45–65 times a day** (`DEPARTMENTS` rows per day in `sync_log`:
57, 67, 59, 61 against a scheduled 16) and each restart wound the stage-history
cursor back 45 days: STAGE_HISTORY read **1 372 072 rows on 2026-09-13** from a
222 000-row table, six full re-reads a day. The Roistat heap cap stopped the
restarts and `historyBackfillCursor` stopped the re-reads: **2 730 rows on
2026-09-16, a 500× cut.** That is what the support ticket describes. It was
real, it was fixed, and it was not what caused the two blocks that followed.

**THE CURE AND THE GUARD, AND WHICH IS WHICH.** The cure is `CHAIN_MIN`: an idle
DEALS pass sends 2 commands, ~1.3 s instead of ~32 s, which at the 120 s tick is
~6.5 s per ten minutes — **from 30% of the method's budget to ~1.4%.** The guard
is the measured fallback in `portalMeter.ts`, because **this portal sends no
`time` block** and the gauge had nothing to read: `call()` now times every
successful request and bills it to the WALKED method, and above 60 s of our own
time per ten minutes a method is paced, above 120 s it waits. Those rungs are set
BELOW the 145 s that got blocked, deliberately — the portal's own users share the
basket and we cannot see their half. `portalMeter.test.ts` replays the incident
(a 36 s DEALS pass every 180 s is stopped) and the cure (a 1.3 s pass every 120 s
is never touched).

**HOW TO KNOW IT HELD, WITHOUT TRUSTING THIS PARAGRAPH:** `npm run bitrix:cost`
against production. The DEALS row's `o‘rt s` must read ~1–2, not ~32, and its
`sek/10daq` single digits, not 145. If it creeps back up, read the chain width
first.

**THE GAUGE WAS ALWAYS ON THE WIRE AND NOTHING EVER READ IT — `portalMeter.ts`,
2026-09-16.** Every successful Bitrix24 answer carries `time.operating` (seconds
of operating time this method has already spent in the current basket, against
the 480 s the portal allows per method per ten minutes) and
`time.operating_reset_at` (when the basket empties). `Bitrix24Response` had no
field for either, so `response.json()` parsed and discarded both on every call
this integration has ever made. **Everything this file says about our own
load — the 2 rps limiter, «107 requests into a closed door», the volumes in the
support ticket — was therefore an estimate made from OUR side of the wire,
against a limit only the portal can see**, and both blocks (2026-09-14, four
hours; 2026-09-16 11:53, three entities) were diagnosed after the fact from
`sync_log` row counts.

`PortalGate` is what happens AFTER a refusal; the meter is what keeps us off
the wall. They are deliberately separate — a tripped gate is a fact about the
past, a basket at 70% is a fact about the next minute. Above `SOFT_FRACTION`
(60%) `call()` paces, spreading what is left of the basket over what is left of
the window; above `HARD_FRACTION` (85%) it waits the basket out, because there
is nothing to pace INTO when the wall empties on a clock the portal hands us.
**A stale reading is no reading** — once its `resetAt` passes it is discarded,
or the meter would invent an outage of its own.

**IT BILLS THE METHOD THAT WAS SPENT, NEVER THE TRANSPORT.** A chained walk
sends `batch` and drains `crm.deal.list`'s basket fifty times over; filing that
under «batch» would hide the only method the portal was ever going to refuse,
which is exactly the blindness that made 2026-09-14 take a live probe against
the portal to diagnose. The sub-readings come from `result.result_time` and the
WORST is taken — the lowest is the state that method was in before this batch
ran. `OVERLOAD_LIMIT` is administrative and portal-wide with no published
threshold, so nothing here can promise to avoid it; what it can do is make our
consumption a measured number. `meter.stats().peak` is what the next support
ticket quotes.

**`npm run bitrix:meter` asks the portal once and prints all of it** — answering
or refused, which code, whether to wait or to issue a new webhook, and how full
the basket is. Safe during a block: it is the cheapest call there is.

**IT CALLS `healthCheck`, NEVER `probe`, AND THE FIRST VERSION GOT THAT WRONG.**
`probe()` exists for the gate: it swallows the error and answers a bare boolean,
because the gate only needs «is the door open». A diagnostic needs the REASON —
and the first version called `probe()` inside a try/catch and printed «✓ portal
javob berdi» on the strength of nothing having been thrown. Measured 2026-09-16
against a webhook the portal answers `INVALID_CREDENTIALS`: it reported the
portal healthy in 508 ms. **A tool whose whole job is to say «wait» or «issue a
new key» must not fail open.**

**THE PORTAL DOES SEND `time` — THE «IT SENDS NONE» READING WAS AN ERROR
RESPONSE.** It was measured against a webhook the portal answered
`INVALID_CREDENTIALS`, and an error body carries no `time` block. Against the
live webhook (`/rest/8868/…`, issued 2026-09-16) every success carries
`time.operating` and `operating_reset_at`, so the gauge READS here and the
measured fallback is a backstop again. Measured through the new chain that
afternoon: an incremental DEALS read of 18 changed rows took **1.6–2.2 s**
(against 31.8 s at the fixed fifty) and `crm.deal.list` stood at 5.9 s of 480
(1%) after three of them. Never measure the portal through a key it refuses.

**AND THE WALK STOPPED SENDING 48 COMMANDS NOBODY NEEDED — `CHAIN_MIN`.**
`batchWalk` sent a fixed chain of FIFTY id-chained seeks on every call,
including the once-a-minute incremental tick where the first command covers 50
changed rows and the portal has perhaps five. Each of the other 49 resolves a
`$result` reference to a row that does not exist; the portal executes,
validates and refuses each one with `INVALID_ARG_VALUE` — which the walk
correctly reads as «the data ended», and which is also fifty invocations of
`crm.deal.list` billed to read five rows. **From here that is invisible**: one
HTTP request a minute per entity, comfortably inside our own 2 rps limiter, is
all our side of the wire sees. Counted at the deployed cadence — four HOT
entities, one tick a minute, stage history walking two passes — it is **~288 000
method invocations a day of which ~277 000 exist only to discover there was
nothing more to read**, the largest single thing this integration does to the
portal.

A walk now OPENS at `CHAIN_MIN` (2) and WIDENS ×4 only when a chain comes back
FULL, which is the walk proving there is more; a chain that runs dry ends the
walk and **resets the width**, so the six-hourly sweep's widening cannot leave
every tick after it paying fifty. The floor is 2 rather than 1 so an ordinary
busy minute of 51–100 changed rows still finishes in one round trip. A full
import pays three extra round trips at the start (2 + 8 + 32 + 50 + 50 …):
`listDealIds` reaches 464 000 deals in 188 requests against the old 186. A
quiet tick costs **8 invocations instead of 200**.

**AND THE CEILING THAT MAKES IT NOT COME BACK — `portalBudget.ts`.** Everything
else in that directory limits a RATE, and **the rate was never the problem**: 2
requests a second was true for every second of both blocks. What earned them was
VOLUME, and a rate limiter has no memory — it answers «may this leave now», never
«how much have we asked for today». `PortalBudget` is that memory: a rolling
60-minute ceiling on INVOCATIONS, enforced inside `call()` below every caller
(the engine, the sweep, `scripts/import.ts`, a hand-run resync). Above 70% it
paces; at the ceiling it **refuses locally and sends nothing** until the window
drains. Refusing is safe wherever it lands — `listDealIds` throws rather than
returning a short read, `sweepByAntiJoin` will not delete on an empty source, and
no watermark advances except after a clean run — so a refusal costs freshness and
nothing else.

`DEFAULT_HOURLY_INVOCATIONS` is **15 000**, and the number is set by the one
expensive hour that is legitimate: the sweep's, at ~9 500. **WHAT IT DOES AND
DOES NOT CATCH, stated honestly, because an earlier draft of this paragraph
claimed more than it can deliver.** It does NOT catch a return to the
fifty-command chain on its own — that is ~6 000 an hour at the deployed tick,
comfortably under a ceiling the sweep forces to be high. `portalBudget.test.ts`
is what catches that, and it is why the test pins an EXACT number. What the
ceiling catches is the shape neither a test nor a comment can: an UNBOUNDED
loop. A cursor that stops advancing, a restart storm re-reading 45 days of
stage history over and over, a full walk retried in a tick loop — the
2026-09-14 pattern, where 94–97% of a day's traffic was the same 45-day window
read 11–29 times. Any of those crosses 15 000 in minutes. It
is `BITRIX24_HOURLY_INVOCATIONS`, so a portal under strain can be throttled
**without a deploy**, which is the one thing nobody could do during either block.
`scripts/import.ts` raises it to 250 000 — a full import is a deliberate act
somebody is watching, and sizing the worker's ceiling for a run that happens
twice a year would defeat having one. **A budget refusal must not trip
`PortalGate`**: the portal never said no, we did, and tripping it would put
«Bitrix24 band» on the freshness chip over our own accounting.
`classifyRefusal` returns `null` for `LOCAL_BUDGET_EXCEEDED` — listed BY NAME in
`NOT_A_REFUSAL`, because the bare-401 fallback would otherwise sweep it into
`CREDENTIAL` and tell an operator to go and issue a new webhook for a portal that
is answering every call.

**AND A SELF-IMPOSED STOP READS AS OURS, ALL THE WAY TO THE CHIP.** Three things
had to line up or it would have reported as a Bitrix24 outage:
*the code has to survive the MESSAGE* — `sync_log` stores text and
`syncErrorCode` recovers the code from it with a regex, so a code carried only on
the error's `code` field reaches the header as «UNKNOWN», which is the one word
nobody can act on; `SELF_LIMIT_CODE` is therefore one exported constant and it is
printed at the front of the thrown message.
*the chip needs a fifth reading* — `AlertsDto.syncError.kind` gains `SELF_LIMIT`,
and **it is NOT a `RefusalClass`**: that union answers «what should the CALLER
do» and `PortalGate` switches on it, so a fifth member there would fall into the
THROTTLE/CREDENTIAL branch and shut the gate over our own accounting. The two
were already joined by `?? 'UNKNOWN'`, which is the seam. The union is
hand-mirrored in `src/lib/api.ts` and `Shell.tsx` — **nothing checks the mirror**.
*and the sentence has to say so*: «Dashboard oʻzini toʻxtatdi… Bitrix24 sogʻlom»,
not «Bitrix24 dan maʼlumot olinmayapti — texnik yordam kerak».
The worker prints the same judgement with the remedy attached, naming the three
methods that spent the hour.

**THE HONEST COST OF THE CEILING: a cold start on an EMPTY database will hit
it.** The first walks are millions of rows — ~9 300 invocations for the deals
alone and far more for stage history — so an unattended worker filling a fresh
database makes progress at 15 000 invocations an hour instead of running flat
out. That is the intended behaviour and not a bug to route around:
`npm run bitrix:import` is the path built for that case and raises the ceiling
to 250 000. The worker's log says exactly this when it trips.

**THE TEST IS THE GUARANTEE, NOT THE COMMENT.** `portalBudget.test.ts` walks a
simulated hour of the deployed cadence against a portal where nothing changed
and counts what would have been asked for: **241 requests, 481 invocations** —
pinned EXACTLY rather than bounded, because a range absorbs a new pass without
anybody noticing it was added, and «one more entity, it is only fifty commands»
is how the old number reached ~15 000 an hour in the first place. Widen the chain back, add a pass nobody costed, or make
a walk re-read its window, and the number moves THERE before it moves on the
portal.

**TWO CADENCES WENT WITH IT, 2026-09-16.** The **deletion sweep** is DAILY
(`SYNC_SWEEP_EVERY` 1440, was 360): the narrow chain took the hot path to
~11 500 a day and did not touch the sweep, which walks a fixed 464 396 ids
however narrow the chain is — so at four bursts a day it had become **three
quarters of everything we spend** (37 200 against 11 500). One burst is ~9 300.
A deleted deal can now be counted here for up to a DAY; read a day-old test deal
as this setting. The **reference pass** is THREE-HOURLY (`SYNC_REFERENCE_EVERY`
180, was 30): departments, employees, products, pipelines, stages, sources and
stores change a few times a MONTH and were being re-read 48 times a day, and
`PRODUCTS`/`STOCK` page `catalog.*` fifty rows at a time so the pass is dozens of
requests, not one. A new department head now reaches the org chart and a TEAM
account's scope up to three hours later; `npm run bitrix:resync -- DEPARTMENTS
EMPLOYEES` does it in seconds when a hand-over has to land now.

**THE SWEEP RUNS AT NIGHT SINCE 2026-10-14** (`isSweepDue` in `schedule.ts`):
once a night in the backfill's window, 01:00–06:00 Tashkent. On the bare
24-hour clock it had settled at 15:45, where the contact relink behind it
scans every deal on the 1-vCPU database and a reader's request timed out in
the same minute. The deals backfill and the one-off reads keep an hour clear
of it either side (`sweepNear`), since both now share its night.

**`SYNC_REFERENCE_EVERY` IS SET IN `.do/app.yaml`, SO THE CODE DEFAULT ALONE
CHANGES NOTHING IN PRODUCTION** — and the LIVE spec overrides the committed one
again (see *Deploy*: take the live spec, edit it, apply that). A cadence changed
in one of the three places and not the others is invisible and silent, which is
how it would come back.

**THE WHOLE DAY, BEFORE AND AFTER — AND THE TICK LENGTH IS PART OF THE SUM.**
Every figure above counts INVOCATIONS PER TICK; the day depends on how long a
tick is, and **the deployed app and this repository disagreed about that until
2026-09-16**. `.do/app.yaml` said `SYNC_INTERVAL_SEC` 60 and the LIVE spec said
180, so the same `SYNC_SWEEP_EVERY` meant six hours here and eighteen there, and
neither file looked wrong on its own. Read the tick and the two tick-COUNTS
together or none of them.

| | as deployed before | as deployed now |
|---|---|---|
| tick | 180 s | **120 s** |
| hot path | ~96 000 /day | **~5 800** |
| deletion sweep | ~12 400 /day (18 h) | **~9 300** (24 h) |
| reference | 16 passes/day (90 min) | **8** (3 h) |
| **total** | **~108 000** | **~15 000, an 86% cut** |

At the code's own default 60 s tick the old hot path is ~288 000 a day, which is
the figure the commit message quotes; production was a third of that because its
tick was three times longer. Both are true and they are not the same number.

The tick went to **120 s** on the client's instruction («2 minutda yangilansin»)
rather than back to the code's 60: the load cut bought the freshness back, and
two minutes was what they wanted. **The sweep is now ~62% of everything we
spend**, so it is where the next cut comes from if one is ever needed. No screen
reads anything different.

**WHAT THAT LEAVES, AND WHERE THE NEXT LEVER IS.** ~288 000 → ~11 500
invocations a day on the hot path, against the deletion sweep's unchanged
~37 200 (4 runs × 186 requests × 50 commands). **The sweep is now ~75% of
everything we spend**, so if blocks continue it is the next thing to cut, and
it is one environment variable: `SYNC_SWEEP_EVERY` (360 today, see the
six-hourly note above for what raising it costs — a deleted deal survives that
much longer here). `tests/integrations/portalMeter.test.ts` pins the gauge and
the request-versus-invocation gap; `bitrix24.test.ts` pins the narrow opening
and the widening, by counting the commands the walk actually sent.

- **THE CHIP NAMED ONE ENTITY FOR A PORTAL-WIDE OUTAGE.** `syncError.entity` is
  whichever pass failed LAST, so an hour with every number on every screen
  frozen was reported as «stage_history» — the narrowest thing on the portal,
  and a reader who knows what it is would have taken the deal figures for
  current. `findCurrentSyncFailure` also counts the DISTINCT entities failing
  since the last success (an index walk bounded by that timestamp, 0.3 ms on
  production, and it does not run at all while the sync is healthy), and
  `syncFailureScope` prints «9 ta boʻlim» instead of a name whenever the count
  is known and above one. A null count means *not counted*, never *narrow*, so
  it falls back to the name rather than inventing a scope. It is read beside
  `syncError.since`, which says how LONG.
- **THE LADDER HAS TO ACTUALLY CLIMB, AND UNTIL 2026-09-16 IT DID NOT.** Watched
on production under a live `OVERLOAD_LIMIT`, the worker printed «60s kutiladi»
on EVERY probe instead of 60 → 120 → 240 → 480 → 600. Two things combined. The
startup health check failed three times at network level, and `transientRun` was
only ever reset by a SUCCESS — of which there are none during a block — so the
count sat at the tolerance for the whole outage. And the TRANSIENT branch called
`openGate`, which REWRITES `kind`: one stray socket error turned a THROTTLE gate
into a TRANSIENT one, whose delay is a flat 60 s and whose `probes` counter
starts again at zero, and the next `OVERLOAD_LIMIT` then saw a kind mismatch and
opened at rung zero. Round and round, ~860 probes a day at a portal that had
administratively blocked us. **THROTTLE and CREDENTIAL are specific diagnoses
and TRANSIENT is the absence of one, so the specific one wins**: a transient no
longer demotes a named gate, and any named refusal — `OPERATION_TIME_LIMIT`
included, which is why the reset sits ABOVE the METHOD branch — ends the
transient run. Pinned by three cases in `portalRefusal.test.ts`.

**BITRIX24'S PUBLISHED LIMITS, AND WHERE THIS INTEGRATION STANDS — measured
2026-09-17** against apidocs.bitrix24.ru/limits.html. Three documented limits
and one that is not:
- **Intensity** — a leaky bucket on HTTP REQUESTS per source IP per portal
  (`batch` is one request): Enterprise drains 5/s with 250 of headroom, every
  other plan 2/s with 50. `QUERY_LIMIT_EXCEEDED`, 503. Our `RateLimiter` is 2/s,
  the lower plan's drain rate, so it holds on either plan; a hot tick is ~5
  requests every 120 s.
- **Execution time of one request** — 60 s on the cloud, after which the portal
  interrupts it. `PORTAL_REQUEST_LIMIT_MS`; our local abort is 65 s (it was
  180 s for a `batch`), pinned by `portalRefusal.test.ts`.
- **Operating time** — per METHOD, per WEBHOOK, over ten one-minute baskets;
  `OPERATION_TIME_LIMIT`, 429, blocks that method for that webhook only.
  **It is not shared with the portal's own users**, which corrects the reading
  above that «our steady 30% plus their morning emptied the method's basket»:
  the three blocks were `OVERLOAD_LIMIT`, which that page does not mention at
  all — an administrative, portal-wide protection. Our basket for
  `crm.deal.list` read **6.6 s** (1.4%) on 2026-09-17 09:18 Tashkent.
- **`OVERLOAD_LIMIT` is undocumented**, so no setting can promise to avoid it;
  keeping our share of the portal's load small is the only lever.
Steady state that morning, 16 h with no failure: DEALS 1.5–1.8 s a pass
(~8 s per 10 min), CUSTOMERS 0.95 s, STAGE_HISTORY 0.8 s; reference EMPLOYEES
15.5 s and PRODUCTS 14 s, eight times a day. The deletion sweep is cheap per
command — eight `select: ['ID']` seeks cost ~0.06 s of portal time against
~0.23 s for the hot `select` — and dropping the nine-pipeline `CATEGORY_ID`
filter was measured and changes nothing.

**A NEW WEBHOOK DOES NOT LIFT AN ADDRESS BLOCK — 2026-09-16.** After the third
`OVERLOAD_LIMIT` the webhook was replaced (`/rest/8868/…`). The new key answered
in 480 ms from an office machine and the deployed worker still could not reach
the portal: `fetch failed [UND_ERR_CONNECT_TIMEOUT]`. Measured from the worker:
TCP opened to all four portal addresses in 44 ms and the TLS handshake never
completed on any of them — small ClientHello and TLS 1.2 included — while the
same key answered from an office machine in 250 ms. No key was ever read;
Bitrix24's protection had stopped answering the SERVER'S ADDRESS.
The probe keeps its reason (`lastProbeError`, printed as «sabab:» under the
worker's wait line) and every failure message carries Node's socket code,
because «UNKNOWN» was all the log said. A network failure climbs its OWN
ladder (`NETWORK_LADDER_MS`) with ONE attempt per rung — 2, 5, 15, then every
30 minutes until 2026-10-20, **one minute then every tick (120 s) since** (see
*Server cannot reach the portal* below). **The ban lifted for a moment at 11:35 UTC and the worker answered
with a full reference tick and was dropped again inside a minute** — so a
recovery now runs `CALM_TICKS` (3) hot-only ticks before any reference pass or
sweep, a restart inside the block seeds the gate shut from `sync_log` (and a
failed startup health check shuts it too), and `reachability.ts` (deleted 2026-09-17 as dead code) is no longer
run by the worker: its ~11 simultaneous unfinished handshakes answered the
question once and afterwards looked like a scan. **Read `UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET` in that line as
«our address is blocked or the route is down»: rotating the key changes nothing,
waiting, Bitrix24 support (with the egress IP) or a new egress IP do.**

**SERVER CANNOT REACH THE PORTAL — 2026-10-20, and how to read the chip.**
The chip read «Bitrix24 · sinx xatosi · 15 daqiqa oldin» from 11:32 Tashkent.
The worker log said `Bitrix24 call "profile" failed after 1 attempt: fetch
failed [UND_ERR_CONNECT_TIMEOUT]`; the same minute an office machine opened
`obey.bitrix24.kz` in 0.35 s (TLS 0.21 s) on all four addresses, and
status.digitalocean.com showed no FRA1 incident. It recovered at 11:45:54, was
lost again at 11:48 and was still down at 11:55. `sync_log`, 30 days to
2026-10-20: seven such drops (`gate: UNKNOWN`, no portal code) — 09-21 ×2,
10-03 (night), 10-15, 10-16, 10-20 ×2 — 8–30 minutes of frozen screens each,
none a throttle, none a credential. The app has NO dedicated egress (no
`egress:` in the live spec), so its outbound address is DigitalOcean's SHARED,
changing NAT address in `fra`: whatever Bitrix24's protection does to that
address — for our traffic or a neighbour's — happens to us, and there is no
fixed IP to hand Bitrix24 support. Three changes, all in this commit:
*the ladder* — 2 → 5 → 15 → 30 minutes turned every drop into up to half an
hour of staleness AFTER the line came back; one `profile` per tick is less
than a healthy tick sends, and `CALM_TICKS` still keeps the recovery light;
*the chip* — a lost connection (`isNetworkFailure` in `refusal.ts`, moved
there from the worker so `/meta/alerts` shares it) is `kind: 'TRANSIENT'` and
reads «aloqa yoʻq» with «oʻzi tiklanadi», not «sinx xatosi — texnik yordam
kerak»; *this note*.

**THE ROOT CAUSE, MEASURED FROM INSIDE THE WORKER THE SAME MORNING.** The portal
is in Moscow (Corp Soft, AS39337; four fronts). From the deployed `sync`
container (`doctl apps console`, egress 164.90.174.139): TCP opened to all four
in ~45 ms; TLS completed on **46.235.53.58** (100 ms) and **195.208.185.4**
(118 ms) and **never completed on 46.235.53.67 and 46.235.53.69**. ya.ru,
1c-bitrix.ru and google answered from the same container; check-host.net
completed TLS to all four fronts from 38 datacentres. So it is not Bitrix24
being down, not a blanket Russian filter on DigitalOcean, and not our key: two
fronts drop OUR address. fetch dials one address per connection and never tries
another, so one connection in two hung ten seconds, three in a row shut the
gate, and the sync stopped while half the portal answered. **`portalAddresses.ts`
is the fix**: the provider's default fetch is undici's own with a connector that
walks the addresses (5 s handshake budget each), tries a front that dropped us
LAST for 15 minutes, and prints «portal manzili … javob bermadi» / «… yana javob
beryapti» (or «notoʻgʻri sertifikat berdi» — a refused certificate is never a
network drop) to the worker log once per change. **It is pinned to HTTP/1.1
twice** (`allowH2: false` on the Agent and the connector): undici 8 offers h2 by
default and the portal picks it, which would put every call on one multiplexed
session that a dropping front hangs all at once. Every front failing (2026-09-16)
still fails with the last front's network error — `UND_ERR_CONNECT_TIMEOUT`, or
`ECONNREFUSED`/`ECONNRESET`, all read by `isNetworkFailure` — for that one only a
different egress helps: a dedicated egress IP (App Platform → Networking →
Dedicated Egress IPs, two static IPs, paid; it must then stay in every spec
applied — `egress: type: DEDICATED_IP` — or the IPs are released for good), and
those IPs sent to Bitrix24 support. Checked BY HAND on 2026-10-20 (a scratch
script, not in the suite — the suite fakes the dial): real undici and the real
certificate, a dead address first → switched after 5 s and the portal answered;
no address alive → `fetch failed [UND_ERR_CONNECT_TIMEOUT]`; ALPN `h2` by default,
`http/1.1` with the pin. **The same morning the new container (same egress
164.90.174.139) got NO front at all** — two dark at 07:20, four at 07:25 — so
the connector shortens partial outages and cannot end that one; that is the
dedicated-IP and support-ticket case (`~/projects/Work/bitrix24-ticket-2026-10-20.txt`).

**AND THE TRIGGER: THE ROUTE FREEZES A CONNECTION AFTER ~20 KB (measured the
same morning, inside the worker).** A 384 KB static file from two fronts stopped
at 15 757 and 15 746 bytes of body; ten-kilobyte `Range` requests each on a
FRESH connection all arrived, while the third on one kept-alive connection froze.
mirror.yandex.ru sent 1 MB down the same container in 0.56 s, so it is this
path. Our answers on the wire (gzip, measured): deal walk 2 commands 7.5 KB,
**8 commands 31 KB**, 32 → 131 KB, 50 → 227 KB; contacts 2 → 6 KB; calls 2 → 8 KB;
the sweep's `ID, CONTACT_ID` walk at 50 → 17 KB; every single-page reference
call ≤ 7.6 KB. `sync_log`: after every recovery CUSTOMERS succeeded, then DEALS
read exactly 100 rows and hung (11:30, 11:45, 12:12, 12:32 Tashkent) — the
8-command answer — and within minutes the handshakes stopped too. The fix is
two lines of policy: **one request per connection** (`pipelining: 0` in
`portalAddresses.ts`) and **every batch sized to `RESPONSE_BUDGET_BYTES`** (48 000
uncompressed ≈ 10 KB on the wire at the worst ratio measured, 4.7×), learned
from what a ROW weighed (`rowBytes`, keyed by method + select; width `chains` too,
so a sweep that dies mid-walk cannot widen the deal pass): deals walk one
command (one command is the floor — a deal page is ~57 KB uncompressed but
~3.8 KB on the wire), contacts three, the sweep ~27, `dealsById` two until
measured, product rows by what a DEAL's rows weighed (eight until measured).
`SyncEngine`'s page backstop went 10 000 → 50 000 and `CALLS_MAX_PAGES` 200 →
1 000, since a page can now be 50 rows. More round trips (a 3 500-deal catch-up is ~70 at 2 rps,
~40 s), the same invocations. Last night's sweep (17 KB answers on one
connection) ran clean, so the freeze is intermittent — it started ~11:30 that
day — which is exactly why it must not be load-bearing.

**AND IT WAS NOT ENOUGH: THE FILTER IS ON THE NETWORK, NOT ON OUR REQUESTS
(measured 09:10–09:30 UTC the same day, with all of the above live).** The log
showed each front answering a probe, then dropping us 5–40 s into the
recovery, round the four, until the gate shut again. From the container: the
384 KB file still stopped at exactly **15 761 bytes** on the two fronts that
answered; twenty handshakes at 2.5/s to one front all completed (so it is not
a handshake rate); 1 MB came down in 0.4–5 s from mirror.yandex.ru,
storage.yandexcloud.net, mirror.selectel.ru, mirror.ps.kz and mirror.hoster.kz
(Russia and Kazakhstan are reachable — only the portal's fronts are not); and
Tashkent (Uztelecom) fetched the same file whole from every front in 0.8 s.
check-host.net, same file: whole on 49 of 55 nodes — Moscow, St Petersburg,
Karaganda, Istanbul, small European hosters — and stalled on **Hetzner,
Scaleway, Contabo** and two other big-hosting nodes. So the portal's fronts
(or the route into Corp Soft) throttle the big foreign hosting networks,
DigitalOcean among them, and no request shape gets past that. The other
integrations on DigitalOcean («AI hr», «Otsenka ROP app») are cut off the same
way. The way round is to send the calls from a network the filter does not
cover: **`BITRIX24_PROXY_URL`** (`http://user:pass@host:port`) routes every
portal call through an HTTP CONNECT relay — TLS stays end to end, the relay
sees the portal's name, never the webhook — e.g. tinyproxy on a small VPS in
Uzbekistan (the «ai_registrator» server is one, in Tashkent) limited to
`obey.bitrix24.kz:443` with BasicAuth. Unset, the calls go direct as before.
The worker's start-up line says which. A message with these measurements went
to Bitrix24 support («Поддержка24» chat on the portal) on 2026-10-20.

How to diagnose the chip, in order — no database needed for the first two:
1. **Read the chip's word.** «Bitrix24 band» = the portal's throttle, wait.
   «aloqa yoʻq» = the server cannot reach the portal, wait; if it lasts, the
   portal is filtering our hosting network — `BITRIX24_PROXY_URL` (above). Red dot / webhook text = the credential is dead: a new webhook in
   Bitrix24, set as `BITRIX24_WEBHOOK_URL` on the app. «sinx xatosi» = none of
   those — read the log.
2. **Read the worker log:** `doctl apps logs 292f634e-beef-46da-bf57-750f346f58e0
   sync --type run --tail 80`. The `sabab:` line under «portal hali ham band»
   names the cause (and «! portal manzili X javob bermadi» lines name a front
   that dropped us — harmless while another answers): `UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET` = network
   (`[TIMEOUT]` = no answer in time: a dead line or a very slow portal); `OVERLOAD_LIMIT` = throttle; `INVALID_CREDENTIALS` / `NO_AUTH_FOUND`
   = key; `LOCAL_BUDGET_EXCEEDED` = our own ceiling. «✓ portal javob berdi» =
   it is over. A deploy starts a new container and the old one's log is gone.
3. **Check each front from INSIDE the worker** when the log says network:
   `doctl apps console <app-id> sync`, then a TLS handshake per address
   (`node -e` with `tls.connect({host: ip, servername: 'obey.bitrix24.kz', port: 443})`).
   Some fronts answering = handled by the connector; none = egress problem.
4. **Check the portal from outside:** `curl -s -o /dev/null -w
   '%{time_appconnect} %{http_code}\n' https://obey.bitrix24.kz/rest/` — a fast
   404 from here while the worker times out is a server-to-portal network
   problem, not Bitrix24 being down.
5. **History, if needed:** failed rows in `sync_log` for 30 days
   (`status = 'FAILED'`, `errorMessage`), and gaps over 6 minutes between
   successful `DEALS` passes — that is what the reader saw as a frozen chip.

**THE ATTEMPT COUNT IN A FAILURE MESSAGE IS EVIDENCE.** `sync_log` is what
  this integration hands Bitrix24 support when it is asked what load it was
  putting on the portal, and the ticket opened after the 2026-09-14 block
  promises in writing that we back off when refused. That is what the gate's
  probe ladder honours, and what its 600 s ceiling bounds — do not raise it
  without remembering what it answers to.
- **`isCredentialFailure` IS STILL EXPORTED, AND IT IS NOW A READING OF
  `refusal.ts` RATHER THAN A SECOND LIST.** It takes a MESSAGE, because that is
  what survives into `sync_log`; `classifyRefusal` reads a live error's `code`
  field first and falls back to the same screen. Two copies of the portal's
  vocabulary in one repository is exactly the drift this file keeps warning
  about.

**THE WORKER WAS DYING SEVENTEEN TIMES A DAY, AND THE ROISTAT CHILD WAS THE
BALLOON.** Measured 2026-09-14 and fixed the same day. DigitalOcean sets
`NODE_OPTIONS=--max-old-space-size=768` on this worker; `spawn(..., {env:
process.env})` handed the Roistat child the same licence, so a 1 024 MB
container held two V8 isolates each entitled to 768 MB. Neither felt pressure,
neither collected defensively, neither raised a JavaScript OOM — the kernel got
there first, which is why no out-of-memory message was ever in any log and the
death showed up only as an unnamed `code === null`.

The evidence, none of it estimated: the worker's own RSS is flat at 262–297 MB
for a whole hour and the deletion sweep adds ~65 MB (304–327 MB on the two
tick-60 windows it survived), while DO's `memory_percentage` metric for
component `sync` caught the container at **999.0 MB of 1 024** in the tick-60
window; `sync_log` shows 15 gaps >100 s in 24 h, all 62–67 minutes apart and
**every one beginning the instant CALLS finished** — inside the sweep-plus-
Roistat block — twelve of them followed by a `DEPARTMENTS` boot (a fresh
process), three by a `CUSTOMERS` tick (the same one). Ruled out with the same
data: a socket idle-drop (cannot land on tick 60 fifteen times), a leak (RSS
flat), the sweep's id Set (65 MB, measured), the 200 MB `IdResolver` map
(`PAYMENTS` is in neither HOT nor REFERENCE, so it is never built).

`ROISTAT_HEAP_MB` = 320 on the child's own argv, with `NODE_OPTIONS` stripped
from its environment. A synchronous `spawn` throw is now caught too: it was the
one awaited call in the tick loop with no catch, so ENOMEM there rejected into
`main().catch` and exited the process — a second, quieter version of the same
death. And `close` names the signal, so `SIGKILL` says «xotira chegarasi»
instead of hiding as an interruption.

**How to check it stayed fixed, without container logs** (`doctl apps logs …
--type run` answers `websocket: close 1011`): count `DEPARTMENTS` rows in
`sync_log` for a day — that entity only runs at tick 0 and every 30 ticks, so
12–17 a day means the worker is still booting that often and 2 (the deploys)
means it is not. Container memory comes from the metrics API directly —
`monitoring/metrics/apps/memory_percentage?app_id=…`, filter
`metric.app_component == 'sync'`, ×10.24 for MB — because doctl does not wrap
it. And `SELECT max("importedAt") FROM marketing_snapshot` must keep advancing
hourly: if it stops, the child is hitting the new 320 MB cap and the log line
above will say so.

Worker cadence lives in `scripts/syncWorker.ts`: `SYNC_INTERVAL_SEC` 60,
reference data every 30 ticks, Roistat every 60, **the deletion sweep every 360
(six-hourly since 2026-09-15, was 60)**, and
`SYNC_HISTORY_BACKFILL_DAYS` 45 — the stage-history cursor is wound back once
at startup so the ordinary incremental pass repairs arrival rows lost before
the watermark learned to rewind (`historyBackfillCursor`; it never writes a
cursor where there is none, and never moves one forward). 76 000 of 222 000
rows, under a minute, once per start. Backoff is a
**floor**, not an addend — as an addend it disappeared exactly when it was
needed.

**THE SWEEP WENT SIX-HOURLY, AND A DELETED DEAL NOW SURVIVES UP TO SIX HOURS
HERE.** `listDealIds` walks all 464 396 deals at 2 500 a round trip = 180
requests, ninety seconds of continuous traffic at the 2 rps limiter. Hourly
that was 4 320 requests a day — **32% of the worker's entire HTTP volume** —
carrying 9 000 `crm.deal.list` invocations an hour against that method's
ten-minute operating basket, to detect an event the code's own comment calls
rare. Bitrix24's helpdesk names «an app that checks all CRM activities every
five minutes» as the kind of thing that earns an administrative block, and this
portal issued one on 2026-09-14 and again on 2026-09-15. 24 bursts a day became
4. Nothing about the walk, `sweepByAntiJoin` or the short-read guard changed, so
correctness is untouched — **read a six-hour-old test deal as `SYNC_SWEEP_EVERY`,
not as a sync fault**. (Lowering it no longer brings the old latency back: the
sweep is at most nightly since 2026-10-14, see «THE SWEEP RUNS AT NIGHT».)

---

