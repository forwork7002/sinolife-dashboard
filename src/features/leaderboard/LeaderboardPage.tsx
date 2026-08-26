'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type LeaderboardRowDto } from '@/lib/api'
import { formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

type Metric = 'revenue' | 'deals_won' | 'conversion' | 'kpi_achievement'

const METRICS = [
  { value: 'revenue' as const, label: t.metric.revenue },
  { value: 'deals_won' as const, label: t.metric.deals_won },
  { value: 'conversion' as const, label: t.metric.conversion },
  { value: 'kpi_achievement' as const, label: t.metric.kpi_achievement },
]

export function LeaderboardPage() {
  const { apiParams } = useDashboardFilters()
  const [metric, setMetric] = useState<Metric>('revenue')

  const query = useQuery({
    queryKey: ['leaderboard', apiParams, metric],
    queryFn: ({ signal }) =>
      apiGet<readonly LeaderboardRowDto[]>(
        '/analytics/leaderboard',
        { ...apiParams, metric },
        signal,
      ),
    placeholderData: (previous) => previous,
  })

  const rows = query.data?.data ?? []
  // Split on whether the person produced anything, not on rank: a rank exists
  // for everyone, including the 162 rows that are entirely zeros.
  const ranked = rows.filter((row) => row.revenue.amount > 0 || row.dealsWon > 0)
  const unranked = rows.filter((row) => !(row.revenue.amount > 0 || row.dealsWon > 0))
  const podium = ranked.slice(0, 3)

  /** The metric's own value, so the podium works whichever one is selected. */
  const value = (row: LeaderboardRowDto) =>
    metric === 'revenue'
      ? row.revenue.amount
      : metric === 'deals_won'
        ? row.dealsWon
        : metric === 'conversion'
          ? (row.conversionPercent ?? 0)
          : (row.kpiAchievementPercent ?? 0)

  const teamTotal = ranked.reduce((sum, row) => sum + value(row), 0)
  const share = (row: LeaderboardRowDto) =>
    teamTotal === 0 ? null : (value(row) / teamTotal) * 100

  /**
   * Are there any KPI targets at all?
   *
   * The `kpi` table is empty on this portal, so `kpiAchievementPercent` is null
   * for all 288 rows and the column rendered as a full page of em dashes —
   * costing table width and teaching the reader to ignore a column that will
   * matter the day targets are loaded. Selecting the KPI metric was worse: it
   * sorted every row to null and produced a "ranking" in employee-id order.
   */
  const hasKpiTargets = rows.some((row) => row.kpiAchievementPercent !== null)

  const columns: Column<LeaderboardRowDto>[] = ([
    {
      key: 'rank',
      header: t.table.rank,
      width: '56px',
      align: 'right',
      numeric: true,
      // --ink-muted is 3.4:1. On a ranking screen the rank was the least
      // legible text on the row for 285 of 288 rows.
      render: (row) => (
        <span
          style={{
            color: row.rank <= 3 ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: row.rank <= 3 ? 600 : 400,
          }}
        >
          {row.rank}
          {/* Ties share a rank; marking them stops the repeat looking like a bug. */}
          {row.tied && <span title="Teng natija"> =</span>}
        </span>
      ),
    },
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: t.table.employee,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
            {row.fullName}
          </p>
          {row.departmentName && (
            <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.departmentName}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'revenue',
      header: t.table.revenue,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span
          style={{ color: metric === 'revenue' ? 'var(--ink-primary)' : undefined }}
          title={formatUzs(row.revenue.amount)}
        >
          {formatCompactUzs(row.revenue.amount)}
        </span>
      ),
    },
    {
      key: 'dealsWon',
      header: t.table.dealsWon,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'deals_won' ? 'var(--ink-primary)' : undefined }}>
          {formatNumber(row.dealsWon)}
        </span>
      ),
    },
    {
      key: 'conversion',
      header: t.table.conversion,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'conversion' ? 'var(--ink-primary)' : undefined }}>
          {formatPercent(row.conversionPercent)}
        </span>
      ),
    },
    {
      key: 'kpi',
      header: t.table.kpi,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'kpi_achievement' ? 'var(--ink-primary)' : undefined }}>
          {formatPercent(row.kpiAchievementPercent, 0)}
        </span>
      ),
    },
    {
      key: 'growth',
      header: t.table.growth,
      align: 'right',
      render: (row) => <TrendIndicator delta={row.delta} />,
    },
    // A column of 288 em dashes costs width and teaches the reader to skip it.
  ] as Column<LeaderboardRowDto>[]).filter((column) => column.key !== 'kpi' || hasKpiTargets)

  return (
    <PageShell
      title={t.nav.leaderboard}
      // The one screen with no accent rule, so it inherited the overview's
      // blue and was the only page not identifiable at a glance.
      accent="var(--series-5)"
      description="Bitta koʻrsatkich boʻyicha tartiblangan"
      meta={query.data?.meta}
      filters={{ departments: true }}
      actions={
        <SegmentedControl
          ariaLabel="Koʻrsatkich"
          value={metric}
          // Selecting KPI with no targets sorts every row to null and produces
          // a "ranking" in employee-id order. Offer it only when it can rank.
          options={METRICS.filter((m) => m.value !== 'kpi_achievement' || hasKpiTargets)}
          onChange={setMetric}
        />
      }
    >
      {podium.length === 3 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {podium.map((row, index) => (
            <Card key={row.employeeId} className="px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{
                    /*
                      Neutral, not a colour ramp.
                      
                      A sequential ramp encodes MAGNITUDE, and the gap between
                      first and second here is 576 mln to 238 mln — nothing the
                      three evenly-spaced steps convey. The numeral is the
                      rank; the value beside it is the magnitude. Painting the
                      chips as well made rank the third thing on the screen
                      encoded by hue, and the only one doing it with the same
                      blue as the revenue series.
                    */
                    background: 'var(--grid)',
                    color: 'var(--ink-primary)',
                    boxShadow: 'inset 0 0 0 1px var(--border-strong)',
                  }}
                  aria-hidden="true"
                >
                  {row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {row.fullName}
                  </p>
                  <p className="tabular truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    {metric === 'revenue' && formatCompactUzs(row.revenue.amount) + ' soʻm'}
                    {metric === 'deals_won' && `${formatNumber(row.dealsWon)} ta bitim`}
                    {metric === 'conversion' && formatPercent(row.conversionPercent)}
                    {metric === 'kpi_achievement' && formatPercent(row.kpiAchievementPercent, 0)}
                  </p>
                </div>
                <TrendIndicator delta={row.delta} />
              </div>

              {/*
                What the table below cannot say.
                
                The podium used to repeat rows 1–3 verbatim — same name, same
                value, same delta — while omitting the department, deal count
                and conversion the row carried, so it was strictly LESS
                informative than the thing directly beneath it and cost 66px to
                say so. Share of the team's total and the gap to the rank above
                are relational facts a table of independent rows cannot show.
              */}
              <div className="mt-3">
                <Meter value={share(row)} tone="neutral" label={row.fullName} />
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {index === 0
                    ? `Jamoaning ${formatPercent(share(row))} ulushi`
                    : `Yuqoridagidan ${formatCompactUzs(
                        value(podium[index - 1]!) - value(row),
                      )} orqada`}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/*
        Ranked rows first; everyone with nothing behind a disclosure.
        
        The full roster is 288 people, of whom 126 sold anything — the other
        162 rendered as identical rows of zeros and dashes and made the page
        17,400px tall. They are not noise in general (an active person selling
        nothing is a management signal) but they are not a ranking, so they do
        not belong above the fold of one.
      */}
      <Card className="px-4 py-4">
        <DataTable
          columns={columns}
          rows={ranked}
          rowKey={(row) => row.employeeId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          minWidth={880}
          initialRows={25}
          moreLabel={(hidden) => `Yana ${hidden} ta xodimni koʻrsatish`}
        />
      </Card>

      {unranked.length > 0 && (
        <Card className="px-4 py-4">
          <DataTable
            columns={columns}
            rows={unranked}
            rowKey={(row) => row.employeeId}
            status="ready"
            minWidth={880}
            initialRows={0}
            moreLabel={(hidden) => `Natijasiz xodimlar (${hidden})`}
          />
        </Card>
      )}
    </PageShell>
  )
}
