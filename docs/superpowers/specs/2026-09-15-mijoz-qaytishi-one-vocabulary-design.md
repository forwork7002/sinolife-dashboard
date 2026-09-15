# Mijoz qaytishi — one screen, one vocabulary

Design, 2026-09-15 (second pass of the day). Client instruction, verbatim:
«kogorta jadvali va mijoz qaytiishi bo'limini to'lqiqlgicha yaxhsila va
kuchaytir», with four directions named in the same breath — new facts, make
what is there understandable, harden correctness, speed — and then, added by
hand: «kogrota jadadvlani ham tuhusnarli qilish yangi mijolarni aniqlash va
eskialrini va yangi mijozlar ni adashtirmaslik dublikatlar dan halos qilish».

## 1. The situation this design exists to fix

`/analytics/cohort` was reworked **twice on 2026-09-15, in parallel, by two
sessions that did not know about each other**, and the two reworks are not
compatible.

| | `kogorta` branch | `main` branch |
|---|---|---|
| Cohort matrix | cumulative reading added, then a twelve-month window, a continuous grid, a crosshair and the per-cell «%» removed | monthly only, 19 columns, chips |
| «База» card | fifteen stages folded into **four groups** (`retentionGroups.ts`), keyed by **stage id** | fifteen stages drawn as **fifteen bars** (`StageLadder`) |
| Customer state | — | **three states** (`customerStates.ts`), keyed by **stage name**, plus the portal's verdict beside ours |
| Arrival / churn / source | — | the whole «Mijozlar oqimi» band, spec'd and measured |

Neither branch is wrong; each carries something the other needs. But they
partition **the same fifteen БАЗА stages two different ways, under two
different keys**, which is the one thing a screen must never do — the card and
the band would print different verdicts about the same person.

The client's own additions land in exactly this seam: «yangi mijozlarni
aniqlash … adashtirmaslik» is a question about which vocabulary decides who is
new, and «dublikatlardan halos qilish» is a question about identity.

## 2. Measured facts this design rests on

Read from production on 2026-09-15 (`probe-identity.ts`, `probe-dubl.ts`) and
from the local Bitrix24 reference database (`probe-stages.ts`).

### 2.1 There is no duplicate problem. Audited four ways.

| Measure | Result | Of |
|---|---|---|
| Buyer identities sharing a normalised number, over **every** number held | 100 groups, 100 collapsible | 15 876 buyers — **0.63%** |
| Cohort members that would merge under those identities | 11 517 → 11 478, **39 phantom** | **0.34%** |
| The portal's **own** «Дубль заказы» stage (`C10:UC_085NVA`) | **0 deals, 0 customers** | unused |
| Duplicate orders: same customer, same day, same amount | 79 extra orders | 18 405 revenue deals — **0.43%** |

Raw equality on the `phone` column alone — the method the «Mijozlar oqimi»
spec used — finds 59 groups. Normalising to the last nine digits finds 76;
reading every number in `phones[]` finds 100. So normalisation nearly doubles
the count and the count is still under two thirds of one percent.

**The stored numbers are far cleaner than assumed.** Of 15 873 buyers carrying
a phone, 15 805 (99.6%) hold twelve digits and 15 755 begin with `+`; exactly
two contain a separator. The «mixed formats hide duplicates» hypothesis is
measured and rejected.

**One caveat, recorded rather than chased.** `phones[]` is populated for only
2 741 of 15 876 buyers — the column was added after the last full contact
import and incremental sync only touches changed contacts. The 100 above is
therefore a **floor**. A full re-import of 352 550 contacts was offered and
declined on 2026-09-15: a 0.34% effect does not justify that load on the
client's portal.

### 2.2 The retention funnel does not leak into revenue

| Pipeline | Role | Revenue deals | All deals |
|---|---|---|---|
| Доставка | REVENUE | 18 208 | 18 208 |
| Ecommerce | REVENUE | 197 | 197 |
| База | RETENTION | **0** | 16 358 |
| every other | LEAD / AI_TRIAGE / QUALIFICATION / CONFIRMATION / HR / IGNORED | 0 | — |

The cohort matrix reads `countsAsRevenue`, so the База funnel cannot reach it.
Audited and clean; recorded so it is not re-derived.

### 2.3 The БАЗА funnel, as production actually holds it

Sixteen stages. Deal counts are open deals unless noted.

| Stage id | Name | Open deals | Customers | Group | State |
|---|---|---|---|---|---|
| `C10:NEW` | Успешно раздача | 22 | 21 | NEW | ACTIVE |
| `C10:UC_79XRT6` | Новый база | 1 211 | 1 110 | NEW | ACTIVE |
| `C10:FINAL_INVOICE` | 1 кун | 1 254 | 1 207 | CADENCE | ACTIVE |
| `C10:UC_FEENT1` | 3 кун | 1 235 | 1 187 | CADENCE | ACTIVE |
| `C10:UC_1TH09B` | 10 кун | 1 522 | 1 434 | CADENCE | ACTIVE |
| `C10:UC_8VIZ08` | 20 кун | 1 052 | 1 023 | CADENCE | ACTIVE |
| `C10:UC_4OTGKV` | 30 кун | 1 110 | 1 076 | CADENCE | ACTIVE |
| `C10:UC_W94F10` | Актив | 850 | 810 | ACTIVE | ACTIVE |
| `C10:PREPAYMENT_INVOIC` | Активный клиент | 894 | 831 | ACTIVE | ACTIVE |
| `C10:UC_KYP1SE` | Перерыв успешно | 426 | 401 | PAUSED | AT_RISK |
| `C10:UC_WWD9W7` | Пропущенный | 269 | 229 | PAUSED | AT_RISK |
| `C10:UC_S5YE1H` | Недозвоны | 2 557 | 2 360 | LOST | LOST |
| `C10:UC_SDQ5HF` | Неактивные | 2 055 | 1 899 | LOST | LOST |
| `C10:UC_085NVA` | **Дубль заказы** | **0** | 0 | DUPLICATE | — excluded |
| `C10:WON` | Успешно | 0 (1 821 closed) | 1 315 | CLOSED | — excluded |
| `C10:LOSE` | Не активный клиент | 0 (80 closed) | 80 | CLOSED | — excluded |

Open deals sum to **14 457**; with the 1 821 + 80 closed that is the 16 358
the pipeline census reports. That identity is the arithmetic check §9 pins.

### 2.4 Three defects this table exposes

1. **Neither branch names «Дубль заказы».** It holds nothing today, so nothing
   is visibly wrong — and the first order that lands there is silently folded
   into whichever bucket the fallback picks. `kogorta` sends it to «Boshqa
   bosqichlar»; `main` sends it to **Xavf ostida**, where it would be counted
   as a customer at risk.
2. **`kogorta` counts closed stages.** `C10:WON` (1 821 deals, 1 315
   customers) and `C10:LOSE` (80) are in its four groups. `main` counts open
   deals only. The same card would differ by ~1 900 deals depending on branch.
3. **The two disagree about 630 customers.** «Пропущенный» (229) is *sovigan*
   on `kogorta` and *xavf ostida* on `main`; «Перерыв успешно» (401) is *faol*
   on `kogorta` and *xavf ostida* on `main`.

And one structural difference: **`kogorta` keys by stage id, `main` by stage
name.** Stage names are edited from the portal's own UI. A rename silently
re-buckets every customer on that stage, with no error anywhere. Id wins.

## 3. Scope — three projects, this spec is the first

Splitting is sequencing, not reduction; all three are wanted.

* **P1 — this spec.** Merge the two branches, give the screen one stage
  vocabulary, and make every block state its clock and its denominator. No new
  endpoint, no new query shape beyond the state census that already exists.
* **P2 — «Kim yangi, kim eski».** The customer list the client asked for, and
  the normalised identity key in the arrival band (§8).
* **P3 — Speed.** The covering index `first_win` wants; measured separately.

## 4. The one stage table

`src/lib/retentionStages.ts` replaces `src/lib/retentionGroups.ts` and the
stage half of `src/lib/customerStates.ts`. It is the single home for the
partition; the day thresholds (`CUSTOMER_ACTIVE_DAYS` 60,
`CUSTOMER_AT_RISK_DAYS` 150) stay where they are, because they describe order
recency rather than stages.

```ts
export const RETENTION_STAGES = [
  // id, and the portal's name as a COMMENT — a name is a label, an id is a fact.
  { id: 'C10:NEW',               group: 'NEW',       state: 'ACTIVE'  }, // Успешно раздача
  { id: 'C10:UC_79XRT6',         group: 'NEW',       state: 'ACTIVE'  }, // Новый база
  { id: 'C10:FINAL_INVOICE',     group: 'CADENCE',   state: 'ACTIVE'  }, // 1 кун
  …
  { id: 'C10:UC_KYP1SE',         group: 'PAUSED',    state: 'AT_RISK' }, // Перерыв успешно
  { id: 'C10:UC_WWD9W7',         group: 'PAUSED',    state: 'AT_RISK' }, // Пропущенный
  { id: 'C10:UC_S5YE1H',         group: 'LOST',      state: 'LOST'    }, // Недозвоны
  { id: 'C10:UC_085NVA',         group: 'DUPLICATE', state: null      }, // Дубль заказы
  { id: 'C10:WON',               group: 'CLOSED',    state: null      }, // Успешно
  { id: 'C10:LOSE',              group: 'CLOSED',    state: null      }, // Не активный клиент
] as const
```

The rows elided above are the cadence stages and «Актив» / «Активный клиент»;
**§2.3 carries all sixteen with their group and state**, and that table is the
one to implement from.

**Two projections, one row each.** `group` is the funnel's own shape — what
the retention desk does next — and drives the «База» card. `state` is the
three-way reading that has to line up against the portal-versus-us comparison
in the «Mijozlar oqimi» band. Deriving both from one row is what makes it
impossible for a stage to be *faol* in one block and *sovigan* in the other.

**Five groups, not four.** `PAUSED` is new, and it is exactly the 630 people
the two branches disagreed about. Folding them into either neighbour is what
produced the disagreement; naming them ends it.

**`state: null` means "counted, named, and deliberately outside the census".**
`CLOSED` stages are not where a customer is *now* — the card's question is
«hozir qayerda» — and `DUPLICATE` is an administrative mark, not a state of a
customer. Both are rendered as their own labelled rows with their counts, so
they can never be mistaken for a missing stage or fold into a bucket.

**«Пропущенный» and «Перерыв успешно» resolve to AT_RISK.** A missed call is
not a lost customer, and a deliberate pause is not an active one. This is a
business judgement, it moves 630 people, and it is one line each to flip.

**A stage this table does not name is reported by id**, never bucketed —
the tripwire `logisticsBuckets.ts` established and `retentionGroups.ts`
already follows. The portal added a nineteenth Доставка stage on 2026-09-10;
silent mis-bucketing is the failure being prevented. **No stage count is
written down** in code or copy: that number has already moved once.

## 5. The «База» card

`StageLadder` — fifteen bars in portal order — is deleted. The card draws the
five groups, each naming its own stages in its hover, plus the `CLOSED` and
`DUPLICATE` rows below a rule.

Bars stay proportional to the largest group rather than to a total: a customer
sits on one stage, but the funnel is not exhaustive of the customer base, so a
stacked or percentage treatment would state something untrue. That reasoning
is `StageLadder`'s and it survives the change.

The SQL keeps `GROUPING SETS` over (group, stage), (group), () and keeps
`count(DISTINCT customerId)` at every level — a customer on two stages of one
group is one person in it, and summing the level below is how this screen once
printed a base 1 660 people too large. It gains `AND d."status" = 'OPEN'`,
which is what removes the closed stages from the census.

## 6. Every block states its clock and its denominator

This is the whole of «yangi va eskini adashtirmaslik». Two honest totals sit
on one screen and, unlabelled, one of them reads as broken.

| Block | Clock | Denominator | Moves with the period? |
|---|---|---|---|
| Mijozlar oqimi | `createdAtSource` — order placed | 15 876 customers by order | **yes** |
| Mijozlar holati — bugun | last order date | same 15 876 | no — today |
| База — mijozlar hozir qayerda | open stage now | 14 457 open deals | no — today |
| Kogorta tahlili + matritsa | `closedAt` on WON | 11 517 customers by delivery | no — whole history |
| Mijozlar kontsentratsiyasi | `closedAt`, trailing 90 days | that window's customers | no — its own window |

**These totals drift by a few while the day runs**, because both clocks are
open — the «Mijozlar oqimi» design measured 15 867 and 11 512 earlier the same
afternoon against the 15 876 and 11 517 recorded here. The figures are read
from the database at render time and no copy anywhere writes one down; the
numbers in this document date their measurement and are not contracts.

Each section header carries its clock in words: «Buyurtma berilgan sana
boʻyicha», «Bugungi holat», «Yetkazilgan sana boʻyicha». The gap between the
two customer totals is stated once, in the cohort section's hint, as a fact
rather than left for a reader to discover as a contradiction.

## 7. The cohort matrix, carried over

Already built on `kogorta` and verified in the browser; this is a port, not a
redesign. It brings:

* the **cumulative** reading as the default («Jami qaytgan»), with «Oylik» one
  press away. Measured: monthly repeat purchase runs 0–4% here, so ~250 cells
  land in two indistinguishable shades; the same customers read cumulatively
  run 0–37%. This is the single largest improvement to the matrix and it
  exists only on `kogorta`;
* the **twelve-month window** («6 oy / 12 oy / Hammasi»), counted as an offset
  rather than a column count, since the two readings draw a different number of
  columns for the same span;
* month columns that **flex** between 44px and 72px so the narrowed table still
  fills its card, with the three pinned columns fixed because every sticky
  `left` is a whole sum of them;
* **one continuous heat field** — hairline separators in the card's colour
  instead of 250 rounded chips — and a **crosshair** lighting the hovered row
  and column;
* **no per-cell «%»** (the column group already states the unit; every cell's
  `aria-label` still spells the figure out as a percentage);
* «Qaytgan» printing the **share alone**, with the distinct count in the
  cell's label and the row's hover panel;
* the legend's cross-check («a row's last cell equals its «Qaytgan» share»)
  made **conditional**, because it is true of the last *measured* cell and not
  the last *drawn* one.

The matrix keeps the `closedAt` clock. Rebuilding it on the order clock was
offered and declined in the «Mijozlar oqimi» design, and this spec does not
reopen it.

## 8. The identity key — where it goes, and where it does not

Decided 2026-09-15: **the normalised identity key goes into the arrival band
only, not into the cohort matrix.**

* **Where it goes.** `customerFlow`'s `firsts` CTE decides who is *new* and
  who is *returning* in a window — which is precisely the client's complaint.
  The key is the last nine digits, digits only, of the numbers the customer
  holds — `phone` together with every entry of `phones[]`. A customer holding
  several different numbers takes the **lexicographically smallest** of them,
  so the key is deterministic and two records merge only when they agree on a
  number both of them carry. Where no number exists at all — three buyers —
  the key falls back to the customer row's own id, which merges nothing.
* **Where it does not.** `first_win` in `cohorts()` is the most expensive scan
  on the screen — two heap walks over ~180 000 revenue rows, already measured
  and already documented as wanting an index rather than more joins. Adding a
  join over 352 550 customer rows to buy 39 cohort members out of 11 517
  (0.34%) is not a trade this screen can afford.
* **The consequence is stated, not hidden.** The two blocks will differ by up
  to 39 customers on the same question. That is smaller than the gap between
  their clocks (15 867 vs 11 512) and it is recorded here and in CLAUDE.md.

## 9. Tests and verification

* `tests/domain/retentionStages.test.ts` — the partition against the sixteen
  stage ids; every id unique; every `group` mapping to exactly one `state`;
  `CLOSED` and `DUPLICATE` carrying `state: null`; an unknown id falling to the
  unmapped path rather than into a bucket.
* `tests/http/retentionStagesSql.test.ts` — `status = 'OPEN'` present,
  `count(DISTINCT customerId)` at every grouping level, the `CASE` built from
  the table rather than written out.
* `tests/components/cohortMatrix.test.tsx` — carried over from `kogorta`,
  seventeen cases including the month window, the bare figure in the cell and
  the «Qaytgan» share.
* Invariants checked against production before this is called done:
  open deals by group sum to 14 457; the group counts and the state counts
  partition the same population; the unmapped list is empty; the «Дубль
  заказы» row renders at zero rather than disappearing.

## 10. Merge mechanics, against a branch that is still moving

`main` gained a commit at 12:26 while this design was being written; the other
session is executing its own nine-task plan on the same screen. So:

1. Implementation branches from `main` **at the moment work starts**, not from
   any sha recorded here.
2. New logic lands in **new files** (`retentionStages.ts` and its tests), which
   cannot conflict.
3. `CohortPage.tsx` and `insightsRepository.ts` are touched **last and
   minimally** — they are the two files the other session is also editing.
4. The gate runs in this worktree, on the **commit** rather than the working
   tree, per the rule a broken deploy established on 2026-09-11.

## 11. Out of scope

* **The customer list** — P2. It is the client's «qaysi mijoz yangi eski» and
  it needs its own design.
* **A full contact re-import** to complete `phones[]` — offered, declined; the
  duplicate floor in §2.1 is recorded instead.
* **The covering index for `first_win`** — P3, a migration and its own
  decision.
* **`isReturnCustomer`**, set on 98.3% of orders and therefore useless as the
  data-quality signal `RepeatShareCard` claims. Raised, untouched here.
* **`/sellers` and `/confirmation`** — out of bounds by standing instruction.
  `insightsRepository.ts` holds the confirmation queue's SQL beside this
  screen's; nothing in this spec goes near it.
