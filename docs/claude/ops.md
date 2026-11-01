# Ops — the web log

> CLAUDE.md'dan 2026-11-01 da so'zma-so'z ko'chirildi (ixchamlash). Qoidalar o'zgarmagan.

From «Deploy» in CLAUDE.md.

**`slow request` AND `slow page guard` IN THE WEB LOG (2026-10-14).** Any API
request or page-guard lookup taking a second or more leaves one warn line:
path (cut to 160), the shape-only query keys, status, `ms`, `authMs` (the
caller lookup) and the pool's `{ total, idle, waiting }` read when the request
arrived (`poolAtStart`) and when it ended (`pool`) —
`src/server/http/slowRequest.ts`; `/api/health` writes `slow health check`
the same way. `poolAtStart.waiting > 0` is a request that arrived at a full
pool; nothing in the line proves a slow query on its own (a screen can queue
for connections after the caller is resolved too). A `slow page guard` with
`resolved: false` is a signed-in reader the guard may have sent to /login:
`optionalPrincipal` answers null on any failure. Read them with
`doctl apps logs <app-id> web --type run | grep 'slow '`.
