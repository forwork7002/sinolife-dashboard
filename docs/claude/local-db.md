# Local database

> CLAUDE.md'dan 2026-11-01 da so'zma-so'z ko'chirildi (ixchamlash). Qoidalar o'zgarmagan.

## Local database

`.env` points at `127.0.0.1:5433` and **nothing serves that port** — the
throwaway cluster this checkout used was deleted on 2026-09-07 with the machine
move, so `db:deploy`, `db:check`, `db:studio` and `prisma migrate` all fail with
`P1001` until one is made. `.env.example` says 5432.

```bash
initdb -D ~/pg-sinolife -A trust -U "$USER"
pg_ctl -D ~/pg-sinolife -o "-p 5433 -c listen_addresses=127.0.0.1" start
createdb -h 127.0.0.1 -p 5433 sinolife
npm run db:deploy && npm run db:seed && npm run db:seed:users
```

(eskirgan: «16 migrations» — 2026-11-01 da `ls -d prisma/migrations/*/ | wc -l` = 71; «11 of 11»
o'shandan beri qayta o'lchanmagan, `prisma/check.ts`da invariantlar hali 11 ta. 2026-11-01 da 5433
portini hech narsa tinglamaydi va `~/pg-sinolife` yo'q — birinchi gap hali to'g'ri.)
On a database made that way all **16 migrations apply and `db:check` returns 11
of 11** (1 600 deals, 14 employees, 611 won) — measured 2026-09-07. A failing
invariant on a database that has been sitting around is a stale database, not a
broken rule.

Everything else — typecheck, lint, the whole test suite, `next build` — runs
without a database, on Node 22.22.2+ (see `.nvmrc`; Node 20 cannot run the
tests, `jsdom` refuses it).
