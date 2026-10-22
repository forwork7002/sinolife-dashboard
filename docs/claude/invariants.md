<!-- Moved verbatim from CLAUDE.md on 2026-10-20 to keep every session's context small. CLAUDE.md points here; read this file before working on what it covers. -->

## Invariants that break things quietly

**`countsAsRevenue` — name it in every query that touches money.** The portal
records the same order twice: `#10 База` mirrors `#6 Доставка` (97% of order
codes and amounts, created a median of ten days later). Pipeline roles are
decided in one place, `PIPELINE_ROLE_BY_ID` in `mapping.ts`, and denormalised
onto the deal at import. Bypass it and revenue is ~5 bn UZS (~30%) too high and
**nothing looks broken**. `scripts/import.ts` prints the excluded total on every
run; if it is ever zero, the guard has stopped working.

**Money is BigInt minor units, end to end.** `src/server/domain/money/money.ts`.
`toMajorNumber` is lossy and one-way and throws past `MAX_SAFE_INTEGER`.
`MoneyDto` carries `amountMinor` as a string plus a lossy `amount` for charts.
BigInt crosses the wire as a decimal string (`envelope.ts` `jsonReplacer`).

**Every window comes from `period.ts`.** Half-open `[start, end)`.
`this_week` / `this_month` / `this_year` mean **to-date**, so a mid-month view
compares 1–23 Aug against 1–23 Jul rather than showing a fake collapse.
All arithmetic in `env.APP_TIMEZONE`.

**Cache and comparison keys must include the PRESET.** On a Monday, `today` and
`this_week` resolve to the identical window but demand different comparisons.
Every memo key names the preset (`ttlCache.ts` tells the 78-vs-103 story of
the command centre's key that once left it out).

**A deal has four date bases and they may not be substituted.** `*AtSource`
columns are the CRM's timestamps and are what analytics uses; `createdAt` /
`updatedAt` are *our* row lifecycle — using them would move every deal into the
current period on a re-sync. Durations come from `deal_stage_history`, never
from close-minus-create.

**Delivered revenue is not a seller's close.** In one month 2 798 deals
entered the sellers' won stage and 3 729 Доставка-won, only 1 152 shared. The
seller-close metric that measured the first was never wired to a screen and
was deleted as dead code on 2026-09-30; money figures here are delivered.

**A rate with no denominator is `null`, not `0`.** `rateBp` returns null over an
empty denominator and deliberately does not round — `pct` rounds again for
display, and double-rounding moved one region across the 85% tone threshold.
`null` (no data) and `0` (a measurement) stay distinct to the UI.

**A person belongs to ONE unit for money and to SEVERAL for the org chart, and
the two must never be swapped.** Bitrix24's `UF_DEPARTMENT` is an ARRAY, and the
portal's own `hr/structure` screen counts a person once in EVERY unit it names —
nine of this portal's 208 active people sit in two. The importer kept only `[0]`,
so five of the twenty cards were short by one or two: Тошкент онлайн 0 against 1,
Asliddin(ROP) 8 against 10, Azizbek(ROP) 14 against 16, Saidaziz(ROP) 14 against
15, Sevinchxon(ROP) 8 against 10 (measured 2026-09-05). `department_member` now
carries the full set and **nothing but the org chart reads it** — save «Безквал»'s one «… rop» registrar rule (`bezkvalOwnerRopSql`, naming the team of the person in «ROP KVAL LID» / «РОП (Первичка)» since 2026-10-22), a count of clients, never money.
`employee."departmentId"` is untouched and stays the PRIMARY unit: every analytic
credits a person to exactly one unit, and rolling a two-unit person up both
branches would count their headcount and their money twice.
`tests/http/structureSql.test.ts` pins which CTE reads which — the `members` CTE
the join table, the `people` CTE the column — because swapping them produces a
plausible number rather than an error.

Three subsidiary rules of that screen, all invisible when they break:

- **The head is not one of their own subordinates.** «Подчинённые: 13» sits over
  a unit of fourteen. Dropping the subtraction adds one to every card at once —
  and the subtraction and the total are computed in ONE pass under ONE
  `isActive` filter, because a head the portal has deactivated is not in the
  total and taking one off anyway printed five active people as four.
- **A head the portal does not list IN the unit gets no head row.** «Навоий»
  names `UF_HEAD` = Мурод Содиков, whose own two units are «Kompaniya(ROP)» and
  «Тошкент онлайн»; the portal draws that card with no head row rather than
  seating him where his record does not. `head` is null for exactly that case,
  and `headName` is still on the DTO beside it.
- **The subtree pill counts PEOPLE, not memberships.** Somebody in both
  «Регистрация» and «Azizbek(ROP)» is one person under NEWGEN, so the count is
  `DISTINCT`; summing the row below would double them.

**Scope narrows, never widens.** `intersectEmployeeScope` takes two LISTS now
(the authorisation side is a team, not a person) and is an intersection,
never a union. An empty scope may not be an empty array — every repository
tests `ids?.length`, so `[]` reads as "no filter" and silently widens to the
whole company. Hence the sentinels `NO_EMPLOYEE_IN_SCOPE` and
`__no_employee_linked__`.

**Branch (`filial`) scoping was removed on 2026-09-30.** It had been fully built
and had zero callers since 2026-09-11; the resolver, `?filial=`,
`DASHBOARD_DEFAULT_BRANCH` and `branch:verify` went as dead code. What remains
of `domain/employees/branches.ts` is the employee-scope contract
(`ScopedWindow`, `NO_EMPLOYEE_IN_SCOPE`). No screen is branch-scoped.

**Confirmation queue: cohorted by arrival in `C4:NEW`, not by Дата создания.**
Five stages speak (`CONFIRMATION_SIGNAL_STAGES` in `mapping.ts`), every other
stage leaves the status alone. An order joins the board the moment it reaches
Тасдиклаш — the move out of «Регистрация» / «Сделка успешна» — and a deal with
no arrival (~52 that appear straight in `C6:NEW`) is not on the board at all.
`tests/http/confirmationQueueSql.test.ts` pins the cohort, the `numbered`
partition key, the never-queued exclusion and the left-only history bound.

**«🔁 ҚАЙТА ТУШДИ» counts GAPS, not entries, and the gap is six hours.** The
bot marks a return by remembering each deal's previous stage; we read the same
fact from the stage history, where every entry into `C4:NEW` is a row. But an
order can enter twice in fifteen minutes because one person confirmed it, saw a
mistake and pulled it back — deal 319494 on 2026-09-03 did exactly that, wore
the mark here and correctly did not in Telegram. `REPEAT_GAP_HOURS` is the
bot's own threshold, so the two surfaces cannot contradict each other in front
of the same operator. The lookup is unbounded by the window (a return in
September against a July arrival is still a return) and runs after the page's
LIMIT, so it costs 25 index lookups rather than a second pass over the cohort.

**THE TASDIQLASH BOARD FILES AN ORDER UNDER EVERY DAY IT ARRIVED ON — 2026-10-09.**
The client, over deal 1081546 (queued and refused on 07.10, re-queued and
confirmed on 08.10, and gone from the 07.10 report): «kun oxirida qanday
holatda boʻlsa oʻsha kunda shu holatida qoladi», the new day's arrival is a
row of its own under the usual rules. `queueSql` takes a third argument,
`unit`: `'day'` groups the moves by the Tashkent day of the arrival they
follow, closes an earlier visit at the next arrival (exit scan bounded, the
deal's present stage and «Тастиклаш анализ» read onto the latest visit only),
and is passed by the four board readings ALONE — `confirmationOrders`,
`confirmationBoard`, `confirmationByRop`, `confirmationRegions`, window mode.
Two arrivals on one day are still one row. An order that arrives at 23:50 and
is decided next morning WITHOUT a new arrival stays on its arrival day with
that decision. `queueHistorySql(upTo)` cuts the chain at the row's own visit.
**AND EACH DAY KEEPS ITS OWN SUM** (the client, same day: «qancha summa
bilan ishlamay qolgan boʻlsa shuncha summa bilan turadi»). The portal keeps
only the deal's present amount, so the STAGE_HISTORY handler stamps
`deal_stage_history."amountMinor"` on each transition it CREATES
(`historyAmountStampSql`, `IS NULL` — written once, never again; skipped when
the move is older than `HISTORY_AMOUNT_MAX_AGE_MS`, so a backfill cannot write
today's sum on an old move). A visit closed by a later arrival reads the newest
stamp inside it; no stamp (everything before the 2026-10-09 deploy) or the
order's latest visit reads `deal."amountMinor"`. The board's tiles, сумма
filter, sort and row all read the cohort's `c.amount_minor`.
**Everything else — FAKT 1 / FAKT 2, Savdo dinamikasi, Reyting, RNP,
Logistika, Sverka, Maosh, the backlog and the bell — keeps `'order'`**, the
rule below: one row per order at its last arrival, so an order confirmed,
pulled back and confirmed again is sold once. So the board's «Жами» and
refusals for a past day can exceed those screens' by the orders that came
back later; that is the stated difference, not drift. Extending `'day'` to a
money reading needs the client's word on the double-confirmed order first.
Pinned by «the board per arrival day» in `confirmationQueueSql.test.ts`.

**The LAST arrival dates the row, so the row has to carry the earlier ones.**
One order is one row — their bot and their board keep one entry per deal, and
counting visits would let «тасдиқланиш %» exceed the orders it divides — but
that means an order confirmed on the 29th and pulled back into Тасдиклаш on the
31st leaves the 29th. Deal 834920 did exactly that, and six of the 127 orders
that arrived on 2026-08-29 did; the operator reading the 29th found an order
their Telegram channel had announced that morning simply gone. `QUEUE_HISTORY_SQL`
(the same LATERAL that draws 🔁) therefore returns every visit as JSON, newest
first, and the СТАТУС column draws them as a chain: only the last state is
lit as a chip, an arrow points up from each earlier one, and every step
carries its own date — the chip's included, because САНА is two columns away
and routinely scrolled off, which left the lit state looking like the older.
**It is shown and never summed** — the tiles, the Статистика panel, the state
filter and the header bell all read the single `classified.outcome`, and
`queueHistory[0]` IS that outcome, which is why the UNCONFIRMED_SHIPPED
refinement is confined to the last visit. Production holds at most three
visits per order. Pinned by `tests/features/confirmationHistory.test.tsx`.

**The header bell counts the BACKLOG, so its link must carry `queue=backlog`.**
One SQL definition answers two questions: `window` — what arrived in the
selected period, and where each of those stands — and `backlog` — what is
waiting right now, whenever it arrived. `alertsService` asks for
`queuePressure(allTime, 120, 'backlog')`, so a link without that mode opens a
board counting a different population: the badge read 44 over a page reading 1,
both correct, nothing on screen saying they answered different questions. The
mode rides the URL through `useDashboardFilters` (`reset()` keeps it — it is a
question, not a filter), and `tests/features/confirmationBacklog.test.tsx` pins
the pair together.

**AND THE BACKLOG'S «LIVE ORDERS ONLY» FILTER LIVES IN THE COHORT, NOT IN THE
HISTORY SCAN.** It rode `moves` as `JOIN "deal" d0 … d0."status" = 'OPEN'`
until 2026-09-14, on the reasoning that open deals are a small fraction of the
table — they are **303 286 of 462 968**, so the join removed a third of the
rows and paid one random `deal_pkey` probe per confirmation move ever recorded
(70 876, against a 257 MB heap on a 1 GB database) to do it: **6.1 s of the
bell's 7.8 s**, once a minute per open tab, which is what had `/meta/alerts`
answering in 13 s or returning `INTERNAL_ERROR` on the afternoon the portal was
refusing us. `status` is a fact about the DEAL, so the predicate selects the
same deal_ids on either side of the per-deal aggregate; in `dated` it probes
the 165 orders whose latest signal is CONFIRM_NEW instead. **8.3 s → 1.7 s,
same 74 rows, row for row, board included** (measured back to back on
production). `confirmationQueueSql.test.ts` pins which CTE holds it.

**THE BOARD IS THE PAGE — `PageShell`'s `fill`, the second screen to take it —
and `640` TURNED FROM A CEILING INTO A FLOOR.** The client asked for the
«Барча буюртмалар» section to occupy more of the screen. The table was capped
at a literal `maxHeight={640}`, a number that can only be wrong twice: too tall
for a laptop, and permanently too short for the 27-inch screen a floor manager
reads it on, where the browser had 800 spare pixels the board refused to use.
The page body is now one flex column — banner, state tiles, Статистика panel
all `shrink-0`, the results Card `flex-1` — and the table's bound is
`maxHeight="100%"`, the height the card was given, which is whatever the screen
had left. Same mechanism as the org chart's canvas: `Shell` is exactly `100dvh`
and `main` is `min-h-0 flex-1`, so a percentage resolves without anything
measuring the header.

**The floor is `min-h-[746px]` on the Card and the number is load-bearing** —
640 of table plus the card's own 106px of chrome. It only ever bites when the
column does not fit, and a column that does not fit makes `main` scroll, so on
exactly the screens where it applies the page is scrolling anyway: there is no
reason to show a SHORTER table than before on a page that scrolls just as much
as before. A comfortable-looking 540 was tried and measured as a loss — 6 rows
where the old cap gave 9 on a 1280×800 laptop, and on a phone a letterbox
inside a page that still scrolled. The break-even is a window about 1054px
tall; above it the floor is slack and nothing scrolls. Measured: 2560×1440 →
13 rows against 8, maximised 1920×1080 → 8 against 7 (that row is the caption
the page no longer prints), 1280×800 → exactly what it was.

Two more things a later edit would undo. `fill` hands a page ONE plain block
with no `display: flex` and no gap, so the column is built in
`ConfirmationPage`, not in `PageShell` — changing the wrapper would move the
org chart for a reason that has nothing to do with it. And the Статистика panel
had to be bounded (`maxHeight={300}`, `shrink-0`) in the same change: fifteen
(ROP) groups unbounded is ~390px of panel opening ABOVE the card that takes
what is left, and a demo database returns ONE, so neither the gate nor a local
screenshot can see it.

**Nothing is printed between the title and the controls, in any mode.**
`description={null}` AND `meta={undefined}`, which say one thing together.
`null` is not the same as omitting the prop: PageShell RESERVES that line by
default, because a page that will print `meta.period`'s dates has to claim the
height before the first response lands. This board never prints them, so an
omitted prop held twenty pixels plus its margin open forever above the densest
table in the application. The sentence that used to sit there — orders in
Тасдиклаш have states, the window is the C4:NEW arrival — is not lost: the
first is what the six state tiles directly under it say, the second is what the
preset row says, and both are stated at length here and in the queue SQL, which
is where somebody reconciling against the portal actually looks.
`t.modules.confirmation.lead` was deleted with its last call site.

**Its РОП / status / Статистика controls are `toolbar`, not `actions`.**
`actions` is the header slot beside the title, right-aligned — for a page-level
ACTION, which is what Foydalanuvchilar' «+ Yangi hisob» is. These three are
filters, and passed as `actions` they sat on the far right of the header while
the window and the search box sat on the left: one screen carrying two toolbars
a metre apart, with the reader crossing the page to narrow one table. `toolbar`
puts them in the filter row after the shell's own controls, and it opens that
row on its own (`period || anyFilter || toolbar`) — backlog mode has no window
and no filters and still needs its ROP filter and Статистика. «Filtrlarni
tozalash» is hoisted out of the filters fragment so it stays LAST, rather than
standing between the search box and the controls it also clears. Pinned by
`tests/features/pageShellToolbar.test.tsx`.

---

### The org chart

`/structure` re-creates `obey.bitrix24.kz/hr/structure/`: department cards on a
pannable, zoomable canvas joined by orthogonal elbow connectors, one row per
level, a floating control row at the top and a zoom stepper bottom-left, a
per-card expand/collapse footer, a «SIZ» badge on the reader's own unit, and a
roster panel docked over the canvas.

**IT IS THE WHOLE PAGE.** The screen carries a title, a Chizma/Roʻyxat toggle
and then the canvas, which takes every remaining pixel. There is no header
band, no KPI tile, no reporting window and no figure in soʻm — the client asked
for all four to go («shu joy kerak emas… shu boʻlimni kattaroq qil, sahifani
qoplasin»), and what they cost was the thing the page exists for: the chart used
to start below the fold on a 1080p window.

The height is `height: 100%` on `.org-canvas` under `PageShell`'s `fill` — the
first of the two pages that take it, the confirmation board being the other —
NOT a `calc(100dvh − N)`. `Shell` is exactly `100dvh` and `main` is `min-h-0 flex-1`,
which gives a flex item a definite main size, so a percentage resolves against
what is actually left — and no constant has to be re-measured when the header
changes. The hand-measured expression this replaced was already stale and also
mixed `100vh` against a shell sized in `100dvh`.

- **Every write affordance the portal has is deliberately absent** — ДОБАВИТЬ,
  the «+» on the connectors, the drag handle, the «...» menu. All four write
  into Bitrix24, and the frontend never talks to a CRM; the entire mutation
  surface of this API is three `/users` handlers. What the card gains instead is
  the TEAM: where the money used to be there is now a stack of `InitialChip`s
  for the unit's first five active members and a «+N» for the rest, because
  «har bir sotuvchi bilishi kerak kim kimlar borligini» was previously answered
  one unit at a time by opening a panel. The names already ride the payload for
  the search box, so a face on every card at once costs no request.
- **The second level down starts FOLDED, and the chart fits ONCE.** Fully open,
  this portal's tree is 4 332 canvas units wide, which fitted into a 1 500px
  card is 35% zoom and a screen of unreadable rectangles. Re-fitting on every
  shape change was worse: the answer to "show me this branch" was the whole
  company zoomed out and the branch smaller than before the click. Expanding
  holds the clicked card still (a `useLayoutEffect` anchor measured at 0.0px
  drift); «Sigʻdirish» is the way back, and it stops at a legibility floor of
  0.5 rather than shrinking the names away.
- **Pan writes the transform straight onto the stage node.** The viewport is a
  ref, never state; only the zoom READOUT re-renders, and it moves in steps.
- **The cards ARE the treeitems.** `role="tree"` owns its `treeitem`s, so the
  layout's coordinates go on the treeitem itself rather than on a positioning
  wrapper, and the treeitem is the focusable element rather than a button
  inside it — a nested button is announced as a button and throws away the
  level, the position among siblings and the expanded state. One roving tab
  stop for the whole chart, and it falls back to the first card whenever the
  focused one is folded away, or the chart has no tab stop at all.
- **The canvas key handler only fires on a card.** It lives on the canvas, which
  also holds the search box: unscoped, SPACE in that box selected a department
  instead of typing, and Home/End/arrows moved the tree rather than the cursor.
- **Avatars are initials, not photos.** `user.get` returns `PERSONAL_PHOTO` on
  `cdn-ru.bitrix24.kz` and the CSP is `img-src 'self' data: blob:`, so every one
  of them would be a broken image. `InitialChip` is the whole answer.
- **THE CHAIN OF COMMAND IS DRAWN, NOT LEFT TO THE EYE.** Every card from the
  one under the pointer — or picked, or focused — up to the company root wears
  `data-chain`, and every connector along it lights. Before this exactly ONE
  connector ever lit (`edge.to === selectedId`), so a reader was told who their
  immediate parent was and left to trace the rest across nineteen identical grey
  lines. With nothing picked at all the chain falls back to the READER'S OWN
  unit, so the first frame answers the question before they touch anything.
  `data-chain` is in the `forced-colors` block for the same reason
  `data-selected` is: the one thing this screen exists to show is carried by
  colour, and that mode discards colour.
- **The opening frame is the reader's own chain, fitted.** An account linked to
  an employee opens unfolded to its own unit with the whole chain to the root in
  view — the fold comes from `openingCollapsed`, derived rather than written by
  an effect, and the viewport is sized to the chain's BOUNDING BOX (not just its
  height: the root sits over the middle of its children, so a chain hanging off
  the leftmost branch is as wide as it is tall, and a phone showed the reader's
  card with the connector running off to a root that was not on screen). It does
  not SELECT the unit — that would open the roster over a third of the chart and
  write `?dep=` into an address nobody chose. «Hammasini yopish» still returns
  the structural default, which is why that is a separate set.
- **The chain is also printed in words.** A second line of the floating control
  row reads «Siz  NEWGEN › Тошкент онлайн › Sevinch(ROP)  ·  Rahbaringiz: …»,
  every crumb a button. It is the only affordance here that needs no
  interaction at all, and it survives panning, zooming, folding and a phone.
  «Rahbaringiz» walks UP until it finds a head, because «Тошкент онлайн» has no
  `UF_HEAD` and «Навоий»'s is not listed inside it — stopping at the reader's own
  unit would tell a third of the floor «Rahbar tayinlanmagan».
- **A plain wheel ZOOMS, and it could not before.** The handler used to return
  early unless ctrl/meta was held, because the canvas was a card inside a
  scrolling `main` and an unconditional `preventDefault` would have trapped the
  page. The canvas is the page now, so the gesture is free to take. Three riders
  make it safe: it bails over `.org-panel` (whose body scrolls), it scales by
  `deltaY` magnitude honouring `deltaMode` (a trackpad fires dozens of small
  deltas per flick and a fixed step would cross the whole range in one gesture),
  and Shift+wheel takes over the sideways pan the wheel no longer does.
  `touch-action` moved from `pan-y` to `none` for the same reason. The honest
  cost: a Mac trackpad's two-finger scroll now zooms rather than pans — nothing
  in a wheel event distinguishes the devices — and the pan is a drag on the
  background.
- **The search matches PEOPLE, not just units.** Every active member's name
  rides the tree's own payload (`memberNames`, ~290 strings), because the first
  thing a seller types into this screen is their own name — matching only the
  unit and its head answered «topilmadi» over a dimmed company while their row
  sat two clicks away in the panel. A match force-opens its ancestors and is
  centred once.
- **A `?dep=` link force-opens its own way in**, by the same derivation, so
  "this is the team, look" pasted into a chat opens on the card rather than on a
  panel floating over a folded tree.
- **The search answers with NAMES, not a count.** It used to print «3 ta» and
  centre one card silently, so if three units held a Malika the second and third
  were unreachable and nothing ever said which person had matched. Up to twelve
  rows now read «Ismoilov Aziz — Sevinch(ROP)»; picking one selects that unit,
  flies to its card and marks that person's row in the roster. The mark travels
  as a NAME rather than an id, because `memberNames` and `DepartmentMemberDto.
  fullName` are the same `employee."fullName"` column — carrying ids would mean
  turning `array_agg` into a `jsonb_agg` of objects and rippling that through
  the node type, the `src/lib/api.ts` mirror and both test fixtures to mark one
  row.
- **`/insights/structure/roster` is a SECOND request on purpose.** The chart
  draws twenty cards and a reader opens one panel; putting 289 people on every
  node would ship the whole roster again on every change of selection. Its
  header carries the unit's ancestors as clickable crumbs and the person it
  answers to; its rows carry membership, so somebody shown in their SECOND unit
  is tagged «Ikkinchi boʻlim» — without it a borrowed operator reads as a member
  of that team, which is the one thing this screen must not get wrong.
- **The endpoint touches no `deal` table and takes no parameters.** `structureSql`
  used to carry an `active` CTE (feeding the period-scoped `workingHeadcount`)
  and a `sales` CTE (the card's revenue); together they were the only readers of
  `deal`, the only users of `$1`/`$2`, and **3.4 of the query's 3.5 seconds** —
  on the single vCPU that answers every other screen, for the page every seller
  is meant to open. What is left reads `department`, `department_member` and
  `employee`. `tests/http/structureSql.test.ts` fails on a `$1`, on a `"deal"`,
  on a fourth table, and on `WITH RECURSIVE` going missing — which is the exact
  edit deleting the first CTE invites, and which fails with a
  relation-does-not-exist error naming `walk` rather than the missing keyword.

