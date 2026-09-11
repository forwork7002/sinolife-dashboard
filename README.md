# SinoLife Sales Intelligence

Sales, delivery and team analytics for the `obey.bitrix24.kz` portal.

Runs on **live Bitrix24 data**. UI language is Uzbek, currency UZS, every
reporting period computed in `Asia/Tashkent`. One administrator account; public
sign-up is disabled in code, the password is held to a house policy and checked
against known breaches, an optional TOTP second factor can be armed from
`/account`, and five wrong passwords lock sign-in for fifteen minutes. What
that does and does not protect: [SECURITY.md](docs/SECURITY.md).

---

## What it reports

| Screen | Question it answers |
|---|---|
| **Savdo dinamikasi** | Revenue over time, by product, by source and by seller — plus the confirmation FAKT band the floor is paid on |
| **Mijoz qaytishi** | Do customers come back, how soon, what repeat business is worth, and how much revenue rests on the top ten |
| **Yalpi marja** | Gross margin per product, and how much of revenue it covers |
| **Reklama samarasi** | What each campaign, ad set and creative returned. Roistat's own ledger, not Bitrix24 data. **Paused** — the screen is held and shows «tayyorlanmoqda» |
| **Tasdiqlash navbati** | Did the operator confirm the order, and did the confirmation hold |
| **Logistika natijasi** | Which hub and carrier delivered, how fast, and where parcels came back |
| **Joʻnatish nuqtalari** | What each warehouse, courier and marketplace shipped. **Paused** — the screen is held and shows «tayyorlanmoqda» |
| **KPI rejalari** | Each plan's target against what was delivered inside the plan's own window |
| **Kadrlar tuzilmasi** | The portal's own org chart, with every unit's headcount and its money over the window |
| **Sotuvchilar reytingi** | Who sold what, ranked on delivered revenue — the television board the floor watches |

Ten sections, listed in `src/lib/sections.ts`, which is the only place that
decides what a section is. Two more pages sit outside that list and are reached
by permission rather than by section: `/users` (account administration) and
`/account` (password and two-factor). `/` renders nothing at all — it forwards
to `LANDING_ROUTE` («Sotuvchilar reytingi»), or to the first section the account
actually holds.

---

## What the portal actually holds

Verified against the live API, not assumed.

| | |
|---|---|
| Deals | 419 717 across nine pipelines |
| Revenue | 16.28 bn UZS from 11 561 won deals |
| Contacts | 317 839 |
| Employees | 288, in a 20-department tree |
| Stage transitions | ~191 000 |
| Calls | ~286 000 for the last month |
| Products | 186, of which 22 carry a purchase price |

A full import takes about sixteen minutes. After that a worker keeps the
database within about ninety seconds of the portal — it pulls every sixty
seconds and the browser refetches on the same cadence, so a screen left open
updates itself.

Any window can be reported on: the six presets, or a specific day, month, year
or arbitrary range through the date picker. The selection lives in the URL, so
it survives navigation and a filtered view is a shareable link.

### Two things the portal does not have

**Payments.** No payment amount exists anywhere: `crm.invoice.list` returns
nothing, there are no smart processes, and none of the 55 custom fields holds a
sum. Payment appears only as stage names. The finance page therefore reports
"not connected" rather than 0 soʻm outstanding, which would be false.

**Stock balances.** Four stores are defined and every one is empty —
`catalog.storeproduct.list` returns zero rows and there are no inventory
documents. The warehouse page reports dispatch by fulfilment point, which the
portal *does* record, and says plainly that on-hand quantity is not maintained.

---

## The one rule that matters

The portal records the same order twice. `#10 База` mirrors `#6 Доставка`: 97%
of its order codes and amounts reappear there, created a median of ten days
later, and always later.

So every deal carries `countsAsRevenue`, set from its pipeline's role, and
**every query that touches money names it explicitly**. Without that filter,
reported revenue is roughly 5 bn UZS too high — about 30% — and nothing looks
broken.

The import prints the excluded total on every run. If it is ever zero, the
guard has stopped working.

---

## Getting started

**Before anything else: Node 22.22.2 or newer** (the 24.x line needs 24.15.0).
Node 20 will not do — the floor comes from `jsdom` and `undici` in the lockfile,
not from Next, and nothing in the repo enforces it beyond `.nvmrc`. Production
builds on **22.22.2**, which is what `.nvmrc` names. PostgreSQL **16**, to match
the managed cluster; the SQL itself only needs 12.

```bash
nvm use                       # reads .nvmrc
cp .env.example .env          # then EDIT it — see below
npm ci
npm run db:generate           # the Prisma client is gitignored, and there is no postinstall
npm run db:deploy             # migrations
npm run bitrix:import -- --full --reset
npm run db:seed:users         # the single administrator
npm run dev
```

**The copied `.env` will not boot as it stands**, and that is deliberate: it
ships an empty `BETTER_AUTH_SECRET` and a `CHANGE_ME` password inside
`DATABASE_URL`. Fill in `DATABASE_URL`, `BITRIX24_WEBHOOK_URL`,
`BETTER_AUTH_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first
command that touches either.

On a machine with no Bitrix24 webhook, set `DATA_SOURCE=demo` and run
`npm run db:seed` in place of the import: the demo provider walks the same sync
engine, so every screen has data and no portal is contacted.

Then sign in, change the password from `/account`, and arm two-factor while you
are there — **the ten backup codes are shown once and are the only recovery
path there is.** Write them on paper, not into the password manager on the same
laptop.

`--reset` removes demo-sourced rows before importing. Demo data is retired; the
generator survives only as a test fixture so the analytics suite runs without a
portal.

### Everyday commands

```bash
npm run verify                        # typecheck + lint + the whole test suite
npm run bitrix:worker                 # continuous sync, one tick a minute
npm run bitrix:import                 # a single incremental pass
npm run bitrix:resync -- STAGES DEALS # one entity, after a mapping fix
npm run db:seed:users -- --reset-password
```

The worker is what runs in production. `bitrix:import` is for the first load
and for catching up by hand.

---

## Documentation

| | |
|---|---|
| [SUPERDASHBOARD.md](docs/SUPERDASHBOARD.md) | What each module measures and why, with the portal evidence behind it |
| [BITRIX24.md](docs/BITRIX24.md) | Field mapping, duplicate analysis, revenue recognition |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers and the rules between them |
| [DATABASE.md](docs/DATABASE.md) | Schema and the money/time contracts |
| [API.md](docs/API.md) | Endpoints and the response envelope |
| [DEPLOY.md](docs/DEPLOY.md) | DigitalOcean App Platform, step by step |
| [SECURITY.md](docs/SECURITY.md) | What protects the dashboard, what does not, and what to do if you suspect a compromise |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, the gate, and the conventions |

---

## Still open

| # | Item | Blocks |
|---|---|---|
| 1 | Purchase prices for the other 164 products | Margin covers only 27% of revenue |
| 2 | Ad spend per channel per month | ROI, CPO and CAC on the channels page |
| 3 | `task` and `timeman` scopes are granted but not yet imported | Workload and attendance |
| 4 | Confirm revenue is recognised at `Доставлено`, not at payment | The revenue rule |
| 5 | Call quality scoring | Recordings are stored; no rubric agreed |
