# Doc rot

> CLAUDE.md'dan 2026-11-01 da so'zma-so'z ko'chirildi (ixchamlash). Qoidalar o'zgarmagan.

## Doc rot — verify before trusting

- `docs/ARCHITECTURE.md` documents `getHandler(permission, schema, handle)`. The
  real signature takes `access = { permission, section }`, and the word
  "section" appears nowhere in that file — half the authorisation model is
  undocumented there.
- `docs/BITRIX24.md` says `assertMappingComplete()` guards startup. It was a
  no-op with no callers and was deleted on 2026-09-10 with the rest of the
  callerless code; the `sourceField` / `confirmed: true` fields its "steps to
  finish" tell you to edit do not exist either. It also references a
  `POST /api/v1/sync/run` route that was never built.
- (eskirgan — keyingi band, 2026-11-01 da tekshirildi: `docs/API.md` bu o'n beshtadan birortasini
  endi sanamaydi — `/dashboard/`, `/deals`, `/employees/[id]`, `/finance/overview`,
  `/insights/{channels,flow,pulse,response}` uchun `grep -c` = 0; ro'yxatni b5b2ad21 (2026-09-11)
  «Twenty endpoints, and this is the whole list» jadvaliga almashtirgan, u ham eskirgan.
  «twenty-three on 2026-09-16» — 2026-11-01 da 56 ta `route.ts`
  (`find src/app/api/v1 -name route.ts | wc -l`). `/insights/calls` haqidagi gap hali to'g'ri.)
- `docs/API.md` still lists fifteen endpoints that no longer exist — every
  `/analytics/*` but `sellers`, `/dashboard/*`, `/deals*`, `/employees/[id]`,
  `/finance/overview`, `/insights/{channels,confirmations,flow,pulse,response}`.
  (`/insights/calls` is listed again since 2026-09-16 — a new endpoint at the
  old address.) `find src/app/api/v1 -name route.ts` is the authority;
  twenty-three on 2026-09-16.
- `docs/DEVELOPMENT.md`'s test count is current as of 2026-09-07 (928) but the
  phase table below it is finished work; `npm run verify` is the authority.
- `src/lib/sections.ts` cites a `src/server/auth/sections.ts` that does not
  exist. The invariant it describes still holds — by direct import.
