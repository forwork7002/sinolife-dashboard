<!-- Moved verbatim from CLAUDE.md on 2026-10-20 to keep every session's context small. CLAUDE.md points here; read this file before working on what it covers. -->

## The 2026-09-10 cull — what is gone, and how to tell

The client asked for «Boshqaruv markazi» to be removed outright and for all dead
code to go with it («loyihadagi barcha oʻlik kodlarni yoʻqotish»). What went was
everything with **no caller in `src/features`** — the API had grown a long tail
of endpoints whose screens had been removed one instruction at a time.

**Fifteen endpoints** — every `/analytics/*` except `sellers`; `/dashboard/command`
and `/dashboard/overview`; `/deals` and `/deals/[id]`; `/employees/[id]`;
`/finance/overview`; `/insights/calls`, `/channels`, `/confirmations` (the
parent — `orders` and `regions` stayed), `/flow`, `/pulse` and `/response`.
Twenty remain. **Four services**: CommandCentre, Finance, Response, and the
whole instance side of Analytics — `AnalyticsService` is now two statics,
`context()` and `periodMeta()`, which is all three live routes ever asked it for.
**Two repositories** (Finance, Response) and ~40 methods out of four more.
**Forty-odd DTOs** from `src/lib/api.ts`, which lost a third of its lines.

**How to check the claim rather than trust it**, because this is the sort of
list that rots:

```bash
# Every endpoint, and whether any client code names it.
for r in $(find src/app/api/v1 -name route.ts | sed 's|.*api/v1/||;s|/route.ts||'); do
  echo "$r $(grep -rl "'/${r%%/\[*}" src/features src/components src/lib | wc -l)"
done
```

**One thing was deliberately NOT removed** although nothing imports it:
`src/server/repositories/enumParity.ts` — a compile-time assertion that the
domain unions match the Prisma enums; `tsc` reads it because `tsconfig.json`
includes `**/*.ts`. (The 2026-09-30 sweep removed the unused test seams and
the `REVENUE_PIPELINES` / `REVENUE_RULE` / `PAYMENTS_AVAILABLE` constants; their
decision text stays as comments in `bitrix24/mapping.ts`. `countsAsRevenue` on
the deal row is what the code reads.)

**What the sweep exposed and did not fix:** the ⌘K «Mahsulotlar» group still
links to `/analytics/sales?productIds=…`, and that screen has applied no product
filter since it was stripped to FAKT 1 / FAKT 2. The «Manbalar» group beside it
is fine — `sourceIds` does reach `sellerBoardRepository`.

---

## Superseded in CLAUDE.md on 2026-11-01 — the old text, with the reason

> CLAUDE.md'dan 2026-11-01 da so'zma-so'z ko'chirildi (ixchamlash). Qoidalar o'zgarmagan.

Each block is the old CLAUDE.md text, word for word; the current rule is in CLAUDE.md under the
same heading.

**From the top of CLAUDE.md:**

(eskirgan: ro'yxat to'liq emas — 2026-11-01 dan `docs/claude/`da yana `client.md`, `architecture.md`,
`ops.md`, `doc-rot.md`, `local-db.md` bor; amaldagi to'liq ro'yxat CLAUDE.md oxiridagi «Batafsil» bo'limida. «261 KB» — 2026-10-20
dagi o'lcham, tarix sifatida to'g'ri.)

**The long reference lives in `docs/claude/`** — `screens.md`, `invariants.md`, `sync.md`, `data-scope.md`,
`history.md` (moved there whole on 2026-10-20: this file was 261 KB and every session paid for it on every
request). This file keeps the rules and points at them. When a change alters a screen, an invariant, the sync
or a scope rule, update its part in that file — never grow this one back.

**From «Authorisation»:**

(eskirgan: `deals/[id]` va `employees/[id]` 2026-09-10 da o'chirilgan — 2026-11-01 da
`src/app/api/v1/deals` va `src/app/api/v1/employees` yo'q; `tests/http/routeAccess.test.ts`
13–14-qatorlarda shuni yozadi va «NO ROUTE AUTHORISES BY HAND» testida `requirePermission`,
`requirePrincipal(` yoki `assertSection(` topilgan route'ni yiqitadi. Amaldagi matn — CLAUDE.md
«Authorisation».)

`getHandler(access, …)` takes `access = { permission, section }`. **Both are
required fields**; `section: null` must be written out, so adding an endpoint is
always a decision about who reaches it. Two drill-down routes
(`deals/[id]`, `employees/[id]`) hand-roll `requirePermission` +
`assertSection` because they authorise per-resource — and
`tests/http/routeAccess.test.ts` is the only thing guarding that path. It also
pins the ungated list exactly, so **adding an endpoint with `section: null`
fails that test until you extend the array.**

**From «Deploy»:**

(eskirgan: «the entire deployment» endi to'g'ri emas — jonli app spec'ida committed faylda yo'q
`collagen-landing` servisi ham bor: `doctl apps get <app-id>` 2026-11-01 — services `web`,
`collagen-landing`; worker `sync`; jobs `migrate`, `provision-admin`; `.do/app.yaml`da «collagen»
0 marta. Vault ISH Runbook 14- va 71-qatorlar. Amaldagi matn — CLAUDE.md «Deploy».)

`.do/app.yaml` is the entire deployment: `web`, the `sync` worker
(`instance_count: 1`), a PRE_DEPLOY `migrate` job and a POST_DEPLOY
`provision-admin` job. No Dockerfile, no CI.
