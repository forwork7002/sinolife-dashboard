# Mijozlar oqimi — customer flow on «Mijoz qaytishi»

Design, 2026-09-15. Client request, verbatim: «mijozlar qanday kelayapti qanday
ketayapti, qayta olgan mijoz statistikasi, yangi mijozlar statistikasi, qanday
mijoz qayta olayapti, qaysi mijoz qayerdan kelayapti (koʻpi), qaysi mijoz yangi
eski — shuni aniqlashimiz kerak».

## 1. What the screen answers today, and what it does not

`/analytics/cohort` («Mijoz qaytishi») already carries: four whole-history
tiles, the 18-month cohort matrix, the «База — mijozlar hozir qayerda» ladder,
and the concentration band (top-10 share, 80% list, repeat interval, 90-day
repurchase, repeat-share card).

None of the six things asked for is on it:

| Asked | Present today |
|---|---|
| how customers arrive, period by period | no — every tile is whole-history |
| how customers leave (churn) | not measured anywhere in the product |
| new-customer statistics | no |
| repeat-customer statistics | partly — whole-history only, no breakdown |
| which source customers come from | not on this screen |
| which customer is new vs old | no customer list exists anywhere |

## 2. Measured facts this design rests on

Read directly from production on 2026-09-15 (`probe-cust1/2/3.ts`).

**Duplicate identities are not a threat to the new/repeat split.** The
`customer` table holds 352 550 rows, 12 044 phone numbers appear on more than
one of them, and 129 041 rows carry no phone at all. Among rows that actually
bought, the picture is different: 11 512 buyer identities, 11 475 distinct
phones, **35 duplicate groups covering 70 rows — 0.3%**. The duplicates live in
the lead pool, not among buyers. A repeat customer being miscounted as new is
therefore a 0.3% error, and it is recorded rather than corrected.

**Source attribution is nearly complete.** Of 11 598 revenue-pipeline orders
created in the last 180 days, 195 carry no source — 1.7%. Twenty-one sources
are in real use.

**Bitrix24's own `isReturnCustomer` flag is not usable.** 11 396 of those
11 598 orders are flagged — 98.3%. It is out of scope here; see §9.

**Inter-purchase interval, all customers, whole history:** 2 346 gaps,
median **37.5 days**, p75 73.9, p90 **141.1**, p95 212.5.

**Silence today**, by each buyer's last order: 15 867 buyers, 8 843 silent past
90 days, 7 412 past 120, 5 324 past 180. The 60/150 split this design ships is
in §5.4. (Counts taken minutes apart drift by one or two as `now()` moves; the
§5.4 table is the one measured against the shipped thresholds.)

**The portal's own verdict**, distinct customers on open База deals:
Недозвоны 2 268, Неактивные 1 866, Не активный клиент 80 — 4 214 called dead;
against Актив 811, Активный клиент 825, Новый база 1 282 and the 1/3/10/20/30
кун cadence.

**Repeat rate by acquisition source**, on the 90-day horizon this design
ships (§5.3) — customers whose first order is old enough to have had a chance
to return:

| Source | Matured customers | Returned |
|---|---|---|
| Ген лид | 4 176 | **12.4%** |
| Входящий | 1 794 | 16.9% |
| Веб-сайт | 859 | 15.6% |
| (manbasiz) | 713 | 15.0% |
| Сммщик sinolifeuz | 424 | 15.8% |
| sinolifeuz | 396 | 11.6% |
| Instagram | 339 | 9.1% |
| Telegram — Открытая линия | 179 | 16.2% |
| Телеграмм | 167 | 13.2% |
| sinolife_otziv | 88 | 11.4% |
| База клиент | 72 | 40.3% |
| CRM-форма | 50 | 16.0% |

**The largest source returns worst.** Ген лид supplies more first-time buyers
than every other source combined and sits at the bottom of the table beside
Instagram; Входящий is a third its size and returns half again as often. That
contrast is the finding the source block exists to make visible.

**The horizon is not cosmetic.** Measured without it, over first orders in the
last 365 days, the same sources read 8.0 / 10.2 / 14.0 / 9.0 / 15.2 / 19.6 —
every one understated, and «База клиент» understated by 20 points, because a
customer acquired last month is counted as having failed to return. §5.3 is
what makes the column honest.

## 3. The clock, and the one contradiction it creates

The client chose the **order date** — «buyurtma bergan sana (kelgan kun)» —
over the delivered date. So everything in this band is cohorted by
`deal.createdAtSource`, over deals with `countsAsRevenue` and a non-null
`customerId`.

The cohort matrix on the same screen is cohorted by `closedAt` on WON deals
(CLAUDE.md, screen table). The two therefore print different customer totals —
**15 867 by order, 11 512 by delivery** — and neither is wrong.

**Both blocks state their clock in their own heading.** The new section header
reads «Buyurtma berilgan sana boʻyicha»; «Kogorta tahlili» gains «yetkazilgan
sana boʻyicha» in its existing hint. Unlabelled, the two totals read as one of
them being broken. Rebuilding the matrix on the order clock was offered and
declined — it changes a settled block.

## 4. Definitions — the contract every figure obeys

* **Order** — a `deal` with `countsAsRevenue = true` and `customerId IS NOT
  NULL`. Status is **not** filtered: an order placed is an order placed, and
  the question is how customers arrive.
* **Customer** — a `customer` row with at least one Order. Not the 352 550
  contacts; those are mostly leads.
* **First order** — the customer's earliest Order by `createdAtSource`, over
  the **whole history**, never the window's earliest.
* **New in the window** — first order falls inside it.
* **Returning in the window** — has an Order inside it and the first order
  falls before it.
* **Active in the window** — new plus returning, counted once each.
* **Revenue** is the one place status is filtered: money counts only on
  `status = 'WON'`. A refused order is an arrival, not a soʻm.

Every count is `count(DISTINCT customerId)`. A customer with two orders in a
month is one customer.

## 5. Data

### 5.1 `GET /api/v1/insights/customers`

Access `{ permission: 'analytics:read:all', section: 'cohort' }` — the same
pair `/insights/cohorts` carries, and `cohort` is in `COMPANY_WIDE`.

Query: the standard period (`preset` / `from` / `to` / `today`), as the other
insights routes take it. Scope spread **last** — `{ ...ctx.query, ...ctx.scope }`.

### 5.2 `InsightsRepository.customerFlow(options)` — one statement, three arms

`UNION ALL` over CTEs built once, in the shape `cohorts` already uses, so no
two blocks on the band can disagree:

```
orders    -- customerId, createdAtSource in Asia/Tashkent, amountMinor, status, sourceId
firsts    -- customerId -> min(createdAtSource), and that order's sourceId
```

* **`summary` arm** — inside the window: `newCustomers`, `returningCustomers`,
  `activeCustomers`, `newCustomersWon` (of the window's new customers, how many
  have at least one WON order — the tile's honesty line, since 26% of orders
  never land), `newRevenueMinor`, `repeatRevenueMinor`.
* **`series` arm** — one row per bucket: `newCustomers`, `returningCustomers`.
  Bucket is **daily when the window is 62 days or shorter, monthly otherwise**;
  the resolved grain is returned in the DTO so the screen labels the axis from
  the data rather than re-deriving it.
* **`sources` arm** — one row per source **for customers whose first order
  falls in the window**, keyed on the first order's source. Rows sum exactly to
  `summary.newCustomers`; a null source is its own row, `(manbasiz)`, always
  emitted when non-zero. Carries `newCustomers` only — the rate column comes
  from §5.3.

### 5.3 `InsightsRepository.sourceRepeatRates()` — a property of the source, not of the window

Of customers whose **first order is at least 90 days old**, the share with a
second Order. Whole history, no period. The 90-day horizon is the rule the
concentration card on the same screen already uses, and without it a source
that acquired heavily last month reports a near-zero repeat rate for no reason
but the calendar.

Stated in the block's hint: «qaytish % — butun tarix, birinchi xaridiga 90 kun
toʻlgan mijozlar boʻyicha». It does not move with the period control, and the
hint is what stops that reading as a bug.

### 5.4 `InsightsRepository.customerStates()` — today, not the window

Churn is a state as of now, exactly like the «База — mijozlar hozir qayerda»
ladder beside it. No period.

**Our verdict**, over every Customer, on `max(createdAtSource)`:

| State | Rule | Measured today |
|---|---|---|
| Faol | ≤ 60 days | 4 753 |
| Xavf ostida | 60 < d ≤ 150 | 5 052 |
| Yoʻqotilgan | > 150 days | 6 062 |

The three sum to 15 867, the Customer total.

**The thresholds are measured, not chosen.** 60 days is past both the median
gap (37.5) and its 75th percentile (73.9 — so a customer inside 60 days is
inside the normal cycle). 150 days sits past p90 (141.1): a customer silent
that long returns with under one chance in ten. They live as named constants in
`src/lib/customerStates.ts`, which **both** the repository's `CASE` and the
screen's labels read — the arrangement `logisticsBuckets.ts` already uses, so a
business definition has one home rather than a hand-mirror. Changing them is
one edit.

**The portal's verdict**, over open deals in the RETENTION pipeline, bucketed:

| Bucket | Stages |
|---|---|
| Faol | Новый база, Актив, Активный клиент, 1/3/10/20/30 кун, Успешно раздача |
| Xavf ostida | Пропущенный, Перерыв успешно |
| Yoʻqotilgan | Недозвоны, Неактивные, Не активный клиент |

A customer may sit on two stages at once, so **each customer is counted once,
in their BEST bucket** — any faol stage makes them faol. Summing the ladder
instead double-counts, which is the error `retentionStages` already documents.
A fourth row, **«Базада yoʻq»**, carries every Customer with no open База deal;
without it the two columns have different denominators and invite a
reconciliation that cannot come out. Measured today: Faol 7 609 · Xavf ostida
353 · Yoʻqotilgan 3 452 · Базада yoʻq 4 453, summing to the same 15 867.

**THE TWO COLUMNS DISAGREE, AND THE DISAGREEMENT IS THE POINT.** The portal
calls 7 609 customers active where the order dates say 4 753, and calls 3 452
dead where the order dates say 6 062 — roughly 2 900 people sitting in an
active-looking База stage who have not ordered in five months. Neither column
is wrong: one reports what the retention desk believes, the other what the
customers did. Printing them side by side is the whole value of the block, and
no figure here should ever be averaged or reconciled into one.

Stage names are matched through a table in `src/lib/customerStates.ts` beside
the day thresholds, and an unrecognised RETENTION stage falls into «Xavf
ostida» and is **named in an `unbucketedStages` field** — the tripwire
`logisticsBuckets` taught. The portal adds stages (it added a 19th Доставка
stage on 2026-09-10); silent mis-bucketing is the failure to prevent. Verified
on 2026-09-15: the fourteen stages above are every open RETENTION stage there
is, and `unbucketedStages` measures empty. **No stage count is written down**
anywhere in the code or the copy — that number moved once already on this
portal and two places went on printing the old one for a day.

### 5.5 Service and caching

`insightsService.customerFlow(currency, period, scope)` runs the three reads in
one `Promise.all` and folds the DTO, the way `cohorts` folds `cohorts` +
`retentionStages`.

`sourceRepeatRates` and `customerStates` take no period and no scope, so both
go through `ttlCache` at 5 minutes. `customerFlow` is period-scoped; its key
must carry the resolved window **and** `keyPart(restrictToEmployeeIds)` or it
gets no memo at all — the rule `ttlCache`'s own header states.

Cost: every probe above ran in 0.2–2.5 s including a fra1 round trip, against
18 392 revenue deals. This band adds no scan of the 448 000-row table. It needs
no new index; `@@index([countsAsRevenue, status, closedAt])` and
`@@index([customerId])` already exist, and `createdAtSource` is indexed.

## 6. Screen

One new band at the **top** of `CohortPage`, above «Kogorta tahlili». Nothing
below it moves except the one hint amended in §3.

1. **SectionHeader** «Mijozlar oqimi» — hint «Buyurtma berilgan sana boʻyicha ·
   tanlangan davr». The resolved dates print here, as the concentration band
   already does it.
2. **Four tiles** — Yangi mijozlar (hint: how many of them have a WON order) ·
   Qaytgan mijozlar · Takroriy tushum ulushi, davrda · Yoʻqotilgan mijozlar.
3. **ChartCard «Yangi va qaytgan mijozlar»** — two lines, **one Y axis**, built
   on `DailyOutcomeChart`'s pattern. Both series are people, which is what
   makes one axis honest; a second axis is forbidden in this codebase.
4. **ChartCard «Mijoz qayerdan kelayapti»** — the existing `CategoryBarList` in
   its two-panel arrangement: `magnitude` above (new customers per source),
   `rate` below (that source's repeat %), **in the same row order, the lower
   panel never re-sorted**. That is the component's stated mechanism and it is
   exactly what makes «Ген лид brings the most and returns the least» legible
   in one glance.
5. **ChartCard «Mijozlar holati — bugun»** — our three bands beside the
   portal's three plus «Базада yoʻq». Hand-drawn rows, not a chart: eight fixed
   rows need a bar and a number.

Empty, loading and error states on every card, all three — the branch the
«База» card was shipped without.

## 7. Tests and verification

* `tests/http/customerFlowSql.test.ts` — pins the SQL shape: the
  `createdAtSource` cohort, `countsAsRevenue` named explicitly, scope spread
  last, `count(DISTINCT customerId)` on every count.
* `tests/domain/customerStates.test.ts` — pins the day thresholds and the
  stage table against the RETENTION stage list, the way
  `logisticsBuckets.test.ts` does.
* Invariants checked against production before the work is called done:
  `sum(series.newCustomers) = summary.newCustomers`;
  `sum(sources[].newCustomers) = summary.newCustomers` (the `(manbasiz)` row
  included); the four state rows sum to the Customer total; `unbucketedStages`
  is empty.

## 8. Out of scope

* **The customer list.** The client chose statistics first and the list as a
  later step. Nothing here blocks it: `firsts` is the CTE that list needs.
* **The cohort matrix's clock.** Offered as option C and declined.

## 9. Known and deliberately unfixed

* **35 buyer identities are duplicates by phone (0.3%).** A returning customer
  registered as a second contact counts as new. Measured, recorded, not
  corrected — deduplicating contacts is a portal-side decision.
* **`isReturnCustomer` is set on 98.3% of orders**, which makes the second
  meter of `RepeatShareCard` at the bottom of this screen a constant rather
  than the data-quality signal its comment claims. Raised separately; this work
  does not touch that card.
* **`newCustomers` counts arrivals, not buyers.** 26% of revenue-pipeline
  orders never reach WON. `newCustomersWon` is printed beside it for exactly
  that reason.
