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

