'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { PeriodFilter } from '@/components/layout/PeriodFilter'
import { Shell } from '@/components/layout/Shell'
import { MultiSelect, SearchInput } from '@/components/ui/Controls'
import { apiGet, type ResponseMeta } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { t } from '@/lib/messages'
import { useDashboardFilters } from './useDashboardFilters'

export interface FilterOptions {
  readonly employees: readonly { id: string; fullName: string }[]
  readonly departments: readonly { id: string; name: string }[]
  readonly products: readonly { id: string; name: string }[]
  readonly sources: readonly { id: string; name: string }[]
  readonly stages: readonly { id: string; name: string }[]
  readonly lastSyncedAt: string | null
}

/**
 * Filter options, fetched once and shared by every page.
 *
 * Cached for the session: employees, products and stages change on sync, not
 * between page views, so refetching them on every navigation would be a
 * round trip for data that has not moved.
 */
export function useFilterOptions() {
  return useQuery({
    queryKey: ['filters'],
    queryFn: ({ signal }) => apiGet<FilterOptions>('/meta/filters', {}, signal),
    staleTime: 5 * 60_000,
  })
}

export interface FilterToggles {
  readonly employees?: boolean
  readonly departments?: boolean
  readonly stages?: boolean
  readonly products?: boolean
  readonly sources?: boolean
  readonly search?: boolean
}

/**
 * Standard page frame: nav, period control, title, filter row.
 *
 * Every page shares it so the period control sits in the same place, the demo
 * badge is always visible, and the reporting window carries across navigation.
 */
export function PageShell({
  title,
  description,
  meta,
  filters: enabled = {},
  accent,
  actions,
  children,
}: {
  title: string
  description?: string
  meta?: ResponseMeta
  filters?: FilterToggles
  /**
   * Page identity, as a CSS colour.
   *
   * Sets `--accent` for the subtree, which the rule under the title, the
   * active nav marker and any meter set to `tone="accent"` read from. It is
   * never used by a mark that encodes a value — series colour has to stay
   * stable across pages or the same bar means two things in two places.
   */
  accent?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { filters, update, setPeriod, reset, activeCount } = useDashboardFilters()
  const options = useFilterOptions()
  const data = options.data?.data

  const anyFilter =
    enabled.employees || enabled.departments || enabled.stages || enabled.products ||
    enabled.sources || enabled.search

  return (
    <Shell
      dataSource={meta?.dataSource ?? options.data?.meta.dataSource}
      lastSyncedAt={data?.lastSyncedAt ?? null}
      toolbar={
        <PeriodFilter
          value={filters.preset}
          from={filters.from}
          to={filters.to}
          onChange={setPeriod}
        />
      }
    >
      <div
        className="mx-auto max-w-[1400px] space-y-4"
        style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {accent && <div className="accent-rule mb-2.5" aria-hidden="true" />}
            <h1
              className="text-xl font-semibold tracking-tight"
              style={{ color: 'var(--ink-primary)' }}
            >
              {title}
            </h1>
            {(description || meta?.period) && (
              <p className="mt-1 max-w-2xl text-xs" style={{ color: 'var(--ink-muted)' }}>
                {description}
                {description && meta?.period && <span className="mx-1.5">·</span>}
                {meta?.period && (
                  <>
                    {formatDate(meta.period.start)} –{' '}
                    {formatDate(new Date(new Date(meta.period.end).getTime() - 1).toISOString())}
                  </>
                )}
                {meta?.comparisonTruncated && (
                  <span
                    className="ml-2 rounded px-1.5 py-0.5"
                    style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
                  >
                    {t.period.truncated}
                  </span>
                )}
              </p>
            )}
          </div>
          {actions}
        </header>

        {anyFilter && (
          <div className="flex flex-wrap items-center gap-2">
            {enabled.search && (
              <SearchInput
                value={filters.q ?? ''}
                onChange={(q) => update({ q: q || undefined })}
              />
            )}
            {enabled.employees && (
              <MultiSelect
                label="Xodim"
                options={(data?.employees ?? []).map((e) => ({ id: e.id, label: e.fullName }))}
                selected={filters.employeeIds}
                onChange={(employeeIds) => update({ employeeIds })}
              />
            )}
            {enabled.departments && (
              <MultiSelect
                label="Boʻlim"
                options={(data?.departments ?? []).map((d) => ({ id: d.id, label: d.name }))}
                selected={filters.departmentIds}
                onChange={(departmentIds) => update({ departmentIds })}
              />
            )}
            {enabled.stages && (
              <MultiSelect
                label="Bosqich"
                options={(data?.stages ?? []).map((s) => ({ id: s.id, label: s.name }))}
                selected={filters.stageIds}
                onChange={(stageIds) => update({ stageIds })}
              />
            )}
            {enabled.products && (
              <MultiSelect
                label="Mahsulot"
                options={(data?.products ?? []).map((p) => ({ id: p.id, label: p.name }))}
                selected={filters.productIds}
                onChange={(productIds) => update({ productIds })}
              />
            )}
            {enabled.sources && (
              <MultiSelect
                label="Manba"
                options={(data?.sources ?? []).map((s) => ({ id: s.id, label: s.name }))}
                selected={filters.sourceIds}
                onChange={(sourceIds) => update({ sourceIds })}
              />
            )}
            {activeCount > 0 && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
                style={{ color: 'var(--ink-muted)' }}
              >
                Filtrlarni tozalash ({activeCount})
              </button>
            )}
          </div>
        )}

        {children}
      </div>
    </Shell>
  )
}
