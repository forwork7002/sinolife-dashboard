# SinoLife Sales Intelligence

Sales, delivery and team analytics for the `obey.bitrix24.kz` portal.

Runs on **live Bitrix24 data**. UI language is Uzbek, currency UZS, every
reporting period computed in `Asia/Tashkent`. One administrator account; public
sign-up is disabled in code.

---

## What it reports

| Screen | Question it answers |
|---|---|
| **Umumiy koʻrinish** | How much did we sell, where the period is heading, how fast the pipeline turns, and which deals are stuck |
| **Savdo tahlili** | Revenue over time, by product, by seller — and how far deals created in the period actually got |
| **Kanallar** | What each of the 25 sources brings in, what it converts at, and how concentrated the mix is |
| **Kogorta** | Do customers come back, how soon, what repeat business is worth — and how much revenue rests on the top ten customers |
| **Marja** | Gross margin per product, and how much of revenue it covers |
| **Logistika** | Which hub and carrier delivered, how fast, and where parcels came back |
| **Tasdiqlash** | Did the operator confirm the order — and did the confirmation hold |
| **Sklad** | What each warehouse, courier and marketplace shipped |
| **Reyting / Xodimlar / Struktura** | Who sold what — the branch's sellers only, ROPs excluded, ranked on **delivered** revenue — and where everyone sits in the company. The seller-close basis (what was *closed* rather than *delivered*) ships on the API today, not yet in this screen's metric picker |
| **Qoʻngʻiroqlar** | Who actually spoke to customers, how fast a new deal gets its first call, and what an hour of talk returns |
| **Bitimlar** | Every deal, filterable, across all nine pipelines |

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

```bash
cp .env.example .env          # fill in DATABASE_URL, BITRIX24_WEBHOOK_URL,
                              # BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm ci
npm run db:deploy             # migrations
npm run bitrix:import -- --full --reset
npm run db:seed:users         # the single administrator
npm run dev
```

`--reset` removes demo-sourced rows before importing. Demo data is retired; the
generator survives only as a test fixture so the analytics suite runs without a
portal.

### Everyday commands

```bash
npm run verify                        # typecheck + lint + 307 tests
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
| [BITRIX24-IMPORT-PLAN.md](docs/BITRIX24-IMPORT-PLAN.md) | Field mapping, duplicate analysis, revenue recognition |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers and the rules between them |
| [DATABASE.md](docs/DATABASE.md) | Schema and the money/time contracts |
| [API.md](docs/API.md) | Endpoints and the response envelope |
| [DEPLOY.md](docs/DEPLOY.md) | DigitalOcean App Platform, step by step |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup and conventions |

---

## Still open

| # | Item | Blocks |
|---|---|---|
| 1 | Purchase prices for the other 164 products | Margin covers only 27% of revenue |
| 2 | Ad spend per channel per month | ROI, CPO and CAC on the channels page |
| 3 | `task` and `timeman` scopes are granted but not yet imported | Workload and attendance |
| 4 | Confirm revenue is recognised at `Доставлено`, not at payment | The revenue rule |
| 5 | Call quality scoring | Recordings are stored; no rubric agreed |
