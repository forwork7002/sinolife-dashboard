# Kogorta — the screen a manager can read

Design, 2026-09-15 (third pass of the day). Client instruction, verbatim:
«bu kagorta rahbar uchun u tuhsunishi uchun mijozlar aynan qanday
kelayotganligini va kogorta jadvalini yaxshilash kerak bo'ladi … iloji bo'lsa
kogortani maksimal kerakli oddiyroq tushunadigan eng yaxshi narsa bo'ladi»,
after a first message asking for stronger data, better design, verified
correctness, and an explainer.

Asked and answered in the same conversation, and both answers narrow this
spec sharply:

* **The reader is the manager, not an analyst.** The question they want
  answered is «mijozlar **aynan qanday kelayotganligi**» — how customers are
  arriving — with retention as the follow-up, not the headline.
* **No separate explainer document.** Offered as an Artifact page, as an
  in-app panel, and as a repo document; the client chose **in-app only**:
  «Faqat ilova ichida — alohida sahifa kerak emas». Nobody reads a manual.
  The screen has to explain itself.

This spec **builds on** `2026-09-15-mijoz-qaytishi-one-vocabulary-design.md`
(P1) and does not replace it. P1 settles the stage vocabulary and the merge of
the two 2026-09-15 branches; everything below assumes that is done first.

## 1. What the previous spec did not consider

P1 is a correctness and vocabulary document. It makes the screen *consistent*.
It does not make it *readable by a manager*, and re-reading it against the
client's third instruction exposes three gaps:

1. **P1 keeps the matrix as the screen's primary object.** A 250-cell grid of
   percentages is an analyst's instrument. It is the right artefact and it is
   the wrong first impression.
2. **Neither P1 nor either branch answers the arrival question at all.** «Qancha
   yangi mijoz keladi?» — how many customers arrive each month — is the
   client's literal words, and it is nowhere on the screen. P1 routes it to
   the «Mijozlar oqimi» band, which on `main` is four of nine tasks done and
   has no UI.
3. **P1 leaves the money in the SQL.** `revenue` is measured per cell and
   thrown away by the renderer.

## 2. The measured fact this design turns on

**The arrival answer is already in the cohorts payload.**

A cohort's `size` *is* the count of customers who made their first purchase in
that month. Eighteen of them, one per row, already computed, already shipped
over the wire, already correct — and rendered today as a narrow numeric column
nobody reads as a series.

Drawn as a bar per month it is exactly «qancha yangi mijoz keladi», on the same
clock as everything else on the block, from the same statement as the cells.

The consequence is the whole reason this spec is cheap:

> **The manager's view needs no new endpoint, no new query, and no new scan.**
> It is a second rendering of the response `/insights/cohorts` already returns.

That matters twice. It satisfies priority 1 — two views built from one
statement cannot disagree — and it protects the one measurement this screen
cannot afford to repeat: `cohorts()` is the slowest endpoint in the product at
**1587 ms p50**, two heap walks over ~180 000 revenue rows, measured
2026-09-11. A second endpoint for the manager's view would have doubled the
most expensive read on the slowest screen to display numbers that were already
in the first response.

## 3. Two modes, one payload

`/analytics/cohort` opens in **«Oddiy»**. **«Batafsil»** is one press away and
holds everything the screen holds today.

The toggle is a view switch over cached data — no refetch, no loading state,
no second query key. Both modes read the same `useQuery(['cohorts'])` result.

**The mode is URL state**, so a manager can be sent a link to what they are
looking at. It is a **shallow** route update: `URL state costs a round trip`
is a settled finding on this project — a full navigation on every filter click
cost 521 ms of frozen UI. The mode writes with `history.replaceState`, not a
router push.

**«Batafsil» is not an admin mode.** No permission differs between them. A
manager who wants the grid presses one button; the default is a judgement
about what to show first, not about who may see what.

## 4. «Oddiy» — three questions, in the order a manager asks them

### 4.1 «Qancha yangi mijoz keladi?»

A bar per month: how many customers made their first delivered purchase in it.
`row.size`, oldest month on the left.

Beneath it, one plain sentence comparing the **last complete** month against
the mean of the **twelve complete months before it** — the shape a manager
reads without decoding an axis. Neither side of that comparison contains the
running month, and neither contains the month being compared.

**The newest bar is always short and it is always a lie.** A customer counts
into a month when their order is *delivered*, and the current month is
half-lived; orders placed in it are still in Тасдиклаш and in Доставка. The
running month is therefore drawn **hatched and labelled «oy tugamagan»**, and
it is excluded from the comparison sentence. This is the same failure the
record wall hit — a partial period rendered as a collapse — and the same
remedy.

### 4.2 «Ular qaytadimi?»

One sentence, whole history, the number that decides whether the retention
desk is worth funding:

> «Har 100 ta yangi mijozdan **78** tasi keyin yana xarid qiladi.»

`repeatCustomers / totalCustomers`, from the totals arm — the arm that reads
every cohort there has ever been, not the windowed rows. P1 §6 already fixed
this figure once, when it was being folded from windowed cells and silently
deleting the oldest loyal customers from its own denominator.

Then the **average cumulative curve** — of a typical cohort, what share has
come back by +1, +2, … months — with four milestones called out as figures:
**+1 oy, +3 oy, +6 oy, +12 oy**.

**The curve is the summary row and it must be built the way the summary row
is.** A column's average is the average *of the cohorts that have reached that
offset*, never of all eighteen. `Stop the cohort summary row painting a sample
of one` is a commit on the `kogorta` branch: the +12 column had one qualifying
cohort and printed its number as the company average. Each milestone therefore
prints **how many cohorts it averages**, and a milestone backed by fewer than
three is drawn as «yetarli maʼlumot yoʻq» rather than as a figure.

### 4.3 «Pul qayerdan keladi?»

Two figures, both whole-history:

* **Takroriy tushum ulushi** — `laterRevenue / (firstRevenue + laterRevenue)`.
  Already computed, already correct, today shown as a gauge among four tiles
  where its meaning is not stated. Here it gets the sentence it deserves:
  «Tushumning **65%** i — mijozning birinchi emas, keyingi xaridlaridan.»
* **Bir mijoz olib kelgan o'rtacha tushum** — `(firstRevenue + laterRevenue) /
  totalCustomers`, over the whole history, labelled **«hozirgacha»**.

The company-wide figure is honest as a single number. The **per-cohort** one
is not, and §6 is about that.

## 5. «Batafsil» — the matrix, ported and extended

The matrix arrives from the `kogorta` branch as P1 §7 describes it — the
cumulative default, the twelve-month window, flexing columns, one continuous
heat field, the crosshair, no per-cell «%». That port is not re-argued here.

Four additions, all requested:

| Addition | Source | Cost |
|---|---|---|
| **Kumulyativ / Oylik** toggle | already built on `kogorta`; `first_return` CTE, `min(months_since)` per customer | already paid |
| **Buyurtmalar soni** per cell | `count(*)` added to the existing `GROUP BY` | one more aggregate over a CTE already being scanned — no new pass |
| **Kogorta tushumi** and **1 mijozga o'rtacha**, two pinned columns | folded in TS from the `revenue[]` array already in the DTO | none — no SQL change |
| **Full arithmetic per cell** on hover | `panelFor` on `kogorta`, extended with orders and money | none |

**The order count is a count of deals, and the customer count is a count of
people, and the hover must never blur them.** `count(*)` over `purchases`
counts revenue-bearing WON deals; `count(DISTINCT customer_id)` counts people.
A cell reading «15 mijoz · 23 ta buyurtma» is the useful pair, and it is the
pair that makes an average order count derivable without a third aggregate.

**Cohort revenue is summed across every drawn offset, and that is the whole
cohort's revenue.** The windowed arm bounds `p.cohort`, not `p.months_since`,
so a cohort that appears in the matrix appears with all of its months. Summing
`revenue[]` along a row is therefore complete, not partial. This is stated
because the opposite assumption is the natural one and it would be wrong.

## 6. The honesty problem this spec must not create

**«1 mijozga o'rtacha» does not compare across rows, and a column of figures
is an invitation to compare across rows.**

The August 2025 cohort has had thirteen months to spend. The July 2026 cohort
has had one. Ranking them on money-to-date ranks them on age, and it will read
as «new customers are worse» — which is the exact misreading priority 3 exists
to prevent («malumotlarni **aynan to'g'ri** tushunish»).

Three defences, all of them cheap, none of them optional:

1. The column is headed **«1 mijozga · hozirgacha»**, with the word doing work.
2. Each cell's hover states the cohort's age: «13 oy yashagan».
3. A cohort younger than **three months** prints its figure **greyed**, with
   the hover saying it is too young to compare.

A fourth defence was considered and rejected: normalising to a fixed horizon —
revenue in each cohort's first 90 days, comparable by construction. It is the
statistically correct column and it is a worse one here, because it silently
discards the repeat revenue that is the entire subject of the screen. The
ranking problem is a labelling problem; solving it by deleting data is not a
trade this screen should make.

## 7. The screen explains itself — there is no document

The client declined a separate explainer. So every explanation is placed where
the number is, and this replaces the document rather than shrinking it.

* **Every block states its clock in words, in its own header.** «Yetkazilgan
  sana bo'yicha», «Bugungi holat», «Buyurtma berilgan sana bo'yicha». P1 §6
  establishes this; it matters more here, because the manager is the reader
  most likely to meet two honest customer totals (11 517 and 15 876) and
  conclude that one of them is broken.
* **Every cell's hover carries the arithmetic, not a restatement of the
  cell.** «24 mijozdan 15 tasi → 63%», the orders behind it, the money. The
  `kogorta` branch already writes these sentences; they gain the two new
  quantities.
* **One `InfoTip` per block**, answering «this block answers which question»,
  never «this block is a cohort analysis».
* **«Oddiy» mode is itself the explanation.** This is the substantive claim of
  the section: a manager who reads three sentences and three shapes has
  understood the matrix without being shown it. The grid is then evidence for
  a reader who wants it, which is what a grid is for.

**No copy anywhere writes down a count that the database produces.** Stage
counts, customer totals and cohort sizes are read at render time. The portal
added a nineteenth Доставка stage on 2026-09-10 and P1 §4 records the same
rule; a number in copy is a number that goes stale silently.

## 8. Correctness

### 8.1 One defect found while writing this spec, and its fix

`InsightsService.cohorts()` builds

```ts
const options: { months: number } & EmployeeScopeFilter = {
  months,
  restrictToEmployeeIds: scope.restrictToEmployeeIds ?? null,
}
```

and hands it to `InsightsRepository.cohorts(options: { months: number })`,
**whose SQL contains no employee predicate of any kind.** Verified by reading
every line of the statement: there is no `assignee`, no `ownerId`, no
`restrictTo`. TypeScript does not catch it because the argument is a variable
rather than an object literal, so excess-property checking does not apply.

The scope is silently discarded. It does not leak data *today* — the route is
gated on `analytics:read:all` and calls `cohorts(ctx.currency, ctx.query.months)`
with no scope argument at all — but it is a filter that appears to be applied
and is not, on a screen whose entire value is that its numbers can be trusted.
The next caller that passes a scope gets a whole-company answer wearing a
branch label.

**The fix is to delete the parameter, not to implement it.** A cohort is a
company-wide fact about a customer. One customer's purchases are spread across
sellers and across months; narrowing a retention curve by employee would
produce a figure with no business meaning — «did the customers of this seller
come back» is a question about customers that seller no longer owns. The
`EmployeeScopeFilter` is removed from the signature and a comment records why
this endpoint is deliberately unscoped, so it is not re-added as an oversight.

### 8.2 Invariants verified against production before this is called done

Carried from P1 §9, plus this spec's own:

| Invariant | Why it would break |
|---|---|
| Open deals by group sum to the pipeline census | a stage silently bucketed twice, or dropped |
| The unmapped-stage list is empty | the portal added a stage |
| «Дубль заказы» renders at **zero**, not absent | a zero row disappearing is how a future non-zero row would hide |
| Each row's last **measured** cumulative cell = that row's «Qaytgan» share | the two are computed by different paths and must agree |
| Σ cohort sizes **over every cohort there has ever been** = «Jami mijozlar» | the windowed rows and the totals arm drifting apart — this exact bug was fixed once |
| Σ per-cohort revenue **over every cohort** = first + later revenue | the TS fold in §5 disagreeing with the SQL totals |
| Per cell: `orders ≥ customers` | the two aggregates transposed |
| «Oddiy» milestones = the matrix's own summary row at those offsets | the two renderings disagreeing, which is the one thing §3 exists to prevent |

**The two Σ rows are checked against the database, not against the rendered
grid, and the distinction is the point.** `months` bounds which cohorts are
drawn; the totals arm deliberately carries no such bound. So summing the
eighteen visible rows and expecting «Jami mijozlar» is not a failing invariant
— it is a **misreading of the screen**, and it is the misreading a manager is
most likely to attempt, because the two figures sit a few centimetres apart.
Both checks are therefore run as unbounded queries, and the screen states the
gap in words: the tiles count the whole history, the grid draws a window of
it.

The last row is the important one and it is checked in a **component test**,
not by eye: the manager's four milestone figures are read from the same array
the grid's summary row is read from, and a test asserts they are the same
numbers.

### 8.3 What is measured and deliberately not chased

The duplicate-identity gap — **39 cohort members of 11 517, 0.34%** (P1 §2.1,
audited four ways). It is recorded in the block's hover as a stated limit. A
full contact re-import to close it was offered and declined on 2026-09-15.

## 9. Tests

* `tests/domain/retentionStages.test.ts` — P1's partition test, unchanged.
* `tests/http/cohortsSql.test.ts` — extended: `count(*)` present alongside
  `count(DISTINCT …)`; no employee predicate and no scope parameter; the
  `first_return` CTE taking `min(months_since)`.
* `tests/components/cohortMatrix.test.tsx` — carried from `kogorta`, plus the
  two money columns, the young-cohort greying, and the orders figure.
* `tests/features/cohortSimpleMode.test.tsx` — **new.** The running month
  hatched and out of the comparison; a milestone with fewer than three
  cohorts refusing to print a figure; the milestones equal to the summary row;
  the mode surviving a URL round trip.

## 10. Out of scope

* **The «Mijozlar oqimi» band** (arrival by source, churn, the portal-versus-us
  comparison) — `main`'s own nine-task plan, tasks 5–9 unbuilt. §4.1 answers
  the arrival question from the cohort payload; it does not pre-empt that band,
  which answers it on a different clock and by source.
* **The customer list** («kim yangi, kim eski») — P1 §11 routes it to P2.
* **The covering index** `first_win` wants — P3, a migration and its own
  decision. This spec adds no scan, so it neither helps nor hurts it.
* **`/sellers` and `/confirmation`** — out of bounds by standing instruction.
  `insightsRepository.ts` holds the confirmation queue's SQL in the same file;
  changes here are confined to `cohorts()` and `retentionStages()`.
* **`isReturnCustomer`** — set on 98.3% of orders and therefore useless as a
  signal. Raised in P1, untouched here.

## 11. Mechanics

Branch `kogorta-rahbar`, worktree `/home/smack/Work/ISH-rahbar`, taken from
`main` at `7bfeaca`. P1 lands first, in the same branch, because §3 and §5
both assume its vocabulary.

Commits are local. Nothing is pushed to `main` until the client says «deploy
qil».

The gate runs in this worktree against the **commit**, not the working tree —
the rule a broken deploy established on 2026-09-11.
