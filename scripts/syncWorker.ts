/**
 * Continuous Bitrix24 synchronisation.
 *
 *     npm run bitrix:worker
 *
 * Keeps the database within about a minute of the portal, so the dashboard is
 * current without anyone pressing anything. The browser refetches on the same
 * cadence; the two together are what make an always-open screen trustworthy.
 *
 * WHAT RUNS HOW OFTEN
 * Transactional data — deals, stage history, calls, contacts — changes
 * constantly and is read every tick. Reference data — employees, departments,
 * products, pipelines, stages, sources, stores — changes a few times a month,
 * and re-reading it sixty times an hour would spend the portal's rate limit on
 * rows that are already correct. It runs on its own slower cadence and on the
 * first tick after startup.
 *
 * WHY IT IS SAFE TO RUN FOREVER
 * Every write is an upsert keyed on the source record's own id, so a tick that
 * overlaps the previous one cannot double anything. Each entity carries its own
 * watermark, advanced only after a clean run — a failed tick re-reads the same
 * window next time rather than skipping it.
 *
 * ONE AT A TIME
 * A Postgres advisory lock keeps a second worker out rather than letting it
 * race the first. Two running at once produced foreign-key rejections on call
 * records and spent twice the portal's rate limit for no extra freshness.
 *
 * The lock lives on a connection held open for the life of the process, NOT on
 * a pooled one — a pooled connection goes back to the pool the moment the
 * query returns and Postgres drops the lock with it, which looks like it works
 * and enforces nothing. Holding it on a dedicated client also means it
 * releases by itself if the process dies without cleaning up, the case a flag
 * column in a table gets wrong.
 *
 * A second copy WAITS instead of exiting. On a rolling redeploy the new worker
 * starts before the old one has finished its tick, and a worker that exits is
 * a worker the platform restarts — so exiting here would produce a restart
 * loop until the old process happened to go away. Waiting turns the same
 * situation into a few quiet seconds of overlap.
 */

import 'dotenv/config'

import { spawn } from 'node:child_process'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import type { PoolClient } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

import { PrismaClient } from '../src/generated/prisma/client'
import type { SyncEntityValue } from '../src/server/domain/types'
import type { RawCall } from '../src/server/integrations/crm/CrmProvider'
import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { relayHost } from '../src/server/integrations/crm/bitrix24/portalAddresses'
import { createSyncHandlers, SweepRefusedError } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'
import { historyBackfillCursor } from '../src/server/integrations/crm/sync/backfill'
import { relinkDealContacts } from '../src/server/integrations/crm/sync/contactRelink'
import {
  type RecentPopulation,
  deleteDealsByExternalId,
  sweepRecentConfirmations,
} from '../src/server/integrations/crm/sync/recentDeletions'
import { closedTriageDealIds, rereadClosedTriageDeals } from '../src/server/integrations/crm/sync/triageMoves'
import {
  applyCrmEvents,
  dropUnknownDeletes,
  expireCrmEvents,
  localDealIds,
  markCrmEventsProcessed,
  pendingCrmEvents,
  pruneCrmEvents,
  takeDistinct,
} from '../src/server/integrations/crm/sync/crmEvents'
import {
  describeFeedError,
  prismaChatStore,
  prismaFeedClock,
  refreshOpenLineChats,
  refreshRecentCalls,
} from '../src/server/integrations/crm/sync/leadWatchFeeds'
import {
  FORM_FILLS_FROM_MONTH,
  prismaFormFillStore,
  refreshFormFills,
} from '../src/server/integrations/crm/sync/formFillFeed'
import {
  DEAL_BIRTHS_FROM_MONTH,
  prismaDealBirthStore,
  prismaDealMoveStore,
  refreshDealBirths,
} from '../src/server/integrations/crm/sync/dealBirthFeed'
import { refreshBezkval } from '../src/server/integrations/crm/sync/bezkvalRefresh'
import { RegistrationRepository } from '../src/server/repositories/registrationRepository'
import { META_DEEP_REFRESH_DAYS, importMetaSpend } from '../src/server/integrations/meta/metaImport'
import { importMetaAdForms } from '../src/server/integrations/meta/metaAdFormImport'
import { applyLabelRenames } from '../src/server/integrations/crm/sync/labelRenames'
import { pendingLinksSince, repairPendingLinks } from '../src/server/integrations/crm/sync/pendingLinks'
import { importMetaLeads } from '../src/server/integrations/meta/metaLeadImport'
import { importMoyskladOrders, recordMoyskladFailure } from '../src/server/integrations/moysklad/moyskladImport'
import { resolvePeriod, sinceMonth, zonedDateKey } from '../src/server/domain/period/period'
import {
  type DealsBackfill,
  isBackfillDue,
  isPassDue,
  isResolvePassDue,
  isSweepDue,
  isSweepNear,
  planTick,
  REFERENCE_MARKER,
  RESOLVE,
  runOneOff,
  SWEEP_REFUSED_MARK,
  SWEEP_RETRY_MS,
  sweepLogRow,
} from '../src/server/integrations/crm/sync/schedule'
import {
  classifyRefusal,
  isNetworkFailure,
  refusalCode,
  SELF_LIMIT_CODE,
} from '../src/server/integrations/crm/bitrix24/refusal'
import type { RefusalClass } from '../src/server/integrations/crm/bitrix24/refusal'
import { FRESHNESS_ENTITIES } from '../src/server/repositories/referenceRepository'
import { SverkaRepository } from '../src/server/repositories/sverkaRepository'
import { productRecheckRows } from '../src/server/domain/sverka/sverka'
import { CALL_DATA_FLOOR } from '../src/lib/callQuality'
import { LEAD_WATCH_SETTINGS } from '../src/lib/leadWatchSettings'

const DATABASE_URL = process.env.DATABASE_URL
const WEBHOOK_URL = process.env.BITRIX24_WEBHOOK_URL

if (!DATABASE_URL || !WEBHOOK_URL) {
  console.error('\n  DATABASE_URL va BITRIX24_WEBHOOK_URL kerak.\n')
  process.exit(1)
}

/** Seconds between ticks. One minute is the design point. */
const INTERVAL_SEC = Number(process.env.SYNC_INTERVAL_SEC ?? 60)

/**
 * How many ticks between reference-data refreshes. Default: every three hours.
 *
 * WAS THIRTY MINUTES, AND NOTHING IT READS MOVES THAT FAST. Departments,
 * employees, products, pipelines, stages and sources change a few times
 * a MONTH — the file header says so — and this pass was asking the portal about
 * all of them 48 times a day. `PRODUCTS` pages through
 * `catalog.*` fifty rows at a time, so the pass is not one request but dozens.
 *
 * Three-hourly is 8 passes a day instead of 48. What that delays: a new
 * department head named in Bitrix24 reaches the org chart, the ROP picker and
 * a TEAM account's scope up to three hours later instead of thirty minutes.
 * Nobody's money moves — every analytic reads `employee."departmentId"`, which
 * this pass writes, and a head appointed at eleven who appears at two is not a
 * reporting error. If a specific hand-over needs to land now,
 * `npm run bitrix:resync -- DEPARTMENTS EMPLOYEES` does it in seconds.
 */
const REFERENCE_EVERY = Number(process.env.SYNC_REFERENCE_EVERY ?? 180)

/**
 * How many ticks between Roistat imports. Default: hourly.
 *
 * The marketing module reads a SECOND source — the client's published page,
 * not Bitrix24 — and without this it only ever refreshed when someone ran
 * `npm run roistat:import` by hand. On a deployed dashboard that means the
 * Reklama samarasi screen quietly freezes at whatever the last manual run
 * saw, which is exactly the failure the freshness panel exists to expose and
 * the one nobody notices because the page still renders numbers.
 *
 * Hourly, not every minute: the source is a 5.5 MB static page regenerated by
 * the client on their own schedule, and its sheet-fed dimensions move a few
 * times a day. Re-reading it sixty times an hour would spend bandwidth to
 * re-import bytes that did not change — the importer's own digest check
 * proves that, printing "0 changed" on a re-run.
 *
 * Set to 0 to turn it off.
 */
const ROISTAT_EVERY = Number(process.env.SYNC_ROISTAT_EVERY ?? 60)
/**
 * ON THE WALL CLOCK SINCE 2026-10-22, HOURLY. It was `tick % ROISTAT_EVERY`:
 * 60 ticks at the deployed 120 s tick is TWO hours, and `tick` starts at 0
 * with every process — so on a day of deploys less than two hours apart it
 * never ran at all, and /target's so'm spend sat on yesterday's rate. Now
 * `SYNC_ROISTAT_MIN` minutes (default 60) since the newest snapshot's
 * `importedAt`, the way Meta and the sweep keep time. `SYNC_ROISTAT_EVERY`
 * 0 still switches it off.
 */
const ROISTAT_MS = ROISTAT_EVERY > 0 ? Number(process.env.SYNC_ROISTAT_MIN ?? 60) * 60_000 : 0

/**
 * «Mijoz qaytishi», built and stored beside the loop (2026-10-24) — every
 * half hour of the working day, every three hours outside it; see
 * `src/server/services/cohortSnapshotRefresh.ts`. `SYNC_COHORTS=0` switches
 * it off, and the screen then builds every question live, as before.
 */
const COHORTS_ON = process.env.SYNC_COHORTS !== '0'

/**
 * Roistat's closed months — «Kunlar boʻyicha», «Shu yil», «Oʻtgan oy» —
 * read and stored beside the loop (2026-10-28), at most three months a
 * pass; see `src/server/services/monthScanRefresh.ts`. `SYNC_MONTH_SCANS=0`
 * switches it off, and the screens then read every month live, as before.
 */
const MONTH_SCANS_ON = process.env.SYNC_MONTH_SCANS !== '0'

/**
 * Meta Ads spend, lead-form leads and ad→form links, every `SYNC_META_MIN`
 * minutes. Off without `META_ACCESS_TOKEN`. In-process, unlike Roistat:
 * fourteen accounts' daily rows are a few hundred small objects, not a
 * five-megabyte page, and the calls go to Meta, never to Bitrix24, so the
 * portal's budget is untouched.
 *
 * FIFTEEN MINUTES, IN MINUTES, SINCE 2026-10-22. It was `SYNC_META_EVERY`
 * ticks — the live spec's 30 at its 120 s tick, hourly. The client: «har bir
 * oʻzgarish Facebook va Bitrix24 dagi srazi yangilansin». Meta refreshes a
 * running day's Insights roughly every quarter hour; asking oftener reads the
 * same numbers. Each pass is ~3 Insights calls an account for the week, so
 * ~12 an hour an account — the `ads_insights` budget, never `ads_management`.
 * `SYNC_META_EVERY` is IGNORED now: the live spec still carries it, and
 * honouring it would have kept production hourly with this file saying 15.
 */
const META_MS = Number(process.env.SYNC_META_MIN ?? 15) * 60_000
/**
 * How long one pass may walk accounts back past 2026-07-01, toward Insights'
 * 37-month floor (`importMetaSpend` `historyMs`). The pass runs beside the
 * Bitrix24 loop, not in it, so this bounds Meta's load, not the portal's.
 */
const META_HISTORY_MS = Number(process.env.SYNC_META_HISTORY_SEC ?? 90) * 1000
const META_TOKEN = process.env.META_ACCESS_TOKEN?.trim() || null

/**
 * MoySklad customer orders for «Sverka», every N ticks — about six minutes at
 * the 120 s tick. Off without `MOYSKLAD_TOKEN`. In-process like Meta: an
 * incremental read is one or two requests to MoySklad, never to Bitrix24.
 * Every `MOYSKLAD_SWEEP_RUNS`-th read (the first included) also lists every
 * order id and drops the ones MoySklad deleted — about ten more requests.
 */
const MOYSKLAD_EVERY = Number(process.env.SYNC_MOYSKLAD_EVERY ?? 3)
const MOYSKLAD_TOKEN = process.env.MOYSKLAD_TOKEN?.trim() || null
const MOYSKLAD_SWEEP_RUNS = 10
/**
 * Pages of 100 one read may take. The first, whole-table read is ≈100 pages
 * (≈6 minutes); at 15 a turn it is spread over ~7 turns of ~1 minute each,
 * so the Bitrix24 sync is never held for long.
 */
const MOYSKLAD_MAX_PAGES = 15

/**
 * «SVERKA»'S PRODUCT RE-READ — see `productRecheckRows` (2026-10-15, the client
 * over two «Mahsulot farqi» lines the portal no longer had: «aniq qilish
 * kerak»). After a MoySklad read, at most every `PRODUCT_RECHECK_MS`, the
 * deals whose stored product rows disagree with their order (dated in the last
 * `PRODUCT_RECHECK_REACH_MS`), and were last read over `PRODUCT_RECHECK_AGE_MS`
 * ago, are handed to the line-item read (`requestDealItems`, 20 stored lines a
 * tick). A difference that survives the read is the portal's; a deal still
 * differing — or one the read gave up on, whose rows never move — is asked
 * about again a day later at most (`productAskedAt` covers the second, in
 * this process). One `crm.deal.productrows.get` per deal per day. Minutes; 0
 * switches it off.
 */
const PRODUCT_RECHECK_MS = Number(process.env.SYNC_PRODUCT_RECHECK_MIN ?? 60) * 60_000
const PRODUCT_RECHECK_AGE_MS = 24 * 60 * 60_000
/** Orders this old or newer: MoySklad's whole reach on 2026-10-15, bounded from then on. */
const PRODUCT_RECHECK_REACH_MS = 120 * 24 * 60 * 60_000
/**
 * Deals one check may hand over — newest orders first. 200 an hour bounds the
 * day at 4 800 reads even if a product's codes stopped matching wholesale; on
 * 2026-10-15 the chip held two deals.
 */
const PRODUCT_RECHECK_MAX = 200

/**
 * How many ticks between deletion sweeps. Default: 60 = hourly.
 *
 * A deletion is rare and a stale row is quiet — nobody notices until they go
 * looking for an order they removed and find it still counted. Hourly is
 * often enough that a test deal does not survive the afternoon, and rare
 * enough that the FULL pass it needs is not competing with the minute tick.
 *
 * SIX-HOURLY SINCE 2026-09-15, AND THIS IS THE SINGLE BIGGEST THING WE STOPPED
 * SPENDING ON THE PORTAL.
 *
 * Measured: `listDealContacts` walks all 464 396 deals at 2 500 a round trip =
 * 180 requests, which at the 2 rps limiter is ninety seconds of continuous
 * traffic.
 * Hourly, that was 4 320 requests a day — 32% of the worker's ENTIRE volume —
 * carrying 9 000 `crm.deal.list` invocations an hour against that method's
 * ten-minute operating basket, to detect an event this comment itself calls
 * rare. Bitrix24's own helpdesk names «an app that checks all CRM activities
 * every five minutes» as the kind of thing that earns an administrative block,
 * and on 2026-09-14 and again on 2026-09-15 this portal issued one.
 *
 * 24 bursts a day become 4: 4 320 requests → 720, with no change to the walk,
 * to `sweepByAntiJoin` or to the short-read guard, so nothing about correctness
 * moves.
 *
 * DAILY SINCE 2026-09-16, FOR THE SAME REASON ONE STEP FURTHER, AND BECAUSE IT
 * IS NOW THE LARGEST THING LEFT.
 *
 * The narrow chain (`CHAIN_MIN` in the provider) took the hot path from
 * ~288 000 method invocations a day to ~11 500. That did not touch the sweep,
 * which walks a fixed 464 396 ids however narrow the chain is — so at six
 * bursts a day it went from a third of our volume to about THREE QUARTERS of
 * it: 37 200 invocations against the hot path's 11 500. Cutting the biggest
 * remaining item is the whole of this instruction.
 *
 * One burst a day, ~9 300 invocations. Nothing about the walk,
 * `sweepByAntiJoin` or the short-read guard moves; correctness is untouched.
 *
 * WHAT IT COSTS, SAID PLAINLY: a deal deleted in the portal can be counted
 * here for up to a DAY. Read a day-old test deal as this setting, not as a
 * sync fault. Since 2026-10-14 it is also AT MOST NIGHTLY (`isSweepDue`, the
 * 01:00–06:00 Tashkent window): a value under a day no longer brings the old
 * latency back, and the near / wide / created reaches of `RECENT_SWEEPS`
 * plus the portal's own DELETE events are what keep recent deletions short.
 * The cheaper thing to do first is to ask whether the number they are
 * checking is one a deletion would move at all.
 *
 * Set to 0 to switch it off.
 */
const SWEEP_EVERY = Number(process.env.SYNC_SWEEP_EVERY ?? 1440)

/**
 * THE TASDIQLASH QUEUE'S OWN DELETION CHECK — see `recentDeletions.ts`.
 *
 * The day-long latency above was fine until the client deleted an order they
 * had just posted and watched it stay on the board (2026-09-24). So the
 * queue's recent orders are checked by id, in two reaches:
 *
 *   near   orders that moved through confirmation in the last 2 days, every
 *          5 minutes — ~250 ids, ~5 invocations, ≈ 60 an hour;
 *   wide   the last 62 days (this month and the whole of last), hourly —
 *          ~7 000 ids, ~140 invocations;
 *   new    deals the portal OPENED in the last 2 days, any imported pipeline,
 *          every 30 minutes — 3 000–5 000 ids, 60–100 invocations,
 *          120–200 an hour.
 *          2026-10-08: a test «Сарафан маркетинг» deal made and deleted the
 *          same day stayed on «Lidlar» until the night; it was in no
 *          confirmation stage, so the two reaches above never asked about it.
 *
 * 300–400 invocations an hour together, against the ~500 of an ordinary
 * hour and the 15 000 ceiling. Minutes; 0 switches a reach off.
 */
const RECENT_SWEEPS = [
  { label: 'yaqin', population: 'confirmed', days: 2, everyMs: Number(process.env.SYNC_RECENT_SWEEP_MIN ?? 5) * 60_000 },
  { label: 'keng', population: 'confirmed', days: 62, everyMs: Number(process.env.SYNC_WIDE_SWEEP_MIN ?? 60) * 60_000 },
  { label: 'yangi', population: 'created', days: 2, everyMs: Number(process.env.SYNC_CREATED_SWEEP_MIN ?? 30) * 60_000 },
] as const satisfies readonly { label: string; population: RecentPopulation; days: number; everyMs: number }[]

/**
 * «ИИ ОБРАБОТКА» DEALS THE PORTAL MOVED TO РЕГИСТРАЦИЯ — see `triageMoves.ts`.
 * The move leaves DATE_MODIFY alone, so these are re-read by id:
 *
 *   near   closed in «ИИ обработка» in the last 2 days, every 5 minutes —
 *          a handful of ids, one invocation;
 *   wide   every closed one (~500), hourly — ~10 invocations. The first wide
 *          pass also repairs the moves made before this shipped.
 *
 * Minutes; 0 switches a reach off.
 */
const TRIAGE_REREADS = [
  { label: 'yaqin', days: 2 as number | null, everyMs: Number(process.env.SYNC_TRIAGE_NEAR_MIN ?? 5) * 60_000 },
  { label: 'keng', days: null, everyMs: Number(process.env.SYNC_TRIAGE_WIDE_MIN ?? 60) * 60_000 },
] as const

/**
 * THE PORTAL'S OWN EVENTS, APPLIED BETWEEN TICKS — see `crmEvents.ts` and
 * `bitrix24/outgoingEvent.ts`.
 *
 * Every check above goes and ASKS; this is the portal telling us. The
 * outgoing webhook queues a row per deal event in `crm_event`, and while the
 * worker waits out its interval it drains that queue every `EVENTS_DRAIN_MS`:
 * a deal deleted in Bitrix24 is gone from the Tasdiqlash queue seconds later,
 * not 6 minutes or an hour later (the client, 2026-09-24 and 2026-10-08:
 * «Bitrix24ʼda oʻchirilsa srazi oʻchirilishi kerak»).
 *
 * COST: one `crm.deal.list` per fifty DISTINCT deals named since the last
 * drain, so an ordinary hour is a few dozen invocations and a robot rewriting
 * thousands of deals is capped at `EVENTS_DRAIN_MAX` deals (two invocations)
 * per drain — 720 an hour at most — and by the gate like everything else. Seconds; 0 switches the drain off (the rows
 * then wait, unprocessed, for a worker that has it on).
 */
const EVENTS_DRAIN_MS = Number(process.env.SYNC_EVENTS_DRAIN_SEC ?? 10) * 1000
/** Rows read per drain, and the distinct deals among them that are applied (2 invocations). */
const EVENTS_DRAIN_ROWS = 500
const EVENTS_DRAIN_MAX = 100
/** Processed rows are kept this long, for a look at what the portal sent. */
const EVENTS_KEEP_MS = 86_400_000
/**
 * A pending row this old is given up on. A drain that keeps failing — the
 * portal refusing one id, say — must not retry the same hundred deals every
 * ten seconds for ever (720 invocations an hour, nothing behind them ever
 * applied); the nightly walk still owns whatever the rows named.
 */
const EVENTS_GIVE_UP_MS = 3_600_000

/**
 * «ЛИД НАЗОРАТИ»'S TWO FEEDS — see `leadWatchFeeds.ts`.
 *
 * The lead watch on «Lidlar» reads the calls of the last minutes and the
 * open-line chats a person has left open; neither is on the tick (calls ride
 * the three-hourly reference pass, chats were never read). Both are refreshed
 * here on the watch's own clock — the settings file's `refreshEveryMs`, two
 * minutes, the cadence the page itself asks on.
 *
 * ON THE WALL CLOCK, AND DUE A LITTLE EARLY RATHER THAN A WHOLE TICK LATE. At
 * the deployed 120 s tick «every two minutes» is every tick — but a pass is
 * stamped when the tick's own work has finished, and that work takes a
 * different number of seconds each tick, so two stamps can be 115 s apart and
 * a strict 120 would skip every other tick. `LEAD_WATCH_SLACK_MS` is that
 * allowance; at the code's 60 s default tick the feeds still run on every
 * second one.
 *
 * COST: 2 requests / 3 invocations an ordinary pass, ~175 invocations an
 * ordinary hour with the calls' settle read and the chats' anchor — counted
 * and explained over `leadWatchFeeds.ts`. No environment variable: the
 * cadence is a product setting, and the hourly ceiling and the gate are what
 * stop a pass that should not run.
 */
const LEAD_WATCH_MS = LEAD_WATCH_SETTINGS.refreshEveryMs
const LEAD_WATCH_SLACK_MS = 30_000

/**
 * How often the CRM-form fills are read (`formFillFeed.ts`): one request a
 * pass, ~290 a day (less the tick's slack, as the lead watch). Five minutes
 * because Meta's own figure beside them moves hourly; a pass that stopped at
 * its page cap (the first backfill) runs again on the next tick instead.
 */
const FORM_FILLS_MS = 5 * 60_000

/**
 * How often the deal births, then the moves, are read (`dealBirthFeed.ts`):
 * one batch each a pass, ~290 passes a day. «Безквал»'s today is on a
 * two-minute memo, and a deal whose birth is not read yet still counts by the
 * pipeline it stands in; a pass that stopped at its cap (the first backfill)
 * runs again on the next tick.
 */
const DEAL_BIRTHS_MS = 5 * 60_000

/**
 * How often «Безквал» looks for a day to count (`bezkvalRefresh.ts`): every
 * pass asks which days are due — today and yesterday every ten minutes, the
 * week before every three hours, a never-counted day once — and counts at
 * most a few. Database only: no portal call, so no gate or calm applies.
 */
const BEZKVAL_PASS_MS = 2 * 60_000

/**
 * How far back the stage history is re-read once, at startup. Default: 45 days.
 *
 * A LOST ARRIVAL ROW TAKES AN ORDER OFF THE BOARD AND SAYS NOTHING. The
 * Тасдиклаш queue is cohorted on the deal's entry into `C4:NEW`, so that one
 * row IS the order's membership — and until the watermark learned to rewind
 * after a skipped run (`SKIP_LOOKBACK_MS` in SyncEngine.ts), a row whose deal
 * had not been imported yet was dropped and never offered again. Measured
 * against the client's own board on 2026-09-03: 927148 and 928094 both reached
 * the queue on 31 August, both are absent from this database, and the deals
 * themselves are here — only their arrivals are missing.
 *
 * The engine fix stops new gaps. It cannot close the old ones, because the
 * portal is only ever asked for rows newer than the cursor. So the cursor is
 * wound back once per start, and the ordinary incremental pass repairs
 * whatever it finds — every write is the same idempotent upsert, so re-reading
 * a row that is already correct costs a write and changes nothing.
 *
 * FORTY-FIVE DAYS IS SIZED, NOT GUESSED. It is 76 000 of this portal's 222 000
 * history rows: about thirty batched round trips, a few seconds of reading and
 * one pass of chunked upserts. Compare the deletion sweep, which is why tick 0
 * is otherwise kept clear — that one walked 434 000 deals and took thirty
 * minutes, and with deploys landing several times a day the worker spent its
 * life in it. This is under a minute, once, and it is also a standing net: any
 * gap inside the window heals at the next restart even if some future skip
 * escapes the lookback.
 *
 * Set to 0 to switch it off.
 */
const HISTORY_BACKFILL_DAYS = Number(process.env.SYNC_HISTORY_BACKFILL_DAYS ?? 45)

/*
  THE TEN-MINUTE WAIT MOVED, IT DID NOT GO.

  `THROTTLED_WAIT_MS` lived here — a flat ten minutes after any refusal, put in
  by the 2026-09-14 incident because a portal refusing the whole REST surface is
  not our error to retry out of. It is now the CEILING of `PortalGate`'s probe
  ladder (`THROTTLE_LADDER_MS` in portalGate.ts), which keeps the bound it set
  while fixing what it could not do: a flat wait cannot notice a block that
  lifted after ninety seconds, so recovery always cost the full ten minutes.

  THE BOUND IS ALSO A PROMISE MADE IN WRITING. The ticket opened with Bitrix24
  support after the 2026-09-14 block says this integration backs off when it is
  refused. The ladder honours that more strictly than the flat wait did — it
  sends ONE `profile` where a tick sent three to twelve — but the ceiling is
  what bounds the worst case, and it should not be raised without remembering
  what it answers to.
*/

/**
 * The heap the Roistat child is allowed, in megabytes.
 *
 * Deliberately NOT the worker's own 768 — see `runRoistatImport` for the
 * measurement that forced this. Roughly ten times the working set of the 5.5 MB
 * page it parses, and a third of the container, so parent and child together
 * cannot reach the ceiling. If the importer ever genuinely needs more it dies
 * with a JavaScript heap error naming this constant: one passenger failing
 * diagnosably, which is the whole point of it being a child process.
 */
const ROISTAT_HEAP_MB = 320

/**
 * Read on every tick.
 *
 * These four are what every screen in the product is built on: the deal, its
 * items, its stage history and the customer. A minute late on any of them is
 * a minute the confirmation queue, the sellers board and the payroll are
 * wrong, which is the whole reason this worker runs at all.
 */
const HOT: SyncEntityValue[] = ['CUSTOMERS', 'DEALS', 'DEAL_ITEMS', 'STAGE_HISTORY']

/**
 * Read occasionally. Order matters — deals reference all of these.
 *
 * `STORES` AND `STOCK` LEFT THIS LIST ON 2026-09-16, and each was a portal
 * method spent on a table NOTHING READS. `CALLS` left with them at 15:32 and
 * CAME BACK THE SAME EVENING, the way the paragraph below says it should: «Mijozlar
 * va qoʻngʻiroqlar» reads `call_record` now. It costs roughly 60–120 invocations
 * a pass on this three-hourly clock — three hours of new calls plus the three
 * hours `SETTLE_LOOKBACK_MS` re-reads so a call stored mid-conversation gets its
 * finished duration — against the 15 000-an-hour `portalBudget`. LAST in the
 * list, so its employee and customer links resolve against the passes above it.
 * What follows was written about all three and still holds for the other two. `store` and `stock_level` have
 * no reader since «Joʻnatish nuqtalari» was paused, and
 * `catalog.storeproduct.list` returns zero rows on this portal anyway;
 * `call_record` has had no reader since `/insights/calls` went in the
 * 2026-09-10 cull. On a portal that blocked us three mornings running, a
 * request for data nobody renders is the one kind with no argument for it.
 *
 * REMOVED FROM THE SCHEDULE, NOT FROM THE CODE. The handlers, the provider
 * methods and the tables stay, so the day a screen needs one of them again it
 * is `npm run bitrix:resync -- CALLS` to fill it and one line here to keep it
 * current — and the history already imported is not thrown away.
 */
const REFERENCE: SyncEntityValue[] = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCTS',
  'PIPELINES',
  'STAGES',
  'SOURCES',
  'CALLS',
]

const url: string = DATABASE_URL
const webhook: string = WEBHOOK_URL

function stamp(): string {
  return new Date().toISOString().slice(11, 19)
}

/**
 * Ticks after a recovery that run the hot entities only.
 *
 * On 2026-09-16 11:35 UTC the address block lifted for a moment, the probe got
 * through, and the worker answered with a reference tick — twelve entities back
 * to back — and was dropped again inside a minute. The reference pass, the
 * sweep and anything else scheduled onto the recovery tick wait until the
 * portal has taken this many ordinary ticks from us.
 */
const CALM_TICKS = 3

/** How long `sync_log` keeps a row. Every diagnostic in CLAUDE.md reads days, not months. */
const SYNC_LOG_RETENTION_MS = 30 * 86_400_000

/**
 * Keep `sync_log` a working log rather than an archive.
 *
 * It grows ~3 000 rows a day at the 120 s tick and nothing ever deleted one:
 * 126 000 rows by 2026-09-17, every query on it an index walk that gets longer.
 * And ~270 of them were `RUNNING` forever — a pass whose process was killed
 * mid-tick (a deploy, the OOM kills of 2026-09-14) never writes its ending. A
 * pass cannot run for a day, so a day-old `RUNNING` row is a dead process, not
 * a slow one. Run at startup and after each daily sweep; never fatal.
 */
async function pruneSyncLog(db: PrismaClient): Promise<void> {
  const now = Date.now()
  try {
    const { count } = await db.syncLog.deleteMany({
      where: {
        OR: [
          { startedAt: { lt: new Date(now - SYNC_LOG_RETENTION_MS) } },
          { status: 'RUNNING', startedAt: { lt: new Date(now - 86_400_000) } },
        ],
      },
    })
    if (count > 0) console.log(`  ${stamp()} sync_log: ${count} ta eski yozuv oʻchirildi`)
  } catch (error) {
    console.warn(`  ${stamp()} ! sync_log tozalanmadi:`, error)
  }
}

/**
 * THE ONE-OFF DEALS RE-READ, requested in code. Null when nothing is owed.
 *
 * Set on 2026-09-24 for «Lid kogortasi»: five new deal columns (leadArrivedAt,
 * leadDistributedOn, aiQualifiedAt, leadRopEmployeeId, repeatLead) that the
 * sync fills only on deals the portal touches again. The portal started
 * filling those fields on 2026-09-14, so everything modified since the 13th
 * is re-read — once, in the night window, through THIS process's provider:
 * the same 2 rps limiter, hourly ceiling and refusal gate as the minute tick,
 * so there is never a second process asking the portal for anything. Settled
 * by a `DEALS / BACKFILL` success in `sync_log` after `requestedAt`; dropped
 * unserved after `BACKFILL_EXPIRES_MS`. The next column that needs one
 * replaces this value. (It was 2026-08-01 / 2026-09-19 for «Target tahlili»,
 * and 2026-09-13 / 2026-09-24 for «Lid kogortasi», both served.)
 *
 * NOW (2026-09-29) for «RNP jadvali»: `deal.registrar` («Регистрация»,
 * UF_CRM_1747975291848), which the registration «guruh» rows count by. The
 * sheet is a calendar month, so everything modified since 1 September is
 * re-read — a superset of the lead-cohort window, so that request loses
 * nothing by being replaced.
 *
 * NOW (2026-10-06) for «Безквал»: `deal.createdByEmployeeId` (CREATED_BY_ID),
 * which tells a deal handed to a ROP's seller from one the seller opened. The
 * month grid reaches back into September, so the same window again.
 *
 * NOW (2026-10-07) for «Безквал»: `deal.ropKvalLidEmployeeId` («ROP KVAL LID»,
 * UF_CRM_ROP_KVAL_LID), the ROP the portal stamps on each Регистрация deal.
 * The same window: every deal the month grid can show was created, so
 * modified, after 1 September. ~254 000 deals (portal count 2026-10-07), ~5 100
 * invocations — inside the hourly ceiling.
 *
 * NOW (2026-10-22) for «Безквал» by the client's spec: `deal.leadVia` («Как
 * поступил лид», UF_CRM_LG_VIA — a Lead Guard deal is dated by «Лид тушган
 * сана») and `deal.dealPhone` («Телефон ракам», the number when the contact
 * has none). The same window, for the same month grid.
 */
/** The day contact relinking shipped; see the startup read of `lastSweepAt`. */
const CONTACT_RELINK_SINCE = new Date('2026-09-25T00:00:00Z')

const DEALS_BACKFILL: DealsBackfill | null = {
  since: new Date('2026-09-01T00:00:00+05:00'),
  // After the deploy, so no DEALS backfill run earlier today settles it.
  requestedAt: new Date('2026-10-22T20:00:00+05:00'),
}

/**
 * THE ONE-OFF READS «Kiruvchi qoʻngʻiroqlar» needs, requested 2026-10-05.
 * Same night window, guards and settling as `DEALS_BACKFILL`, at most one
 * per hour so the two never share the portal's hourly ceiling.
 *
 * - CUSTOMERS / FULL: `customer.createdAtSource` (DATE_CREATE) is new, and the
 *   minute sync only fills contacts the portal touches again. «Соф янги» —
 *   a contact born with the call — is unreadable without it. FULL, not
 *   BACKFILL, because CUSTOMERS / BACKFILL is the contact relink's own row
 *   (see the sweep below) and would settle this request the night it is made;
 *   nothing in the worker writes CUSTOMERS / FULL. ~381 000 contacts, ~7 600
 *   invocations.
 * - CALLS / BACKFILL since `CALL_DATA_FLOOR`: rows written before the
 *   2026-10-02 `callDirection` fix carry outgoing legs as INBOUND, and the
 *   minute pass only looks three hours back. Re-reading rewrites `direction`.
 */
const ONE_OFF_READS: readonly {
  readonly label: string
  readonly entity: 'CUSTOMERS' | 'CALLS'
  readonly mode: 'FULL' | 'BACKFILL'
  readonly request: DealsBackfill
}[] = [
  {
    label: 'kontaktlar (DATE_CREATE)',
    entity: 'CUSTOMERS',
    mode: 'FULL',
    request: { since: new Date('2026-10-05T00:00:00+05:00'), requestedAt: new Date('2026-10-05T00:00:00+05:00') },
  },
  {
    label: 'qoʻngʻiroqlar (yoʻnalish)',
    entity: 'CALLS',
    mode: 'BACKFILL',
    request: { since: CALL_DATA_FLOOR, requestedAt: new Date('2026-10-05T00:00:00+05:00') },
  },
]

/** What a one-off read may need of the hourly budget: the contacts' ~7 600 and some room. */
const ONE_OFF_HEADROOM = 8_000

const WORKER_TIME_ZONE = process.env.APP_TIMEZONE ?? 'Asia/Tashkent'

/** How recent a logged refusal must be to start the next worker already closed. */
const SEED_MAX_AGE_MS = 15 * 60_000

/**
 * What the process that died in the block already wrote down.
 *
 * Two index walks on `@@index([status, finishedAt(sort: Desc)])`, no portal
 * call. Returns nothing unless the newest failure is NEWER than the last
 * success the freshness clock trusts — a failure sitting behind a success is a
 * blip that already healed — and unless it is recent enough to still be true.
 */
async function lastRefusal(
  db: PrismaClient,
  now: Date,
): Promise<{ kind: RefusalClass; code: string; since: Date } | null> {
  const [failure, success] = await Promise.all([
    db.syncLog.findFirst({
      where: { status: 'FAILED' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, errorMessage: true },
    }),
    db.syncLog.findFirst({
      where: { status: { in: ['SUCCESS', 'PARTIAL'] }, entity: { in: [...FRESHNESS_ENTITIES] } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    }),
  ])

  const at = failure?.finishedAt
  if (!at) return null
  if (success?.finishedAt && success.finishedAt >= at) return null
  if (now.getTime() - at.getTime() > SEED_MAX_AGE_MS) return null

  /*
    AN UNREACHABLE PORTAL IS REMEMBERED TOO. Neither «fetch failed
    [UND_ERR_CONNECT_TIMEOUT]» nor the gate's own «Bitrix24 gate: UNKNOWN …
    not sent» carries a portal code, so `classifyRefusal` reads both as
    nothing — and every redeploy inside the 2026-09-16 address block opened
    with a health check and a reference tick into the firewall that was
    dropping us.
  */
  const kind =
    classifyRefusal(failure.errorMessage) ??
    (isNetworkFailure(failure.errorMessage) ? 'TRANSIENT' : null)
  if (kind !== 'THROTTLE' && kind !== 'CREDENTIAL' && kind !== 'TRANSIENT') return null

  return { kind, code: refusalCode(failure.errorMessage) ?? 'UNKNOWN', since: at }
}

/**
 * Interruptible sleep.
 *
 * A plain setTimeout would hold SIGTERM for as long as the wait — up to six
 * minutes once backoff is in play — and the platform kills a container that
 * takes longer than thirty seconds to stop. `wake` is called by the signal
 * handler so shutdown is immediate whenever a tick is not in flight.
 */
let wake: () => void = () => {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    wake = finish
    function finish() {
      clearTimeout(timer)
      wake = () => {}
      resolve()
    }
  })
}

/**
 * Arbitrary but fixed. Advisory locks are namespaced only by this number, so
 * it must be stable across deploys and unlikely to collide with anything else
 * using the same database.
 */
const LOCK_ID = 8_872_601

/** Seconds between attempts while another worker still holds the lock. */
const LOCK_RETRY_SEC = 10

/**
 * Take the single-worker lock, waiting for it if someone else has it.
 *
 * Returns the client the lock is held on. Keeping a reference matters: the
 * lock lives as long as that connection and not a moment longer.
 */
async function acquireLock(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect()

  // Postgres cannot tell us the lock was lost, so if this connection breaks
  // we are no longer the only worker and must not keep writing.
  client.on('error', (error) => {
    console.error(`\n  ${stamp()} ✗ blokirovka ulanishi uzildi:`, error, '\n')
    process.exit(1)
  })

  let waited = false

  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [LOCK_ID],
    )

    if (rows[0]?.locked) {
      if (waited) console.log(`  ${stamp()} blokirovka olindi — ishga tushdi.`)
      return client
    }

    if (!waited) {
      waited = true
      console.log(
        `\n  ${stamp()} boshqa worker ishlayapti — u toʻxtaguncha kutilmoqda.` +
          `\n  (Ikkitasi bir vaqtda ishlasa portal limitini ikki barobar sarflaydi.)\n`,
      )
    }

    await sleep(LOCK_RETRY_SEC * 1000)
  }
}

/**
 * The Roistat import, as a CHILD PROCESS rather than an inlined call.
 *
 * `scripts/importRoistat.ts` opens its own pool, owns its own transaction and
 * calls `process.exit(1)` on failure — a design that is right for a command
 * someone runs and fatal for a loop that must survive it. Spawning isolates
 * all three: a Roistat failure cannot exit this worker, cannot poison its
 * Prisma client, and cannot leave a half-open pool behind. The cost is one
 * process start an hour, which is nothing against a tick that already spends
 * thirty seconds waiting on Bitrix24.
 *
 * Never throws. The Bitrix sync is the worker's job; marketing is a passenger
 * and a passenger does not get to stop the vehicle.
 *
 * THE CHILD GETS ITS OWN, SMALLER HEAP — and that is what stopped this worker
 * dying seventeen times a day. See `ROISTAT_HEAP_MB`.
 */
async function runRoistatImport(): Promise<void> {
  await new Promise<void>((resolve) => {
    /*
      `env: process.env` MINUS `NODE_OPTIONS`, with the cap on argv instead.

      The platform sets NODE_OPTIONS=--max-old-space-size=768 on this worker and
      a spawned child inherits the whole environment — so a 1 024 MB container
      held TWO V8 isolates, each believing it could take 768 MB. Neither ever
      felt pressure, neither collected defensively, and neither raised a
      JavaScript OOM: the kernel got there first, which is exactly why no
      out-of-memory message was ever in any log.

      Measured on production 2026-09-14, before this change: the worker's own
      RSS is flat at 262-297 MB for a whole hour and the deletion sweep adds
      about 65 MB, while DigitalOcean's own metric caught the container at
      999.0 MB of 1 024 — during the tick-60 window, the only tick that runs the
      sweep AND this import. Fifteen restarts in 24 hours, every one beginning
      the instant CALLS finished, i.e. inside this block; twelve killed the
      container, three got through. Nothing else in the process is big enough to
      account for the difference.
    */
    const { NODE_OPTIONS: _workerHeap, ...env } = process.env

    /*
      SPAWN CAN THROW SYNCHRONOUSLY, and the header above promises it does not.

      `spawn` raises ENOMEM or EMFILE from inside this executor rather than
      through the 'error' event — and a throw here REJECTS the promise, which
      travels up the one awaited call in the tick loop that carries no catch,
      reaches `main().catch` and exits the process. Under memory pressure at
      tick 60 that is a second, quieter way for this block to kill the worker,
      punctual and tick-aligned and indistinguishable in the data from the
      kernel doing it. Caught here, the passenger fails and the vehicle
      continues, which is what the whole child-process design is for.
    */
    let child
    try {
      child = spawn(
        process.execPath,
        [`--max-old-space-size=${ROISTAT_HEAP_MB}`, '--import', 'tsx', 'scripts/importRoistat.ts'],
        {
          cwd: process.cwd(),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (error) {
      console.warn(`  ${stamp()} roistat: ishga tushirib boʻlmadi — ${(error as Error).message}`)
      resolve()
      return
    }

    // The importer prints a full report; only its verdict belongs in this log.
    let tail = ''
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)

    // Shutdown must reach the child too: an orphaned importer would hold its
    // own pool open against a database the platform is about to take away.
    const onStop = () => child.kill('SIGTERM')
    process.once('SIGTERM', onStop)
    process.once('SIGINT', onStop)
    const done = (fn: () => void) => {
      process.off('SIGTERM', onStop)
      process.off('SIGINT', onStop)
      fn()
    }

    child.on('error', (error) => {
      done(() => {
        console.warn(`  ${stamp()} roistat: ishga tushmadi — ${error.message}`)
        resolve()
      })
    })

    child.on('close', (code, signal) => {
      done(() => {
        if (code === 0) {
          // Only the snapshot's rate is written since 2026-10-07 (see
          // scripts/roistatSnapshot.ts), so the verdict is the rate it wrote.
          const rate = /\(= ([\d.]+) soʻm\/\$\)/.exec(tail)
          // Which rate it is: the blob's, the bank's (the blob carried a reserve), or the one kept (roistatSnapshot.ts).
          const source = /kurs manbai\s*:\s*(\S+)/.exec(tail)?.[1]
          const from =
            source === 'cbu'
              ? ' (CBU — manbada zaxira kurs)'
              : source === 'stored'
                ? ' (saqlangan oxirgi CBU kursi — manbada zaxira kurs, CBU javob bermadi)'
                : source === 'previous'
                  ? ' (oldingi kurs qoldi — manbada zaxira kurs, CBU javob bermadi)'
                  : ''
          console.log(`  ${stamp()} roistat: ok, kurs ${rate ? `${rate[1]} soʻm/$` : 'yozildi'}${from}`)
        } else if (code === null) {
          /*
            Killed by a signal — and WHICH signal is the whole diagnosis.

            SIGTERM is our own shutdown reaching the child mid-import: an
            interruption, not a failure, and logging it as one would put a red
            line in the log on every redeploy. SIGKILL is the kernel, which on a
            1 024 MB container means the memory ceiling — the death this worker
            spent seventeen restarts a day hiding behind an unnamed
            `code === null`. Naming it is how the next one is diagnosable
            without container logs nobody can read.
          */
          console.log(
            `  ${stamp()} roistat: toʻxtatildi (${signal ?? 'signalsiz'})` +
              (signal === 'SIGKILL' ? ' — xotira chegarasi boʻlishi mumkin' : '') +
              ' — keyingi tsiklda qaytadan uriniladi',
          )
        } else {
          /*
            THE WHOLE REASON, NOT ITS FIRST LINE (2026-10-24). A validation
            failure is a heading and one line per issue; the heading alone —
            «The blob failed validation (1 issue(s)):» — was all this log
            held for a day the source sent «резерв» where a date belonged.
          */
          const reason = /✗ IMPORT TOʻXTADI\s*\n\s*\n([\s\S]+)/.exec(tail)
          const lines = reason ? reason[1].split('\n').map((l) => l.trim()).filter(Boolean) : []
          console.warn(
            `  ${stamp()} roistat: muvaffaqiyatsiz (kod ${code})` + (lines.length > 0 ? ` — ${lines.join(' ').slice(0, 400)}` : ''),
          )
        }
        resolve()
      })
    })
  })
}

async function main() {
  // Five: one is checked out permanently to hold the advisory lock, and the
  // sync engine runs one query at a time, so the rest is headroom. The point
  // of the cap is the managed database's 22-connection ceiling, which the web
  // service and the deploy jobs also draw on.
  /*
    NOTHING HERE MAY WAIT FOREVER (2026-10-24). The pool had `pg`'s defaults:
    no statement timeout, no connect timeout, no keepalive — and the loop
    awaits every query, so ONE statement stuck on a half-dead connection froze
    the sync, Meta's pass included, until the next deploy. Fifteen minutes is
    past anything the worker means to run (its longest transactions are capped
    at ten), so the limit only ever ends a hang. Idle connections live two
    minutes, past the one-minute tick: the default ten seconds closed them all
    between ticks and every tick reopened TLS to the one-core database.
    Keepalive is what notices the lock connection is gone (its 'error' exits,
    see `acquireLock`); `application_name` is what tells this worker's rows
    from the web's in `pg_stat_activity`.
  */
  const pool = new Pool({
    ...poolConfig(url, {
      caCert: caCertFromEnv(),
      max: 5,
      idleTimeoutMillis: 120_000,
      connectionTimeoutMillis: 60_000,
      statementTimeoutMs: 15 * 60_000,
    }),
    idle_in_transaction_session_timeout: 15 * 60_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 60_000,
    application_name: 'sync',
  })
  /*
    A TRANSACTION WAITS FOR A CONNECTION UP TO 30 s, NOT PRISMA'S 2 (2026-10-22).
    Since Meta runs beside the loop, its writes and the Bitrix24 tick's share
    these five connections; the first live pass lost an account's ad rows to
    «Unable to start a transaction in the given time» while the tick held the
    pool for a moment. Waiting is right for both: neither is answering a
    person.
  */
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), transactionOptions: { maxWait: 30_000 } })

  const lockClient = await acquireLock(pool)

  const provider = new Bitrix24CrmProvider({
    webhookUrl: webhook,
    rateLimitRps: Number(process.env.BITRIX24_RATE_LIMIT_RPS ?? 2),
    requestTimeoutMs: Number(process.env.BITRIX24_REQUEST_TIMEOUT_MS ?? 30_000),
    callHistoryMonths: Number(process.env.BITRIX24_CALL_MONTHS ?? 1),
    // A deal the line-item read gave up on. Progress stays silent here.
    onWarning: (message) => console.warn(`  ${stamp()} ! ${message.trim()}`),
  })

  /*
    Held in a const, not inlined into the SyncEngine, because the deletion
    sweep below calls `deleteMissing` on the DEALS handler directly rather
    than going through the engine. See the sweep block for why.
  */
  const handlers = createSyncHandlers(prisma, 'BITRIX24')
  const dealsHandler = handlers.find((h) => h.entity === 'DEALS')

  const store = new PrismaSyncStore(prisma)
  const sverkaRepository = new SverkaRepository(prisma)

  const engine = new SyncEngine({
    provider,
    store,
    handlers,
    logger: {
      info: () => {},
      warn: (o, m) => console.warn(`  ${stamp()} ! ${m ?? ''}`, o ?? ''),
      error: (o, m) => console.error(`  ${stamp()} ✗ ${m ?? ''}`, o ?? ''),
    },
  })

  /*
    A FAILED HEALTH CHECK IS REPORTED, NOT FATAL — and that changed on
    2026-09-14, when Bitrix24 blocked its own REST API for a quarter of an
    hour («OVERLOAD_LIMIT — REST API is blocked due to overload»).

    `process.exit(1)` here turns exactly that state into a restart loop: the
    platform brings the worker back, the portal is still throttling, the
    process exits again — and every cycle pays the startup cost and issues the
    same call that is being refused, which is the last thing a portal
    complaining about load needs from us. Meanwhile nothing syncs even in the
    minute AFTER the block lifts, because the process that would have noticed
    is gone.

    The tick loop already handles a portal that will not answer: it logs, it
    counts consecutive failures and it backs off up to five minutes between
    ticks. Starting into that loop is strictly better than not starting.

    What is lost is the fast fail on a genuinely bad configuration — a
    mistyped webhook never gets a first reading. The line below still says so
    on the first line of the log, and the dashboard's own header now names the
    portal's error code (see `AlertsDto.syncError`), which is a better place
    for it than a container nobody is watching.
  */
  /*
    START ALREADY KNOWING. The database was told about the block by the process
    that died in it — reading that back costs two index walks and no portal
    call at all.

    Measured 2026-09-15: a restart inside a block cost ~11 requests, one for the
    health check and ten because tick 0 is always a reference tick
    (`0 % REFERENCE_EVERY === 0`). At the ~17 restarts a day this worker was
    recording, that is ~187 requests a day spent re-discovering a block we
    already knew about, issued at exactly the moment the portal is complaining
    about load. Seeded, the same restart costs 0 until a probe is due.

    THE FIFTEEN-MINUTE BOUND IS WHAT KEEPS THIS HONEST. A database left idle
    over a weekend must not start the worker blocked on a Friday failure, so
    only a recent refusal — and only one NEWER than the last success — seeds
    anything. Anything older, and the worker starts by asking the portal, which
    is the right default.
  */
  try {
    const seeded = await lastRefusal(prisma, new Date())
    if (seeded) {
      provider.gate.seed(seeded.kind, seeded.code, seeded.since, new Date())
      console.log(
        `  ${stamp()} oldingi tsikl ${seeded.code} bilan toʻxtagan` +
          ` (${seeded.since.toISOString()}) — portal zondlanadi, toʻliq tsikl emas.`,
      )
    }
  } catch (error) {
    // Never fatal: not knowing costs one refused request, which is what the
    // worker did before this existed.
    console.warn(`  ${stamp()} ! oldingi holat oʻqilmadi:`, error)
  }

  /*
    The health check is SKIPPED when the gate was seeded shut. It is one more
    request into a door the database just told us is closed, and `probe()` on
    the ladder asks the same question at a time worth asking it.
  */
  if (!provider.gate.isOpen()) {
    const health = await provider.healthCheck()
    console.log(`\n  ${health.ok ? '✓' : '✗'} ${health.detail}`)
    if (!health.ok && isNetworkFailure(health.detail)) {
      // Unreachable, not refused: shut the gate now rather than following up
      // with a dozen reference-tick connections. The ladder probes from here.
      provider.gate.seed('TRANSIENT', 'UNKNOWN', new Date(), new Date())
      console.warn(`  ${stamp()} ! portalga ulanib boʻlmadi — tekshiruv jadval boʻyicha, toʻliq tsikl emas.`)
    } else if (!health.ok) {
      console.warn(
        `  ${stamp()} ! portal javob bermadi — tsikl baribir boshlanadi,` +
          ' xatolar har tsiklda qayd etiladi.',
      )
    }
  }

  /*
    WIND THE HISTORY CURSOR BACK, ONCE, BEFORE THE FIRST TICK.

    See `HISTORY_BACKFILL_DAYS`. The first ordinary incremental pass then
    re-reads the window and upserts whatever it finds, which is what repairs an
    arrival row that was skipped before the watermark learned to rewind.

    ONLY EVER BACKWARDS. A cursor already older than the window — after an
    outage, or on a database that has never synced — is left where it is:
    moving it forward here would skip everything between, which is the one
    thing this must not do.

    Failure is not fatal. A worker that cannot reach the cursor table has
    bigger problems than a backfill, and the tick loop below reports them
    properly; refusing to start over a repair would turn a degraded sync into
    no sync at all.
  */
  try {
    const cursor = await store.getCursor(provider.source, 'STAGE_HISTORY')
    const from = historyBackfillCursor(cursor, new Date(), HISTORY_BACKFILL_DAYS)
    if (from !== null) {
      await store.setCursor(provider.source, 'STAGE_HISTORY', from)
      console.log(
        `  ${stamp()} bosqich tarixi ${HISTORY_BACKFILL_DAYS} kunga qaytarildi —` +
          ' yoʻqolgan yozuvlar shu tsiklda tiklanadi.',
      )
    }
  } catch (error) {
    console.warn(`  ${stamp()} ! tarixni qaytarib boʻlmadi:`, error)
  }

  /*
    THE SLOW CLOCKS ARE INHERITED, NOT RESTARTED — see `schedule.ts`.

    `REFERENCE_EVERY` and `SWEEP_EVERY` keep their meaning in TICKS so the
    deployed spec needs no edit; they are converted to wall time here and
    measured from what the previous process wrote to `sync_log`. Both reads are
    bounded to twice their period so they stay short walks of the
    `[status, finishedAt DESC]` index on a log of 120 000 rows.

    A reference pass is dated by its `REFERENCE_MARKER` row (PRODUCTS),
    whatever became of the entities before it: seconds after the moment the
    pass was attempted, which is what the tick counter measured too. It was the
    FIRST entity until that one opened the forced `RESOLVE` pass as well
    (2026-10-06) — dated by a row the forced pass also writes, a skip would put
    the full pass off for three hours. A marker that keeps FAILING re-runs the
    pass after each restart, as a failing first entity always did; never on
    every tick, because the loop stamps the attempt itself.

    The sweep writes its own `DEALS` / `FULL` row (below), because until now it
    left no trace in the database at all.
  */
  const REFERENCE_MS = REFERENCE_EVERY * INTERVAL_SEC * 1000
  const SWEEP_MS = SWEEP_EVERY * INTERVAL_SEC * 1000
  let lastReferenceAt: Date | null = null
  let lastSweepAt: Date | null = null
  let lastSweepFailedAt: Date | null = null
  /*
    META IS ON THE WALL CLOCK TOO (2026-10-14). It was `tick % META_EVERY`
    offset by half a period, so every start waited half an hour before its
    first Meta pass — and on a day of six deploys the forms table and the
    spend were never read at all. The clock is the newest spend row's
    `importedAt` (the import deletes and re-creates its window, so the
    column is the last successful pass); the loop stamps each attempt, so a
    failing token is retried once per period, never every tick.
  */
  let lastMetaAt: Date | null = null
  let lastRoistatAt: Date | null = null
  /** The nightly 37-day re-read (`META_DEEP_REFRESH_DAYS`); in memory — a restart at night costs one more. */
  let lastMetaDeepAt: Date | null = null
  /**
   * The pass in flight, if any. Since 2026-10-22 Meta runs BESIDE the loop:
   * awaited, a pass with the history walk held the Bitrix24 tick and the
   * portal-events drain for minutes, and «srazi» is the portal's promise
   * first. One at a time — a slow pass is never doubled.
   */
  let metaInFlight: Promise<void> | null = null
  /**
   * The stored answers' passes in flight — «Mijoz qaytishi» (`runCohortPass`),
   * then Roistat's closed months (`runMonthScanPass`), one after the other —
   * and when the cohorts were last built.
   */
  let storedInFlight: Promise<void> | null = null
  let lastCohortAt: Date | null = null
  // In memory only: a restart costs one near and one wide check, ~150 invocations.
  const recentSweepAt = new Map<string, Date>()
  // In memory only: a restart costs one pass of the feeds, two requests.
  let lastLeadWatchAt: Date | null = null
  const leadWatchClock = prismaFeedClock(prisma)
  const openChatStore = prismaChatStore(prisma, 'BITRIX24')
  const formFillStore = prismaFormFillStore(prisma, 'BITRIX24')
  const dealBirthStore = prismaDealBirthStore(prisma, 'BITRIX24')
  const dealMoveStore = prismaDealMoveStore(prisma, 'BITRIX24')
  let lastDealBirthsAt: Date | null = null
  const bezkvalStore = new RegistrationRepository(prisma)
  let lastBezkvalAt: Date | null = null
  /** Null while a backfill is behind: the next tick reads on at once. */
  let lastFormFillsAt: Date | null = null
  const triageRereadAt = new Map<string, Date>()
  try {
    const now = Date.now()
    const [reference, sweep] = await Promise.all([
      REFERENCE_MS > 0
        ? prisma.syncLog.findFirst({
            where: {
              status: { in: ['SUCCESS', 'PARTIAL'] },
              entity: REFERENCE_MARKER,
              finishedAt: { gt: new Date(now - 2 * REFERENCE_MS) },
            },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          })
        : null,
      SWEEP_MS > 0
        ? prisma.syncLog.findFirst({
            where: {
              // A sweep the guard refused waits a day too — but only the
              // sweep's own row: a manual `bitrix:resync -- DEALS` writes
              // DEALS / FULL / PARTIAL whenever it skips a deal.
              OR: [{ status: 'SUCCESS' }, { status: 'PARTIAL', errorMessage: { startsWith: SWEEP_REFUSED_MARK } }],
              entity: 'DEALS',
              mode: 'FULL',
              finishedAt: { gt: new Date(now - 2 * SWEEP_MS) },
            },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          })
        : null,
    ])
    lastReferenceAt = reference?.finishedAt ?? null
    lastSweepAt = sweep?.finishedAt ?? null
    /*
      THE FIRST RELINK IS NOT LEFT TO THE DAILY CLOCK. The client merged its
      duplicate contacts across the whole base in September 2026, and until
      the sweep re-points those deals «Mijoz qaytishi» counts one buyer as two
      — so a worker that has never recorded a relink sweeps on its first
      eligible tick (never tick 0, same guards as always), once. After that the
      relink's own row keeps this false and the daily clock is back in charge.
    */
    if (SWEEP_MS > 0) {
      const relinked = await prisma.syncLog.findFirst({
        where: {
          status: 'SUCCESS',
          entity: 'CUSTOMERS',
          mode: 'BACKFILL',
          finishedAt: { gte: CONTACT_RELINK_SINCE },
        },
        select: { id: true },
      })
      if (relinked === null) lastSweepAt = null
    }
  } catch (error) {
    // Not fatal: unknown means «due», which is exactly what a restart did before.
    console.warn(`  ${stamp()} ! oxirgi maʼlumotnoma/tozalash vaqti oʻqilmadi:`, error)
  }
  if (ROISTAT_MS > 0) {
    const roistat = await prisma.marketingSnapshot
      .aggregate({ _max: { importedAt: true } })
      .catch(() => null)
    lastRoistatAt = roistat?._max.importedAt ?? null
  }
  if (COHORTS_ON) {
    // Loaded here, not at the top: it reads the validated environment, and a failure must cost this pass, not the worker.
    lastCohortAt = await import('../src/server/services/cohortSnapshotRefresh')
      .then((m) => m.storedCohortsBuiltAt(prisma))
      .catch(() => null)
  }
  if (META_TOKEN && META_MS > 0) {
    try {
      const meta = await prisma.metaAdDaily.aggregate({ _max: { importedAt: true } })
      lastMetaAt = meta._max.importedAt
    } catch (error) {
      // Not fatal: unknown means «due» — one Meta pass on the first eligible tick.
      console.warn(`  ${stamp()} ! oxirgi Meta vaqti oʻqilmadi:`, error)
    }
  }

  await pruneSyncLog(prisma)

  // Unknown reads as «not yet settled»: a second backfill costs a night's
  // invocations, a skipped one leaves the columns empty for good.
  let backfillSettled = DEALS_BACKFILL === null
  let backfillFailedAt: Date | null = null
  if (DEALS_BACKFILL) {
    try {
      backfillSettled =
        (await prisma.syncLog.findFirst({
          where: {
            entity: 'DEALS',
            mode: 'BACKFILL',
            status: { in: ['SUCCESS', 'PARTIAL'] },
            startedAt: { gte: DEALS_BACKFILL.requestedAt },
          },
          select: { id: true },
        })) !== null
    } catch (error) {
      console.warn(`  ${stamp()} ! backfill holati oʻqilmadi:`, error)
    }
  }

  // Same «unknown reads as not settled» rule as the deals backfill.
  const oneOffSettled = new Map<string, boolean>()
  const oneOffFailedAt = new Map<string, Date | null>()
  let lastOneOffAt: Date | null = null
  for (const read of ONE_OFF_READS) {
    oneOffSettled.set(read.label, false)
    oneOffFailedAt.set(read.label, null)
    try {
      const done = await prisma.syncLog.findFirst({
        where: {
          entity: read.entity,
          mode: read.mode,
          status: { in: ['SUCCESS', 'PARTIAL'] },
          startedAt: { gte: read.request.requestedAt },
        },
        select: { id: true },
      })
      oneOffSettled.set(read.label, done !== null)
    } catch (error) {
      console.warn(`  ${stamp()} ! ${read.label} qayta oʻqish holati oʻqilmadi:`, error)
    }
  }

  /*
    «MIJOZ QAYTISHI», BUILT AND STORED — see `COHORTS_ON`. Never throws: like
    Roistat, a passenger. The clock is stamped when the pass starts, so a
    failing pass is retried once per period, never every tick.
  */
  const runCohortPass = async (): Promise<void> => {
    try {
      const m = await import('../src/server/services/cohortSnapshotRefresh')
      const now = new Date()
      if (!isPassDue(lastCohortAt, now, m.cohortRefreshEvery(now, WORKER_TIME_ZONE))) return
      lastCohortAt = now
      const r = await m.refreshStoredCohorts({ prisma, stopping: () => stopping })
      const built = r.built.map((b) => `${b.key.replace(/^v\d+:/, '')} ${(b.ms / 1000).toFixed(1)} s`).join(' · ')
      if (built) console.log(`  ${stamp()} kohort: ${built}`)
      for (const f of r.failed) console.warn(`  ${stamp()} kohort muvaffaqiyatsiz: ${f.key} — ${f.error.slice(0, 200)}`)
    } catch (error) {
      console.warn(`  ${stamp()} kohort hisobi muvaffaqiyatsiz: ${describeFeedError(error)}`)
    }
  }

  /*
    ROISTAT'S CLOSED MONTHS, READ AND STORED — see `MONTH_SCANS_ON`. Never
    throws, like the cohorts. Each pass asks the store which months are due,
    so a failing month is tried again on the next pass, never twice in one.
  */
  const runMonthScanPass = async (): Promise<void> => {
    try {
      const m = await import('../src/server/services/monthScanRefresh')
      const r = await m.refreshMonthScans({ prisma, timeZone: WORKER_TIME_ZONE, stopping: () => stopping })
      const built = r.built.map((b) => `${b.key.replace(/^v\d+:/, '')} ${(b.ms / 1000).toFixed(1)} s`).join(' · ')
      if (built) console.log(`  ${stamp()} oy keshi: ${built}`)
      for (const f of r.failed) console.warn(`  ${stamp()} oy keshi muvaffaqiyatsiz: ${f.key} — ${f.error.slice(0, 200)}`)
    } catch (error) {
      console.warn(`  ${stamp()} oy keshi hisobi muvaffaqiyatsiz: ${describeFeedError(error)}`)
    }
  }

  console.log(
    `  Sinxronizatsiya har ${INTERVAL_SEC}s. Maʼlumotnomalar har ${REFERENCE_EVERY} tsiklda` +
      ` (oxirgisi: ${lastReferenceAt?.toISOString() ?? 'yozilmagan'}).` +
      (SWEEP_EVERY > 0 ? ` Oxirgi tozalash: ${lastSweepAt?.toISOString() ?? 'yozilmagan'}.` : '') +
      (ROISTAT_MS > 0 ? ` Roistat har ${Math.round(ROISTAT_MS / 60_000)} daqiqada.` : ' Roistat oʻchirilgan.') +
      (META_TOKEN && META_MS > 0
        ? ` Meta har ${Math.round(META_MS / 60_000)} daqiqada (oxirgisi: ${lastMetaAt?.toISOString() ?? 'yozilmagan'}).`
        : ' Meta oʻchirilgan (token yoʻq).') +
      (MOYSKLAD_TOKEN && MOYSKLAD_EVERY > 0
        ? ` MoySklad har ${MOYSKLAD_EVERY} tsiklda.`
        : ' MoySklad oʻchirilgan (token yoʻq).') +
      (SWEEP_EVERY > 0
        ? ` Oʻchirilganlarni tozalash kechada bir marta (01:00–06:00, ${WORKER_TIME_ZONE}), oraliq ${SWEEP_EVERY} tsikl.`
        : ' Tozalash oʻchirilgan.') +
      (EVENTS_DRAIN_MS > 0
        ? ` Portal hodisalari har ${EVENTS_DRAIN_MS / 1000}s.`
        : ' Portal hodisalari oʻchirilgan.') +
      ` Lid nazorati (qoʻngʻiroqlar, ochiq chatlar) har ${LEAD_WATCH_MS / 1000}s.` +
      (relayHost() ? ` Bitrix24 soʻrovlari oraliq server orqali: ${relayHost()}.` : ' Bitrix24 soʻrovlari toʻgʻridan-toʻgʻri.') +
      '\n',
  )

  /*
    Each account's grains, read through which day (`MetaImportOptions.readThrough`):
    the worker's memory, so a quiet account is asked a week, not July → today,
    from the second pass after a start.
  */
  const metaReadThrough = new Map<string, string>()

  /**
   * One Meta pass — spend (with the history walk, and the 37-day re-read when
   * `deep`), then the forms' leads, then the ad→form links — each in a try of
   * its own; `deep` also re-reads a week of every form's leads and re-checks
   * the recently spending ads' forms. Never throws: it runs beside the loop,
   * and a rejection there would be nobody's to catch. True when every
   * account's spend was read.
   */
  async function runMetaPass(token: string, deep: boolean): Promise<boolean> {
    const metaStarted = Date.now()
    let complete = false
    try {
      const r = await importMetaSpend(prisma, token, zonedDateKey(new Date(), WORKER_TIME_ZONE), {
        refreshDays: deep ? META_DEEP_REFRESH_DAYS : undefined,
        historyMs: META_HISTORY_MS,
        readThrough: metaReadThrough,
      })
      console.log(
        `  ${stamp()} meta${deep ? ' (tungi chuqur qayta oʻqish)' : ''}: ${r.accounts} akkaunt, ${r.rows} kun-qator, ${r.campaignRows} kampaniya-kun, ${r.adRows} eʼlon-kun (${r.since} – ${r.until})` +
          (r.historyRows > 0 || r.historyPending > 0
            ? `, eski tarix: ${r.historyRows} qator` + (r.historyPending > 0 ? `, ${r.historyPending} akkaunt davom etadi` : ', tugadi')
            : '') +
          `  (${((Date.now() - metaStarted) / 1000).toFixed(1)}s)`,
      )
      if (r.wide.length > 0) console.log(`  ${stamp()} meta keng oyna (7 kundan uzun): ${r.wide.join(' · ')}`)
      for (const refused of r.failed) console.warn(`  ${stamp()} meta akkaunt oʻqilmadi — ${refused}`)
      complete = r.failed.every((f) => f.includes(' · eski tarix: '))
    } catch (error) {
      console.warn(`  ${stamp()} meta muvaffaqiyatsiz: ${(error as Error).message}`)
    }

    /*
      The lead forms' own leads, for the campaigns' kval — after the spend,
      in a try of its own: it is the page's budget, not the ad accounts',
      and a token without `leads_retrieval` must not cost the spend import.
    */
    const leadsStarted = Date.now()
    try {
      const r = await importMetaLeads(prisma, token, undefined, { deep })
      console.log(
        `  ${stamp()} meta lidlar: ${r.pages} sahifa, ${r.forms} forma, ${r.leads} yangi lid` +
          `  (${((Date.now() - leadsStarted) / 1000).toFixed(1)}s)`,
      )
      for (const refused of r.failed) console.warn(`  ${stamp()} meta forma oʻqilmadi — ${refused}`)
    } catch (error) {
      console.warn(`  ${stamp()} meta lidlar muvaffaqiyatsiz: ${(error as Error).message}`)
    }

    /*
      Which form each lead-form ad points at, off its creative — the only
      link to a form on a page the token is not assigned to. Once per ad,
      in its own try: it is the ad accounts' `ads_management` budget.
    */
    const adFormsStarted = Date.now()
    try {
      const r = await importMetaAdForms(prisma, token, { recheck: deep })
      console.log(
        `  ${stamp()} meta reklama→forma: ${r.ads} reklama oʻqildi, ${r.withForm} tasida forma` +
          `  (${((Date.now() - adFormsStarted) / 1000).toFixed(1)}s)`,
      )
      for (const refused of r.failed) console.warn(`  ${stamp()} meta reklama→forma toʻxtadi — ${refused}`)
    } catch (error) {
      console.warn(`  ${stamp()} meta reklama→forma muvaffaqiyatsiz: ${(error as Error).message}`)
    }
    return complete
  }

  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // Finish the tick in flight rather than leaving a half-written batch,
      // but cut short any wait — the platform allows thirty seconds to stop.
      console.log(`\n  ${stamp()} toʻxtatilmoqda…`)
      stopping = true
      wake()
    })
  }

  let tick = 0
  /** MoySklad reads this process has made — every tenth also sweeps deletions. */
  let moyskladRuns = 0
  /** When «Sverka»'s product check last ran; null — on the first MoySklad turn. */
  let lastProductCheckAt: Date | null = null
  /** Deals the check asked for, and when — none is asked for twice inside a day. */
  const productAskedAt = new Map<string, number>()
  /**
   * Consecutive failures, for backoff.
   *
   * The portal blocks a method for about ten minutes when it decides a read
   * was too expensive. Hammering it every minute through that window keeps the
   * block alive; backing off lets it clear.
   */
  let failures = 0
  /** Hot-only ticks left after a recovery; see `CALM_TICKS`. */
  let calm = 0
  /** A reference pass that fell inside the calm and still has to run. */
  let referenceOwed = false
  /** Skipped deals asked for `RESOLVE` on the next tick, and when it last ran. */
  let resolveOwed = false
  let lastResolveAt: Date | null = null

  while (!stopping) {
    const started = Date.now()

    /*
      A CLOSED DOOR IS NOT KNOCKED ON — IT IS PROBED, ONCE, ON A LADDER.

      This replaces the `throttled` flag, which could not do the job it was
      written for: it is computed from the RESULTS of `runAll`, so by the time
      it is true every entity in that tick has already been refused. Measured
      on 2026-09-15, a hot tick under `OVERLOAD_LIMIT` sent 3 requests of which
      2 left after the portal had already said no; a reference tick sent 12 of
      which 11 did; a restart inside the block sent 11 more. The gate inside
      `call()` stops those. This is the other half: while the gate is open the
      worker does no work at all, and asks exactly ONE cheap question when the
      ladder says it is worth asking.

      `tick` is deliberately NOT incremented here. It schedules the Roistat
      import; the reference pass and the sweep run on the wall clock
      (`schedule.ts`), and what keeps THEM off a portal that has just started
      answering again is `CALM_TICKS`.
    */
    if (provider.gate.isOpen()) {
      const now = new Date()

      if (!provider.gate.dueForProbe(now)) {
        const wait = provider.gate.nextWaitMs(now)
        if (wait > 0 && !stopping) await sleep(wait)
        continue
      }

      const state = provider.gate.state()
      if (!(await provider.probe())) {
        console.warn(
          `  ${stamp()} portal hali ham band (${state.code}) —` +
            ` ${Math.round(provider.gate.nextWaitMs(new Date()) / 1000)}s kutiladi` +
            (provider.lastProbeError ? `
    sabab: ${provider.lastProbeError}` : ''),
        )
        /*
          THE NETWORK DIAGNOSIS IS NO LONGER RUN (reachability.ts, deleted 2026-09-17).
          answered its question on 2026-09-16 — TCP opens, TLS never completes,
          Bitrix24 is dropping this address — and each run opened ~11
          connections to four portal addresses at once, handshakes left
          unfinished, which is what a scan looks like to the firewall we were
          waiting on.
        */
        const wait = provider.gate.nextWaitMs(new Date())
        if (wait > 0 && !stopping) await sleep(wait)
        continue
      }

      // `probe()` succeeded, so `call()` has already closed the gate. Fall
      // straight through into a full tick rather than waiting for the next
      // boundary: the data is as stale as the outage was long.
      failures = 0
      calm = CALM_TICKS
      console.log(
        `  ${stamp()} ✓ portal javob berdi (${state.code} tugadi) — sinxronizatsiya sekin tiklanmoqda`,
      )
    }

    const plan = planTick({
      referenceDue: isPassDue(lastReferenceAt, new Date(), REFERENCE_MS) || referenceOwed,
      resolveOwed,
      calm,
    })
    referenceOwed = plan.referenceOwed
    resolveOwed = plan.resolveOwed
    const entities = plan.reference ? [...REFERENCE, ...HOT] : plan.resolve ? [...RESOLVE, ...HOT] : HOT
    // Stamped when the pass is ATTEMPTED — see the startup read for why.
    if (plan.reference) lastReferenceAt = new Date()
    if (plan.resolve) lastResolveAt = new Date()

    // Zeroed per tick, so the line below reports THIS tick's cost rather than
    // the process total. The baskets are kept — they belong to the portal's
    // ten-minute clock, not to ours.
    provider.meter.resetCounters()

    try {
      const results = await engine.runAll(entities, 'INCREMENTAL')
      const changed = results.reduce((sum, r) => sum + r.recordsCreated + r.recordsUpdated, 0)
      const failed = results.filter((r) => r.status === 'FAILED')

      // A deal skipped for an employee or stage we do not hold yet — see `RESOLVE`.
      const dealsSkipped = results.find((r) => r.entity === 'DEALS')?.recordsSkipped ?? 0
      if (isResolvePassDue(dealsSkipped, [lastReferenceAt, lastResolveAt], new Date())) {
        resolveOwed = true
        console.log(
          `  ${stamp()} ${dealsSkipped} bitim yozilmadi (xodimi yoki bosqichi hali yoʻq) —` +
            ' keyingi tsiklda xodimlar, bosqichlar va manbalar qayta oʻqiladi',
        )
      }

      /*
        AND A DEAL WRITTEN WITHOUT ITS SOURCE / ROP / CREATOR (2026-10-22,
        `deal_pending_link`): a new id asks for the same `RESOLVE` pass, and
        after any pass that read the reference data the columns are filled
        from what it brought — in the database, no portal request.
      */
      try {
        if (plan.reference || plan.resolve) {
          const repaired = await repairPendingLinks(prisma)
          if (repaired.filled > 0 || repaired.dropped > 0) {
            console.log(
              `  ${stamp()} bogʻlanmagan bitimlar: ${repaired.filled} ta maydon toʻldirildi` +
                (repaired.dropped > 0 ? `, ${repaired.dropped} tasi bir haftadan beri topilmadi — tashlandi` : '') +
                `, ${repaired.waiting} ta kutmoqda`,
            )
          }
        }
        const lastAsked = [lastReferenceAt, lastResolveAt].filter((d): d is Date => d !== null)
        const newPending = await pendingLinksSince(
          prisma,
          lastAsked.length > 0 ? new Date(Math.max(...lastAsked.map((d) => d.getTime()))) : null,
        )
        if (!resolveOwed && isResolvePassDue(newPending, [lastReferenceAt, lastResolveAt], new Date())) {
          resolveOwed = true
          console.log(
            `  ${stamp()} ${newPending} ta bitim yangi manba yoki xodimni nomladi —` +
              ' keyingi tsiklda xodimlar, bosqichlar va manbalar qayta oʻqiladi',
          )
        }
      } catch (error) {
        console.warn(`  ${stamp()} bogʻlanmagan bitimlar tekshirilmadi: ${(error as Error).message}`)
      }

      // A dropdown item renamed in the portal: the deals stored under its old text follow it.
      const renames = provider.takeLabelRenames()
      if (renames.length > 0) {
        try {
          const changed = await applyLabelRenames(prisma, renames)
          console.log(
            `  ${stamp()} portalda nomi oʻzgargan: ${renames.map((r) => `«${r.from}» → «${r.to}»`).join(', ')} — ${changed} ta bitimda yangilandi`,
          )
        } catch (error) {
          console.warn(`  ${stamp()} nomi oʻzgarganlar yozilmadi: ${(error as Error).message}`)
        }
      }

      /*
        THE SUBSTRING MATCH IS GONE, AND WITH IT ITS BLIND SPOT.

        This used to read the two codes out of an error MESSAGE — which only
        works when the message carries them. It did not for the whole 429/5xx
        family: that branch of `call()` dropped the response body, so a
        `QUERY_LIMIT_EXCEEDED` behind a 503 arrived as «Bitrix24 responded 503»,
        this test was false, and the ten-minute wait it guards never engaged.
        `PortalGate` is told by `call()` itself, from the error's own `code`
        field, before any message is formatted.
      */
      if (failed.length > 0) {
        failures += 1
        console.warn(
          `  ${stamp()} ${failed.map((r) => r.entity).join(', ')} muvaffaqiyatsiz` +
            ` (${failures}-marta ketma-ket)`,
        )
        /*
          SAID ONCE, IN THE WORDS OF THE ACT IT NEEDS.

          «muvaffaqiyatsiz» above reads like a portal having a bad minute, and
          for every other failure it is. This one needs a person, and the log
          is the only place an operator will be looking before the client
          phones — so it names the act rather than the symptom.
        */
        /*
          OUR OWN CEILING NAMES ITSELF, AND NAMES THE REMEDY.

          A budget refusal is not a portal fault and not something to wait out —
          either a regression is spending the hour or the ceiling is genuinely
          too low for what this worker has been asked to do (a cold start on an
          empty database is the honest case: the first walks are millions of
          rows and `npm run bitrix:import` is the path built for it). Both are
          acted on, not waited on, so the line says which and what to look at.
        */
        const budgetNow = provider.budget.state(new Date())
        if (failed.some((r) => r.errorMessage?.includes(SELF_LIMIT_CODE))) {
          console.error(
            `  ${stamp()} ✗ soatlik chaqiruv chegarasi toʻldi` +
              ` (${budgetNow.spent}/${budgetNow.ceiling}) — portal aybdor EMAS.` +
              ` Eng koʻp sarflagan: ${
                budgetNow.byMethod
                  .slice(0, 3)
                  .map((m) => `${m.method} ${m.invocations}`)
                  .join(', ') || 'yoʻq'
              }.` +
              ' Regressiya boʻlmasa BITRIX24_HOURLY_INVOCATIONS ni koʻtaring;' +
              ' toʻliq import uchun `npm run bitrix:import` ishlating.',
          )
        }

        const gate = provider.gate.state()
        if (gate.kind === 'CREDENTIAL') {
          console.error(
            `  ${stamp()} ✗ Bitrix24 webhook rad etildi (${gate.code}). Yangi webhook kerak —` +
              ' qayta urinish yordam bermaydi, portal ' +
              `${Math.round(provider.gate.nextWaitMs(new Date()) / 60_000)} daqiqada zondlanadi.`,
          )
        } else if (gate.kind === 'THROTTLE') {
          console.warn(
            `  ${stamp()} portal bloklandi (${gate.code}) — soʻrovlar toʻxtatildi,` +
              ` ${Math.round(provider.gate.nextWaitMs(new Date()) / 1000)}s dan keyin zondlanadi.`,
          )
        }
      } else {
        failures = 0
        /*
          WHAT THIS TICK COST THE PORTAL, IN THE PORTAL'S OWN UNITS.

          Two portal-wide blocks were diagnosed after the fact from `sync_log`
          row counts, and the support ticket opened after the first one had to
          estimate our request volume from this side of the wire. It is a
          measurement now: HTTP requests, the method invocations they carried
          (a `batch` is one of the first and up to fifty of the second), and
          the fullest basket the portal reported.

          Printed only when a basket is worth reporting or a pace was applied,
          so a healthy idle minute stays silent — the same rule as `changed`
          below, and for the same reason.
        */
        const cost = provider.meter.stats()
        const hottest = cost.peak[0]
        const budget = provider.budget.state(new Date())
        if (cost.waits > 0 || (hottest && hottest.pct >= 25) || budget.pct >= 50) {
          console.log(
            `  ${stamp()} portal: ${cost.requests} soʻrov / ${cost.invocations} chaqiruv` +
              `, soatlik ${budget.spent}/${budget.ceiling} (${budget.pct}%)` +
              (hottest ? `, eng band: ${hottest.method} ${hottest.operating}s (${hottest.pct}%)` : '') +
              (cost.waits > 0 ? `, ${cost.waits} marta sekinlashtirildi` : ''),
          )
        }
        /*
          THE CEILING IS NOT A QUIET SETTING. It sits ~30× above an ordinary
          hour, so reaching three quarters of it means something regressed —
          the chain width, a restart loop, a new pass nobody costed. Said here,
          once, with the spenders named, because the alternative is finding out
          from a 401 several days later, which is how both blocks were found.
        */
        if (budget.pct >= 75) {
          console.warn(
            `  ${stamp()} ⚠ soatlik chaqiruv chegarasiga yaqin: ${budget.pct}% —` +
              ` ${budget.byMethod
                .slice(0, 3)
                .map((m) => `${m.method} ${m.invocations}`)
                .join(', ')}`,
          )
        }
        // Silent when nothing moved: a worker that logs every idle minute
        // buries the ticks that did something.
        if (changed > 0) {
          const detail = results
            .filter((r) => r.recordsCreated + r.recordsUpdated > 0)
            .map((r) => `${r.entity.toLowerCase()} ${r.recordsCreated + r.recordsUpdated}`)
            .join(', ')
          console.log(
            `  ${stamp()} ${changed} yozuv yangilandi — ${detail}` +
              `  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
          )
        }
      }
    } catch (error) {
      failures += 1
      console.error(`  ${stamp()} ✗ tsikl xatosi:`, error)
    }

    /*
      «ЛИД НАЗОРАТИ»'S FEEDS — see `LEAD_WATCH_MS` and `leadWatchFeeds.ts`.

      AFTER THE TICK, BEFORE THE SLOW PASSES. The tick above is what the
      dashboard is judged on, so these never run in its place; and they run
      ahead of the sweeps below because a daily walk takes minutes, and a
      watch that says «no call in 15 minutes» cannot wait behind it.

      THE WORKER'S GUARDS, ALL OF THEM. Nothing while the gate is shut or the
      worker is calming down after a block (`CALM_TICKS`) — a recovery tick is
      for the hot entities alone. Tick 0 is allowed, unlike the sweeps: a pass
      is two requests, and after a deploy the watch would otherwise show the
      previous process's calls for one more tick. The clock records the
      ATTEMPT, so a refusal waits out the interval; each feed has its own try,
      so a failure costs that feed one pass and nothing else — not the tick's
      `failures` count, not the other feed. The calls' walk stops between two
      pages once the worker is told to stop. A refusal has already been told to
      the gate by `call()` itself, and the chats are not asked once the calls
      have shut it.
    */
    const watchNow = new Date()
    if (
      isPassDue(lastLeadWatchAt, watchNow, Math.max(1, LEAD_WATCH_MS - LEAD_WATCH_SLACK_MS)) &&
      LEAD_WATCH_MS > 0 &&
      calm === 0 &&
      !provider.gate.isOpen() &&
      !stopping
    ) {
      lastLeadWatchAt = watchNow
      try {
        const r = await refreshRecentCalls({
          clock: leadWatchClock,
          fetch: (options) => provider.fetchCalls(options),
          persist: (calls: readonly RawCall[]) => engine.persistRecords('CALLS', calls),
          now: watchNow,
          dayStart: resolvePeriod('today', { timeZone: WORKER_TIME_ZONE, now: watchNow }).start,
          stopping: () => stopping,
        })
        // Quiet on an ordinary pass: it runs 720 times a day. A walk cut short by shutdown reads again next start.
        if (!r.stopped && (r.settle || r.failed > 0 || r.pages > 2)) {
          console.log(
            `  ${stamp()} lid nazorati · qoʻngʻiroqlar: ${r.since.toISOString().slice(11, 16)} UTC dan ${r.read} ta oʻqildi` +
              (r.settle ? ' (uzun suhbatlar uchun kengroq oʻqish)' : '') +
              (r.failed > 0 ? `, ${r.failed} tasi yozilmadi (maʼlumotnoma oʻtishi qayta taklif qiladi)` : ''),
          )
        }
      } catch (error) {
        // Never the raw error: see `describeFeedError`.
        const message = describeFeedError(error)
        console.warn(`  ${stamp()} lid nazorati · qoʻngʻiroqlar muvaffaqiyatsiz: ${message}`)
        await leadWatchClock.failed('calls', message, new Date()).catch(() => undefined)
      }

      if (!provider.gate.isOpen() && !stopping) {
        try {
          const r = await refreshOpenLineChats({
            clock: leadWatchClock,
            store: openChatStore,
            fetchChats: (afterId) => provider.fetchOpenLineChats(afterId),
            newestId: () => provider.newestActivityId(),
            firstIdSince: (since) => provider.firstActivityIdSince(since),
            anyOpenChat: (afterId) => provider.anyOpenLineChat(afterId),
            now: watchNow,
          })
          if (r.bootstrap) {
            console.log(
              `  ${stamp()} lid nazorati · ochiq chatlar: oyna #${r.floor} dan boshlandi` +
                (r.bootstrap === 'head'
                  ? ' (sana boʻyicha topilmadi — faqat hozirdan keyin ochilgan chatlar koʻrinadi, bir kunda toʻladi)'
                  : ' (soʻnggi 24 soat)'),
            )
          }
          if (r.held > 0) {
            console.warn(
              `  ${stamp()} lid nazorati · ochiq chatlar: ${r.held} tasi birdan yoʻqoldi — oʻchirilmadi,` +
                ' keyingi oʻtishda tasdiqlansa oʻchiriladi',
            )
          }
        } catch (error) {
          const message = describeFeedError(error)
          console.warn(`  ${stamp()} lid nazorati · ochiq chatlar muvaffaqiyatsiz: ${message}`)
          await leadWatchClock.failed('chats', message, new Date()).catch(() => undefined)
        }
      }
    }

    /*
      THE CRM-FORM FILLS — see `FORM_FILLS_MS` and `formFillFeed.ts`. The
      watch's guards (gate shut, calming down, stopping), its own clock and
      its own try: a failure costs this feed one pass and nothing else.
    */
    const formsNow = new Date()
    if (
      isPassDue(lastFormFillsAt, formsNow, FORM_FILLS_MS - LEAD_WATCH_SLACK_MS) &&
      calm === 0 &&
      !provider.gate.isOpen() &&
      !stopping
    ) {
      lastFormFillsAt = formsNow
      try {
        const r = await refreshFormFills({
          clock: leadWatchClock,
          store: formFillStore,
          fetch: (afterId) => provider.fetchFormFills(afterId, 1),
          firstIdSince: (since) => provider.firstActivityIdSince(since),
          from: sinceMonth(FORM_FILLS_FROM_MONTH, formsNow, WORKER_TIME_ZONE).start,
          now: formsNow,
          stopping: () => stopping,
        })
        if (!r.complete && !stopping) lastFormFillsAt = null
        // Quiet on an ordinary pass: one short page every five minutes.
        if (r.bootstrap || !r.complete) {
          console.log(
            `  ${stamp()} forma toʻldirishlari: #${r.floor} gacha ${r.written} ta yozildi` +
              (r.complete ? '' : ' — hali yetib olinmadi, keyingi tsiklda davom etadi'),
          )
        }
      } catch (error) {
        const message = describeFeedError(error)
        console.warn(`  ${stamp()} forma toʻldirishlari muvaffaqiyatsiz: ${message}`)
        await leadWatchClock.failed('forms', message, new Date()).catch(() => undefined)
      }
    }

    /*
      THE DEAL BIRTHS, THEN THE MOVES — see `DEAL_BIRTHS_MS` and
      `dealBirthFeed.ts`. The same guards, clock and try as the form fills
      beside them; each feed its own try, so a failed one costs only itself.
    */
    const birthsNow = new Date()
    if (
      isPassDue(lastDealBirthsAt, birthsNow, DEAL_BIRTHS_MS - LEAD_WATCH_SLACK_MS) &&
      calm === 0 &&
      !provider.gate.isOpen() &&
      !stopping
    ) {
      lastDealBirthsAt = birthsNow
      for (const feed of ['births', 'moves'] as const) {
        if (stopping) break
        const typeId = feed === 'births' ? 1 : 5
        const label = feed === 'births' ? 'bitim tugʻilishlari' : 'bitim koʻchishlari'
        try {
          const r = await refreshDealBirths({
            feed,
            clock: leadWatchClock,
            store: feed === 'births' ? dealBirthStore : dealMoveStore,
            fetch: (afterId) => provider.fetchDealBirths(afterId, typeId),
            firstIdSince: (since) => provider.firstDealBirthIdSince(since, typeId),
            from: sinceMonth(DEAL_BIRTHS_FROM_MONTH, birthsNow, WORKER_TIME_ZONE).start,
            now: birthsNow,
            stopping: () => stopping,
          })
          if (!r.complete && !stopping) lastDealBirthsAt = null
          if (r.bootstrap || !r.complete) {
            console.log(
              `  ${stamp()} ${label}: #${r.floor} gacha ${r.written} ta yozildi` +
                (r.complete ? '' : ' — hali yetib olinmadi, keyingi tsiklda davom etadi'),
            )
          }
        } catch (error) {
          const message = describeFeedError(error)
          console.warn(`  ${stamp()} ${label} muvaffaqiyatsiz: ${message}`)
          await leadWatchClock.failed(feed, message, new Date()).catch(() => undefined)
        }
      }
    }

    /*
      «БЕЗКВАЛ», COUNTED AND STORED — see `BEZKVAL_PASS_MS` and
      `bezkvalRefresh.ts`. Its own try: a failed day costs this pass only.
    */
    const bezkvalNow = new Date()
    if (isPassDue(lastBezkvalAt, bezkvalNow, BEZKVAL_PASS_MS - LEAD_WATCH_SLACK_MS) && !stopping) {
      lastBezkvalAt = bezkvalNow
      try {
        const r = await refreshBezkval({
          store: bezkvalStore,
          today: zonedDateKey(bezkvalNow, WORKER_TIME_ZONE),
          timeZone: WORKER_TIME_ZONE,
          now: () => new Date(),
          stopping: () => stopping,
        })
        if (r.days.length > 0) {
          console.log(
            `  ${stamp()} bezkval: ${r.days.map((d) => `${d.day} ${d.clients} mijoz, ${d.kirim} kirim, ${d.kval} kval ${Math.round(d.ms / 100) / 10} s`).join(' · ')}`,
          )
        } else if (r.waiting) {
          console.log(`  ${stamp()} bezkval: bitim tugʻilishi va koʻchishi lentalari hali toʻlmagan — hisob kutmoqda`)
        }
      } catch (error) {
        console.warn(`  ${stamp()} bezkval hisobi muvaffaqiyatsiz: ${describeFeedError(error)}`)
      }
    }

    /*
      DELETED IN BITRIX, DELETED HERE.

      An incremental run cannot do this and says so: it fetches only what
      changed since the watermark, so "not returned" means "not touched", not
      "gone". The sweep therefore needs a FULL pass, which is why it has its
      own, much slower clock — and why the dashboard showed a deal for as long
      as it existed, even after somebody deleted it in the portal.

      DEALS ALONE. `deal_item` and `deal_stage_history` are `onDelete: Cascade`
      on the deal, so they follow without a pass of their own; `calls` and
      `stage_history` have no sweeper at all and a FULL run over their 200-300
      thousand rows would be work with nothing to show for it.

      IDS ONLY, AND NEVER THROUGH THE ENGINE.

      This used to run `engine.runAll(['DEALS'], 'FULL', {sweepDeleted: true})`,
      and a FULL engine run does not just collect ids — it re-upserts every row
      it walks. That was 432 000 deals rewritten to answer a question the ID
      column alone answers: thirty to sixty minutes of write traffic on a
      1-vCPU database, with this loop blocked for all of it and no incremental
      tick running. `listDealContacts` walks the same pipelines selecting only ID
      (and CONTACT_ID, for the relink below) —
      a couple of minutes, zero writes — and `deleteMissing` is called
      directly, so the DEALS watermark is never touched by a sweep.

      NOT AT TICK 0. `tick` starts at zero and `0 % N === 0`, so this fired on
      the first tick after every start, restart and redeploy. With deploys
      landing more often than the old sweep could finish, the worker spent its
      whole life sweeping and the dashboard never saw a second minute-tick.
      Reference data loads at tick 0 only when its wall clock says it is due;
      the sweep never does.

      Guarded, because `sweepByAntiJoin` refuses to delete anything when the
      source returns nothing at all, and `listDealContacts` throws rather than
      returning a short read — a failed read must never empty the table. And
      a read that is complete but too SHORT — a pipeline the webhook stopped
      seeing — is refused by `sweepLimit` (2026-10-06); see the catch below.
    */
    /*
      ON THE WALL CLOCK SINCE 2026-09-17 (`schedule.ts`): the tick counter
      restarts with every deploy, and with more than one deploy a day this
      never reached tick 720 at all. A failure is retried after
      `SWEEP_RETRY_MS`, never on the next tick — ~9 300 invocations every two
      minutes into a portal that just refused one is the loop to avoid.
      AND ONLY AT NIGHT SINCE 2026-10-14 (`isSweepDue`): the relink below
      scans every deal, and at 15:45 it timed out a reader's request.
    */
    const sweepNow = new Date()
    const sweepDue =
      isSweepDue(lastSweepAt, sweepNow, SWEEP_MS, WORKER_TIME_ZONE) &&
      (lastSweepFailedAt === null || sweepNow.getTime() - lastSweepFailedAt.getTime() >= SWEEP_RETRY_MS)
    if (sweepDue && tick > 0 && calm === 0 && !provider.gate.isOpen() && !stopping && dealsHandler) {
      const sweepStarted = Date.now()
      // The walk, for the relink below: after a sweep that deleted or was
      // refused, never after one that failed.
      let contacts: Map<string, string | null> | null = null
      try {
        contacts = await provider.listDealContacts()
        const live = new Set(contacts.keys())
        const deleted = (await dealsHandler.deleteMissing?.(live)) ?? 0
        lastSweepAt = new Date()
        lastSweepFailedAt = null
        /*
          THE SWEEP'S OWN RECORD — the next process reads it back at startup.
          `recordsRead` is the portal's deal count and `recordsUpdated` the
          rows deleted here (`sweepLogRow`). A write failure costs one early
          sweep after the next restart, so it is reported and not fatal.
        */
        await prisma.syncLog
          .create({
            data: {
              provider: 'BITRIX24',
              ...sweepLogRow({ refused: false, seen: live.size, deleted }, new Date(sweepStarted), lastSweepAt),
            },
          })
          .catch((error: unknown) => console.warn(`  ${stamp()} ! tozalash yozuvi saqlanmadi:`, error))
        await pruneSyncLog(prisma)
        // Logged unconditionally, including the zero. The old code logged only
        // when something was deleted, so a sweep that silently deleted nothing
        // for months was indistinguishable from one that had nothing to do.
        console.log(
          `  ${stamp()} tozalash: portalda ${live.size} bitim, ${deleted} ta oʻchirildi` +
            `  (${((Date.now() - sweepStarted) / 1000).toFixed(1)}s)`,
        )
      } catch (error) {
        if (error instanceof SweepRefusedError) {
          /*
            REFUSED IS NOT FAILED, AND IT IS NOT TRIED AGAIN IN AN HOUR.

            `sweepLimit` found more deals missing from the walk than a day of
            deletions ever is, and deleted nothing. What causes that — a
            pipeline hidden from the webhook user, most likely — does not lift
            in an hour, and an hourly retry would walk ~9 300 invocations into
            it every hour: the volume both portal blocks were earned with. So it
            stands as the day's sweep — recorded PARTIAL under
            `SWEEP_REFUSED_MARK` with the would-be deletions as skipped (read
            back at startup like a success), said loudly here, tried again
            tomorrow. The relink below runs all the same.
          */
          lastSweepAt = new Date()
          lastSweepFailedAt = null
          await prisma.syncLog
            .create({
              data: {
                provider: 'BITRIX24',
                ...sweepLogRow(
                  { refused: true, seen: error.seen, gone: error.gone, reason: error.message },
                  new Date(sweepStarted),
                  lastSweepAt,
                ),
              },
            })
            .catch((logError: unknown) => console.warn(`  ${stamp()} ! tozalash yozuvi saqlanmadi:`, logError))
          console.error(
            `  ${stamp()} ✗ tozalash rad etildi — ${error.message}. Webhook foydalanuvchisi` +
              ' hamma voronkalarni koʻra olishini tekshiring; ertaga yana uriniladi.',
          )
        } else {
          // Never fatal: a failed sweep leaves stale rows, which is the state we
          // were already in. Losing the tick loop over it would be worse.
          contacts = null
          lastSweepFailedAt = new Date()
          console.warn(`  ${stamp()} tozalash muvaffaqiyatsiz: ${(error as Error).message}`)
        }
      }

      /*
        MERGED CONTACTS, FROM THE SAME READ — see `contactRelink.ts`. Its own
        try: the sweep above is settled and recorded, and a relink that
        refuses must not make the sweep look failed and run again in an hour.

        AFTER A REFUSED SWEEP TOO (2026-10-06). The relink re-points only
        deals the walk returned — and the walk is complete, or
        `listDealContacts` would have thrown — under its own `relinkLimit`.
        Waiting with the refusal stopped merge relinking, which «Mijoz
        qaytishi» counts on, for as long as the refusal stood: a pipeline
        hidden from the webhook stands for days.
      */
      if (contacts) {
        try {
          const relinkStarted = new Date()
          const r = await relinkDealContacts(prisma, 'BITRIX24', contacts)
          /* Its own row, read back at startup above. CUSTOMERS / BACKFILL:
             nothing else writes that pair, and no watermark lives in sync_log. */
          await prisma.syncLog
            .create({
              data: {
                provider: 'BITRIX24',
                entity: 'CUSTOMERS',
                mode: 'BACKFILL',
                status: 'SUCCESS',
                startedAt: relinkStarted,
                finishedAt: new Date(),
                recordsRead: r.checked,
                recordsUpdated: r.relinked,
              },
            })
            .catch((error: unknown) => console.warn(`  ${stamp()} ! relink yozuvi saqlanmadi:`, error))
          console.log(
            `  ${stamp()} kontakt bogʻlanishi: ${r.checked} bitim tekshirildi, ${r.relinked} tasi` +
              ` birlashtirilgan kontaktga oʻtkazildi (${r.customersBefore} ta eski mijozdan)`,
          )
        } catch (error) {
          console.warn(`  ${stamp()} kontakt bogʻlanishi muvaffaqiyatsiz: ${(error as Error).message}`)
        }
      }
    }

    /*
      THE RECENT DEALS, CHECKED BY ID — see `RECENT_SWEEPS`. Same guards as
      the full sweep. The clock records the ATTEMPT, so a refusal
      waits out the reach's own interval rather than retrying every tick; a
      failure deletes nothing and leaves the rows for the next check.
    */
    for (const reach of RECENT_SWEEPS) {
      const reachNow = new Date()
      if (
        !isPassDue(recentSweepAt.get(reach.label) ?? null, reachNow, reach.everyMs) ||
        tick === 0 ||
        calm !== 0 ||
        provider.gate.isOpen() ||
        stopping
      ) {
        continue
      }
      recentSweepAt.set(reach.label, reachNow)
      const reachStarted = Date.now()
      try {
        const r = await sweepRecentConfirmations(
          prisma,
          'BITRIX24',
          (ids) => provider.existingDealIds(ids),
          new Date(reachNow.getTime() - reach.days * 86_400_000),
          reach.population,
        )
        // Quiet when nothing was deleted: the near reach runs 288 times a day.
        if (r.deleted > 0) {
          console.log(
            `  ${stamp()} ${reach.population === 'created' ? 'yangi bitimlar' : 'tasdiqlash'} tozalash (${reach.label}): ${r.checked} bitim tekshirildi,` +
              ` ${r.deleted} ta portalda oʻchirilgan — bu yerda ham oʻchirildi` +
              `  (${((Date.now() - reachStarted) / 1000).toFixed(1)}s)`,
          )
        }
      } catch (error) {
        console.warn(
          `  ${stamp()} ${reach.population === 'created' ? 'yangi bitimlar' : 'tasdiqlash'} tozalash (${reach.label}) muvaffaqiyatsiz: ${(error as Error).message}`,
        )
      }
    }

    /*
      «ИИ ОБРАБОТКА» → РЕГИСТРАЦИЯ MOVES, RE-READ BY ID — see `TRIAGE_REREADS`.
      The same guards as the queue's check above; written through the deal
      handler with no run around it, so no `DEALS` / BACKFILL row settles the
      one-off backfill below. A failure changes nothing and waits its interval.
    */
    for (const reach of TRIAGE_REREADS) {
      const reachNow = new Date()
      if (
        !isPassDue(triageRereadAt.get(reach.label) ?? null, reachNow, reach.everyMs) ||
        tick === 0 ||
        calm !== 0 ||
        provider.gate.isOpen() ||
        stopping
      ) {
        continue
      }
      triageRereadAt.set(reach.label, reachNow)
      try {
        const candidates = await closedTriageDealIds(
          prisma,
          'BITRIX24',
          reach.days === null ? null : new Date(reachNow.getTime() - reach.days * 86_400_000),
        )
        const r = await rereadClosedTriageDeals(
          candidates,
          (ids) => provider.fetchDealsByIds(ids),
          (deals) => engine.persistRecords('DEALS', deals),
          (deal) => deal.metadata?.pipelineRole === 'AI_TRIAGE',
        )
        // Quiet when nothing moved: the near reach runs 288 times a day.
        if (r.moved > 0 || r.skipped > 0) {
          console.log(
            `  ${stamp()} ИИ обработка (${reach.label}): ${r.checked} bitim qayta oʻqildi,` +
              ` ${r.moved} tasi boshqa voronkada` +
              (r.skipped > 0 ? `, ${r.skipped} tasi yozilmadi (bosqich/xodim hali yoʻq — keyingi safar)` : ''),
          )
        }
      } catch (error) {
        console.warn(`  ${stamp()} ИИ обработка qayta oʻqish (${reach.label}) muvaffaqiyatsiz: ${(error as Error).message}`)
      }
    }

    /*
      AN HOUR CLEAR OF THE SWEEP, EITHER SIDE, for both night reads below
      (`isSweepNear`). The one-off reads always kept this distance; the deals
      backfill did not need to while the sweep ran in the day, and shares its
      night since 2026-10-14 (`isSweepDue`).
    */
    const sweepNear = isSweepNear(lastSweepAt, new Date(), SWEEP_MS, WORKER_TIME_ZONE)

    /*
      THE ONE-OFF BACKFILL — see `DEALS_BACKFILL`. Same guards as the sweep:
      never tick 0, never while recovering from a block, never with the gate
      shut; plus the night window, and never beside the sweep (above).
      PARTIAL settles it like SUCCESS — a skipped deal is one the portal no
      longer resolves, and re-reading the window would skip it again.
    */
    const backfillNow = new Date()
    if (
      DEALS_BACKFILL &&
      tick > 0 &&
      calm === 0 &&
      !provider.gate.isOpen() &&
      !stopping &&
      !sweepNear &&
      isBackfillDue(DEALS_BACKFILL, backfillSettled, backfillNow, WORKER_TIME_ZONE, backfillFailedAt)
    ) {
      const backfillStarted = Date.now()
      // An expensive night read: the one-off reads below keep their hour from it.
      lastOneOffAt = new Date()
      console.log(
        `  ${stamp()} backfill: ${DEALS_BACKFILL.since.toISOString().slice(0, 10)} dan beri` +
          ' oʻzgargan bitimlar qayta oʻqilmoqda',
      )
      // Never throws — see `runOneOff`: a database blip here used to exit the worker.
      const outcome = await runOneOff(() =>
        engine.runEntity('DEALS', 'BACKFILL', { updatedSince: DEALS_BACKFILL.since }),
      )
      if (outcome.settled) {
        const r = outcome.result
        backfillSettled = true
        console.log(
          `  ${stamp()} backfill tugadi: ${r.recordsRead} bitim oʻqildi, ${r.recordsUpdated} yangilandi` +
            `  (${((Date.now() - backfillStarted) / 1000).toFixed(1)}s,` +
            ` soatlik ${provider.budget.state(new Date()).spent}/${provider.budget.state(new Date()).ceiling})`,
        )
      } else {
        backfillFailedAt = new Date()
        console.warn(`  ${stamp()} backfill muvaffaqiyatsiz: ${outcome.reason} — bir soatdan keyin`)
      }
    }

    /*
      THE ONE-OFF READS — see `ONE_OFF_READS`. The deals backfill's guards, one
      read per tick, an hour between two of them (the deals backfill counts),
      and never beside the daily sweep: the sweep's ~9 300 invocations and the
      contacts' ~7 600 together pass the 15 000 hourly ceiling, and a refused
      ceiling freezes every hot tick until the hour drains. So an hour clear of
      the sweep either side (`sweepNear`, above), and ONE_OFF_HEADROOM left in
      the budget.
    */
    const oneOffNow = new Date()
    const oneOffBudget = provider.budget.state(oneOffNow)
    const oneOff = ONE_OFF_READS.find((read) =>
      isBackfillDue(
        read.request,
        oneOffSettled.get(read.label) ?? false,
        oneOffNow,
        WORKER_TIME_ZONE,
        oneOffFailedAt.get(read.label) ?? null,
      ),
    )
    if (
      oneOff &&
      tick > 0 &&
      calm === 0 &&
      !provider.gate.isOpen() &&
      !stopping &&
      !sweepNear &&
      oneOffBudget.ceiling - oneOffBudget.spent >= ONE_OFF_HEADROOM &&
      (lastOneOffAt === null || oneOffNow.getTime() - lastOneOffAt.getTime() >= SWEEP_RETRY_MS)
    ) {
      lastOneOffAt = oneOffNow
      const started = Date.now()
      console.log(`  ${stamp()} bir martalik qayta oʻqish: ${oneOff.label}`)
      // Never throws — see `runOneOff`. `lastOneOffAt` is already set, so a
      // failure still holds the hour's spacing.
      const outcome = await runOneOff(() =>
        engine.runEntity(
          oneOff.entity,
          oneOff.mode,
          oneOff.mode === 'BACKFILL' ? { updatedSince: oneOff.request.since } : {},
        ),
      )
      if (outcome.settled) {
        const r = outcome.result
        oneOffSettled.set(oneOff.label, true)
        console.log(
          `  ${stamp()} ${oneOff.label} tugadi: ${r.recordsRead} oʻqildi, ${r.recordsUpdated} yangilandi` +
            `  (${((Date.now() - started) / 1000).toFixed(1)}s,` +
            ` soatlik ${provider.budget.state(new Date()).spent}/${provider.budget.state(new Date()).ceiling})`,
        )
      } else {
        oneOffFailedAt.set(oneOff.label, new Date())
        console.warn(`  ${stamp()} ${oneOff.label} muvaffaqiyatsiz: ${outcome.reason} — bir soatdan keyin`)
      }
    }

    /*
      After the Bitrix tick, never instead of it: the portal sync is what the
      dashboard is judged on, and an hourly page fetch must not delay it.

      `tick > 0` for the same reason as the sweep: a five-megabyte page fetch
      on the first tick after every redeploy delays the first real sync for
      nothing — the source changes a few times a day.
    */
    const roistatDue = ROISTAT_MS > 0 && tick > 0 && isPassDue(lastRoistatAt, new Date(), ROISTAT_MS) && !stopping
    if (roistatDue) {
      lastRoistatAt = new Date()
      await runRoistatImport()
    }

    /*
      Meta, on the same «after the tick, never tick 0» rule, on the wall
      clock (`lastMetaAt`, above), and never on Roistat's tick so the two
      passengers never ride together. A failure is logged and forgotten until
      the next period — Meta being down must never cost a Bitrix24 tick.
      Started, not awaited (`metaInFlight`): the loop goes on with the portal.
    */
    if (
      META_TOKEN &&
      tick > 0 &&
      metaInFlight === null &&
      !roistatDue &&
      isPassDue(lastMetaAt, new Date(), META_MS) &&
      !stopping
    ) {
      const startedAt = new Date()
      lastMetaAt = startedAt
      const deep = isSweepDue(lastMetaDeepAt, startedAt, 86_400_000, WORKER_TIME_ZONE)
      metaInFlight = runMetaPass(META_TOKEN, deep)
        .then((complete) => {
          // Only a night pass that read every account counts as the night's: a refused one is asked again next pass.
          if (deep && complete) lastMetaDeepAt = startedAt
        })
        .finally(() => {
          metaInFlight = null
        })
    }

    /*
      «Mijoz qaytishi», beside the loop like Meta, but never STARTED while a
      Meta pass or the hour's Roistat import runs — its four whole-history
      scans are the heaviest thing this worker asks of the one core — and
      never on tick 0 (`runCohortPass` decides whether it is due).
    */
    /*
      Roistat's closed months ride the same passenger, AFTER the cohorts
      (2026-10-28) — two month-long scans side by side on one core are what
      timed out. As two passengers the months never ran at all: the cohort
      pass is started every tick (it decides for itself whether it is due),
      so a second check on «no cohort pass in flight» was false in the very
      tick that started it.
    */
    if ((COHORTS_ON || MONTH_SCANS_ON) && tick > 0 && storedInFlight === null && metaInFlight === null && !roistatDue && !stopping) {
      storedInFlight = (async () => {
        if (COHORTS_ON) await runCohortPass()
        if (MONTH_SCANS_ON && !stopping) await runMonthScanPass()
      })().finally(() => {
        storedInFlight = null
      })
    }

    /*
      MoySklad for «Sverka», on the same «never tick 0» rule, offset by one
      tick from the hour's Meta and Roistat passes. A failure is logged and
      retried on the next turn — MoySklad being down must never cost a
      Bitrix24 tick.
    */
    if (MOYSKLAD_TOKEN && MOYSKLAD_EVERY > 0 && tick > 0 && (tick + 1) % MOYSKLAD_EVERY === 0 && !stopping) {
      const sweep = moyskladRuns % MOYSKLAD_SWEEP_RUNS === 0
      moyskladRuns += 1
      const msStarted = Date.now()
      try {
        const r = await importMoyskladOrders(prisma, MOYSKLAD_TOKEN, { sweep, maxPages: MOYSKLAD_MAX_PAGES })
        console.log(
          `  ${stamp()} moysklad: ${r.orders} buyurtma, ${r.items} pozitsiya` +
            (r.partial ? ' (davomi keyingi safar)' : '') +
            (r.skipped > 0 ? `, sanasiz ${r.skipped}` : '') +
            (r.deleted === null ? '' : `, oʻchirilgan ${r.deleted}`) +
            (r.repriced ? `, toʻlovi yangilangan ${r.repriced}` : '') +
            (r.paymentError ? `, toʻlovlar oʻqilmadi: ${r.paymentError}` : '') +
            `  (${((Date.now() - msStarted) / 1000).toFixed(1)}s)`,
        )
      } catch (error) {
        console.warn(`  ${stamp()} moysklad muvaffaqiyatsiz: ${(error as Error).message}`)
        await recordMoyskladFailure(prisma, error as Error).catch(() => undefined)
      }

      // See `PRODUCT_RECHECK_MS`. Asks the portal nothing itself; never fatal.
      const checkNow = new Date()
      if (isPassDue(lastProductCheckAt, checkNow, PRODUCT_RECHECK_MS)) {
        lastProductCheckAt = checkNow
        const now = checkNow.getTime()
        for (const [id, at] of productAskedAt) if (now - at >= PRODUCT_RECHECK_AGE_MS) productAskedAt.delete(id)
        try {
          const rows = await sverkaRepository.productCheckRows(
            new Date(now - PRODUCT_RECHECK_REACH_MS),
            new Date(now - PRODUCT_RECHECK_AGE_MS),
          )
          const due = productRecheckRows(
            rows.filter((r) => !productAskedAt.has(r.dealId)),
            PRODUCT_RECHECK_MAX,
          )
          if (due.length > 0) {
            for (const r of due) productAskedAt.set(r.dealId, now)
            const waiting = provider.requestDealItems(due.map((r) => ({ id: r.dealId, lines: r.bitrix.length })))
            console.log(
              `  ${stamp()} sverka: ${due.length} bitim mahsuloti MoySkladʼdan farq qiladi —` +
                ` Bitrix24ʼdan qayta oʻqiladi (navbatda ${waiting})`,
            )
          }
        } catch (error) {
          console.warn(`  ${stamp()} sverka mahsulot tekshiruvi muvaffaqiyatsiz: ${(error as Error).message}`)
        }
      }
    }

    tick += 1
    if (calm > 0 && !provider.gate.isOpen()) calm -= 1

    /**
     * Wait out the rest of the interval, not the whole interval.
     *
     * A tick that took forty seconds should be followed by twenty, not sixty —
     * otherwise the effective cadence drifts with how much work there was.
     */
    /*
      Backoff is a FLOOR, not an addend.

      Added to `remaining` it disappeared exactly when it was needed: a tick
      failing slowly — thirty-second portal timeouts, five entities — already
      overruns the interval, so `remaining` was negative and the sum stayed
      negative. The worker skipped its sleep entirely and hammered a portal
      that blocks an expensive method for about ten minutes, which is the one
      situation backoff exists to defuse. As a floor, a failing worker always
      waits at least its backoff; a long but SUCCESSFUL tick still starts the
      next one immediately, because `backoff` is zero when nothing failed.
    */
    /*
      The gate owns the wait whenever it is open — its ladder is the schedule,
      and `THROTTLED_WAIT_MS` survives as that ladder's ceiling rather than as a
      flat wait, so the ten minutes a production incident put there still bounds
      how long the dashboard can be stale without anyone asking the portal.
    */
    const backoff = provider.gate.isOpen()
      ? provider.gate.nextWaitMs(new Date())
      : Math.min(failures, 5) * INTERVAL_SEC * 1000
    const remaining = Math.max(INTERVAL_SEC * 1000 - (Date.now() - started), backoff)

    /*
      THE WAIT IS WHERE THE PORTAL'S EVENTS ARE APPLIED — see `EVENTS_DRAIN_MS`.
      Drain `crm_event`, sleep a slice, drain again, until the interval is
      out — the drain comes FIRST so a tick that overran its interval (the
      nightly walk, a slow day) still applies what arrived during it, instead
      of skipping the wait and the drain with it. No drain while the gate is
      shut, while the worker is calming down after a block, or once it is
      stopping. `wake()` still cuts a slice short; a signal that lands inside
      a drain waits for that drain — at most two batch calls and a hundred
      upserts — which the platform's thirty seconds covers. A drain failure
      deletes nothing, leaves the rows pending, is logged once per distinct
      message, and the next slice tries again; rows older than
      `EVENTS_GIVE_UP_MS` are then let go.
    */
    const deadline = Date.now() + remaining
    let lastEventsError: string | null = null
    let floodLogged = false
    let lastHeld = 0
    const drainPortalEvents = async (): Promise<void> => {
      const rows = await pendingCrmEvents(prisma, 'BITRIX24', EVENTS_DRAIN_ROWS)
      if (rows.length === 0) return
      const distinct = new Set(rows.map((r) => r.externalId)).size
      const flood = distinct > EVENTS_DRAIN_MAX
      // A deletion of a deal we never held is done without a read — see `dropUnknownDeletes`.
      const deletes = rows.filter((r) => r.event === 'ONCRMDEALDELETE')
      const { drop } = dropUnknownDeletes(
        deletes,
        await localDealIds(prisma, 'BITRIX24', [...new Set(deletes.map((r) => r.externalId))]),
      )
      const dropped = new Set(drop.map((r) => r.id))
      const live = rows.filter((r) => !dropped.has(r.id))
      const events = flood ? takeDistinct(live.filter((r) => r.event === 'ONCRMDEALDELETE'), EVENTS_DRAIN_MAX) : live
      const deferred = [...drop.map((r) => r.id), ...(flood ? live.filter((r) => r.event !== 'ONCRMDEALDELETE').map((r) => r.id) : [])]
      const drainStarted = Date.now()
      const r =
        events.length > 0
          ? await applyCrmEvents(
              events,
              (ids) => provider.fetchDealsByIds(ids),
              (deal) => deal.externalId,
              (deals) => engine.persistRecords('DEALS', deals),
              (ids) => deleteDealsByExternalId(prisma, 'BITRIX24', ids),
            )
          : null
      await markCrmEventsProcessed(prisma, [...events.map((e) => e.id), ...deferred])
      await pruneCrmEvents(prisma, new Date(Date.now() - EVENTS_KEEP_MS))
      lastEventsError = null
      if (flood && !floodLogged) {
        floodLogged = true
        console.log(
          `  ${stamp()} portal hodisalari: toshqin — ${distinct}+ bitim navbatda; faqat oʻchirishlar qoʻllanadi,` +
            ` oʻzgarishlar tickning oʻz oʻtishiga qoldirildi`,
        )
      }
      if (r === null) return
      // Quiet unless something was deleted, held, skipped or rejected: updates arrive all day.
      const heldChanged = r.held > 0 && r.held !== lastHeld
      lastHeld = r.held
      if (r.deleted > 0 || heldChanged || r.skipped > 0 || r.failed > 0) {
        console.log(
          `  ${stamp()} portal hodisalari: ${r.events} hodisa, ${r.checked} bitim qayta oʻqildi,` +
            ` ${r.written} yozildi` +
            (r.deleted > 0 ? `, ${r.deleted} ta portalda oʻchirilgan — bu yerda ham oʻchirildi` : '') +
            (r.held > 0 ? `, ${r.held} ta portal qaytarmadi — juda koʻp, oʻchirilmadi (kunlik tozalash hal qiladi)` : '') +
            (r.skipped > 0 ? `, ${r.skipped} tasi yozilmadi (bosqich/xodim hali yoʻq)` : '') +
            (r.failed > 0 ? `, ${r.failed} tasi rad etildi (keyingi tick qayta taklif qiladi)` : '') +
            `  (${((Date.now() - drainStarted) / 1000).toFixed(1)}s)`,
        )
      }
    }
    while (!stopping) {
      if (EVENTS_DRAIN_MS > 0 && calm === 0 && !provider.gate.isOpen()) {
        try {
          await drainPortalEvents()
        } catch (error) {
          const message = (error as Error).message
          if (message !== lastEventsError) console.warn(`  ${stamp()} portal hodisalari muvaffaqiyatsiz: ${message}`)
          lastEventsError = message
          const expired = await expireCrmEvents(prisma, 'BITRIX24', new Date(Date.now() - EVENTS_GIVE_UP_MS)).catch(
            () => 0,
          )
          if (expired > 0) {
            console.warn(`  ${stamp()} portal hodisalari: ${expired} ta hodisa bir soatdan beri qoʻllanmadi — tashlab yuborildi (kunlik tozalash hal qiladi)`)
          }
        }
      }
      const left = deadline - Date.now()
      if (left <= 0 || stopping) break
      await sleep(EVENTS_DRAIN_MS > 0 ? Math.min(left, EVENTS_DRAIN_MS) : left)
    }
  }

  // A Meta pass in flight finishes its account — each grain is its own
  // transaction, so one cut short leaves the last pass's rows, never a hole.
  if (metaInFlight) await Promise.race([metaInFlight, sleep(15_000)])
  // A cohort build cut short keeps its old row: each question is written only once it is built.
  if (storedInFlight) await Promise.race([storedInFlight, sleep(15_000)])

  // Releasing the lock explicitly lets a replacement worker start at once
  // instead of waiting out the connection's own timeout.
  await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
  lockClient.release()
  await prisma.$disconnect()
  await pool.end()
  console.log(`  ${stamp()} toʻxtadi.\n`)
}

main().catch((error) => {
  console.error('\n  Worker xatosi:', error, '\n')
  process.exit(1)
})
