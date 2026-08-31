'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { PeriodFilter } from '@/components/layout/PeriodFilter'
import { Shell } from '@/components/layout/Shell'
import { Button } from '@/components/ui/Button'
import { MultiSelect, SearchInput } from '@/components/ui/Controls'
import { apiGet, type ResponseMeta } from '@/lib/api'
import type { RoleValue } from '@/lib/roles'
import type { SectionValue } from '@/lib/sections'
import { formatDate } from '@/lib/format'
import { t } from '@/lib/messages'
import type { DataScopeValue } from '@/lib/dataScope'
import { useDashboardFilters, useRestoreSectionPeriod } from './useDashboardFilters'

export interface FilterOptions {
  readonly employees: readonly { id: string; fullName: string }[]
  readonly departments: readonly { id: string; name: string }[]
  readonly products: readonly { id: string; name: string }[]
  readonly sources: readonly { id: string; name: string }[]
  readonly stages: readonly { id: string; name: string }[]
  readonly lastSyncedAt: string | null
  /** Who is looking. Drives which nav entries render. */
  readonly viewer?: {
    readonly userId: string
    readonly role: RoleValue
    readonly sections: readonly SectionValue[]
    /** ALL or OWN — how much of each granted screen this account reads. */
    readonly dataScope: DataScopeValue
    readonly canManageUsers: boolean
  }
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
  /**
   * What the search box says it searches.
   *
   * The default is a bare "Qidirish…", which is honest on a page whose search
   * covers a title and nothing else. Where the box genuinely spans a whole
   * table, saying so is the difference between someone typing a phone number
   * and someone assuming it will not work.
   */
  readonly searchPlaceholder?: string
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
   * Sets `--accent` for this subtree. Exactly two things read it: the rule
   * under the title and the focus ring. Nothing that encodes a value does —
   * series colour has to stay stable across pages, or the same bar means two
   * things in two places.
   *
   * The sidebar's active marker is NOT in this subtree and never was. It sits
   * in Shell, above every page, so it resolved --accent from :root and was
   * permanently series-1 blue while this comment claimed otherwise. It is
   * chrome rather than page identity, and it is now explicitly coloured as
   * such rather than appearing to follow something it cannot see.
   */
  accent?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { filters, update, setPeriod, reset, activeCount } = useDashboardFilters()
  // Once per page: see the hook's own note on why it does not live in
  // useDashboardFilters, which a dozen components call.
  useRestoreSectionPeriod()
  const options = useFilterOptions()
  const data = options.data?.data

  const anyFilter =
    enabled.employees || enabled.departments || enabled.stages || enabled.products ||
    enabled.sources || enabled.search

  return (
    <Shell
      dataSource={meta?.dataSource ?? options.data?.meta.dataSource}
      lastSyncedAt={data?.lastSyncedAt ?? null}
      // Every page built on this shell renders the window control below.
      periodAware
    >
      <div
        className="mx-auto max-w-[1400px] space-y-4"
        style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}
      >
        {/*
          The header zone carries the aurora — title, description and filters
          sit over it; data never does.

          `.page-atmosphere` (globals.css) paints two blurred chrome-tint
          blobs and masks them away over the bottom of the band, so the
          atmosphere dies before the first chart. It lives in
          its own absolutely-positioned, overflow-hidden layer rather than
          putting overflow-hidden on the content: the MultiSelect popovers in
          the filter row open downward past this box and must not be clipped.
          The layer bleeds up into main's padding so the glow starts at the
          top of the page, not 20px into it. pointer-events-none because
          scenery must never intercept a click meant for the controls over it.
        */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-5 bottom-0 overflow-hidden lg:-top-6"
          >
            <div className="page-atmosphere" />
          </div>

          <div className="relative space-y-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {accent && <div className="accent-rule mb-2.5" aria-hidden="true" />}
                {/* `.display` (tight tracking for large sizes) at 24px — the page
                    title's one job is to outrank every section heading below it. */}
                <h1
                  className="display text-2xl font-semibold"
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

            {/*
              THE REPORTING WINDOW BELONGS TO THE PAGE, not to the chrome.

              It used to sit in the app header, above every screen, which said
              it was one setting for the whole dashboard — and it never was:
              each section is read in its own window, and each keeps it. A
              control rendered over the top bar cannot say that. Down here it
              sits with the section's other filters, under the section's title,
              and reads as what it is: this page's dates.

              The header keeps the search, which genuinely is global — it looks
              across every screen at once.

              The row renders even when a page has no other filters: the window
              is not optional, so a screen without it would simply have no way
              to change its dates.
            */}
            <div className="flex flex-wrap items-center gap-2">
              <PeriodFilter
                value={filters.preset}
                from={filters.from}
                to={filters.to}
                onChange={setPeriod}
              />
              {anyFilter && (
                <>
                {enabled.search && (
                  <SearchInput
                    value={filters.q ?? ''}
                    onChange={(q) => update({ q: q || undefined })}
                    placeholder={enabled.searchPlaceholder}
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
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Filtrlarni tozalash ({activeCount})
                  </Button>
                )}
                </>
              )}
            </div>
          </div>
        </div>

        {children}
      </div>
    </Shell>
  )
}
