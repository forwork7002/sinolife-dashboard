# Database

PostgreSQL, accessed through Prisma 7. Schema lives in `prisma/schema.prisma`;
migrations are version controlled in `prisma/migrations`. The database is never
edited by hand.

## Four contracts

### 1. External identity

Every entity that can originate from a CRM carries `externalSource` +
`externalId` under a **unique composite index**.

That single constraint is what makes synchronisation idempotent: the sync
engine upserts on that pair, so re-running a full sync never duplicates rows.
Rows created inside the app use `externalSource = MANUAL` and a null
`externalId`.

### 2. Money

`BigInt`, in minor units, in a column whose name ends in `Minor`, paired with a
`currency CHAR(3)`.

Never float. Never `Decimal`. For UZS the minor unit is 1/100 so'm. Integer
arithmetic stays exact through `SUM` and `AVG`, and ports across engines.
See `src/server/domain/money`.

### 3. Time

`*AtSource` columns hold timestamps as reported by the CRM. `createdAt` and
`updatedAt` are our own row lifecycle.

**Analytics must use the `*AtSource` columns.** Using `createdAt` would move
every deal into the current reporting period on the next re-sync.

### 4. Stage semantics

`DealStage.category` is our normalised meaning: `NEW`, `IN_PROGRESS`, `WON`,
`LOST`. Bitrix24 stage IDs map onto it by configuration. No analytics code ever
reads a stage *name*.

## Entities

**Auth** (shape owned by better-auth): `user`, `session`, `account`,
`verification`. `user.role` is `ADMIN | MANAGER | SALES`; `user.employeeId`
links a login to a salesperson, and a `SALES` user is scoped to that employee's
own deals — enforced in the repository query, not by hiding UI.

`account.issuer` is required and is **not optional decoration**: better-auth
matches the sign-in account on `(issuer, accountId, providerId)`, so a row
without it looks correct in the table and can never be signed into. For
email+password the value is `local:credential`.

**Organisation**: `department`, `employee`.

**Catalogue**: `product_category`, `product`, `customer`.

**Pipeline**: `deal_stage`, `sales_source`, `deal`, `deal_item`.

**Finance**: `payment` — schema exists, real field mapping unconfirmed. See
[BITRIX24.md](BITRIX24.md) question 7.

**KPI**: `kpi`, `kpi_result`.

**Operations**: `sync_log`, `sync_cursor`, `audit_log`.

### Notable columns

| Column | Note |
|---|---|
| `deal.amountMinor` | BigInt minor units; equals the sum of its `deal_item.totalMinor` |
| `deal.metadata` | Source fields with no confirmed mapping, preserved so no data is lost |
| `deal.status` | Derived from the stage category; always consistent with it |
| `deal_item.totalMinor` | Denormalised `quantity × unitPriceMinor`, so product analytics aggregates in SQL |
| `kpi.targetValue` | BigInt. Units depend on `metric`: minor units for money, a count for deals, **basis points** for conversion |
| `kpi_result.achievementBp` | Basis points (10000 = 100.00%). Integer, so no float drift |
| `sync_log.errorMessage` | Pre-redacted. Never a raw provider response — those can contain credentials |

## Indexes

Chosen to match the actual analytics access patterns rather than added
speculatively:

- `deal(employeeId, createdAtSource)` — "this employee's deals in this period"
- `deal(status, closedAt)` — "won deals closed in this period", the revenue query
- `deal(createdAtSource)`, `deal(stageId)`, `deal(sourceId)`, `deal(customerId)`
- `deal_item(dealId)`, `deal_item(productId)`
- `payment(dealId)`, `payment(paidAt)`
- Unique `(externalSource, externalId)` on every importable entity
- `kpi(periodStart, periodEnd)`, `audit_log(entity, entityId)`

## Referential behaviour

- `deal.stageId` and `deal.employeeId` are `RESTRICT` — deleting a stage or an
  employee that still has deals must fail loudly rather than orphan revenue.
- `deal.customerId` and `deal.sourceId` are `SET NULL` — a deal survives losing
  its customer record.
- `deal_item` and `payment` `CASCADE` from their deal.
- `user.employeeId` is `SET NULL` — deleting an employee record must not delete
  the login.

## Migrations

```bash
npm run db:migrate          # create + apply in development
npm run db:deploy           # apply in production
npm run db:reset            # DESTRUCTIVE: drop, recreate, re-seed
```

Migration files are committed. Never edit an applied migration; add a new one.

## Enum parity

The domain layer declares the enum values as plain string unions so it stays
free of Prisma. `src/server/repositories/enumParity.ts` asserts at **compile
time** that the two never drift. Removing a value from either side fails
`npm run typecheck` — verified by probe.

## Seeding

`npm run db:seed` runs the demo provider through the **real sync engine**, so
demo data enters via the same path Bitrix24 data will. It is deterministic:
`DEMO_SEED` fixes the employees, deals and revenue.

`npm run db:seed:users` provisions the demo accounts. It converges from any
partial state — user row and credential are ensured independently, because a
run that creates one and fails on the other would otherwise leave an account
that can never be signed into and that re-running would skip.

## Integrity checks

`npm run db:check` asserts 11 invariants the schema cannot express, and exits
non-zero on violation so it is usable in CI:

- every deal amount equals the sum of its line items;
- no deal is paid more than its value, and payments belong only to won deals;
- deal status agrees with its stage category;
- resolved deals have a close date, open deals do not, and none closes before
  it was created;
- no duplicate external ids per source;
- every KPI target is positive, and **no employee has two KPI windows covering
  the same instant** — a regression guard, after changing how those windows
  were computed silently doubled the target count.

## Upstream deletions

A full sync can sweep rows whose source record has disappeared
(`sweepDeleted: true`). Without it, a deal deleted in Bitrix24 would sit in
every revenue total permanently.

The sweep is guarded three ways, because deletion is the one irreversible
operation here: never on incremental runs (a changed-records read says nothing
about what still exists), never after a FAILED or PARTIAL run (a transient
network error yields a short read), and never on an empty read (that is a
misconfiguration, not a real emptying).

Enabled for the demo seed. **Opt-in for Bitrix24** until the retention policy
is agreed — see [BITRIX24.md](BITRIX24.md) §10.
