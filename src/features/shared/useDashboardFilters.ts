'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { PeriodPreset, PeriodSelection } from '@/components/layout/PeriodFilter'

/**
 * Dashboard filter state, held in the URL.
 *
 * The URL is the single source of truth rather than component state, which
 * buys three things a `useState` cannot: a filtered view is a shareable link,
 * the back button steps through filter changes, and a page refresh keeps the
 * view. It also means the period survives navigation between pages, so moving
 * from Overview to Deals does not silently reset the reporting window.
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
  page: 1,
  pageSize: 25,
  sort: 'createdAtSource',
  order: 'desc',
}

function list(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : []
}

export function useDashboardFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const filters = useMemo<DashboardFilters>(
    () => ({
      preset: (params.get('preset') as PeriodPreset) ?? DEFAULTS.preset,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      employeeIds: list(params.get('employeeIds')),
      departmentIds: list(params.get('departmentIds')),
      stageIds: list(params.get('stageIds')),
      productIds: list(params.get('productIds')),
      sourceIds: list(params.get('sourceIds')),
      status: (params.get('status') as DashboardFilters['status']) ?? undefined,
      q: params.get('q') ?? undefined,
      page: Number(params.get('page') ?? DEFAULTS.page),
      pageSize: Number(params.get('pageSize') ?? DEFAULTS.pageSize),
      sort: params.get('sort') ?? DEFAULTS.sort,
      order: (params.get('order') as 'asc' | 'desc') ?? DEFAULTS.order,
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
      update({
        preset: selection.preset,
        from: selection.preset === 'custom' ? selection.from : undefined,
        to: selection.preset === 'custom' ? selection.to : undefined,
      })
    },
    [update],
  )

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

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
    (filters.q ? 1 : 0)

  return { filters, update, setPeriod, reset, apiParams, activeCount }
}
