'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
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
  /** Which ROP group the confirmation queue is narrowed to. */
  readonly rop?: string
  readonly q?: string
  readonly page: number
  readonly pageSize: number
  readonly sort: string
  readonly order: 'asc' | 'desc'
}

const DEFAULTS: DashboardFilters = {
  preset: 'this_month',
  employeeIds: [],
  departmentIds: [],
  stageIds: [],
  productIds: [],
  sourceIds: [],
  outcomes: [],
  page: 1,
  pageSize: 25,
  sort: 'createdAtSource',
  order: 'desc',
}

function list(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : []
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

export function useDashboardFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

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
      rop: params.get('rop') ?? undefined,
      q: params.get('q') ?? undefined,
      page: counted(params.get('page'), DEFAULTS.page, 10_000),
      pageSize: counted(params.get('pageSize'), DEFAULTS.pageSize, 200),
      sort: params.get('sort') ?? DEFAULTS.sort,
      order: params.get('order') === 'asc' ? 'asc' : DEFAULTS.order,
    }),
    [params],
  )

  const update = useCallback(
    (patch: Partial<DashboardFilters>) => {
      const next = new URLSearchParams(params.toString())

      for (const [key, value] of Object.entries(patch)) {
        const isEmpty =
          value === undefined ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)

        if (isEmpty) next.delete(key)
        else next.set(key, Array.isArray(value) ? value.join(',') : String(value))
      }

      // Any filter change invalidates the current page number — staying on
      // page 7 of a result set that now has two pages shows an empty table.
      if (!('page' in patch)) next.delete('page')

      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
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
      // would also store the default, and this section would then be pinned to
      // whatever it happened to open on the first time.
      rememberPeriod(pathname, selection)
      update({
        preset: selection.preset,
        from: selection.preset === 'custom' ? selection.from : undefined,
        to: selection.preset === 'custom' ? selection.to : undefined,
      })
    },
    [pathname, update],
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
    for (const key of ['preset', 'from', 'to'] as const) {
      const value = params.get(key)
      if (value !== null) kept.set(key, value)
    }
    const query = kept.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [params, pathname, router])

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
    if (filters.rop) out.rop = filters.rop
    // Only when it is not the default: every other screen's requests stay
    // byte-identical, so their react-query caches are untouched by this.
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
    (filters.rop ? 1 : 0) +
    (filters.q ? 1 : 0)

  return { filters, update, setPeriod, reset, apiParams, activeCount }
}

/**
 * Put this section's remembered window back when the address bar carries none.
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
export function useRestoreSectionPeriod(enabled = true): void {
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

    const stored = rememberedPeriod(pathname)
    if (!stored) return

    restored.current = pathname

    const next = new URLSearchParams({ preset: stored.preset })
    if (stored.preset === 'custom' && stored.from && stored.to) {
      next.set('from', stored.from)
      next.set('to', stored.to)
    }

    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [bare, enabled, pathname, router])
}
