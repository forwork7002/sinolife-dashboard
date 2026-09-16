# Mijozlar va qoʻngʻiroqlar — a new screen for customer flow and telephony

Design, 2026-09-16. Client request, verbatim: «sotivda mijoz soniyam kerak
pritok otoklar kerak baza ne baza mijozlarga call duration — shu narsalarni
qilishimiz kerak dashboarda juda zoʻr va ideal qilib shu narsalarni qoʻshib ber
dashboardga aniq malumotlarda», then «call duration ham kerak call duration
toʻliq malumot boʻlimda».

Four decisions the client made in the same conversation, before any of this was
written:

1. **A new screen**, not a band on an existing one — offered «Mijoz qaytishi»
   (where the backend already fits) and «Savdo dinamikasi» (the screen they
   named) and they chose a third section of their own.
2. **Call duration starts at 2026-09-13.** The sixteen days before it are
   wrong; they were offered a portal re-read that would correct them and
   declined it. §4 is why the data is wrong and §4.3 is what stops it
   recurring.
3. **All four call cuts**: per operator, a daily trend, per team, and per
   customer.
4. **The period control drives the call block only.** The customer-flow band
   keeps its own ninety days and prints the dates it got.

---

## 1. What already exists, and what this adds

The customer half of the request is **already built and unrendered**. Branch
`mijozlar-oqimi` carries `/insights/customers` end to end — repository, service,
DTOs, endpoint, `CustomerFlowChart`, `CategoryBarList`'s rate mode — against
the spec `2026-09-15-mijozlar-oqimi-design.md`. Its Task 9 («the band on the
screen») was never finished: `CohortPage.tsx` holds two unused imports and no
band. That work is not redone here; it is **mounted on the new screen
instead**, which is the only change the client's choice of location forces.

| Asked for | Where it comes from |
|---|---|
| мижоз сони | `summary.activeCustomers` — built |
| приток | `summary.newCustomers` + `series[].newCustomers` — built |
| отток | `states.rows` → `Yoʻqotilgan` — built |
| база / не база | **new** — one arm added to `customerStates()`, §5.3 |
| call duration, toʻliq | **new** — `/insights/calls`, §3 |

---

## 2. Measured facts this design rests on

Read directly from the production database on 2026-09-16, with throwaway
read-only scripts that are not kept in the repository (see commit 949ebb9 on
main for why: `next build` type-checks every root `.ts`). Every number below is
a count or an
aggregate; no customer name or phone column was selected.

**Volume.** `call_record` holds **366 300** rows spanning 2026-07-29 →
2026-09-15, over **164** employees, **5 327** talk-hours in total.

**Linkage.** `employeeId` is set on **100%** of rows. `customerId` on
**363 826 — 99.3%**. `dealId` on **1 row of 366 300**: the portal answers
`CRM_ENTITY_TYPE = 'CONTACT'` for effectively every call, and the importer
only writes `dealId` for `'DEAL'`. **A call cannot be tied to an order**, so
"how many calls did this order take" is not a question this data can answer;
"how many calls did this customer take" is.

**`recordUrl` is set on 0 of 366 300 rows.** `docs/SUPERDASHBOARD.md` §6 says
"the recordings are stored… so a scorer added later reads this table instead of
facing a year-long gap". That is **false** and has been false since the first
import. Recorded here; the doc is corrected separately, and a future scorer
faces exactly the gap that sentence promised it would not.

**Direction is the leg, not the intent.** INBOUND **338 467** against OUTBOUND
**27 833** on a floor whose job is ringing customers. `mapping.ts` already says
so in a comment («voximplant.statistic.get reports the leg, not the intent»):
an operator taking a queued outbound leg is recorded as receiving a call. The
block therefore **does not split by direction**, because the split reads
backwards.

**`connected` and `durationSec` are one population.** Above the floor,
non-connected calls carrying seconds: **0**. Connected calls carrying zero
seconds: **18 of 5 522 — 0.3%**. So `sum(durationSec) FILTER (WHERE connected)`
and `sum(durationSec)` differ by nothing that matters, and the FILTER is kept
only to make the population explicit.

**Failure codes**, whole table: `304` on 259 092 (no answer), `503` on 4 371,
`480` on 100, and 102 737 connected.

### 2.1 The mean is not the figure to print

Connected calls since the floor (5 522 of them, 256.3 talk-hours):

| avg | p50 | p75 | p90 | p99 | max |
|---|---|---|---|---|---|
| 167 s | **50 s** | 137 s | 514 s | 1 491 s | 2 717 s |

**The mean is 3.3× the median.** The distribution is why:

| Band | Calls | Share | Talk hours |
|---|---|---|---|
| 0–9 s | 497 | 9.0% | 0.6 |
| 10–29 s | 1 193 | 21.6% | 6.9 |
| 30–59 s | 1 376 | 24.9% | 16.1 |
| 1–3 daq | 1 322 | 23.9% | 37.7 |
| 3–10 daq | 669 | 12.1% | 62.8 |
| **10+ daq** | **465** | **8.4%** | **132.3** |

8.4% of calls hold **52%** of all talk time. An average alone would tell a ROP
that a typical call runs nearly three minutes when half of them end inside
fifty seconds. **The median is mandatory on this block, the mean is printed
beside it, and the band distribution is what makes both readable.** This is
what «call duration toʻliq malumot» is answered with.

### 2.2 The team basis was measured, not chosen

Callers by their `employee.departmentId`, three days above the floor: thirteen
`(ROP)` departments plus `Регистрация` (3 533 calls), `Операцион` (752) and
`NEWGEN` (135).

Two consequences:

* **`employee.departmentId`, never `department_member`.** The membership table
  puts one person in several units, so grouping on it inflates the total —
  measured: `Azizbek(ROP)` reads 1 902 calls on the primary department and
  2 847 through memberships, `Sadriddin(ROP)` 187 against 463. The primary
  department is a **partition**: the team rows sum to the overall row, which is
  what makes the block checkable.
* **`(ROP)` is stripped but a non-ROP department is NOT dropped.**
  `sellerBoardRepository.ropOf` returns null for a department without the
  marker; applying that here would send 4 420 of 20 607 calls — **21.4%** —
  into an unlabelled hole. The rule is therefore: strip the marker where it exists,
  otherwise print the department verbatim, and label a caller with no
  department `Boʻlimsiz`. Same spelling as the rest of the product for every
  ROP team; complete for the rest.

### 2.3 Cost

`GROUPING SETS` over the four arms, measured from Tashkent (which adds ~1.4 s
of round trip to every figure below):

* 3 days (the real window today): **1 487 ms**, 156 rows
* 30 days (the worst case this grows into): **8 063 ms**, 211 rows
* the customer-band statement: **158 ms**
* per-operator percentiles in the same pass: **+166 ms**

So the block goes behind `ttlCache`, the arrangement `customerFlow` already
uses on the same database (370–1 478 ms warm, 3.7–8 s cold). One vCPU,
`work_mem` 2 MB: a `count(DISTINCT customerId)` over 190 000 rows spills, and
a per-reader re-query is what the memo exists to prevent.

---

## 3. `GET /api/v1/insights/calls`

The name was freed by the 2026-09-10 callerless cull, which deleted the old
`/insights/calls` with the screen it fed. This is a different endpoint under
the same address, and the old one is not restored: it answered response-speed
questions that needed a call→deal join, and §2 shows that join does not exist.

```
ACCESS  = { permission: 'analytics:read:all', section: 'customers' }
schema  = the standard dashboard period (preset | from/to), as /insights/margin takes it
```

**It honours the dashboard window**, and «Bugun» — the global default in
`useDashboardFilters` — is the right question for it: "who spoke to customers
today, and for how long". That is the one difference from `/insights/customers`,
whose sibling failure («twelve customers and one pair under a critical-red
gauge») is what made that endpoint resolve its own window. Nothing about a
day's telephony is degenerate, so nothing here needs that defence.

**`DEFAULTS.preset` is not changed.** It lives in
`src/features/shared/useDashboardFilters.ts`, which reaches `/sellers` and
`/confirmation`; those screens are not to change.

### 3.1 `InsightsRepository.callActivity(options)` — one statement, four arms

`GROUPING SETS ((), (employee), (team), (day))` over one scan, the shape
`retentionStages` and `logistics` already use. Every arm carries the same
measures so the screen cannot compare two differently-defined figures:

| Measure | SQL | Why |
|---|---|---|
| `calls` | `count(*)` | every leg, connected or not |
| `connected` | `count(*) FILTER (WHERE connected)` | the portal's own code 200 |
| `talkSec` | `sum("durationSec") FILTER (WHERE connected)` | seconds only exist on connected legs (§2) |
| `medianSec` | `percentile_disc(0.5) … FILTER (WHERE connected)` | §2.1 — the headline duration |
| `p90Sec` | `percentile_disc(0.9) … FILTER (WHERE connected)` | how long the long tail runs |
| `customers` | `count(DISTINCT "customerId")` | people reached, not legs |

`percentile_disc`, not `percentile_cont`: a duration is a number of whole
seconds the portal observed, and interpolating between two of them invents a
call that did not happen.

The team expression is one shared SQL fragment —
`InsightsRepository.callTeamSql`, read by this statement only but written once
so §2.2's rule has one home:

```sql
COALESCE(
  NULLIF(btrim(regexp_replace(dp."name", '\(ROP\)', '', 'i')), ''),
  dp."name",
  'Boʻlimsiz')
```

The window's lower bound is `greatest(period.start, CALL_DATA_FLOOR)` — §4.

### 3.2 `InsightsRepository.callDurationBands(options)`

The §2.1 table, on the same clamped window: six fixed bands over connected
calls, each with its call count, its share and its talk hours. A second
statement rather than a seventh grouping arm, because the bands are a `CASE`
over the row and the four arms are groupings of it; measured at 144 ms, so
there is nothing to buy by merging them.

`CALL_DURATION_BANDS` lives in `src/lib/callQuality.ts` (§4) so the SQL's
`CASE` and the screen's labels are built from one table — the arrangement
`logisticsBuckets.ts` and `customerStates.ts` already use.

### 3.3 `InsightsRepository.callCustomerBands(options)`

How many calls one customer takes: `1`, `2-3`, `4-5`, `6+`, each with its
customer count, its mean talk seconds and its talk hours. Measured over three
days: **8 323 / 2 773 / 520 / 301** customers, 82.7 / 73.5 / 34.1 / 33.9 hours.
158 ms.

Rows with `customerId IS NULL` are **excluded from this statement and disclosed
as a number** (`unlinkedCalls`), the same way `/insights/concentration` discloses
revenue booked with no customer attached. 0.7% today; a silent drop would still
be 0.7% tomorrow and unexplained.

### 3.4 Service and caching

`InsightsService.callActivity(period)`:

* three statements in one `Promise.all`, each behind its own `ttlCache`
* the memo key is `period.start` + the span in days + `'calls'`, matching
  `customerFlow`'s key and for the same reason — the day it lands on, not the
  instant
* no currency in the key: this endpoint states no money
* no scope in the key: `customers` is COMPANY_WIDE and the route asks for
  `analytics:read:all`, so every caller who gets through reads the same rows.
  If that changes, the key changes in the same commit or the memo goes.

### 3.5 DTO

```ts
interface CallRowDto {
  key: string           // employeeId | team name | ISO date
  label: string
  calls: number
  connected: number
  connectPercent: number | null   // null when calls = 0, never a manufactured zero
  talkSec: number
  medianSec: number | null        // null when nothing connected
  p90Sec: number | null
  customers: number
}

interface CallActivityDto {
  total: CallRowDto                   // the () arm — every other arm sums to it
  operators: readonly CallRowDto[]    // ranked by talkSec desc
  teams: readonly CallRowDto[]
  series: readonly CallRowDto[]       // one per day, ascending
  durationBands: readonly { key: string; label: string; calls: number; sharePercent: number; talkSec: number }[]
  customerBands: readonly { key: string; label: string; customers: number; avgTalkSec: number; talkSec: number }[]
  unlinkedCalls: number
  /** True when the requested window began before CALL_DATA_FLOOR. */
  floorApplied: boolean
}
```

**The mean carries no column.** It is `talkSec / connected`, computed on the
screen from two numbers already in the row. A server-side `avgSec` would be a
third figure that has to agree with the other two, and rounding it twice is how
a tile comes to disagree with the table under it.

The resolved (clamped) window rides back in `meta.period`, so the screen prints
the dates it actually got rather than the ones it asked for — the same
mechanism `/insights/concentration` and `/insights/customers` use.

---

## 4. The data floor, and the importer bug behind it

### 4.1 What is wrong

Connected share and mean connected duration, by week:

| Week of | Connected | Mean | Max | Talk hours |
|---|---|---|---|---|
| 2026-07-27 | 30.8% | 220 s | 3 025 s | 519 |
| 2026-08-03 | 31.9% | 199 s | 3 600 s | 1 120 |
| 2026-08-10 | 32.2% | 207 s | 3 600 s | 1 235 |
| 2026-08-17 | 31.2% | 190 s | 3 600 s | 1 288 |
| 2026-08-24 | 27.5% | 182 s | 3 600 s | 870 |
| **2026-08-31** | **11.8%** | **42 s** | **2 006 s** | **32** |
| **2026-09-07** | **11.6%** | **28 s** | **360 s** | **24** |
| 2026-09-14 | 28.1% | 175 s | 2 717 s | 240 |

Per day, the ceiling is the tell — `max("durationSec")` reads 55, 89, 28, 112,
166, 101, 224, 336, 252, 291, **360**, 270, 277 on the thirteen days from
2026-08-29 to 2026-09-12. A week of 26 511 calls whose longest conversation was
six minutes did not happen.

### 4.2 Why

`createdAt` against `startedAt` dates it exactly. Everything up to 2026-08-27
was written by the **backfill** of 2026-08-28 and is correct. Every day from
2026-08-28 to 2026-09-12 was imported **on the day itself**, by the
**per-minute** incremental pass — which reads
`voximplant.statistic.get` with `>=CALL_START_DATE = watermark` and so picks a
call up **while it is still ringing or still being spoken**. `CALL_DURATION` is
then whatever has elapsed, the watermark moves past that call's start, and the
row is never re-read. Hence a per-day ceiling of roughly one sync interval, and
a connected share collapsing to a third of normal — a leg caught mid-dial has
not got its code 200 yet either.

2026-09-13 onward is correct again because **`CALLS` left the per-minute list on
2026-09-14** (recorded in `CLAUDE.md`, done for the portal's overload, not for
this) and rides the half-hourly reference pass, by which time a call has ended.
The fix below made itself; the floor is where it took effect.

### 4.3 `src/lib/callQuality.ts` — and the settle lag

```ts
/** Durations and connect rates below this are truncated — see the spec §4. */
export const CALL_DATA_FLOOR = new Date('2026-09-13T00:00:00+05:00')

/**
 * `maxSec` is EXCLUSIVE and the last band has none, so the six cover every
 * non-negative integer exactly once. `colour` follows the entity, never its
 * rank (docs/DESIGN.md) — one ramp from short to long.
 */
export const CALL_DURATION_BANDS = [
  { key: 'S0',    maxSec: 10,   label: '0-9 s',    colour: '--series-1' },
  { key: 'S10',   maxSec: 30,   label: '10-29 s',  colour: '--series-2' },
  { key: 'S30',   maxSec: 60,   label: '30-59 s',  colour: '--series-3' },
  { key: 'M1',    maxSec: 180,  label: '1-3 daq',  colour: '--series-4' },
  { key: 'M3',    maxSec: 600,  label: '3-10 daq', colour: '--series-5' },
  { key: 'M10',   maxSec: null, label: '10+ daq',  colour: '--series-6' },
] as const
```

Client-safe, both sides read it: the repository clamps its window to the floor
and builds its `CASE` from the bands, the screen draws its labels from the same
bands and states the floor in the block's hint.

**The importer fix belongs in `SyncEngine`, not in the provider.** Watermark
policy already lives there: `SKIP_LOOKBACK_MS` moves an entity's next
watermark back *when a run skipped something*, and `nextWatermark(entity,
startedAt, skipped)` applies it. CALLS needs the same movement
**unconditionally**, because nothing was skipped — the row was written, with a
duration that had not happened yet. So a second table beside it:

```ts
/** How far back an entity re-reads EVERY run, so a record can settle. */
const SETTLE_LOOKBACK_MS: Partial<Record<SyncEntityValue, number>> = {
  CALLS: 3 * 60 * 60_000,
}
```

and `nextWatermark` returns `startedAt` moved back by the **larger** of the two
lookbacks that apply. It cannot stall: the value is still derived from THIS
run's start, so the cursor advances by a whole tick every tick — the property
the comment above `SKIP_LOOKBACK_MS` says blocking on skips did not have.

Three hours, not thirty minutes: the pass is half-hourly, so anything shorter
leaves a call that started just before a pass read once and only once. Every
call is then read at least twice and the later read sees a finished
`CALL_DURATION`. The upsert corrects the row rather than skipping it — verified:
`CALL_COLUMNS` marks only `createdAt` `insertOnly`, so `durationSec`,
`connected`, `failedCode` and `recordUrl` are all overwritten on conflict.
Cost at the current half-hourly cadence: three hours of calls ≈ 560 rows ≈ 12
requests per pass, against a portal that refused us for overload on 2026-09-14.

**No backfill.** The client chose to start at 2026-09-13 rather than re-read
2026-08-28 → 2026-09-12 from the portal (~19 days, ~7 000 metered requests,
roughly an hour). The sixteen days stay wrong in the table and unreachable from
the screen. Re-reading them later needs no code: a full CALLS pass with
`BITRIX24_CALL_MONTHS` covering the window re-upserts and corrects it, and then
`CALL_DATA_FLOOR` is one edit.

---

## 5. The screen — `src/features/customers/CustomersPage.tsx`

Section `customers`, route `/customers`, label «Mijozlar va qoʻngʻiroqlar»,
nav group «Tahlil». `COMPANY_WIDE`, `analytics:read:all` — the same standing as
`cohort`, and for `payroll`'s reason: one operator's talk time is a performance
figure about a named person, and opening it to a ROP scope is a separate
decision taken in one commit (route permission, scope through the service,
scope in the memo key).

`PageShell` with `period` on. Two bands, each stating its own clock in its own
`SectionHeader` hint — the discipline `CLAUDE.md` demands of any screen
carrying two windows, and the reason «Savdo dinamikasi» was refused as a home.

### 5.1 Band A — «Qoʻngʻiroqlar», on the dashboard window

Hint: «Qoʻngʻiroq sanasi boʻyicha · tanlangan davr · suhbat davomiyligi
13.09.2026 dan ishonchli» (the last clause only when `floorApplied`).

1. **Five tiles** — Qoʻngʻiroqlar soni · Ulangan (`connectPercent`) · Suhbat
   vaqti (hours) · **Oʻrtacha suhbat** · **Median suhbat**. The last two sit
   side by side deliberately: §2.1 is only legible when both are on screen.
2. **ChartCard «Kunlik suhbat vaqti»** — one line, connected talk-hours per
   day, on `DailyOutcomeChart`'s pattern. One Y axis; a second is forbidden in
   this codebase.
3. **ChartCard «Suhbat davomiyligi boʻyicha»** — the six `CALL_DURATION_BANDS`
   as a `CategoryBarList` in its two-panel arrangement: call share above, talk
   hours below, **same row order, lower panel never re-sorted**. That is what
   makes "8.4% of calls, 52% of the time" land in one glance.
4. **ChartCard «Operatorlar»** — a table ranked by talk time: operator, calls,
   connect %, talk hours, **mean**, **median**, p90. Every row, 164 of them,
   the way `/sellers` renders every seller: a truncated performance table
   invites the question "where am I", and no truncation rule exists in this
   codebase to copy.
5. **ChartCard «Komandalar»** — the same columns by team. Its rows sum to the
   tile row, which is the block's own arithmetic check (§2.2).
6. **ChartCard «Bitta mijozga qancha qoʻngʻiroq»** — the four customer bands,
   with `unlinkedCalls` disclosed beneath.

### 5.2 Band B — «Mijozlar oqimi», on its own ninety days

Hint: «Buyurtma berilgan sana boʻyicha · <resolved dates from meta.period>».
Unchanged from `2026-09-15-mijozlar-oqimi-design.md` §6 except its address, and
it is mounted here rather than on `CohortPage`.

1. **Four tiles** — Yangi mijozlar (приток) · Qaytgan mijozlar · Faol mijozlar
   (мижоз сони) · Takroriy tushum ulushi.
2. **ChartCard «Yangi va qaytgan mijozlar»** — `CustomerFlowChart`, two series,
   one Y axis, both people.
3. **ChartCard «Mijoz qayerdan kelayapti»** — `CategoryBarList`, magnitude
   above (new customers per source), rate below (that source's 90-day repeat
   %), same row order.
4. **ChartCard «Mijozlar holati — bugun»** — hand-drawn rows, not a chart:
   Faol · Xavf ostida · **Yoʻqotilgan (отток)**, then **Bazada · Bazada yoʻq**
   (§5.3). Hint says «bugungi holat», because neither figure takes a window.

The two unused imports left in `CohortPage.tsx` on branch `mijozlar-oqimi` are
removed in the same commit that mounts the band here. `CohortPage` keeps its
matrix, its «База» ladder and its concentration band and gains nothing.

### 5.3 «база / база emas» — the one new customer figure

One CTE added to `InsightsRepository.customerStates()`, which already walks
every buyer:

```sql
based AS (SELECT DISTINCT d."customerId" AS cid
            FROM "deal" d JOIN "pipeline" p ON p."id" = d."pipelineId"
           WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL)
```

`inBase` = buyers in `based`, `notInBase` = buyers not in it. **They sum to
`states.customers`**, which is the check; and they are counted over *buyers*
(`countsAsRevenue`), not over the 352 550-row `customer` table, so the figure
answers "how many of our customers are being worked in База" rather than "how
big is the lead pool".

This split is **not** the four-group «База» ladder on `CohortPage`. That one
partitions open retention deals by stage and its bars deliberately do not sum
(`retentionStages` says so in place). This is a two-way split of buyers. Both
can be right; neither is the other's total.

### 5.4 Where the words live

`src/lib/messages.ts` gains `nav.customers` and `modules.customers`
(`title` + `lead`). The `lead` is not decoration here for the reason that
object's own comment gives: a reader arriving at a screen called «Mijozlar va
qoʻngʻiroqlar» will read the call figures as being about orders, and §2 says
they cannot be. The lead states that a call is joined to a **customer**, never
to an order.

`src/lib/sections.ts` gains the `customers` entry and adds it to
`COMPANY_WIDE`. `src/lib/roles.ts` adds `/customers` to `ALL_ROUTES`, which is
`ADMIN` and `MANAGER`, and **not** to `SALES` — the same standing `cohort`,
`margin` and `structure` already have, for that file's own stated reason: a
screen naming every operator's talk time is granted per account by an
administrator, not handed to the floor by default.

---

## 6. Tests and verification

* `tests/http/callActivitySql.test.ts` — pins the SQL shape: the window clamped
  to `CALL_DATA_FLOOR`, `connected` named explicitly on every duration measure,
  `percentile_disc` (not `_cont`), `count(DISTINCT "customerId")` on the
  customer measure, `employee."departmentId"` and **not** `department_member`,
  scope spread last.
* `tests/domain/callQuality.test.ts` — the six bands cover the whole number
  line with no gap and no overlap; the shape `logisticsBuckets.test.ts` uses.
* `tests/integrations/syncEngine.test.ts` — `nextWatermark('CALLS', t, 0)`
  returns `t − 3 h` although nothing was skipped, and every other entity with
  no settle lookback still returns `t` on a clean run.
* `tests/http/routeAccess.test.ts` — the new route in the table, `customers` in
  `COMPANY_WIDE`.
* `tests/features/customersPage.test.tsx` — both bands render their own hint,
  the median tile is present beside the mean, and the floor clause appears only
  when `floorApplied`.
* Invariants checked against production before this is called done:
  `sum(teams[].calls) = total.calls`; `sum(series[].calls) = total.calls`;
  `sum(operators[].calls) = total.calls`;
  `sum(durationBands[].calls) = total.connected`;
  `inBase + notInBase = states.customers`.

---

## 7. Out of scope

* **Backfilling 2026-08-28 → 2026-09-12.** Declined by the client; §4.3 says
  what it would take.
* **Call recordings and scoring.** `recordUrl` is empty on every row (§2), so
  there is nothing to play and nothing to score. Fixing the import is a
  separate question about which portal field actually carries the URL.
* **Response speed** — first-call latency, attempts-to-connect, revenue per
  talk-hour. All four need a call→deal join and `dealId` is empty (§2). The old
  `/insights/response` measured them and is documented in
  `docs/SUPERDASHBOARD.md` §6 for whoever gets that field populated.
* **A customer list.** Still deferred, as in the previous spec.
* **Splitting calls by direction.** §2 — the split reads backwards.

---

## 8. Known and deliberately unfixed

* **Sixteen days of telephony are wrong in the database** and unreachable from
  the screen. The floor hides them; it does not correct them.
* **`docs/SUPERDASHBOARD.md` §6 claims recordings are stored.** They are not.
  Corrected in that file as part of this work — the one documentation change
  here, since it is the sentence a reader of this table would trust first.
* **35 buyer identities are duplicates by phone (0.3%)**, so a returning
  customer registered as a second contact counts as new. Carried over from the
  previous spec, unchanged and uncorrected.
* **A per-operator median over a short window is thin.** At «Bugun» an operator
  with four connected calls gets a median of four numbers. The table prints the
  connected count in the row beside it, which is what lets a reader discount it;
  no minimum is imposed, because a floor that blanks a real figure is the
  mistake `WAIT_BAND_MIN_ORDERS` was allowed to make once.

---

## 10. Amendment, 2026-09-16 — «база не база» is a CALL cut as well

Found during execution, on production data, before Task 6 was written.

### 10.1 What the request actually said

«база не база **мижозларга** call duration» — the dative «мижозларга» attaches
to «call duration»: *call duration to база and non-база customers*. This spec
read it as two separate asks. Shown both readings with measurements, the client
chose **both** («Ikkalasi ham»).

### 10.2 The customer split, as §5.3 specified it, measures delivery

Buyers (`countsAsRevenue`, any status — the same `cust` set `customerStates`
counts): **15 937**. In База: **11 751**. Not: **4 186**.

But of the **11 607** customers with a WON revenue order, **11 586 — 99.8% —
are in База**, and 21 are not. The portal places every delivered customer into
База automatically. So among real buyers the split is a constant, and «Bazada
yoʻq» is overwhelmingly *customers whose order was never delivered*. It ships
because the client chose it with that caveat in front of them, and the card
states it.

**It moves out of `customerStates()`.** That statement's test —
«no longer reads the retention funnel at all» — records a decision made the day
before, in commit `35aca08`: `retentionStages()` owns the reading of the funnel,
and two statements answering overlapping questions is how they start
disagreeing. The split becomes its own method, `customerBaseSplit()`, so
neither existing statement nor its test changes.

### 10.3 The call split is informative

Calls above the floor, by whether the called customer **had a База deal created
before the call started**:

| | Calls | Connected | Talk hours | Mean | **Median** | Customers |
|---|---|---|---|---|---|---|
| База | 3 998 | 27.9% | 45.0 | 145 s | **82 s** | 2 872 |
| Not База | 15 512 | 26.2% | 179.1 | 159 s | **43 s** | 9 086 |
| No customer | 1 097 | 31.3% | 32.2 | 338 s | 96 s | — |

**A typical call to a База customer runs twice as long.** And the split is
nearly a team split: `Baza(ROP)` places 3 522 of the 3 998 База calls (88%), and
every other ROP team calls almost only non-База customers — `Charos(ROP)` is the
one mixed team (224 against 87).

**"Before the call", not "in База today".** Membership today moves 376 calls
(~9% of the База side) across: a lead called on Monday who buys on Friday enters
База afterwards, and "today" would retroactively call Monday's call a База
call. The honest question is what the customer was *when they were rung*.

### 10.4 What changes

* **`callActivity`** gains a per-row `side` — `BAZA` / `NOT_BAZA` / `UNLINKED` —
  from a `first_baza` CTE (the earliest RETENTION deal per customer, bounded to
  the customers called in the window), and two more grouping sets: `(side)` and
  `(day, side)`. `CallActivityRows` gains `sides` and `seriesBySide`.
  Reading the RETENTION pipeline here does not breach `35aca08`'s rule: that
  rule protects the *stage partition* of База; this reads one timestamp per
  customer, and no other statement answers "when did this customer enter База".
* **`customerBaseSplit()`** — new repository method, its own SQL test, its own
  cache in the service; `CustomerFlowDto['states']` gains `inBase` / `notInBase`.
* **The call block** — a two-row «Baza / Baza emas» table directly under the
  tiles (the same columns as the operator table), the unlinked calls disclosed
  beside it.
* **`CallTalkChart`** — stacked areas by side, in hours, on one axis. The stack
  top equals the «Suhbat vaqti» tile, so the chart needs no reconciliation line.
* **«Mijozlar holati — bugun»** — «Bazada» / «Bazada yoʻq» rows, with a hint that
  every delivered customer enters База automatically.

---

## 11. Correction, 2026-09-16 — the floor is 2026-09-15, and §2's numbers move

Found by running the repository method against production with the correct
timezone conversion.

### 11.1 Where the truncation actually ends

The probes behind §2 and §4 bucketed days with the one-step
`AT TIME ZONE 'Asia/Tashkent'`, which reads the naive UTC `startedAt` as
Tashkent local — CLAUDE.md's third rule. Their day labels were shifted, and the
floor this spec chose (2026-09-13) sat inside the damage.

Per Tashkent hour, two-step conversion:

| Tashkent hour | Calls | Max duration | Import lag |
|---|---|---|---|
| 2026-09-13, every hour | 1 307 in the day | 277 s | 1–2 min |
| 2026-09-14 09:00 | 467 | 187 s | 1 min |
| 2026-09-14 10:00 | 543 | 126 s | 1 min |
| **2026-09-14 11:00** | 964 | **1 677 s** | **256 min** |
| 2026-09-14 12:00 | 691 | 2 717 s | 293 min |

The import lag jumping from one minute to 256 at 11:00 is CALLS leaving the
per-minute pass. **The floor is the next whole day, 2026-09-15 00:00 Tashkent**
(`2026-09-14T19:00:00Z`), so no bucket on the daily chart is half truncated.
The client's decision — show only data that can be trusted — is unchanged; its
date was wrong.

### 11.2 Corrected figures, above the real floor

Measured 2026-09-16 over 2026-09-15 00:00 → now: **one whole working day and part
of the next**, 11 230 calls, 3 261 connected. A small sample; the shape matched
the wider, partly truncated one to within a few points.

| | §2 said | Correct |
|---|---|---|
| Mean / median connected call | 167 s / 50 s | **169 s / 53 s** — 3.2× |
| Calls past ten minutes | 8.4% holding 52% of talk time | **8.4% holding 50%** |
| p90 | 514 s | 513 s |
| База / not-База median | 82 s / 43 s | **86 s / 46 s** |
| Customer bands 1 / 2-3 / 4-5 / 6+ | 8 323 / 2 773 / 520 / 301 | 5 476 / 1 495 / 246 / 138 (a shorter window) |
| Calls with no customer | 1 097 (5.3%) | 135 (1.2%) — most unlinked calls sat inside the truncated window |

Facts about the whole table are unaffected: `dealId` on 1 row of 366 300,
`recordUrl` on none, direction as the leg, the team basis.

All seven repository invariants hold on production above the corrected floor:
operators, teams, days and sides each sum to the total; the side series sums to
total talk time; the duration bands sum to the connected count; no day repeats.

---

## 12. At merge onto main, 2026-09-16 evening

Main had moved twice under this work. `REFERENCE_EVERY` went 30 → 180, so the
reference pass — and CALLS with it — runs every three hours, not every half
hour; and at 15:32 (`35a5354`) CALLS was taken off the schedule altogether
because nothing read `call_record`. This screen reads it, so CALLS is back in
`REFERENCE`, as that commit's own comment prescribes. Consequences:

* The call block lags the portal by up to three hours, and says so in its hint.
* `SETTLE_LOOKBACK_MS` stays at three hours. §4.3's reason (half-hourly pass)
  no longer applies; the real condition is lookback ≥ longest call (3 600 s
  measured), which does not depend on the schedule.
* Cost is ~60–120 invocations a pass against main's 15 000-an-hour budget, not
  §4.3's "twelve requests".
