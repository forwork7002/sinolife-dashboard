'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { CommandPalette, useCommandK, type CommandGroup } from '@/components/ui/CommandPalette'
import { SearchGlyph, TriangleGlyph } from '@/components/ui/Icons'
import { Kbd } from '@/components/ui/Kbd'
import { Tooltip } from '@/components/ui/Tooltip'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { sessionUser, signOut, useSession } from '@/lib/authClient'
import { formatDateTime } from '@/lib/format'
import { ROLE_LABELS, canSee } from '@/lib/roles'
import { t } from '@/lib/messages'
import { PERIOD_PRESETS } from './PeriodFilter'
import { RouteTransitions } from './RouteTransitions'

/**
 * Navigation, grouped by the question each screen answers.
 *
 * Fourteen destinations in one flat list is a wall. Grouped by intent — how
 * much did we sell, did it arrive, who did it — the reader finds a screen by
 * remembering what they wanted to know rather than what it was called.
 */
interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: () => React.JSX.Element
}

const NAV_GROUPS: readonly { readonly label: string | null; readonly items: readonly NavItem[] }[] = [
  {
    label: null,
    items: [{ href: '/', label: t.nav.overview, icon: GridIcon }],
  },
  {
    label: 'Savdo',
    items: [
      { href: '/analytics/sales', label: t.nav.sales, icon: ChartIcon },
      { href: '/analytics/channels', label: t.nav.channels, icon: SignalIcon },
      { href: '/analytics/cohort', label: t.nav.cohort, icon: LayersIcon },
      { href: '/products', label: t.nav.products, icon: BoxIcon },
      { href: '/margin', label: t.nav.margin, icon: CoinIcon },
    ],
  },
  /**
   * The second ledger, kept in its own group on purpose.
   *
   * Every other destination in this rail reads Bitrix24. This one does not —
   * it reads the client's Google Sheets plus Meta Ads, imported from their
   * published Roistat page (docs/SUPERDASHBOARD.md §11). Filing it under
   * "Savdo" beside the Bitrix24 analytics would invite the exact mistake the
   * module exists to prevent: adding the two revenue figures together. A group
   * of its own is the cheapest way to say "different system" before the reader
   * opens anything.
   */
  {
    label: 'Marketing',
    items: [{ href: '/marketing', label: t.nav.marketing, icon: MegaphoneIcon }],
  },
  {
    label: 'Bajarish',
    items: [
      { href: '/logistics', label: t.nav.logistics, icon: TruckIcon },
      { href: '/confirmation', label: t.nav.confirmation, icon: CheckIcon },
      { href: '/warehouse', label: t.nav.warehouse, icon: WarehouseIcon },
    ],
  },
  {
    label: 'Jamoa',
    items: [
      { href: '/leaderboard', label: t.nav.leaderboard, icon: TrophyIcon },
      { href: '/employees', label: t.nav.employees, icon: PeopleIcon },
      { href: '/structure', label: t.nav.structure, icon: TreeIcon },
      { href: '/calls', label: t.nav.calls, icon: PhoneIcon },
      { href: '/kpi', label: t.nav.kpi, icon: TargetIcon },
    ],
  },
  {
    label: 'Maʼlumot',
    items: [
      { href: '/deals', label: t.nav.deals, icon: ListIcon },
      { href: '/finance', label: t.nav.finance, icon: WalletIcon },
    ],
  },
]

const NAV = NAV_GROUPS.flatMap((group) => group.items)

export function Shell({
  children,
  toolbar,
  dataSource,
  lastSyncedAt,
}: {
  children: ReactNode
  toolbar?: ReactNode
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
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useCommandK(openPalette)

  const role = user?.role

  /**
   * Hide destinations the role cannot use.
   *
   * Presentation only — the server rejects any request the role is not
   * entitled to regardless of what is rendered here. Hiding a link the user
   * would only get a 403 from is a courtesy, not the boundary.
   */
  const visibleNav = NAV.filter((item) => !role || canSee(role, item.href))

  /**
   * What the palette knows: every screen this role can see, then the six
   * period presets. The same canSee gate as the sidebar — a palette that
   * offers a route the rail hides would just be a faster way to find a 403.
   * Navigation goes through router.push with the bare href, exactly like the
   * sidebar's links; period changes go through setPeriod, exactly like the
   * toolbar's buttons. The palette adds no third semantics of its own.
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
          onSelect: () => router.push(item.href),
        }
      }),
    },
    {
      label: t.period.label,
      items: PERIOD_PRESETS.map((preset) => ({
        id: `davr-${preset}`,
        label: t.period[preset],
        // Say which window is already on screen, so re-choosing it reads as
        // the no-op it is rather than a change that silently did nothing.
        hint: preset === filters.preset ? t.palette.currentPeriod : undefined,
        onSelect: () => setPeriod({ preset }),
      })),
    },
  ]

  return (
    /*
      No background here on purpose. `html` already paints `--page` plus the two
      ambient accent pools, and the film grain lives on `body::after` at z:-1 —
      an opaque fill on this wrapper was silently covering all three. The shell
      stays transparent so the atmosphere the stylesheet paints can reach the eye.
    */
    <div className="flex min-h-screen">
      <RouteTransitions />
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
        className="hidden w-56 shrink-0 border-r lg:flex lg:flex-col"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          viewTransitionName: 'app-sidebar',
        }}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <WordmarkBadge />
          <div className="min-w-0">
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
        </div>

        <nav aria-label="Asosiy menyu" className="flex-1 overflow-y-auto px-2.5 py-1">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !user || canSee(user.role, item.href))
            if (items.length === 0) return null

            return (
              <div key={group.label ?? 'root'} className="mb-2">
                {group.label && (
                  /*
                    `.eyebrow` — the ONE positive-tracked style in the system,
                    reserved for section headers like this. The utility classes
                    behind it are the same treatment spelled by hand, so the
                    label renders correctly even before globals.css defines the
                    class; once it exists, the unlayered rule wins over the
                    layered Tailwind utilities and the two cannot drift.
                  */
                  <p className="eyebrow px-2.5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-[var(--ink-muted)]">
                    {group.label}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = isActive(pathname, item.href)
                    const Icon = item.icon

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className="focusable relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium transition-colors"
                          style={{
                            /*
                              A soft series-1 wash rather than the neutral
                              --grid: the active screen shares a hue with the
                              2px bar beside it and the S mark above — one
                              chrome identity, still nowhere near strong
                              enough to read as data.
                            */
                            background: active
                              ? 'color-mix(in oklab, var(--series-1) 9%, transparent)'
                              : 'transparent',
                            color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                          }}
                        >
                          {active && (
                            /*
                              Chrome, not page identity.
                              
                              This marker is rendered above every page, so it
                              cannot see the --accent a PageShell sets on its
                              own subtree — it resolved the :root value and was
                              always series-1 regardless. Naming the series
                              slot says what it actually is instead of implying
                              a link that does not exist.
                            */
                            <span
                              aria-hidden="true"
                              className="absolute top-1.5 bottom-1.5 -left-2.5 w-0.5 rounded-full"
                              style={{ background: 'var(--series-1)' }}
                            />
                          )}
                          <Icon />
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        <FreshnessPanel lastSyncedAt={lastSyncedAt} />

        {user && (
          <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ background: 'var(--grid)', color: 'var(--ink-primary)' }}
                aria-hidden="true"
              >
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              {/* The whole identity block is the way into the account screen —
                  a separate "settings" icon would be a second target for the
                  same thing, and this is where a reader already looks to check
                  who they are signed in as. */}
              <Link
                href="/account"
                className="focusable min-w-0 flex-1 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-[var(--grid)]"
                aria-label="Hisob va parol"
              >
                <p
                  className="truncate text-xs font-medium"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {user.name}
                </p>
                <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {ROLE_LABELS[user.role]}
                </p>
              </Link>
              {/* The Tooltip primitive, not a native title: an icon-only
                  button whose label arrives after a second of hovering and
                  never on focus or touch is unlabelled for most people. */}
              <Tooltip content="Chiqish">
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
                className="focusable rounded-md p-1.5 transition-colors hover:bg-[var(--grid)]"
                style={{ color: 'var(--ink-muted)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 01-2-2V6a2 2 0 012-2h6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              </Tooltip>
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 border-b"
          style={{
            /* Glass: a translucent surface plus a real backdrop blur, so the
               content scrolling underneath reads as behind rather than as
               clipped. Saturation is raised because blurring alone desaturates
               what shows through and the accent bar below goes grey. */
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
                The ⌘K chip. A ghost button, because it must sit beside the
                period control without competing with it — the keycaps do the
                explaining. On a phone the label and caps fold away (there is
                no ⌘K to teach) and the chip is just a search button; the
                aria-label keeps it named either way.
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
              {toolbar}
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
                      href={item.href}
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
        <main
          id="main"
          className="flex-1 px-4 py-5 lg:px-6 lg:py-6"
          style={{ viewTransitionName: 'page-body' }}
        >
          {children}
        </main>
      </div>

      {/* Portalled to document.body by the primitive; mounted here so the
          shortcut, the chip and the dialog ship as one unit on every page.
          Closed is unmounted — its Escape and focus trap cannot outlive it. */}
      <CommandPalette open={paletteOpen} onClose={closePalette} groups={paletteGroups} />
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
    <div className="border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-1.5">
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
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {t.badge.lastSync}
        </p>
      </div>
      {/* The word matters, not only the tint. The worker runs every sixty
          seconds, so five missed ticks is a fault — and a fault signalled by
          colour alone reaches nobody who cannot see the colour. */}
      {/* The exact timestamp is data, so it travels by the Tooltip primitive
          rather than a native title — visible on focus and touch, not only to
          a patient mouse. The trigger is a tab stop for the same reason. */}
      <Tooltip content={formatDateTime(lastSyncedAt)}>
        <p
          tabIndex={0}
          className="focusable tabular rounded text-[11px]"
          style={{ color: stale ? 'var(--status-warning)' : 'var(--ink-secondary)' }}
        >
          {relativeMinutes(minutes)}
          {/* A drawn glyph as well as the word, matching StatusChip's set —
              and NO aria-live: this panel re-renders every fifteen seconds,
              so a live region would announce a ticking clock forever. */}
          {stale && (
            <span className="ml-1 inline-flex items-center gap-1 font-medium">
              <TriangleGlyph size={10} /> eskirgan
            </span>
          )}
        </p>
      </Tooltip>
    </div>
  )
}

/** "hozir" / "3 daqiqa oldin" / "2 soat oldin". */
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

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
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

function TrophyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4h10v5a5 5 0 01-10 0V4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7 6H4.5v1A3.5 3.5 0 007 10.4M17 6h2.5v1a3.5 3.5 0 01-2.5 3.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 14v3M9 20h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3 8l9 5 9-5M12 13v8" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="14.5" r="1.2" fill="currentColor" />
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

function SignalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 18v-4M9.5 18v-8M14 18v-6M18.5 18V6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

function PhoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3.5h2.5l1.4 3.6-1.9 1.3a11 11 0 005.6 5.6l1.3-1.9 3.6 1.4V16c0 1.9-1.6 3.3-3.4 3A15.5 15.5 0 014 6.9C3.7 5.1 5.1 3.5 7 3.5z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}
