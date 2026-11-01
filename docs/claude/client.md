# Client data flow, light or dark

> CLAUDE.md'dan 2026-11-01 da so'zma-so'z ko'chirildi (ixchamlash). Qoidalar o'zgarmagan.

CLAUDE.md keeps a pointer here and the rules in one line each; this is the whole account.

### Client data flow

Every `src/features/*/[A-Z]*Page.tsx` starts with `'use client'`. There is no
server-component fetching and no data handed over at hydration — pages are thin
shells, all data comes from `/api/v1` in the browser.

**ONE EXCEPTION, AND IT IS ABOUT THE FIRST FRAME: the viewer.** `layout.tsx` is
an async server component that calls `pageViewer()` and hands the result to the
client tree through `ViewerProvider` (`src/lib/viewer.tsx`); `Shell` reads it
with `useServerViewer()` and draws the sidebar from it, letting the
`/meta/filters` payload override it the moment it lands. Both copies are built by
`viewerOf` in `src/server/auth/viewer.ts`, so the handover is invisible — which
is the whole requirement. **Without it the rail had nothing to go on for about a
second and showed EVERYTHING**: the session comes from
`/api/auth/get-session`, which cannot have answered during the server render, so
every cold load shipped HTML carrying all eleven destinations — «Foydalanuvchilar»
included — to every account, and a salesperson whose account had just been opened
met the administrator's menu blinking at them. Reported by the client on
2026-09-11; pinned by `tests/features/navColdLoad.test.tsx`, which also pins the
direction of the override and the fail-closed default.

It costs no extra query: `pagePrincipal()` in `pageGuard.ts` is wrapped in React's
`cache`, so the layout and the page guard under it share ONE session-plus-user
resolution per request. The one thing it does cost is that the root layout now
reads cookies, so `/login` and `/_not-found` are server-rendered on demand like
everything else rather than prerendered — `next build` shows every route as `ƒ`.

**THE RAIL AND HEADER ARE THE `(app)` LAYOUT'S (2026-10-20).** Every screen
lives under `src/app/(app)/` (the group adds nothing to the URL); its
`layout.tsx` draws `Shell` once and it stays mounted across navigations.
There is deliberately NO `loading.tsx`: once its outline is streamed, a page
guard's `redirect` cannot be a 307 any more (measured: 200 + meta refresh for
a stale session). The rail's links prefetch whole and mark a pending click
(`RailPending`); a ⌘K jump runs the header's sync line while it waits.
`PageShell` draws only the page and tells the shell `periodAware` /
`dataSource` through `components/layout/shellChrome.ts`. Never render `Shell`
from a page again — it would nest a second rail and bring back the
rebuild-on-every-click the client reported as «qotish»
(`tests/features/persistentShell.test.tsx`). **The shell hydrates BEFORE the
page** (the page sits in a Suspense boundary, the shell does not) and starts
`['filters']` and the session as it does: a page that renders shared data on
its first frame reads it through `useHydrated()` (`src/lib/useHydrated.ts`),
or it hydrates on data the server never had — React #418 on «Hisob», a
never-patched `disabled` on the filter pickers.

`src/app/providers.tsx` sets the cadence **globally**: `refetchInterval: 120_000`
with `staleTime: 115_000`, matched to the sync worker's 120 s production tick
(`SYNC_INTERVAL_SEC`; it was 60 s / 55 s until 2026-10-05).
Per-page `refetchInterval` overrides were deliberately removed. Three
exceptions, each with a reason in place: `/meta/alerts` (one request a minute
for the whole app, keyed constantly), `/meta/filters` (5 min — reference data
changes on sync), and two that never poll (`refetchInterval: false`, 2026-10-24):
the ⌘K search and the «ROP» heads list in «+ Yangi hisob». And «AI registrator → Boshqaruv» polls every 15 s (only the named accounts, `auth/aiControl.ts`; it waits for the agent's «qabul qildi»).

**THE REFRESH BUTTON REPORTS, AND A DEPLOY NOW REACHES AN OPEN TAB.** Both
added 2026-09-14, after the client reported «yangilash ishlamayapti» four times
over an afternoon in which the button was measurably working. Two different
absences produced that.
*A press that lands on unchanged numbers looks like a press that did nothing* —
and for four hours that afternoon the numbers could not change at all, because
Bitrix24 was refusing every REST call. So the button now prints
«Yangilandi 16:12» beside itself for six seconds, or «Bitrix24 band — yangi
maʼlumot yoʻq» when the sync is blocked («Bitrix24 bilan aloqa yoʻq — …» for a
lost connection since 2026-10-20, matching the chip) (`aria-live`, so it is announced as
well as drawn). The state is the timestamp rather than a flag: the message has
to name the moment or it reads as a status that was always true.
*And a single-page app does not notice a deploy* — five landed under that same
open tab. `scripts/writeBuildId.mjs` stamps `public/build-id.json` before every
`next build`; `useNewBuildAvailable` reads it on mount (that is what THIS tab is
running), then every minute while the tab is visible and once each time it is
shown again (that is what the server is serving now — since 2026-10-24 a hidden
tab does not poll); a difference offers «Yangi versiya · yangilash» and the
polling stops. A BUTTON, never an automatic
reload: this dashboard is read in the middle of work and a page that reloads
itself loses the reader's scroll, filters and place in a table. A failed read —
offline, 404 in dev, HTML from a proxy — is never a new version. The file is
excluded from the auth matcher in `middleware.ts` for that last reason: an
expired session would otherwise answer the poll with the login PAGE.

**THE INTERVAL DOES NOT RUN WHILE THE TAB IS HIDDEN, so the focus refetch is
what keeps the promise.** `refetchIntervalInBackground` is false — a dashboard
left open for a week must not issue ten thousand queries nobody reads — which
means a reader who works in Bitrix24 and glances at this dashboard comes back
to whatever was on screen when they left. `refetchOnWindowFocus` was true, was
turned off on 2026-09-03 because every return reissued every query while
somebody switched tabs every few seconds, and is **true again since
2026-09-14**, when the client reported the other half of it as «avtomatik
yangilanmayapti» (measured: a return at +160 s was answered at +185 s, by the
timer, not by the return). What makes both true at once is `staleTime`: a
focus refetch fires only for a STALE query, so two returns inside a minute
cost nothing and a return after an hour is current at once. Changing either
value without the other brings one of the two failures back.

**WHAT A READER SEES WHILE FIGURES ARE REPLACED — 2026-10-14** (the client:
«yangilanayotganda … bilishimiz kerakki yangilanayapti, yangi maʼlumot
chiqdi»; asked whether to blur on every refresh). Three signals, one per
moment, all in LIVE DATA at the end of `globals.css`: a 3px `.sync-line`
under the header while a PAGE query is in flight (`isPageQuery` in
`components/layout/liveData.ts` leaves out `meta`, `filters`, `search` and the
rail's lead-watch badge; shown after 250 ms); a «Yangi maʼlumot keldi · HH:MM»
pill (`useFreshDataAt`) when a re-ask of the SAME key came back with a
different `data` — structural sharing keeps `data` by reference when equal,
`meta.generatedAt` always moves — never on a first answer, a new filter or a
`manual` write; and `.data-stale` (dim + 1.5px blur) on PageShell's BODY only
while `stale`, so the filter row being used stays sharp. **A background poll
never blurs or dims anything** — every two minutes on a wall screen would make
it unreadable. On a phone the pill rises from the bottom (it covered the
title). Checked on a local build at 375 / 768 / 1440 with a delayed, altered
API answer.

### Light or dark

`globals.css` has carried a full second palette since it was written, but for a
long time the only thing that could reach it was the operating system —
somebody on a machine pinned to light by IT policy had no way to the dark one
at all. `src/lib/theme.ts` is the switch, and **the entire mechanism is one
attribute on `<html>`**: `:root[data-theme="dark"]` forces dark, and the
`prefers-color-scheme: dark` block is guarded `:not([data-theme="light"])` so
the attribute can force light BACK. That guard is the half a reader on a dark
machine depends on, and `tests/features/theme.test.ts` asserts it against the
stylesheet, because nothing in TypeScript can see it. No class list, no inline
colours, no second palette in JavaScript that could drift from the CSS.

**Three choices, not two.** «Tizim» is the absence of a decision rather than a
third theme, and it has to stay reachable, or one press of the header toggle
permanently detaches the dashboard from a machine that switches itself at
sunset. So `Shell`'s `ThemeButton` is a two-state toggle on the RESOLVED theme
— a three-state cycle hands a reader who wanted the other mode a press that
gives neither — and the three named states live in `AppearanceSection` on
`/account`. The store is read through `useSyncExternalStore` for the same
reason `periodMemory` and `sidebarCollapsed` are, and is remembered per browser
under `sinolife.theme.v1`.

Two duplications the feature cannot avoid, both deliberate:

- **The storage key is written out twice.** The attribute has to be on `<html>`
  before the body is parsed or every cold load flashes white at a dark reader,
  and a script that runs that early cannot import a client module — so
  `layout.tsx` carries an inline copy of the one line that sets it.
  `theme.test.ts` reads both files and pins them to the same key; the symptom
  it prevents is silent, because the preference still applies, one full paint
  too late.
- **`<meta name="theme-color">` is set from the CSS, not from a hex literal.**
  The layout's pair is keyed to `prefers-color-scheme`, which is exactly what a
  forced theme overrides — so a reader who picks light on a dark phone would
  otherwise get a black address bar over a white page. `paintBrowserChrome`
  reads `--page` back out of `getComputedStyle` and prepends its own meta (the
  FIRST matching one wins). It runs from `subscribeTheme`, which React calls
  from an effect; `/login` is the one screen nothing subscribes on, so its
  address bar follows the machine until the reader is through the door.
