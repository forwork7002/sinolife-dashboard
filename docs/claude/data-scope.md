<!-- Moved verbatim from CLAUDE.md on 2026-10-20 to keep every session's context small. CLAUDE.md points here; read this file before working on what it covers. -->

#### Handing one out: «ROP» inside «+ Yangi hisob» on `/users`

The scope above is the rule; this is the only place it is granted. `/users` is
ONE table now. It carried two readings behind a `SegmentedControl` —
«Hisoblar» and «ROP», the department heads — and the second tab was the only
door to a team-scoped account, so an administrator who wanted to give a ROP a
login had to know that the button marked «+ Yangi hisob» was the wrong one.
The heads are a CHOICE INSIDE that button now: «Oddiy hisob» / «Boʻlim rahbari
(ROP)», answered before anything else on the form. Everything the tab knew is
kept, in `HeadPicker`.

- **The list is heads, not the roster, and that is the whole point.** An OWN or
  ALL account can be linked to anybody, so the ordinary picker offers all 289
  people. A TEAM account cannot: the scope is grown from the tree, so somebody
  filed nowhere who heads nothing anchors on nothing and `assertScopeIsUsable`
  refuses to save them. `listDepartmentHeads()` answers two `findMany`s and
  hands them to `departmentHeads()` in `domain/employees/departmentHeads.ts` —
  one row per PERSON, because `headId` is one head per unit but nothing stops
  one person running several.
- **EVERY department head, not only the fifteen «(ROP)» ones.** The client
  asked for it and headship descending makes a branch head a real grant. Sales
  teams sort first because ROP is what the floor calls this. Sorted with
  `localeCompare(…, 'ru')`, matching `branches.ts`: 'uz' collation files the
  digraphs Sh and Ch at the END of the alphabet, which is correct Uzbek and
  wrong for a list somebody scans with their eye.
- **The team size in each option is asked of the REAL resolver**, one head at a
  time, and then run through `rowScopeFor` — not counted from the tree here. A
  second count would be a second definition of who is on a team, and the two
  would agree until the day they did not; going through `rowScopeFor` is what
  adds the reader themself, which a raw `teamEmployeeIds().length` omits for
  exactly the odd records worth checking. Roughly nineteen recursive queries,
  which is why the route takes **`?include=heads`** — a query parameter and not
  a second endpoint, because `routeAccess.test.ts` pins the ungated list and
  this has nothing new to say under it.
- **NOTHING ASKS FOR THE HEADS UNTIL SOMEBODY PICKS «ROP».** The query is
  `enabled: isRop` on the dialog and it no longer polls. On the tab it went out
  the moment the tab opened and again every five minutes; a modal that is open
  for a minute has nothing to learn from a second answer. `staleTime` stays at
  five minutes — the roster changes when the sync worker's reference-data pass
  names a new head, not while an administrator types a password — and that is
  what makes reopening the form instant. `refetchInterval` was DELETED rather
  than lowered: it never consults staleness, so leaving it would have restored
  the polling the enable flag exists to stop.
- **The selected head is derived from `employeeId`, never stored beside it.**
  Two pieces of state for one choice is how a form sends a scope anchored to
  one person while showing another's team size — and that number is the only
  thing between an administrator and granting nine teams by accident.
- **Heading the ROOT is «Butun kompaniya» wearing another label**, so the
  option's units line says so in red. The demo tree has one (`SinoLife`, 14 of
  14 people); production has one too.
- **Units nobody heads are NAMED under the picker.** «Тошкент онлайн» carries
  nine sales teams and names no `UF_HEAD` at all, so it cannot be on a list of
  people — and unsaid, an administrator hunts for it and reports the screen.
  The field to fill is in Bitrix24, not here.
- **Picking a head fills the name and guesses the login**, because the person
  is the first thing the form asks and retyping «Sirojov 115 Davlatbek» is
  where the typos are. `loginSuggestion` takes the first ASCII word carrying a
  letter, so a floor badge never becomes a login.
- **Switching the kind resets the scope, the anchor and the ticks**, which are
  answers to the kind question rather than to anything typed. ROP opens with
  Tasdiqlash + Sotuvchilar ticked: an empty list means «follow the role», and a
  SALES role's defaults include Logistika, a screen that refuses a narrowed
  account outright. Every tick stays editable.
- **A head who already signs in is a DISABLED option reading «hisobi bor».**
  `createUser` refuses an employee that already has a login
  (`assertEmployeeIsFree`) — `user.employeeId` is `@unique` and `provisionUser`
  writes it in its THIRD statement, so the clash was a `P2002` nothing
  translates, a 500 that left behind a real, signable account with no username,
  role SALES and scope ALL. Correcting such an account, its scope above all, is
  done by opening its row in the table, where every field is unlocked.
- **The table marks a TEAM account «ROP» on its name cell.** A team-scoped
  account IS a ROP account — that is the definition — so the list that used to
  live on its own tab is a chip on the row it was already on. Five columns, not
  eight: «Yaratilgan» and a column of its own for 2FA went (2FA is a glyph
  beside the status), and the role and the scope share one cell because they
  are read together. `minWidth` 1120 → 860, which is what took the horizontal
  scrollbar off the office laptop.

**PER-SECTION SCOPE — `user.wideSections`, 2026-10-05** («ROP larga
bo'limlarini … hohlagan bo'limimni o'z bo'limi va butun kompaniya bo'yicha»).
A ROP who ticked RNP was refused it: one `dataScope` covered every screen.
Now a narrowed account carries the ticks it reads COMPANY-WIDE, and
`getHandler` runs `widenForSection` BEFORE the permission check — on a wide
screen the principal is ALL (permission, `ctx.scope`, memo keys), everywhere
else it keeps TEAM/OWN. An endpoint feeding several screens widens only if
EVERY one of them the account holds is wide (`/analytics/sellers` feeds
`sellers` + `sales`; `sellers` / `structure` count as wide); `section: null`
never widens — except that `/meta/alerts` resolves the bell's scope as
`confirmation` reads it, so the bell and the page behind it agree. On the form each tick on a narrowed account shows
«Oʻz boʻlimi | Butun kompaniya» (Tasdiqlash, Logistika, Savdo dinamikasi,
KPI), or the fixed «Butun kompaniya» for the `COMPANY_WIDE` screens — the
FORM sends a ticked one as wide; the server stores only what was sent
(`cleanWideSections` never adds) and rewrites the list only when the body
touches sections / scope / wide — or «Hammaga toʻliq» for `sellers` /
`structure`, which answer everybody already. The sidebar, the page guard and
`ForecastSection` read `readsCompanyWide`. **WIDENING IS READ-ONLY**:
`mutationHandler` judges on the stored scope (a TEAM MANAGER widened on the
RNP plan POST would rewrite every team's plans), and a widened principal
carries `widened: true` so `canEditPlans` / `canEdit` stay false. Migration
`20261006090000_user_wide_sections` backfilled ONLY `rnp` as wide on TEAM
accounts that hold it (the client named it); every other company-only tick —
several were added by earlier migrations, not by a decision — waits for an
administrator to re-save the account. `/meta/filters` hands an account with ANY wide
screen the whole roster (names only).

**«RNP JADVALI» NARROWS TO A TEAM — 2026-10-24** (the user, for Malika's
account: «faqat … oʻzini ichidagi xodimlari chiqsin»; every ROP account then
held RNP wide, so all of them read every team). `rnp` left `COMPANY_WIDE` for
`TEAM_NARROWS` in `sections.ts`: on a TEAM account the form offers
«Oʻz boʻlimi | Butun kompaniya» for it (an existing wide tick stays wide — no
other account changed); on OWN it is still company-wide only, because the
sheet has no row smaller than a team. Narrowed, `/rnp/overview` cuts the
FINISHED sheet to the teams the scope's people are filed in
(`RnpRepository.teamsOfEmployees` → `TEAM_ALIASES`, so «Malika(ROP)» reads
the «Charos» block) — their blocks and logistics and no company line
(`narrowRnpSheet`, the month's memo untouched) — and `/registration/report`
keeps the scope's people alone, the totals theirs (`buildRopReport`'s
`keepsSeller`; «192 Charos», on her roster but out of her scope, goes). Both
refuse OWN; a narrowed MANAGER is no editor there (the plan / cost POSTs judge
the stored scope). `isCompanyWideSection(id, dataScope)` takes the scope —
without one it answers the old way.

**Which endpoints admit a narrowed account is pinned by
`tests/http/routeAccess.test.ts`.** Declaring `permission: 'analytics:read:all'`
is how an endpoint says *"I cannot narrow my rows — refuse a ROP rather than
answer with the company's"*; declaring the any-of pair (or `leaderboard:read`,
or `employees:read`) says the opposite, and every route that says the opposite
must read `ctx.scope`. The test asserts both halves of that, so widening a
permission without threading the scope fails the gate.

Narrowed today: the confirmation queue and everything cut from its cohort (rows,
pagination count, tiles, ROP panel, ROP filter options, the header bell, the
rejection chart), the leaderboard, and the ten routes that already spread
scope.

**One route admits a narrowed caller and answers with the whole company on
purpose: `/analytics/sellers`.** The client asked for it on 2026-09-08 —
«sotuvchilar reytingi bo'limi hammaga bir xil ko'rinishi kerak… hamma
bir-birini natijasini ko'ra olishi uchun» — and a leaderboard whose readers
each see a different league is not a leaderboard. It was scoped for six weeks
and the trade was made the other way. THREE screens move with it, because they
are one answer rendered three ways: the board, its record wall, and the
FAKT 1 / FAKT 2 band on Savdo dinamikasi, whose tiles are built from these
rows. What that discloses to every account: per seller and per team, FAKT 1 /
FAKT 2 money, order counts, conversion and rank — no deal rows, no customers,
no phone numbers, no costs. `routeAccess.test.ts` records the exemption by
name (`COMPANY_WIDE`) and fails if the route stops saying so out loud, so
every OTHER route in that list must still be seen reading `ctx.scope`. The
60-second memo in front of `SellerBoardService.board` is keyed WITHOUT a
scope, which is only safe while this holds: narrow the board again and the
memo has to gain the scope in the same commit or be deleted in it.

Still company-only, and still refusing:
logistics, margin, cohort, concentration and **marketing** (the ad sheets have
no employee dimension to narrow by at all).

