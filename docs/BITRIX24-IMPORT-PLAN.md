# Bitrix24 import plan — for review before anything runs

Status: **proposal.** Nothing has been imported. The production database still
holds demo data and the dashboard is unaffected.

Everything below is derived from the portal itself (`npm run bitrix:discover`,
`bitrix:analyze`, `bitrix:compare`, `bitrix:titles`), not from assumption.

---

## 1. Scope

### Imported as revenue

| Pipeline | Deals | With amount | Why |
|---|---|---|---|
| `#6 Доставка` | 16 283 | 99.8% | Where money actually lands |
| `#14 Ecommerce` | 197 | 64% | Separate channel — 20% contact overlap, own team of 10 (only 4 shared) |

**≈ 16 500 deals.** Not 415 591 — the bulk of the portal is lead handling.

### Imported as secondary — excluded from revenue and KPI

| Pipeline | Deals | Why excluded |
|---|---|---|
| `#10 База` | 13 474 | **Confirmed copy.** 97% of order codes and amounts appear in Доставка, created ~10 days later, 290/292 always later |

Stored so the business can later work out what База is for, but it never
reaches a revenue figure. See §5.

### Not imported

| Pipeline | Deals | Why |
|---|---|---|
| `#0 Регистрация` | 179 842 | Amount is 0 on 99.9% |
| `#12 Первичный отдел` | 92 339 | Lead qualification — **zero won deals, ever** |
| `#20 ИИ обработка` | 112 989 | No amounts at all |
| `#4 Тасдиклаш` | 165 | 0 won, 0 lost — inactive |
| `#8 HR` | 299 | Recruitment candidates, not sales |
| `#18 Бахолаш` | 6 | Complaints |

These stay out of the database entirely for the test import. Adding one later
is a config change, not a migration.

---

## 2. Schema changes

Three additions. Everything else in the existing schema is unchanged.

### 2.1 `Pipeline` — new model

The current schema has stages but no pipeline. Bitrix24 has nine, and which
ones count as revenue is a **business decision that is not yet final**, so it
must be data, not code.

```prisma
enum PipelineRole {
  /// Counts toward revenue, conversion and KPI.
  REVENUE
  /// Imported and browsable, but excluded from every aggregate.
  SECONDARY
  /// Present for reference only.
  IGNORED
}

model Pipeline {
  id             String         @id @default(cuid())
  externalSource ExternalSource @default(MANUAL)
  externalId     String?
  name           String
  role           PipelineRole   @default(IGNORED)
  sortOrder      Int            @default(0)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  deals  Deal[]
  stages DealStage[]

  @@unique([externalSource, externalId])
  @@index([role])
  @@map("pipeline")
}
```

Changing `Доставка` from REVENUE to SECONDARY later is one UPDATE, no
redeploy. That matters because §4 is still unconfirmed.

### 2.2 `Deal` — three new columns

```prisma
model Deal {
  // … existing fields unchanged …

  pipelineId String?
  pipeline   Pipeline? @relation(fields: [pipelineId], references: [id], onDelete: SetNull)

  /// Order code from Bitrix24's TITLE, e.g. "bx05267". The key that proved
  /// База duplicates Доставка, and the only way to link the two afterwards.
  orderCode String?

  /// Denormalised from the pipeline's role at import time. Every analytics
  /// query filters on this, so excluding a pipeline never depends on a join
  /// being remembered.
  countsAsRevenue Boolean @default(false)

  @@index([pipelineId])
  @@index([orderCode])
  @@index([countsAsRevenue, status, closedAt])
}
```

`countsAsRevenue` is deliberately redundant with `pipeline.role`. The
redundancy is the point: a forgotten join silently includes 13 474 duplicate
deals, and the resulting revenue looks plausible. A column the query must name
explicitly fails loudly instead. It is recomputed on every sync.

### 2.3 `DealStage` — pipeline link

Stage IDs repeat across pipelines (`C6:WON`, `C14:WON`), so a stage now belongs
to a pipeline.

```prisma
model DealStage {
  // … existing …
  pipelineId String?
  pipeline   Pipeline? @relation(fields: [pipelineId], references: [id], onDelete: SetNull)
}
```

---

## 3. Field mapping

### Deal — `crm.deal.list`

| Bitrix24 | Our field | Conversion |
|---|---|---|
| `ID` | `externalId` | string |
| `TITLE` | `title`, `orderCode` | `orderCode` only when it matches `^bx\d+$` |
| `OPPORTUNITY` | `amountMinor` | **× 100**, parsed as decimal string → BigInt. Never via float |
| `CURRENCY_ID` | `currency` | `UZS` observed |
| `CATEGORY_ID` | `pipelineExternalId` | |
| `STAGE_ID` | `stageExternalId` | e.g. `C6:WON` |
| `STAGE_SEMANTIC_ID` | `status` | `S`→`WON`, `F`→`LOST`, `P`→`OPEN` |
| `ASSIGNED_BY_ID` | `employeeExternalId` | |
| `CONTACT_ID` | `customerExternalId` | |
| `SOURCE_ID` | `sourceExternalId` | |
| `DATE_CREATE` | `createdAtSource` | ISO with `+03:00` offset — parsed as an instant, stored UTC |
| `CLOSEDATE` | `closedAt` | Only when `CLOSED = Y` |

`STAGE_SEMANTIC_ID` is Bitrix24's own classification. Using it means we do not
hand-map 100+ stage IDs and cannot get won/lost wrong for a stage nobody
remembered to tell us about.

### Stage — `crm.dealcategory.stage.list`

Returns `SEMANTICS` (`P`/`S`/`F`) per stage, which is the authoritative source
for `DealStage.category`. **To verify on first run** — if unavailable, fall
back to `crm.status.list` and derive from the `:WON` / `:LOSE` suffix.

### Employee — `user.get`

| Bitrix24 | Our field |
|---|---|
| `ID` | `externalId` |
| `NAME` + `LAST_NAME` | `fullName` |
| `EMAIL` | `email` |
| `WORK_POSITION` | `position` |
| `ACTIVE` | `isActive` |
| `UF_DEPARTMENT[0]` | `departmentExternalId` |

Departments need the `department` scope, **which is currently missing** from
the webhook. Without it, department filters stay empty; everything else works.

### Customer — `crm.contact.list`

The portal has 314 610 contacts. **Only those referenced by imported deals are
fetched** — roughly 15 000 — by id, in batches. Importing all of them would
take hours and fill the database with people who never bought anything.

### Product — `crm.product.list` + `crm.deal.productrows.get`

57 products. Line items are per-deal, and `productrows.get` takes one deal at a
time: 16 500 calls at 2/second is **over two hours**.

Mitigation: Bitrix24's `batch` method packs 50 commands per request → ~330
requests, a few minutes. The provider must use it or product analytics is not
worth having.

### Payments — NOT imported

No amount field exists anywhere: deals expose only `OPPORTUNITY`, `TAX_VALUE`
and `PROBABILITY`; invoices return 0; there are no smart processes; none of the
55 custom fields holds a payment sum.

The Bitrix24 provider therefore declares `PAYMENTS: false`, and the finance
endpoint returns `501 INTEGRATION_PENDING`. The page will say "not connected"
rather than showing 0 so'm outstanding, which would be false.

---

## 4. Revenue recognition — PROVISIONAL

**Not final. Pending finance/accounting confirmation.**

Working rule for the test import:

> A deal contributes revenue when `STAGE_SEMANTIC_ID = S` (won), on the date in
> `CLOSEDATE`, and its pipeline is marked `REVENUE`.

For Доставка that means the `Доставлено` stage. That is a defensible reading
for a delivery business, and the data supports it — but accounting may
recognise revenue at payment instead, and payment is not in Bitrix24 at all.

The rule lives in configuration, not in analytics code:

```ts
export const REVENUE_RULE = {
  recognizeOn: 'WON',        // 'WON' | 'STAGE'
  recognitionStageIds: [],   // used when recognizeOn = 'STAGE'
  dateField: 'CLOSEDATE',    // 'CLOSEDATE' | 'DATE_CREATE'
} as const
```

Changing it is a config edit plus a re-sync — no schema change, no code change.
**Compare the test import's totals against Bitrix24's own reports before this
is called correct.**

---

## 5. Duplicate rules

Three layers, because one is not enough.

**1. Same record re-imported** — existing mechanism. Upsert on
`(externalSource, externalId)` under a unique index. Running the sync twice
updates; it never doubles.

**2. Same order in two pipelines** — the new one. База deals are imported with
`countsAsRevenue = false`. They appear in the deals list, filterable, but are
absent from every revenue, conversion and KPI figure.

Enforced in `DealRepository`, which adds `countsAsRevenue: true` to every
analytics query. A test asserts that a База-equivalent deal never reaches a
revenue total.

**3. Cross-pipeline linkage** — `orderCode` is stored on both sides, so the
business can later ask "how many delivered orders were re-recorded in База"
without another investigation.

### What would go wrong without this

Importing both pipelines as revenue: 16 283 + 13 474 deals, with 97% of База
mirroring Доставка. Reported revenue would be roughly **double** the truth,
consistently, with nothing visibly broken.

---

## 6. Test database

Production and test are fully separate. The running dashboard is untouched.

```
DATABASE_URL           postgresql://…/sinolife        ← demo data, live dashboard
BITRIX24_TEST_DB_URL   postgresql://…/sinolife_test   ← Bitrix24 import
```

The import script takes its connection from `BITRIX24_TEST_DB_URL` and
**refuses to run if that is unset or equal to `DATABASE_URL`** — the guard
exists so a mistyped variable cannot overwrite the live database.

Reviewing the result:

```bash
npm run bitrix:import:test     # into sinolife_test
npm run bitrix:report:test     # totals per pipeline, month, employee
```

The report is what gets compared against Bitrix24's own dashboards.

---

## 7. Estimated time

| Step | Records | Estimate |
|---|---|---|
| Pipelines, stages, sources | ~150 | seconds |
| Employees, departments | ~80 | seconds |
| Products | 57 | seconds |
| Deals (Доставка + Ecommerce) | 16 500 | ~3 min |
| Deals (База, secondary) | 13 474 | ~3 min |
| Contacts (referenced only) | ~15 000 | ~3 min |
| Product rows (batched) | 16 500 deals | ~4 min |
| **Total** | | **~15 minutes** |

Assumes the `batch` method throughout. Without it, product rows alone take over
two hours.

---

## 8. Open items

| # | Item | Blocks |
|---|---|---|
| 1 | Confirm revenue is recognised at `Доставлено` | Final revenue rule — not the test import |
| 2 | What is `База` for? | Whether it becomes a retention metric later |
| 3 | Add `department` scope to the webhook | Department filters |
| 4 | Verify `crm.dealcategory.stage.list` returns `SEMANTICS` | Stage categories — fallback exists |
| 5 | Are Ecommerce deals ever re-recorded in Доставка? | 20% contact overlap, 15% amount match — small, worth a check after import |

None of these blocks the test import. All of them are config, not code.

---

## 9. What I need before building this

Approve, or correct:

1. Scope — Доставка + Ecommerce as revenue, База as secondary, rest excluded
2. Schema — the `Pipeline` model plus three columns on `Deal`
3. Provisional revenue rule — won + `CLOSEDATE`, changeable by config
4. Separate test database with the same-URL guard
