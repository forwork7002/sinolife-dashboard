'use client'

import * as React from 'react'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { Button } from '@/components/ui/Button'
import { CommandPalette, useCommandK, type CommandGroup } from '@/components/ui/CommandPalette'
import {
  SearchGlyph,
  TriangleGlyph,
} from '@/components/ui/Icons'
import { Kbd } from '@/components/ui/Kbd'
import { Tooltip } from '@/components/ui/Tooltip'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet, type SearchDto } from '@/lib/api'
import { sessionUser, signOut, useSession } from '@/lib/authClient'
import { formatCompactUzs, formatDateTime } from '@/lib/format'
import { ROLE_LABELS, canSeeHref } from '@/lib/roles'
import { sectionSpec, type SectionValue } from '@/lib/sections'
import { useFilterOptions } from '@/features/shared/PageShell'
import { t } from '@/lib/messages'

/**
 * React's <ViewTransition>, taken from whatever React the framework vendors.
 *
 * The stable `react` package (19.2) does not export it, so its TYPES do not
 * know the name — but Next aliases `react` to its own canary build in the App
 * Router, and THAT build does export it (verified in
 * node_modules/next/dist/compiled/react). The cast bridges the two truths.
 *
 * This replaces a hand-rolled document.startViewTransition interception that
 * wrapped router.push in the transition's update callback. Measured with a
 * driven browser, that shape deadlocked against the router on EVERY click:
 * the commit the promise waited for never arrived until the interception's
 * own 1-second backstop fired, so every section change cost ~1.1s of frozen
 * screen before the crossfade even began. The component integrates with the
 * router's own transition, commits immediately, and the same globals.css
 * keyframes apply — same look, none of the wait. If a future React channel
 * drops the export, the page renders unwrapped and navigation is simply
 * instant: the fallback is the fast path, never a broken one.
 */
const ViewTransition = (
  React as unknown as {
    ViewTransition?: React.ComponentType<{
      children?: React.ReactNode
      name?: string
    }>
  }
).ViewTransition
import { PERIOD_PRESETS } from './PeriodFilter'
import {
  setSidebarCollapsed,
  sidebarCollapsedServerSnapshot,
  sidebarCollapsedSnapshot,
  subscribeSidebarCollapsed,
} from './sidebarCollapsed'
import {
  periodMemorySnapshot,
  periodMemoryServerSnapshot,
  periodQuery,
  subscribePeriodMemory,
} from '@/features/shared/periodMemory'

/**
 * Navigation, grouped by the question each screen answers.
 *
 * Fourteen destinations in one flat list is a wall. Grouped by intent — how
 * much did we sell, did it arrive, who did it — the reader finds a screen by
 * remembering what they wanted to know rather than what it was called.
 */
interface NavItem {
  readonly href: string
  /**
   * Shown only to an account that holds `users:manage`.
   *
   * Outside the section system on purpose — see `requireUserAdmin`. The page
   * itself refuses entry regardless of what renders here.
   */
  readonly adminOnly?: boolean
  readonly label: string
  readonly icon: () => React.JSX.Element
}

const NAV_GROUPS: readonly { readonly label: string | null; readonly items: readonly NavItem[] }[] = [
  /*
    The nine sections the client asked for, in their own words, and nothing
    else. Overview, channels, products, leaderboard, employees, calls, deals
    and finance were removed on instruction — the pages are gone, not hidden,
    so nothing renders a link to a screen that no longer exists.
  */
  {
    label: null,
    items: [{ href: '/', label: t.nav.overview, icon: PulseIcon }],
  },
  {
    label: 'Tahlil',
    items: [
      { href: '/analytics/cohort', label: t.nav.cohort, icon: LayersIcon },
      { href: '/analytics/sales', label: t.nav.sales, icon: ChartIcon },
      { href: '/margin', label: t.nav.margin, icon: CoinIcon },
    ],
  },
  {
    label: 'Bajarish',
    items: [
      { href: '/confirmation', label: t.nav.confirmation, icon: CheckIcon },
      { href: '/logistics', label: t.nav.logistics, icon: TruckIcon },
      { href: '/warehouse', label: t.nav.warehouse, icon: WarehouseIcon },
    ],
  },
  {
    label: 'Jamoa',
    items: [
      { href: '/kpi', label: t.nav.kpi, icon: TargetIcon },
      { href: '/sellers', label: t.nav.sellers, icon: TrophyIcon },
      { href: '/structure', label: t.nav.structure, icon: TreeIcon },
    ],
  },
  {
    label: 'Marketing',
    items: [{ href: '/marketing', label: t.nav.marketing, icon: MegaphoneIcon }],
  },
  {
    label: null,
    items: [
      { href: '/users', label: t.nav.users, icon: PeopleIcon, adminOnly: true },
    ],
  },
]

const NAV = NAV_GROUPS.flatMap((group) => group.items)

export function Shell({
  children,
  dataSource,
  lastSyncedAt,
  periodAware = false,
}: {
  children: ReactNode
  /**
   * Whether the open page HAS a reporting window.
   *
   * False by default, and true only from PageShell. Marketing and the account
   * screen render this shell directly — marketing keeps its own period control
   * and the account screen has no dates at all — so offering the six presets
   * in the palette there wrote a window nothing on the page reads, pinned it
   * into the address and the sidebar link, and left no control anywhere to
   * clear it again.
   */
  periodAware?: boolean
  dataSource?: 'DEMO' | 'BITRIX24' | 'MANUAL'
  lastSyncedAt?: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const user = sessionUser(session?.user)

  /**
   * The reporting window, read here for the palette's "Davr" group.
   *
   * Reusing the SAME hook every page uses — not a re-implementation — is what
   * guarantees a preset chosen from the palette lands in the URL exactly the
   * way PeriodFilter's own buttons put it there: preset set, stale from/to
   * cleared, page number dropped. Shell only renders inside pages that already
   * sit under a Suspense boundary (useSearchParams demands one), so reading it
   * here costs nothing new.
   */
  const { filters, setPeriod } = useDashboardFilters()

  /**
   * The ⌘K palette. Closed means UNMOUNTED (the primitive returns null), so
   * its Escape handling cannot linger and fight PeriodFilter's popover — while
   * it IS open, its Escape is preventDefault-ed and PeriodFilter stands down.
   */
  const [paletteOpen, setPaletteOpen] = useState(false)

  /*
    What is being typed in the palette, and what the server makes of it.

    DEBOUNCED, not throttled, and only from three characters. Every keystroke
    is six indexed lookups on a one-core database; firing them per character
    would queue five requests to answer the sixth. 220ms is under the gap
    between keystrokes for anyone typing a phone number and above the noise of
    correcting one.

    `keepPreviousData` is what stops the list emptying between a term and its
    successor — without it the palette blinks to "nothing found" on every pause
    and reads as broken.
  */
  const [typed, setTyped] = useState('')
  const [lookup, setLookup] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setLookup(typed.trim()), 220)
    return () => window.clearTimeout(timer)
  }, [typed])

  const searchable = lookup.length >= 3
  const results = useQuery({
    queryKey: ['search', lookup],
    queryFn: ({ signal }) => apiGet<SearchDto>('/search', { q: lookup }, signal),
    enabled: paletteOpen && searchable,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  })

  /*
    Nav links carry the window each section was last read in.

    Read through `useSyncExternalStore` rather than in an effect: browser
    storage is exactly the kind of outside-React state it exists for, it gives
    the server a matching empty snapshot so hydration does not complain about
    every entry in the sidebar, and it re-renders the links the moment somebody
    changes a window — including in another tab.

    Without this the restore would live only in an effect on the destination
    page, which means the page renders once on the default window, fetches for
    it, and fetches again for the real one — two round trips on a database that
    has one core.
  */
  const periodMemory = useSyncExternalStore(
    subscribePeriodMemory,
    periodMemorySnapshot,
    periodMemoryServerSnapshot,
  )

  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    sidebarCollapsedSnapshot,
    sidebarCollapsedServerSnapshot,
  )

  const sectionQuery = useMemo(
    () => Object.fromEntries(NAV.map((item) => [item.href, periodQuery(item.href, periodMemory)])),
    [periodMemory],
  )

  /*
    Where a nav entry actually goes.

    THE SECTION YOU ARE ALREADY ON IS A SPECIAL CASE. Its link carries the
    window it was last LEFT in, which is not necessarily the one on screen —
    somebody who opens a shared link and then clicks the highlighted entry
    beside it would have their dates changed by a link marked "you are here".
    So the current section links to the current address, and every other one
    links to the window it was left in.

    Used by the rail, by the strip below the header on a phone, and by the
    palette — all three navigate, and a window carried by only one of them is
    the double round trip this exists to avoid, on the other two.
  */
  const search = useSearchParams()
  const hrefFor = useCallback(
    (href: string) => {
      if (!isActive(pathname, href)) return `${href}${sectionQuery[href] ?? ''}`
      const query = search.toString()
      return query ? `${pathname}?${query}` : pathname
    },
    [pathname, search, sectionQuery],
  )
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useCommandK(openPalette)

  const role = user?.role

  /*
    The viewer's granted sections, from the filters payload every page already
    fetches. Shares react-query's cache with PageShell, so this costs no extra
    request.
  */
  const viewer = useFilterOptions().data?.data.viewer
  const grantedRoutes = viewer
    ? viewer.sections
        .map((id: SectionValue) => sectionSpec(id)?.route)
        .filter((route): route is string => route !== undefined)
    : undefined

  /**
   * Hide destinations this ACCOUNT was not given.
   *
   * Presentation only — `requireSection` on each page and the permission on
   * each endpoint are what actually refuse access. Hiding a link the user
   * would only be redirected away from is a courtesy, not the boundary.
   *
   * While the viewer payload loads, the role default stands in, so the
   * sidebar does not render a full menu and then visibly shrink.
   */
  const canOpen = (item: NavItem) => {
    if (item.adminOnly) return viewer?.canManageUsers === true
    if (!role) return true
    return canSeeHref(role, grantedRoutes, item.href)
  }

  const visibleNav = NAV.filter(canOpen)

  /**
   * What the palette knows: every screen this role can see, then the six
   * period presets. The same canSee gate as the sidebar — a palette that
   * offers a route the rail hides would just be a faster way to find a 403.
   * Navigation goes through router.push, exactly like the
   * sidebar's links — through the same `hrefFor`, so a section opens on the
   * window it was left in from here too; period changes go through setPeriod,
   * exactly like the control on the open page, and land on that page since
   * setPeriod writes the window of whatever route is current. The palette adds
   * no third semantics of its own.
   *
   * Built plainly, no useMemo: the React Compiler memoizes it (a manual memo
   * here is flagged by react-hooks/preserve-manual-memoization), and twenty
   * rows would be cheap even if it did not.
   */
  const paletteGroups: readonly CommandGroup[] = [
    {
      label: t.palette.sections,
      items: visibleNav.map((item) => {
        const Icon = item.icon
        return {
          id: item.href,
          label: item.label,
          icon: <Icon />,
          onSelect: () => router.push(hrefFor(item.href)),
        }
      }),
    },
    /*
      What the server found, above the static lists.

      `prefiltered` because it has already matched — on a phone number inside
      an array, or a customer's name on an order titled something else, neither
      of which is in the label the palette would filter against.

      Ordered first: somebody who typed a phone number is looking for that
      customer, not for a section whose name happens to share three letters.
    */
    ...(results.data?.data.groups ?? []).map((group) => ({
      label: group.label,
      prefiltered: true,
      items: group.items.map((hit) => ({
        id: hit.id,
        label: hit.label,
        hint: hit.amount ? `${hit.hint} · ${formatCompactUzs(hit.amount.amount)}` : hit.hint,
        onSelect: () => router.push(hit.href),
      })),
    })),

    // Only where there ARE dates. Marketing keeps its own period control and
    // the account screen has none, so on those two the presets wrote a window
    // nothing reads and left no control anywhere to clear it again.
    ...(periodAware
      ? [
          {
            label: t.period.label,
            items: PERIOD_PRESETS.map((preset) => ({
              id: `davr-${preset}`,
              label: t.period[preset],
              // Say which window is already on screen, so re-choosing it reads
              // as the no-op it is rather than a change that did nothing.
              hint: preset === filters.preset ? t.palette.currentPeriod : undefined,
              onSelect: () => setPeriod({ preset }),
            })),
          },
        ]
      : []),
  ]

  return (
    /*
      No background here on purpose. `html` already paints `--page` plus the two
      ambient accent pools, and the film grain lives on `body::after` at z:-1 —
      an opaque fill on this wrapper was silently covering all three. The shell
      stays transparent so the atmosphere the stylesheet paints can reach the eye.
    */
    /*
      THE APPLICATION IS EXACTLY ONE SCREEN TALL, and the browser never
      scrolls it.

      It was `min-h-screen`, which stretches to the CONTENT — so a page with a
      three-thousand-pixel table made the rail three thousand pixels tall too,
      and the account row went with it to the bottom of that. Scrolling down a
      long table, the menu stayed at the top of the page and the person's own
      name appeared a screenful later, under an expanse of nothing. That is the
      "big empty space", and it was never a spacing bug: the rail was simply as
      tall as the table beside it.

      Fixed at the viewport, the rail is a screen tall whatever the page holds,
      its footer sits at its bottom edge and stays there, and the scrolling
      moves into the two places it belongs — the menu, and the content.

      `100dvh` rather than `100vh`: on a phone `vh` is the height WITHOUT the
      browser's own chrome, so a fixed-height app is taller than the window and
      the bottom of it can never be reached.
    */
    <div className="flex overflow-hidden" style={{ height: '100dvh' }}>
      <a href="#main" className="skip-link">
        Asosiy qismga oʻtish
      </a>
      {/* Sidebar: hidden below lg, where the top nav takes over. Desktop is the
          primary management experience, so it keeps the persistent rail. */}
      {/* `viewTransitionName` pins this in place across navigations: the
          browser sees the same named element in both snapshots and, with the
          animation suppressed in globals.css, leaves it alone entirely. Without
          it the sidebar crossfades along with the content and the whole screen
          appears to flicker. */}
      <aside
        className={`hidden shrink-0 border-r transition-[width] duration-200 ease-out lg:flex lg:flex-col ${
          collapsed ? 'w-16' : 'w-60'
        }`}
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          viewTransitionName: 'app-sidebar',
        }}
      >
        {/*
          THREE BANDS: identity, menu, account. The menu is the only one that
          scrolls, so on a short screen the person's own name and the way out
          never leave the screen, and on a tall one the space falls between
          the menu and the account block rather than below everything — the
          account block is the rail's floor, which is where every desktop
          application the floor already uses puts it.
        */}
        {/*
          THE FOLD TOGGLE LIVES UP HERE, beside the brand, not down by the
          account. Two reasons. It is a control on the rail itself, and the
          top corner is where every desktop application the floor uses puts
          that control — Linear, Notion, Slack. And down in the footer it was
          the third 36px button in a 240px row, which left the person's own
          name room for "Administr…". Folded, it sits under the mark, so the
          way back out is the first thing in the column.
        */}
        <div
          className={
            collapsed
              ? 'flex shrink-0 flex-col items-center gap-1.5 pt-4 pb-2'
              : 'flex h-16 shrink-0 items-center gap-3 pr-2 pl-4'
          }
        >
          <WordmarkBadge />
          {/* Removed rather than hidden: a truncated name in a 64px rail is
              three letters and an ellipsis, which reads as a rendering fault. */}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-sm font-semibold tracking-tight"
                style={{ color: 'var(--ink-primary)' }}
              >
                {t.app.name}
              </p>
              <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {t.app.subtitle}
              </p>
            </div>
          )}
          <Tooltip content={collapsed ? 'Panelni ochish' : 'Panelni yigʻish'} side="right">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!collapsed)}
              aria-label={collapsed ? 'Panelni ochish' : 'Panelni yigʻish'}
              aria-expanded={!collapsed}
              className="rail-item rail-button focusable flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <PanelIcon open={!collapsed} />
            </button>
          </Tooltip>
        </div>

        <nav
          aria-label="Asosiy menyu"
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 ${collapsed ? 'px-3' : 'px-3'}`}
        >
          {NAV_GROUPS.map((group, index) => {
            const items = group.items.filter((item) => !user || canOpen(item))
            if (items.length === 0) return null

            return (
              /*
                Keyed by POSITION, not by label. Two groups are deliberately
                unlabelled — the overview at the top and the admin block at the
                bottom — so a `label ?? 'root'` fallback gave both the same key
                and React warned about it on every page. NAV_GROUPS is a
                module-level constant that never reorders or filters, which is
                exactly the case where an index key is the correct one.
              */
              <div
                key={index}
                className={
                  // An unlabelled group that is not the first needs its own
                  // separator, or "Foydalanuvchilar" reads as the tail of
                  // MARKETING. Folded, every group gets a short rule instead
                  // of a heading — the icons alone do not show where one
                  // family of screens ends and the next begins.
                  collapsed
                    ? index > 0 ? 'mt-2 pt-2' : ''
                    : group.label === null && index > 0
                      ? 'mt-3 mb-1 border-t pt-2.5'
                      : 'mb-1'
                }
                style={
                  !collapsed && group.label === null && index > 0
                    ? { borderColor: 'var(--border)' }
                    : undefined
                }
              >
                {collapsed && index > 0 && (
                  <div
                    aria-hidden="true"
                    className="mx-auto mb-2 h-px w-5"
                    style={{ background: 'var(--border)' }}
                  />
                )}
                {group.label && !collapsed && (
                  /*
                    `.eyebrow` — the ONE positive-tracked style in the system,
                    reserved for section headers like this.
                  */
                  <p className="eyebrow px-2.5 pt-3 pb-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--ink-muted)]">
                    {group.label}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = isActive(pathname, item.href)
                    const Icon = item.icon

                    const link = (
                      <Link
                        href={hrefFor(item.href)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        className={`rail-item focusable relative flex items-center rounded-lg font-medium ${
                          collapsed
                            ? 'rail-item--folded mx-auto h-10 w-10 justify-center'
                            : 'h-9 gap-3 px-2.5 text-[13.5px]'
                        }`}
                      >
                        {active && (
                          /*
                            Chrome, not page identity. Rendered above every
                            page, so it cannot see a PageShell's --accent —
                            named as the series slot it actually is.
                          */
                          <span
                            aria-hidden="true"
                            className="absolute top-2 bottom-2 -left-3 w-0.5 rounded-full"
                            style={{ background: 'var(--series-1)' }}
                          />
                        )}
                        <span className="rail-icon" aria-hidden="true">
                          <Icon />
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    )

                    return (
                      <li key={item.href}>
                        {/*
                          A tooltip ONLY when the label is gone. Wrapping the
                          open-rail link too, with empty content, rendered an
                          empty dark pill on every hover — the "black round
                          thing" the client saw.
                        */}
                        {collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        {/*
          The account block — the rail's floor.

          Who is signed in and the way out, with the one line that says how
          fresh the numbers are above them. The fold toggle is up in the
          header — it belongs to the rail, not to the account.
        */}
        <div className="shrink-0 border-t" style={{ borderColor: 'var(--border)' }}>
          {!collapsed && <FreshnessPanel lastSyncedAt={lastSyncedAt} />}

          <div
            className={
              collapsed
                ? 'flex flex-col items-center gap-1.5 px-0 pt-2 pb-3'
                : 'flex items-center gap-1 px-3 pt-1.5 pb-3'
            }
          >
            {user && (
              <Tooltip content={collapsed ? `${user.name} · ${ROLE_LABELS[user.role]}` : ''} side="right">
                {/* The identity block is the way into the account screen — a
                    separate "settings" icon would be a second target for the
                    same thing, and this is where a reader already looks to
                    check who they are signed in as. */}
                <Link
                  href="/account"
                  aria-label="Hisob va parol"
                  className={`rail-item focusable flex items-center rounded-lg ${
                    collapsed ? 'h-10 w-10 justify-center' : 'min-w-0 flex-1 gap-2.5 px-2 py-1.5'
                  }`}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                    style={{
                      background:
                        'linear-gradient(135deg, color-mix(in oklab, var(--series-1) 30%, var(--grid)), var(--grid))',
                      color: 'var(--ink-primary)',
                      boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--series-1) 25%, transparent)',
                    }}
                    aria-hidden="true"
                  >
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  {!collapsed && (
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[13px] font-semibold"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        {user.name}
                      </span>
                      {/* The founding account is literally called
                          "Administrator" and holds the ADMIN role, so the row
                          read "Administrator · Administrator" — which says one
                          thing twice and looks like a bug. */}
                      {user.name !== ROLE_LABELS[user.role] && (
                        <span
                          className="block truncate text-[11px]"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {ROLE_LABELS[user.role]}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              </Tooltip>
            )}

            {user && (
              /* The Tooltip primitive, not a native title: an icon-only button
                 whose label arrives after a second of hovering and never on
                 focus or touch is unlabelled for most people. */
              <Tooltip content="Chiqish" side={collapsed ? 'right' : 'auto'}>
                <button
                  type="button"
                  onClick={() => {
                    void signOut().then(() => {
                      // Clear the query cache as well as the session: cached
                      // analytics from the previous user must not be readable
                      // by whoever signs in next on this browser.
                      queryClient.clear()
                      router.push('/login')
                      router.refresh()
                    })
                  }}
                  aria-label="Chiqish"
                  className="rail-item rail-button focusable flex h-9 w-9 items-center justify-center rounded-lg"
                >
                  <SignOutIcon />
                </button>
              </Tooltip>
            )}

          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="z-20 shrink-0 border-b"
          style={{
            /* Glass: a translucent surface over a real backdrop blur, so the
               ambient wash the stylesheet paints on `html` shows through the
               bar rather than being cut off by it. Saturation is raised
               because blurring alone desaturates what comes through and the
               accent bar below goes grey.

               It no longer needs `sticky`: the bar is a row of a column that
               is exactly the viewport tall, so it cannot be scrolled away from
               — the scrolling happens under it, inside `main`. */
            background: 'color-mix(in oklab, var(--surface) 72%, transparent)',
            backdropFilter: 'blur(12px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(12px) saturate(1.6)',
            borderColor: 'var(--border)',
            viewTransitionName: 'app-header',
          }}
        >
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <WordmarkBadge small />
              <span className="text-sm font-semibold">{t.app.name}</span>
            </div>

            {dataSource && <DataSourceBadge source={dataSource} />}

            <div className="ml-auto flex items-center gap-2">
              {/*
                The ⌘K chip, and now the only control up here.

                Search is the one thing on this bar that is genuinely global:
                it looks across every section at once — a phone number, a deal
                id, a customer — while the reporting window belongs to whatever
                page is open and lives on that page. A ghost button because the
                keycaps do the explaining. On a phone the label and caps fold
                away (there is no ⌘K to teach) and the chip is just a search
                button; the aria-label keeps it named either way.
              */}
              <Button
                variant="ghost"
                icon={<SearchGlyph size={14} />}
                onClick={openPalette}
                aria-label={t.palette.search}
              >
                <span className="hidden sm:inline">{t.palette.search}</span>
                <span className="hidden sm:inline-flex">
                  <Kbd keys={['mod', 'K']} />
                </span>
              </Button>
            </div>
          </div>

          {/* Mobile nav */}
          <nav
            aria-label="Mobil menyu"
            className="overflow-x-auto border-t px-3 lg:hidden"
            style={{ borderColor: 'var(--border)' }}
          >
            <ul className="flex gap-1 py-1.5">
              {visibleNav.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={hrefFor(item.href)}
                      className="block rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap"
                      style={{
                        background: active ? 'var(--grid)' : 'transparent',
                        color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                      }}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </header>

        {/*
          The name the transition animates.

          `viewTransitionName` on the element the browser should treat as its
          own layer: the sidebar and header carry theirs too and have their
          animation suppressed in globals.css, so this is the only thing that
          actually moves. Content changed; the application did not.
        */}
        {ViewTransition ? (
          <ViewTransition name="page-body">
            <main
              id="main"
              className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6 lg:py-6"
            >
              {children}
            </main>
          </ViewTransition>
        ) : (
          /*
            `min-h-0` is the load-bearing half of this pair.

            A flex child's default `min-height: auto` refuses to shrink below
            its content, so `overflow-y-auto` on its own would have nothing to
            scroll — the box would simply grow and push the column past the
            screen it is pinned to. The two together are what put the scrollbar
            on the content instead of on the window.

            `relative` is the third thing, and it was found by measurement. A
            page's screen-reader-only text is `position: absolute`, and with
            no positioned ancestor it is placed against the BODY — outside this
            box's clipping, so the document grew to wherever the last hidden
            span landed and the window could be wheeled down into nothing. Two
            hundred pixels on the sales screen. Making `main` the containing
            block keeps every absolutely-positioned thing a page renders inside
            the page.
          */
          <main
            id="main"
            className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6 lg:py-6"
          >
            {children}
          </main>
        )}
      </div>

      {/* Portalled to document.body by the primitive; mounted here so the
          shortcut, the chip and the dialog ship as one unit on every page.
          Closed is unmounted — its Escape and focus trap cannot outlive it. */}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        groups={paletteGroups}
        onQueryChange={setTyped}
        busy={searchable && (results.isFetching || lookup !== typed.trim())}
        placeholder="Telefon, ID, mijoz, mahsulot yoki boʻlim…"
      />
    </div>
  )
}

/**
 * The S mark — chrome, deliberately series-1.
 *
 * The one place the interface signs its own name, so it gets the finishing a
 * flat fill lacks: a whisper of gradient toward the light and an inset
 * hairline highlight, both mixed from tokens the themes already own. It is
 * NOT page identity and never follows --accent; the sidebar's active bar
 * shares this hue precisely because both are chrome.
 */
function WordmarkBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      className={
        small
          ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold'
          : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold'
      }
      style={{
        background:
          'linear-gradient(180deg, color-mix(in oklab, var(--series-1) 86%, var(--ink-on-series)) 0%, var(--series-1) 65%)',
        color: 'var(--ink-on-series)',
        boxShadow:
          'inset 0 1px 0 color-mix(in oklab, var(--ink-on-series) 30%, transparent), var(--shadow-card)',
      }}
      aria-hidden="true"
    >
      S
    </span>
  )
}

/**
 * How current the numbers are, stated continuously.
 *
 * A dashboard that refreshes itself has to say when it last succeeded,
 * otherwise a stalled sync and a quiet hour look identical — and the quiet
 * hour is the one people assume. The relative time ticks on its own so a
 * screen left open overnight cannot show "just now" at 6am.
 *
 * Past five minutes the dot turns amber: the worker runs every sixty seconds,
 * so five missed ticks is a fault rather than a slow one.
 */
/** Sign out — a door with an arrow leaving through it. */
function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 01-2-2V6a2 2 0 012-2h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The rail itself, as a glyph: a pane with its left column marked.
 *
 * The column is FILLED when the rail is open and hollow when it is folded, so
 * the icon shows the current state rather than the action. An icon that showed
 * the action would have to flip its arrow, and an arrow next to a pane reads
 * as "move" rather than "fold".
 */
function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="4.5"
        width="18"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M9.5 4.5v15"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {open && <rect x="3.9" y="5.4" width="4.7" height="13.2" rx="1.6" fill="currentColor" />}
    </svg>
  )
}

function FreshnessPanel({ lastSyncedAt }: { lastSyncedAt?: string | null }) {
  const fetching = useIsFetching() > 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  if (!lastSyncedAt) return null

  const ageMs = now - new Date(lastSyncedAt).getTime()
  const minutes = Math.max(0, Math.floor(ageMs / 60_000))
  const stale = minutes >= 5

  return (
    <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: stale ? 'var(--status-warning)' : 'var(--status-good)',
          // Only while a request is genuinely in flight — a permanent pulse
          // stops meaning anything within a day.
          animation: fetching ? 'pulse 1.2s ease-in-out infinite' : undefined,
        }}
      />
      {/* The exact timestamp is data, so it travels by the Tooltip primitive
          rather than a native title — visible on focus and touch, not only to
          a patient mouse. The trigger is a tab stop for the same reason. */}
      <Tooltip content={formatDateTime(lastSyncedAt)}>
        <p
          tabIndex={0}
          className="focusable tabular min-w-0 truncate rounded text-[11px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t.badge.lastSync}
          <span className="mx-1">·</span>
          {/* The word matters, not only the tint. The worker runs every
              sixty seconds, so five missed ticks is a fault — and a fault
              signalled by colour alone reaches nobody who cannot see it. */}
          <span style={{ color: stale ? 'var(--status-warning)' : 'var(--ink-secondary)' }}>
            {relativeMinutes(minutes)}
            {stale && (
              <span className="ml-1 inline-flex items-center gap-1 font-medium">
                <TriangleGlyph size={10} /> eskirgan
              </span>
            )}
          </span>
        </p>
      </Tooltip>
    </div>
  )
}

function relativeMinutes(minutes: number): string {
  if (minutes < 1) return t.badge.justNow
  if (minutes < 60) return `${minutes} ${t.badge.minutesAgo}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${t.badge.hoursAgo}`
  return `${Math.floor(hours / 24)} ${t.badge.daysAgo}`
}

/**
 * Which link is current.
 *
 * A prefix match alone makes `/` match every route, and `/analytics/sales`
 * match `/analytics/sales-forecast`. Exact-or-followed-by-a-slash is the rule
 * that gets both right.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Provenance badge.
 *
 * Reads `meta.dataSource` and nothing else, so no screen can present generated
 * numbers as if they came from the live CRM.
 */
function DataSourceBadge({ source }: { source: 'DEMO' | 'BITRIX24' | 'MANUAL' }) {
  const isDemo = source !== 'BITRIX24'

  const badge = (
    <span
      // The hint ("these numbers are generated") is worth reading, so the
      // demo badge is a tab stop and its explanation a real Tooltip — a
      // native title reaches neither keyboards nor touch. The live badge
      // explains nothing and stays out of the tab order.
      tabIndex={isDemo ? 0 : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${isDemo ? 'focusable' : ''}`}
      style={{
        background: isDemo ? 'color-mix(in oklab, var(--status-warning) 18%, transparent)' : 'var(--grid)',
        color: 'var(--ink-primary)',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: isDemo ? 'var(--status-warning)' : 'var(--status-good)' }}
      />
      {isDemo ? t.badge.demo : t.badge.live}
    </span>
  )

  return isDemo ? <Tooltip content={t.badge.demoHint}>{badge}</Tooltip> : badge
}

function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 19V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 19h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 15l4-5 3 3 4-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19a5.5 5.5 0 0111 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 6.5a3 3 0 010 5.9M17.5 19a5.5 5.5 0 00-2-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The sellers' board — a podium, at 15px.
 *
 * Three bars of unequal height rather than a trophy cup: the section ranks
 * people against each other, and a podium says "standings" where a cup says
 * "prize". It also stays legible at 15px, which a cup's handles do not.
 */
function TrophyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9.5" y="6" width="5" height="13" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="11" width="5" height="8" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="16" y="9" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  )
}

/**
 * Marketing — a megaphone, at 15px.
 *
 * Deliberately not another ring or another bar chart. `TargetIcon` (concentric
 * circles, KPI) and `SignalIcon` (four risers, Kanallar) already sit in this
 * rail, and at 15px an icon has roughly nine legible pixels across: a target
 * with one more ring, or a bar chart with one more bar, would read as a
 * mis-drawn version of the neighbour rather than as a new destination.
 *
 * So the silhouette does the work — a horn pointing right, its cone widening
 * from a semicircular cap, plus ONE emission arc. A second arc was drawn and
 * removed: nested arcs land about 1.6px apart at this size and merge into a
 * smudge. Same 24-unit viewBox, 1.7 stroke, currentColor and round joins as
 * every icon above, so it inherits the active/inactive ink like the rest.
 */
function MegaphoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 5L7.5 9.5H4.5a2.5 2.5 0 0 0 0 5h3L14 19V5z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 9a5 5 0 0 1 0 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PulseIcon() {
  // The command centre: a heartbeat line, for the one screen that reads the
  // whole business at a glance.
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12h4l2.5-6 4 13 2.5-7H21"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l8.5 4.5L12 12 3.5 7.5 12 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 12.5L12 17l8-4.5M4 17L12 21.5 20 17" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function TruckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 7.5h11v9H2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13 11h4l3 3v2.5h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="1.7" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="18" r="1.7" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 12.3l2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WarehouseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 10l9-5 9 5v10H3V10z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 20v-6h8v6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function CoinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function TreeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="16.5" width="6" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="15" y="16.5" width="6" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5v4.5M6 16.5V12h12v4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}
