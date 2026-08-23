# SinoLife Sales Intelligence

Internal sales analytics and management dashboard.

Runs today on **deterministic demo data** in PostgreSQL. Designed so that
connecting the real Bitrix24 account later is an integration task, not a
rewrite — the frontend, the analytics engine and the database schema do not
change.

UI language is Uzbek. Currency is UZS. All reporting periods are computed in
`Asia/Tashkent`.

---

## Status

| Area | State |
|---|---|
| Architecture, scaffold | Done |
| Database schema + migrations | Done — 19 tables, 70 indexes |
| Domain layer (money, periods, analytics, KPI, finance) | Done |
| CRM abstraction + deterministic demo provider | Done |
| Synchronisation engine (idempotent, incremental, sweep) | Done |
| Repositories, services, REST API | Done — 13 endpoints |
| Authentication + RBAC | Done — 3 roles, scoping enforced in SQL |
| Dashboard UI | Done — 8 pages + employee drill-down |
| Tests | 285 |
| Bitrix24 provider | Transport done; **field mapping pending credentials** |
| Reports / export page | Not built |
| Admin sync screen | Not built (`sync:run` API and permission exist) |

`BITRIX24_INTEGRATION_PENDING` marks everything waiting on the real portal.

---

## Requirements

- Node.js 20+ (developed on 24)
- PostgreSQL 16 or 17
- npm 10+

## Setup

```bash
npm install
cp .env.example .env          # then set DATABASE_URL
npm run db:migrate            # create the schema
npm run db:seed               # demo data, through the real sync engine
npm run db:seed:users         # demo accounts
npm run dev
```

The app refuses to start if `.env` is incomplete — including while
`DATABASE_URL` still contains the `CHANGE_ME` placeholder. That is deliberate:
a misconfigured deployment should fail loudly rather than serve a dashboard
full of zeros.

## Demo accounts

| Email | Role | Sees |
|---|---|---|
| `admin@sinolife.uz` | Administrator | Everything, including sync and users |
| `manager@sinolife.uz` | Manager | All analytics; no admin operations |
| `sales@sinolife.uz` | Sales | Own deals and KPI only; no finance |

Password: `demo1234`

> **Replace these before any deployment reachable from outside.** They are
> created by `prisma/seedUsers.ts`. Public sign-up is disabled; accounts are
> provisioned server-side through `src/server/auth/provisioning.ts`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm run verify` | **typecheck + lint + tests.** The gate; green before any phase is done |
| `npm test` / `test:watch` / `test:coverage` | Tests |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Load demo data |
| `npm run db:seed:users` | Create/refresh demo accounts |
| `npm run db:check` | **Data integrity checks** — 11 invariants, CI-usable |
| `npm run db:studio` | Browse the database |
| `npm run db:reset` | **Destructive.** Drops and recreates the database |

## Pages

`/` overview · `/analytics/sales` · `/products` · `/finance` · `/employees` ·
`/employees/:id` · `/leaderboard` · `/deals` · `/kpi` · `/login`

Filters live in the URL, so a filtered view is a shareable link, the back
button steps through filter changes, and the reporting period carries across
navigation.

## Demo vs live data

Every API response carries `meta.dataSource` (`DEMO` or `BITRIX24`), and the UI
badge reads that field and nothing else — so no screen can present generated
numbers as if they came from the live CRM.

Demo data is generated from a fixed seed (`DEMO_SEED`), so the same seed always
produces the same employees, deals and revenue.

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, boundaries, and why lint enforces them |
| [DATABASE.md](docs/DATABASE.md) | Schema, money representation, indexes |
| [API.md](docs/API.md) | Endpoints, envelope, auth, filters, errors |
| [BITRIX24.md](docs/BITRIX24.md) | Integration plan and the open questions blocking it |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Conventions, testing, troubleshooting |

## Licence

Proprietary — internal use.
