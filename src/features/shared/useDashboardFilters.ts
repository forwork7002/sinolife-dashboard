'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { rememberPeriod, rememberedPeriod } from './periodMemory'

import { PERIOD_PRESETS, type PeriodPreset, type PeriodSelection } from '@/components/layout/PeriodFilter'
import { CONFIRMATION_OUTCOMES, type ConfirmationOutcome } from '@/lib/api'

/**
 * Dashboard filter state, held in the URL.
 *
 * The URL is the single source of truth rather than component state, which
 * buys three things a `useState` cannot: a filtered view is a shareable link,
 * the back button steps through filter changes, and a page refresh keeps the
 * view.
 *
 * THE REPORTING WINDOW IS PER SECTION, and remembered. Each screen is read in
 * its own window — the confirmation queue for today, the sales chart for the
 * month — so the window lives in the URL of the page it belongs to and is
 * kept, per browser, against that page's route. Arriving without one in the
 * address bar restores the last one chosen here; arriving WITH one honours it,
 * so a link somebody pastes into Telegram still opens on the dates it was
 * copied on. See `periodMemory`.
 */

export interface DashboardFilters {
  readonly preset: PeriodPreset
  /** `YYYY-MM-DD`. Carried only when the preset is 'custom'. */
  readonly from?: string
  readonly to?: string
  readonly employeeIds: readonly string[]
  readonly departmentIds: readonly string[]
  readonly stageIds: readonly string[]
  readonly productIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly status?: 'OPEN' | 'WON' | 'LOST'
  /**
   * Which of the five confirmation states the queue is narrowed to.
   *
   * A LIST: the floor reads these in combinations, so more than one can be
   * selected at once. Empty means all of them, which is why it is an array
   * with a default rather than an optional value.
   *
   * Page-specific, like `status` and `sort` beside it: the hook holds the
   * whole dashboard's URL vocabulary in one place so a filter survives a
   * refresh and a shared link, wherever it is read.
   */
  readonly outcomes: readonly ConfirmationOutcome[]
  /**
   * Which ROP groups the confirmation queue is narrowed to.
   *
   * A LIST SINCE 2026-09-09, when the control left the toolbar for the РОП
   * column's own header — the client asked for «exceldagi filtrga oʻxshab
   * filtr», and an AutoFilter is a set of checkboxes. Comparing two groups
   * against each other used to be a page load each.
   *
   * The old single `?rop=` is still READ, below, and folded into this. Links
   * carrying it sit in Telegram and in browser histories, and the rule on this
   * dashboard is that a link opens on what it was copied from. It is not
   * written back out, so an address settles on the new spelling after the first
   * interaction.
   */
  readonly rops: readonly string[]
  /** Which customer regions the queue is narrowed to. `(Region yoʻq)` is one. */
  readonly regions: readonly string[]
  /**
   * The СУММА column's range, in whole soʻm — the figure the column prints.
   *
   * Two independent bounds, because «everything over a million» is the common
   * ask and a half-open range is not an edge case. Undefined is «no bound»,
   * which is a different statement from zero.
   */
  readonly amountMin?: number
  readonly amountMax?: number
  /**
   * Which QUESTION the confirmation board answers — not which rows it keeps.
   *
   * 'window' reads the reporting period: what arrived in the queue during it,
   * and where each of those orders stands. 'backlog' ignores the period and
   * lists what is waiting right now, whenever it arrived — the one question a
   * windowed board cannot answer, because the oldest unworked order on this
   * portal predates every preset.
   *
   * It lives in the URL like every filter beside it so the header bell can
   * link straight to the set it counts, and so a link somebody pastes into
   * Telegram opens on the view it was copied from. It is deliberately NOT in
   * `activeCount`: the "Filtrlarni tozalash (3)" button counts what it will
   * clear, and this is not something clearing filters may take away.
   */
  readonly queue: 'window' | 'backlog'
  readonly q?: string
  /**
   * Which rendering of the org chart is on screen — the chart or the table.
   *
   * In the URL, and not in component state, for the reason every other view
   * decision on this dashboard is: a link somebody pastes into Telegram has to
   * open on what was copied. It is not a FILTER, so it is not in `apiParams`
   * (both renderings read the same answer, and sending it would split the
   * query cache in two for nothing) and not in `activeCount`; `reset()` keeps
   * it for the same reason it keeps `queue`.
   */
  readonly view: StructureView
  /**
   * Which department's panel is open on the org chart.
   *
   * Also in the URL: «this is the team, look» is a link somebody sends. Cleared
   * by `reset()`, because unlike `view` it is a selection rather than a mode —
   * nothing is lost by closing a panel that can be reopened with one click.
   */
  readonly dep?: string
  readonly page: number
  readonly pageSize: number
  readonly sort: string
  readonly order: 'asc' | 'desc'
}

/**
 * The two ways the company structure can be drawn.
 *
 * 'chart' is the org chart the portal draws — cards on a canvas, which is what
 * a reader means by "who works under whom". 'list' is the indented table this
 * screen has always had, kept because it is the only one that shows every
 * column at once and the only one that prints.
 */
export const STRUCTURE_VIEWS = ['chart', 'list'] as const
export type StructureView = (typeof STRUCTURE_VIEWS)[number]

const DEFAULTS: DashboardFilters = {
  /*
    BUGUN, not this month.

    Two reasons. The dashboard is read to answer "what is happening today" far
    more often than anything else, so the window somebody lands on should be
    the one they were going to pick. And "Shu oy" as the default made its own
    button look broken: it was already lit on every fresh page, so pressing it
    wrote the value that was already there and nothing on screen moved.
  */
  preset: 'today',
  employeeIds: [],
  departmentIds: [],
  stageIds: [],
  productIds: [],
  sourceIds: [],
  outcomes: [],
  rops: [],
  regions: [],
  queue: 'window',
  view: 'chart',
  page: 1,
  pageSize: 25,
  sort: 'createdAtSource',
  order: 'desc',
}

function list(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : []
}

/**
 * A money bound off the address bar, or nothing at all.
 *
 * NEGATIVES AND NONSENSE BECOME `undefined`, NOT ZERO. The API rejects a
 * negative amount, and a rejected parameter is a 400 on the whole page with a
 * filter chip nobody can clear — the same failure `resolvePresetParam`
 * documents. Dropping the bound leaves the rest of the selection working,
 * which is what a reader following a mistyped link wants.
 *
 * Zero itself SURVIVES: «up to 0 soʻm» is how a reader finds the orders
 * somebody saved without a price on them.
 */
function positive(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * A preset the application actually has.
 *
 * The URL is user-editable and arrives from links pasted between phones, so
 * `?preset=` is not a value this hook may trust. It used to be cast straight to
 * `PeriodPreset`: a typo, a truncated link or a preset removed in a later
 * release reached the API, which rejected it, and every card on the page went
 * to an error state while the control lit no button — leaving nothing on
 * screen to click that would put it right.
 *
 * An unreadable window falls back to the default, which is the one behaviour
 * that leaves the reader with a working page and a control they can steer.
 * 'custom' is only honoured with both bounds, for the same reason: the API
 * rejects it without them.
 */
/**
 * A bounded whole number, or the default.
 *
 * Same reasoning as `resolvePresetParam`: the address bar is not a value this
 * hook may trust. `Number('abc')` is NaN and `?page=-3` is a negative offset —
 * both used to reach the API, which rejected them, and every card on the page
 * went to an error state with nothing on screen able to put it right. The
 * ceilings match the server's own (`paginationQuerySchema`,
 * `confirmationOrdersQuerySchema`) so a value this accepts is never one the
 * API refuses.
 */
function counted(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback
  return parsed
}

export function resolvePresetParam(
  value: string | null,
  from: string | null,
  to: string | null,
): PeriodPreset {
  if (value === 'custom') return from && to ? 'custom' : DEFAULTS.preset
  return (PERIOD_PRESETS as readonly string[]).includes(value ?? '')
    ? (value as PeriodPreset)
    : DEFAULTS.preset
}

/**
 * The routes whose address is written WITHOUT asking the server for a new one.
 *
 * WHAT `router.replace` COSTS ON A FILTER CHANGE, measured on 2026-09-10 with
 * a warm dev server on localhost and one row in the table:
 *
 *     click a state tile        t+0
 *     RSC request goes out      t+45ms
 *     the URL commits, the      t+212ms   ← the tile lights up only HERE
 *       page re-renders
 *     the API request starts    t+521ms
 *
 * Half a second of nothing, on a loopback. Every screen here is a client
 * component that reads its filters out of `useSearchParams` and fetches its own
 * data; the server page above it does `requireSection` and renders that
 * component and NOTHING ELSE reads the query string. So the payload that round
 * trip fetches is byte-for-byte the one already on screen — it is a network
 * round trip, a session lookup and a full re-render bought to learn nothing,
 * and until it lands the page cannot even show that the click registered.
 *
 * `window.history.replaceState` is Next's own answer to this: the docs are
 * explicit that push/replaceState "integrate into the Next.js Router, allowing
 * you to sync with usePathname and useSearchParams"
 * (01-getting-started/04-linking-and-navigating.md). The address changes, the
 * hook re-reads it in the same tick, the back button still steps through the
 * entries — and no server is asked anything.
 *
 * A SET AND NOT A FLAG, because two hooks have to agree. This page's controls
 * call `update` on their own instance of this hook while the search box, the
 * period chips and «Filtrlarni tozalash» call it on PageShell's — and one of
 * them writing the address shallowly while the other made the browser fetch a
 * route would give one screen two speeds. Keying on the route is what keeps
 * every control on it the same.
 *
 * TO ADD A ROUTE HERE, check the one condition: nothing on the server side of
 * it may read `searchParams`. The day a page does — a server-rendered table, an
 * OG image built from the window — its address has to be navigated to properly
 * or the server keeps answering the previous question.
 */
const SHALLOW_ROUTES: ReadonlySet<string> = new Set(['/confirmation'])

export function useDashboardFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const shallow = SHALLOW_ROUTES.has(pathname)

  const filters = useMemo<DashboardFilters>(
    () => ({
      preset: resolvePresetParam(params.get('preset'), params.get('from'), params.get('to')),
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      employeeIds: list(params.get('employeeIds')),
      departmentIds: list(params.get('departmentIds')),
      stageIds: list(params.get('stageIds')),
      productIds: list(params.get('productIds')),
      sourceIds: list(params.get('sourceIds')),
      status: (params.get('status') as DashboardFilters['status']) ?? undefined,
      /*
        Only states this application has. An unknown one is a 400 from the API
        and an empty screen with a filter chip nobody can clear — see
        `resolvePresetParam`. Dropping it leaves the rest of the selection
        working, which is what a reader following a slightly stale link wants.
      */
      outcomes: list(params.get('outcomes')).filter((value): value is ConfirmationOutcome =>
        (CONFIRMATION_OUTCOMES as readonly string[]).includes(value),
      ),
      /*
        The old single `?rop=` folded in, not honoured separately. `Set`
        because a link can legitimately carry both spellings — the API unions
        them too, at the one other place they meet.
      */
      rops: [...new Set([...list(params.get('rops')), ...list(params.get('rop'))])],
      regions: list(params.get('regions')),
      amountMin: positive(params.get('amountMin')),
      amountMax: positive(params.get('amountMax')),
      /*
        One value is honoured, everything else is the default — same reasoning
        as `resolvePresetParam` above. An unknown mode reaching the API is a
        400 on the whole page, and the only mode that is worth typing by hand
        is the one the bell links to.
      */
      queue: params.get('queue') === 'backlog' ? 'backlog' : DEFAULTS.queue,
      q: params.get('q') ?? undefined,
      // Same rule as `queue` above: a name this application has, or the
      // default. An unrecognised one used to be a blank region of page with
      // no control on screen able to put it right.
      view: STRUCTURE_VIEWS.find((mode) => mode === params.get('view')) ?? DEFAULTS.view,
      dep: params.get('dep') ?? undefined,
      page: counted(params.get('page'), DEFAULTS.page, 10_000),
      pageSize: counted(params.get('pageSize'), DEFAULTS.pageSize, 200),
      sort: params.get('sort') ?? DEFAULTS.sort,
      order: params.get('order') === 'asc' ? 'asc' : DEFAULTS.order,
    }),
    [params],
  )

  /**
   * Write an address, and let the route decide whether the server hears about it.
   *
   * See `SHALLOW_ROUTES` for the measurement that put this here. `replaceState`
   * and not `pushState` on both paths, so the two behave identically in the
   * history stack: a filter change has never been a step the back button walks
   * through on this dashboard, and making it one on a single route would mean
   * pressing Back eleven times to leave a board somebody had been ticking
   * checkboxes on.
   */
  const write = useCallback(
    (href: string) => {
      if (shallow) window.history.replaceState(null, '', href)
      else router.replace(href, { scroll: false })
    },
    [router, shallow],
  )

  /**
   * The address as it stands RIGHT NOW, not as this render saw it.
   *
   * THE LOST UPDATE THIS FIXES. `update` used to build on the `params` its
   * closure captured, and two clicks inside one render — «Кутилмоқда» then
   * «Тасдиқланди», 60ms apart, which is ordinary human speed on a band of six
   * tiles — both built on the address BEFORE either of them. The second
   * overwrote the first and the URL settled on `?outcomes=CONFIRMED`, so
   * exactly the "pick 🟡 then ❌ and you get both" the tiles document was the
   * one thing they could not do. Ticking two boxes in the РОП or РЕГИОН list
   * lost the first the same way.
   *
   * On a shallow route the address bar is the truth and it is already updated
   * by the time the second handler runs, so reading it is what makes the
   * accumulation reliable rather than a matter of whether React re-rendered in
   * between. Elsewhere `params` is still the only address there is — a
   * `router.replace` in flight has not changed `window.location` yet — so
   * nothing changes for those routes.
   */
  const address = useCallback(
    () => new URLSearchParams(shallow ? window.location.search : params.toString()),
    [params, shallow],
  )

  const update = useCallback(
    (patch: Partial<DashboardFilters>) => {
      const next = address()

      for (const [key, value] of Object.entries(patch)) {
        const isEmpty =
          value === undefined ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)

        if (isEmpty) next.delete(key)
        else next.set(key, Array.isArray(value) ? value.join(',') : String(value))
      }

      /*
        WRITING `rops` RETIRES THE OLD `rop`, and it has to happen here.

        The parser folds a legacy `?rop=Sevinch` INTO `rops`, so the control
        shows it selected — but the serializer only ever writes `rops`, and
        `update` deletes a key whose value is empty. Without this line,
        unticking the last box deleted `rops` and left `rop=Sevinch` standing:
        the filter would clear on screen and come straight back on the next
        read, with nothing on the page able to put it right. Deleting it
        whenever the new key is written is what makes the address settle on one
        spelling after the first interaction.
      */
      if ('rops' in patch) next.delete('rop')

      // Any filter change invalidates the current page number — staying on
      // page 7 of a result set that now has two pages shows an empty table.
      if (!('page' in patch)) next.delete('page')

      write(`${pathname}?${next.toString()}`)
    },
    [address, pathname, write],
  )

  /**
   * Change the reporting window.
   *
   * A preset and an explicit range are mutually exclusive, so switching to a
   * preset clears the bounds. Leaving a stale `from`/`to` in the URL would
   * make a shared link resolve differently from the page that produced it.
   */
  const setPeriod = useCallback(
    (selection: PeriodSelection) => {
      // Remembered only when a PERSON picks one. Writing it on every render
      // would store the default too, and the dashboard would then be pinned to
      // whatever window it happened to open on the first time.
      rememberPeriod(selection)
      update({
        preset: selection.preset,
        from: selection.preset === 'custom' ? selection.from : undefined,
        to: selection.preset === 'custom' ? selection.to : undefined,
      })
    },
    // No `pathname`: the window is the dashboard's, not this route's.
    [update],
  )

  /**
   * Clear the FILTERS, and only the filters.
   *
   * The button counts what it will clear — "Filtrlarni tozalash (3)" — and the
   * reporting window has never been in that count. Wiping the dates too made
   * the number a lie and threw away a choice the person had not asked to undo.
   */
  const reset = useCallback(() => {
    const kept = new URLSearchParams()
    /*
      `queue` is kept for the same reason the window is: it is not a filter.
      It chooses WHICH BOARD is on screen, so dropping it here would answer
      "clear the filters" by silently swapping the backlog somebody opened
      from the bell for a board dated by today — the rows would change, the
      count would change, and the button that did it said it was only
      clearing filters.
    */
    // The live address, for the reason `address()` states above: on a shallow
    // route a selection made a moment ago is in `window.location` and not yet
    // in this closure's `params`, and clearing filters must not put one back.
    const current = address()
    for (const key of ['preset', 'from', 'to', 'queue', 'view'] as const) {
      const value = current.get(key)
      if (value !== null) kept.set(key, value)
    }
    const query = kept.toString()
    write(query ? `${pathname}?${query}` : pathname)
  }, [address, pathname, write])

  /** Query-string params for the API, omitting empties. */
  const apiParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: filters.preset }
    if (filters.preset === 'custom' && filters.from && filters.to) {
      out.from = filters.from
      out.to = filters.to
    }
    if (filters.employeeIds.length) out.employeeIds = filters.employeeIds.join(',')
    if (filters.departmentIds.length) out.departmentIds = filters.departmentIds.join(',')
    if (filters.stageIds.length) out.stageIds = filters.stageIds.join(',')
    if (filters.productIds.length) out.productIds = filters.productIds.join(',')
    if (filters.sourceIds.length) out.sourceIds = filters.sourceIds.join(',')
    if (filters.status) out.status = filters.status
    if (filters.outcomes.length) out.outcomes = filters.outcomes.join(',')
    if (filters.rops.length) out.rops = filters.rops.join(',')
    if (filters.regions.length) out.regions = filters.regions.join(',')
    // `!== undefined`, never a truthiness test: a bound of exactly 0 is a
    // reader asking for the free orders, and `if (0)` would drop it silently.
    if (filters.amountMin !== undefined) out.amountMin = String(filters.amountMin)
    if (filters.amountMax !== undefined) out.amountMax = String(filters.amountMax)
    // Only when it is not the default: every other screen's requests stay
    // byte-identical, so their react-query caches are untouched by this.
    if (filters.queue === 'backlog') out.queue = filters.queue
    if (filters.q) out.q = filters.q
    return out
  }, [filters])

  const activeCount =
    filters.employeeIds.length +
    filters.departmentIds.length +
    filters.stageIds.length +
    filters.productIds.length +
    filters.sourceIds.length +
    (filters.status ? 1 : 0) +
    filters.outcomes.length +
    filters.rops.length +
    filters.regions.length +
    // The range counts ONCE however many of its two ends are set: the reader
    // clears one control, so «Filtrlarni tozalash (3)» must promise one thing.
    (filters.amountMin !== undefined || filters.amountMax !== undefined ? 1 : 0) +
    (filters.q ? 1 : 0)

  return { filters, update, setPeriod, reset, apiParams, activeCount }
}

/**
 * Put the remembered window back when the address bar carries none.
 *
 * CALLED ONCE PER PAGE, from PageShell, and deliberately not from
 * `useDashboardFilters` — a dozen components call that hook and each instance
 * would run this effect and fire its own `router.replace` for the same
 * navigation.
 *
 * `replace`, never `push`: restoring is not a navigation anybody made, and a
 * back button that stepped through it would appear stuck.
 *
 * It only ever fires on an address with NOTHING in it, so there is nothing to
 * carry forward and nothing — a page number least of all — to drop.
 */
export function useRestoreRememberedPeriod(enabled = true): void {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  /*
    A BARE address, not merely one without dates.

    "No preset" and "this_month" look identical in a URL, so a link somebody
    copied off a rendered page — /confirmation?rop=Sevinch, reading this month
    — would arrive at the recipient with their own remembered window applied to
    somebody else's filter, and the two would compare different numbers under
    the same link. If the address says anything at all, it is honoured whole.
  */
  const bare = params.toString() === ''
  const restored = useRef<string | null>(null)

  useEffect(() => {
    // A page with no reporting window has nothing to restore into.
    if (!enabled) return

    /*
      The guard tracks a restore IN FLIGHT, not a route already visited.

      Setting it before this check meant a section that had once been opened
      with dates in the URL would never restore afterwards: arriving at
      /confirmation?preset=today marked the route done, and arriving at bare
      /confirmation later — from the mobile nav, or the palette — found the
      guard already closed and left the window on the default.
    */
    if (!bare) {
      restored.current = null
      return
    }
    if (restored.current === pathname) return

    const stored = rememberedPeriod()
    if (!stored) return

    restored.current = pathname

    const next = new URLSearchParams({ preset: stored.preset })
    if (stored.preset === 'custom' && stored.from && stored.to) {
      next.set('from', stored.from)
      next.set('to', stored.to)
    }

    // The same door every other address change on this route goes through —
    // see `SHALLOW_ROUTES`. A restore is the first thing that happens on a
    // bare arrival, so paying an RSC round trip for it delays the board's
    // first request by the whole of that trip.
    const href = `${pathname}?${next.toString()}`
    if (SHALLOW_ROUTES.has(pathname)) window.history.replaceState(null, '', href)
    else router.replace(href, { scroll: false })
  }, [bare, enabled, pathname, router])
}

/**
 * Whether the address on screen is about to be replaced by the remembered
 * window — so a page can hold its first request until it knows which window it
 * is for.
 *
 * THE WASTED QUERY THIS EXISTS TO STOP. `useRestoreRememberedPeriod` runs in an
 * EFFECT, which is one commit too late: the first render has already happened
 * with the default window, so a page fires a full request for «Bugun», the
 * address is then replaced with the remembered «Shu oy», and a second request
 * goes out for the window the reader actually wanted. Reproduced at the hook
 * level on 2026-09-10 — a bare `/confirmation` with a remembered month asks
 * `{"preset":"today"}` and then `{"preset":"this_month"}`, two react-query keys,
 * two fetches.
 *
 * ON THIS BOARD THAT FIRST FETCH IS THE EXPENSIVE ONE: a whole-cohort CTE plus
 * a ROP breakdown, seconds of work on production, thrown away before anything
 * is drawn with it. TanStack cancels the browser's request when the key
 * changes, which is precisely what makes it invisible — the tab shows a
 * cancelled request and the database still does every second of the work.
 *
 * AND IT IS NOT A RARE PATH. `/` resolves the account's first section and
 * `redirect`s to its route with NO query string, so an operator whose first
 * section is Тасдиклаш lands on a bare address every time they sign in. The
 * sidebar avoids it (`Shell`'s `hrefFor` carries the window on every link, for
 * this same reason) — bookmarks, the logo and the post-login redirect do not.
 *
 * IT ANSWERS ON THE FIRST RENDER, WHICH IS THE ONLY RENDER THAT MATTERS. A
 * query fires from a mount effect, so a gate that only closed a tick later
 * would close after the request it exists to prevent. Both halves of the answer
 * are therefore read during render: whether the address is bare, which is a
 * pure reading of the query string, and whether a window is stored, which is
 * one synchronous look at `localStorage` in a `useState` initialiser — run
 * once, at mount, exactly when the decision is made.
 *
 * AN EFFECT WOULD BE THE WRONG SHAPE and eslint says so
 * (`react-hooks/set-state-in-effect`): setting state from an effect body to
 * announce something that was already knowable during the render is a
 * cascading render, and here it is also a render too late.
 *
 * NOTHING HYDRATES DIFFERENTLY BECAUSE OF IT. The server cannot read storage,
 * so it renders as though there were nothing to restore — but the only thing
 * this value changes is whether a fetch is issued, and a page whose query has
 * no data yet draws its loading state either way. The markup is identical in
 * both worlds; what differs is a request that the server was never going to
 * make.
 *
 * It cannot strand a page: it is false unless the address is bare, so every
 * arrival that carries a window — which is every link on this dashboard —
 * proceeds untouched, and on a bare one it agrees with
 * `useRestoreRememberedPeriod` because both decide with the same
 * `rememberedPeriod()`.
 *
 * It is a decision and not the restore itself, deliberately: the restore has to
 * happen exactly once per page (see the hook above) while this may be asked by
 * anybody who is about to fetch something.
 */
export function useAwaitingRememberedPeriod(enabled = true): boolean {
  const params = useSearchParams()
  const bare = params.toString() === ''
  const [hasRememberedWindow] = useState(() => rememberedPeriod() !== null)

  return enabled && bare && hasRememberedWindow
}
