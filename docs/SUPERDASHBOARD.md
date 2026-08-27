# The modules — what each one measures, and why

Written after building them, against the live portal. Every number and field
name below was read from `obey.bitrix24.kz`, not assumed. Where a module
measures something other than what its name suggests, this says so and says
why — those are the places a reader would otherwise draw a wrong conclusion.

---

## 0. What the portal is

Nine pipelines, of which two are sales.

| ID | Name | Deals | Role | Contributes revenue |
|---|---|---|---|---|
| 0 | Регистрация | 181 720 | `LEAD` | no |
| 12 | Первичный отдел | 92 970 | `QUALIFICATION` | no |
| 4 | Тасдиклаш | 164 | `CONFIRMATION` | no |
| 6 | **Доставка** | 16 421 | `REVENUE` | **yes** |
| 10 | База | 13 541 | `RETENTION` | no — duplicate |
| 8 | HR | 299 | `IGNORED` | no |
| 14 | **Ecommerce** | 197 | `REVENUE` | **yes** |
| 18 | Бахолаш ва таклифлар | 6 | `IGNORED` | no |
| 20 | ИИ обработка | 114 399 | `AI_TRIAGE` | no |

`База` is not a second sales funnel. It is a repeat-contact cycle whose stages
are a call cadence — `1 кун`, `3 кун`, `7 кун`, `14 кун`, `21 кун`, ending in
`Активный клиент` / `Неактивные` / `Недозвоны` — and it re-records orders that
already exist in Доставка. Counting it would add about 5 bn UZS of revenue that
was already counted once.

That is what `Deal.countsAsRevenue` exists for. It is deliberately redundant
with the pipeline's role: a forgotten join produces a plausible-looking figure,
while a column every query must name fails loudly.

### Webhook scopes

All granted. `crm`, `user`, `department` and `telephony` are in use;
`catalog` supplies purchase prices; `task` and `timeman` are granted but not
yet imported.

---

## 1. Kogorta — do customers come back

**Source.** First revenue-bearing win per customer, then repeat wins by month
offset. Cross-checked against `IS_RETURN_CUSTOMER`, which the portal sets
itself on 107 817 deals.

**What it shows.** A retention matrix in distinct CUSTOMERS, not deals — one
buyer placing three orders in month 2 is one retained customer. Beside it, the
live headcount in each `База` stage, which answers "how many are being worked
right now" in the team's own vocabulary.

**Reading it.** Repeat purchase here runs 1–16% a month, so the heat bands are
set to that range. The usual SaaS bands (40/25/12/4) would paint every cell in
the lightest step and the matrix would read as blank.

**The headline** is second-order revenue share — what proportion of money comes
from customers buying again. It is not visible anywhere in Bitrix24 itself.

### Added August 2026 — concentration and the repeat interval

From `/insights/concentration`, on the same screen:

- **Top-10 mijoz ulushi** — the share of the period's revenue held by the ten
  largest customers (top-5 beside it), and the number of customers covering
  80% of revenue. Formula: rank customers by won revenue in the period
  (`countsAsRevenue`, `closedAt` in window), cumulate shares.
- **Takroriy xarid oraligʻi** — p50/p90 days between a customer's first and
  second purchase, over pairs whose *second* purchase falls in the period
  (conditioning on the second avoids censoring bias), with the pair count
  printed beside the percentile.
- **90 kunda qaytish** — the share of first-time buyers who bought again
  within 90 days. The cohort is first purchases in the period **shifted back
  90 days**, so every member has a complete horizon; a cohort cut at the
  period edge would flatter recent months by dropping the buyers who have not
  had time to return.
- **Takroriy tushum ulushi, stated twice** — once computed
  (`row_number() OVER (PARTITION BY customer ORDER BY closedAt) > 1`), once
  from Bitrix24's own `IS_RETURN_CUSTOMER` flag. When the two diverge, that
  divergence is itself the finding — a data-quality signal, shown, not
  reconciled.

**Caveats stated on the page.** `customerId` is nullable, so every share above
covers identified customers only and the revenue booked with *no* customer
attached is disclosed beside them. A customer's "first purchase" is derived as
`min(closedAt)` of won revenue deals — the portal keeps no
customer-created-at-source date to prefer.

---

## 2. Logistika — did it arrive, and how fast

**Source.** `crm.stagehistory.list`. Timings are between entering a hub stage
and being marked delivered — never `CLOSEDATE` minus `DATE_CREATE`, which
answers a different question: an order that sat unconfirmed for three days did
not take three days to deliver.

**The ladder.** Bitrix24 returns `SEMANTICS` only for WON and LOSE; the other
sixteen Доставка stages come back null, so their classification into
`LogisticsRole` is ours and lives in `mapping.ts`.

```
Подготовка товара → Заказ в мой склад → Успешно заказ → В пути
  → TOSHKENT-1 / NAVOIY / VODIY / QASHQADARYO / SURXONDARYO   (hubs)
  → CARAVAN / OSON POCHTA / BEK POCHTA                        (carriers)
  → Доставлено                                                (delivered)
  ↘ Отказ                     parcel travelled and came back
  ↘ Отказ предварительно      cancelled before dispatch
```

**Two numbers that must not merge.** `Отказ` cost real money to move; `Отказ
предварительно` cost nothing. Reporting them as one figure hides the expensive
half.

**The delivery rate is over RESOLVED orders**, not over every order in the
window. Half of any current month is still in transit; dividing by the whole
month reported 42% for an operation that delivers 93% of what it dispatches.

### One correction we make to the portal

`Отказ предварительно` carries `STAGE_SEMANTIC_ID = P`, so Bitrix24 reports
those deals as still in progress. Of the 359 deals that have ever entered that
stage, 331 are still sitting in it and 21 were eventually delivered — a 6%
revival rate over fourteen months.

Left as OPEN they are excluded from the conversion denominator, and the
dashboard reported a **100% conversion rate** for a month with 803 wins and 328
cancellations. A rate that cannot go below 100% measures nothing. So the
provider maps that one stage to LOST, dated by `DATE_MODIFY`. Every other stage
keeps the portal's own classification.

---

## 3. Summa vizual — how much was sold

Revenue by day, week and month; by pipeline, region, product line and seller.
Recognised at `Доставлено`, dated by `CLOSEDATE`.

**Verified against the portal.** 11 561 won deals, 16 277 499 917 UZS. Querying
Bitrix24 directly for the same filter returns 11 561 deals and 16 279 699 917
UZS — a difference of one deal that changed state in the forty minutes between
the two reads.

The portal closes orders in batches: 646 on 7 August, 559 on 20 August. The
spikes in the trend chart are real operational behaviour, not an artefact.

---

## 4. Tasdiqlash — did the operator confirm the order

**Not from the confirmation field.** `UF_CRM_1777879395123` ("Тастиклаш
анализ") is filled on **17 deals out of 16 618**. A report built on it would
render an empty screen that looks like an outage. The `Тасдиклаш` pipeline is
no better: 164 deals, never a win or a loss.

**From the stage instead.** Confirmation is an operator moving the order to
`Успешно заказ`; 4 339 deals have passed through it. `Пропущенный` and
`Юрист смс` are the other side — the customer could not be reached. Both are
read from stage history, because a delivered order left those stages long ago.

**The headline is coverage, not the rate.** Almost nobody records a failed
attempt, so the confirmation *rate* comes out at 100% for every operator every
month and separates no one. How much of their book goes through the step at all
ranges from 20% to 61%, and that is a real difference in how people work.

**The column that keeps it honest** is what happened afterwards. A high
confirmation rate on orders refused at the door is not performance — it is
someone clearing a queue. The verdict chip judges outcome first.

---

## 5. Sklad — fulfilment, not inventory

**The portal keeps no stock.** Four stores are defined;
`catalog.storeproduct.list` returns zero rows and `catalog.document.list`
returns zero documents. On-hand quantity does not exist to be shown, and
drawing an empty shelf would state that the warehouses are empty.

**What it reports instead** is which point fulfils each order —
`UF_CRM_1756494336`, with 15 values covering warehouses, couriers and
marketplaces (Wildberries, Uzum, Yandex Market, Ozon).

**Caveat stated on the page:** that field is filled on 5 913 of 16 618 revenue
deals, and its use has fallen to about 2% in recent months. Orders without it
appear as `Belgilanmagan` rather than being assigned to a default.

If inventory is ever run in Bitrix24, the tables and the import step already
exist and balances appear with no code change.

---

## 6. Qoʻngʻiroqlar — who spoke to customers

**Source.** `voximplant.statistic.get`. The portal logs roughly **12 400 calls
a day**, so a year is 4.5 million rows for a question nobody asks. One month is
imported by default (`BITRIX24_CALL_MONTHS`).

**Ranked by talk time, not call count.** Dialling a hundred numbers and
reaching none of them is not work with customers.

**Not scored.** Call quality rating would need a rubric nobody has agreed. The
recordings are stored and the schema carries null-ready `transcript` and
`score` columns, so a scorer added later reads this table instead of facing a
year-long gap.

**Connect rate is shown neutral, not graded.** A third of outbound calls
connecting is ordinary for this kind of dialling and there is no agreed target
to grade against.

### Added August 2026 — response speed and what an hour of talk returns

From `/insights/response`, which joins calls to deal creation — a join the
call analytics never made before:

- **Birinchi qoʻngʻiroqqacha** — p50/p90 minutes from a revenue deal's
  `createdAtSource` to its first OUTBOUND call, matched by `dealId` with a
  fallback to the same `customerId`. The percentiles run over deals that
  *were* called; the share never called at all is a separate disclosed number,
  because "never" is not a large number of minutes.
- **15 daqiqada aloqa** — the share of *all* deals created in the period that
  were first-called within 15 minutes (60-minute rate beside it). The
  denominator is every cohort deal, not the called subset — the honest one.
- **Urinishlar soni** — median outbound dials up to and including the first
  connect (1 = reached first try), per dialling target (a deal, or a
  customer+Tashkent-day when no deal is linked), and the share of targets
  never connected after 5+ attempts — the "5 уринишда богланиб болмади"
  refusal, made measurable.
- **Bir bitimga ketgan mehnat** — average calls and *connected* talk-seconds
  behind one closed deal, WON and LOST side by side, because either column
  alone invites the wrong reading.
- **Suhbat soatiga daromad** — period revenue ÷ connected talk-hours, overall
  and a top-5 list per employee. Null under one connected talk-hour, and the
  per-employee list applies the same floor: a spectacular soʻm/soat built on
  seventy minutes of talk is a different fact from one built on sixty hours.

**Caveats.** The deal cohort is `countsAsRevenue` only, so a retention-copy of
an order cannot count the same phone call twice. "Connected" is the portal's
own flag (failure code 200). And one month of calls is imported by default
(`BITRIX24_CALL_MONTHS`) — a reporting window older than the imported call
history undercounts first-touch and attempts, silently, so periods should stay
inside it.

---

## 7. Struktura — who is where

**Source.** `department.get`, three levels deep: NEWGEN → region → ROP group,
with `UF_HEAD` naming each head. 288 employees across 20 departments.

Figures roll up — a department shows itself plus everything beneath it, which
is what "how is Navoiy doing" means — while its own headcount is shown
separately so a manager with a large tree and no direct reports is not mistaken
for one running a team of forty.

`timeman` is granted; today's present/absent roster is not built yet.

---

## 8. Valovaya marja — what we actually make

**Source.** `catalog.product.list`, which carries `purchasingPrice`. It needs
`iblockId` in both the filter and the select, and the catalogue blocks are read
from `catalog.catalog.list` rather than hardcoded.

**Coverage is reported beside the margin.** 22 of 186 products carry a purchase
price, covering about 27% of revenue. A 56% margin over a quarter of the
business reads exactly like a 56% margin over all of it, and only one of those
is worth acting on.

**A product with no cost shows a dash, never zero.** A zero cost reports as
100% margin and quietly lifts the company average.

**Discounts are a column.** Some line items carry `DISCOUNT_RATE: 100` — outright
giveaways — which destroy margin silently otherwise.

### Deleted products are rebuilt, not dropped

`catalog.product.get` answers "product does not exist" for ids that appear on
real, paid, historical deals: someone removed the catalogue entry and the sales
stayed. Skipping those lines would remove their revenue from every product
figure while the deal total still counts it, and the two would never reconcile.
The line carries the name Bitrix24 recorded at the time, so the row is rebuilt
from that and marked inactive.

---

## 9. Kanal analitikasi — where the business comes from

**No Roistat.** Channel attribution is built from the portal's own 25
`SOURCE_ID` values — Instagram, Telegram, Tik-tok, sinolifeuz, zextrauzb, Ген
лид, Входящий and the rest.

**Leads count every pipeline**, including registration and triage: that is the
honest top of the funnel. Revenue counts only what a revenue pipeline won.

**Cohorted by CREATED date**, unlike the overview, which recognises revenue by
closed date. That is deliberate — the question is what this month's marketing
produced — and the page says so, because the two totals will differ and a
reader would otherwise assume one is wrong.

**ROI is null until spend is entered.** The `ad_spend` table takes a monthly
figure per channel; with one, the page reports CPL, CPO, CAC and ROI. Without
one it shows a dash, never a zero cost and never an infinite return.

### Added August 2026 — how concentrated the mix is

Two Herfindahl–Hirschman indices from `/insights/concentration`, shown as
verdict chips: revenue concentration **by source** and **by region**. Formula:
each group's revenue share in basis points, squared and summed — 0 to 10,000 —
banded at the DOJ thresholds (≥2500 concentrated, ≥1500 moderate, else
diversified, with the boundary reading as the more alarming band). A single
scalar that says whether the business rests on one channel, trended period
over period.

**Caveat.** `sourceId` and `region` are nullable fields; deals without one are
excluded from the index and their revenue share is disclosed beside it, per
the sparse-field rule. An index quietly computed over the labelled half of
revenue would be a confident claim about the whole.

---

## 10. Puls va oqim — how fast the machine turns, and where it jams

Two endpoints added August 2026, feeding the overview's hero band and the
sales page. Neither invents a new source: every input already existed in the
schema, computed separately and never combined.

**Savdo tezligi (soʻm/kun).** Open revenue deals × win rate × average won
amount ÷ median cycle days — the one number that trends pipeline health. The
UI prints the formula's four legs under the figure, and the composite is
**null the moment any leg is null**, with the em dash landing on the missing
leg. A velocity with an invented zero in one leg would be a confident number
about nothing.

**Davr prognozi.** Period-to-date revenue ÷ the elapsed fraction of the *full*
calendar unit, read against the previous **complete** unit — not the to-date
comparison the rest of the dashboard uses, because a run rate divided by a
to-date window is always ~100% elapsed and projects nothing. Null under 2%
elapsed. The elapsed share is drawn as a meter next to the projection: a
forecast from 8% of a month deserves visible scepticism.

**Aylanish davri.** p50/p75/p90 days over won revenue deals, `closedAt −
createdAtSource` — the one whole-deal duration the data-model rules sanction
(anything stage-to-stage comes from `DealStageHistory` instead). Rows where
`closedAt` precedes `createdAtSource` — sync artefacts — are excluded rather
than averaged in as negative days. The won-deal count is printed beside the
percentiles.

**Yutish darajasi, stated both ways.** won / (won + lost) by deal count *and*
value-weighted, side by side, because the two diverge exactly when a few large
deals are carrying the period — and that divergence is worth seeing, not
averaging away.

**Bosqich konversiyasi (ever-reached).** The old funnel showed where the
period's deals *currently sit* — a snapshot the overview still carries. This
ladder answers the question a sales screen actually asks: of deals **created
in the period** (revenue pipelines), how many ever *reached* each stage, from
`DealStageHistory`, with conversion against the previous stage of the same
pipeline. The basis travels in the payload (`created_in_period`) and the page
caption repeats it — "davrda yaratilgan bitimlar boʻyicha" — because the two
funnels have different denominators and an unlabelled number would invite
reconciling them from memory.

**Qotib qolgan bitimlar.** Point-in-time WIP aging over open revenue deals:
current dwell is `now − enteredAt` of the open stage-history row, and a deal
is *stuck* when its dwell exceeds **2× that stage's own historical median**
from completed visits — the stage judged against itself, because a week in
prepayment is normal and a week in "collecting the order" is a problem. The
panel shows the stuck count and the money standing still, then the worst
stages each with its current median dwell against the usual one, so the claim
"stuck" is checkable from the row itself.

**Caveats.** Every money aggregate names `countsAsRevenue`; all timestamps are
`*AtSource` / `closedAt`, bucketed Asia/Tashkent. Pulse and flow honour the
employee, department and source filters (and the caller's scope); product and
stage filters do not apply, and the pages say so next to the numbers.

---

## The import, and why it is fast

The portal returns 50 rows per list call and allows about two calls a second.
Read sequentially, 420 000 deals plus 318 000 contacts is over three hours.

**Offsets are not the answer.** They work until the portal cuts you off:
Bitrix24 meters "operating time" per method, and `start=400000` makes the
database count past four hundred thousand rows to return fifty. Measured — the
contact import ran twenty-five minutes and then every `crm.contact.list` call
in the account answered `OPERATION_TIME_LIMIT` for ten minutes, including cheap
ones.

**Chained id walking is.** Each command filters `>ID` with `start=-1` — an
indexed seek that skips the row count — and commands are chained inside one
batch through Bitrix24's `$result` reference, so command N starts after the
last id command N−1 returned. Fifty chained seeks cost about a second.

| | Offsets | Chained walk |
|---|---|---|
| 2 500 deals | ~6 s | 0.4 s |
| 318 000 contacts | 25 min, then blocked | ~3 min |
| Full import | 3 h+ | **15 min 54 s** |

It is also strictly ordered, so no row can be returned twice or skipped while
the table is being written to during the read.

---

## Still open

| # | Item | Blocks | Owner |
|---|---|---|---|
| 1 | Purchase prices for the remaining 164 products | Margin covers 27% of revenue | catalogue |
| 2 | Ad spend per channel per month | ROI, CPO, CAC | marketing |
| 3 | Import `task` and `timeman` | Workload, attendance roster | build |
| 4 | Confirm revenue is recognised at `Доставлено` | The revenue rule | finance |
| 5 | A rubric for call quality | AI scoring of stored recordings | sales management |
| 6 | Fulfilment point is filled on ~2% of recent orders | Warehouse module's usefulness | operations |
