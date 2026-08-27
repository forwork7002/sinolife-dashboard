'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { DataTable, InitialChip, type Column } from '@/components/ui/DataTable'
import { Meter, StatTile } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type DeltaDto, type MoneyDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

interface EmployeeRow {
  readonly employeeId: string
  readonly fullName: string
  readonly position: string | null
  readonly departmentName: string | null
  readonly isActive: boolean
  readonly kpiAchievementPercent: number | null
  readonly teamSharePercent: number | null
  readonly versusTeamAveragePercent: number | null
  readonly revenueDelta: DeltaDto
  readonly current: {
    readonly revenue: MoneyDto
    readonly pipelineValue: MoneyDto
    readonly averageDeal: MoneyDto | null
    readonly dealsWon: number
    readonly dealsLost: number
    readonly dealsCreated: number
    readonly dealsOpen: number
    readonly conversionRatePercent: number | null
  }
}

type SortKey = 'revenue' | 'dealsWon' | 'conversion' | 'kpi' | 'name'

export function EmployeesPage() {
  const { apiParams } = useDashboardFilters()
  const router = useRouter()
  const [sort, setSort] = useState<SortKey>('revenue')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const query = useQuery({
    queryKey: ['employees', apiParams],
    queryFn: ({ signal }) =>
      apiGet<{ rows: readonly EmployeeRow[] }>('/analytics/employees', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  /**
   * Sorted client-side, unlike the deals table.
   *
   * The roster is at most a few hundred rows and already fully loaded for the
   * comparison figures, so a round trip per sort would be slower and buy
   * nothing. The deals table sorts server-side because it is paginated and the
   * client only ever holds one page.
   */
  /** Does the kpi table hold anything for this period? */
  const hasKpiTargets = (query.data?.data.rows ?? []).some(
    (row) => row.kpiAchievementPercent !== null,
  )

  const rows = useMemo(() => {
    const list = [...(query.data?.data.rows ?? [])]
    const direction = order === 'asc' ? 1 : -1

    const value = (row: EmployeeRow): number | string | null => {
      switch (sort) {
        case 'revenue':
          return row.current.revenue.amount
        case 'dealsWon':
          return row.current.dealsWon
        case 'conversion':
          return row.current.conversionRatePercent
        case 'kpi':
          return row.kpiAchievementPercent
        case 'name':
          return row.fullName
      }
    }

    return list.sort((a, b) => {
      const left = value(a)
      const right = value(b)

      // Null means "not measurable" and always sorts last, whichever
      // direction the user picked — no data is not an achievement.
      if (left === null && right === null) return a.fullName.localeCompare(b.fullName)
      if (left === null) return 1
      if (right === null) return -1

      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction
      }
      return (left - right) * direction
    })
  }, [query.data, sort, order])

  const onSort = (key: string) => {
    const next = key as SortKey
    if (next === sort) setOrder(order === 'asc' ? 'desc' : 'asc')
    else {
      setSort(next)
      setOrder(next === 'name' ? 'asc' : 'desc')
    }
  }

  const teamRevenue = rows.reduce((sum, row) => sum + row.current.revenue.amount, 0)

  /*
    The KPI header, derived from the SAME rows the table renders — no second
    fetch, so the tiles and the table can never disagree, and both answer to
    the same period and department/employee filters.

    - "producing" counts people with revenue > 0: the header's headcount is
      honest only with its denominator beside it, because "288 xodim" alone
      hides that 162 of them sold nothing this period.
    - conversion is POOLED — total won over total closed — not the mean of the
      row percentages. An average of rates would let an employee with 2 deals
      weigh as much as one with 200 and drift the figure away from anything
      the business experienced. The fraction is printed on the tile so the
      derivation is checkable at a glance.
    - a revenue DELTA is deliberately absent: each row carries only a percent
      delta, and percents do not sum. Claiming a team-level delta from them
      would be arithmetic theatre.
  */
  const producing = rows.filter((row) => row.current.revenue.amount > 0).length
  const wonTotal = rows.reduce((sum, row) => sum + row.current.dealsWon, 0)
  const closedTotal = rows.reduce(
    (sum, row) => sum + row.current.dealsWon + row.current.dealsLost,
    0,
  )
  const teamConversion = closedTotal > 0 ? (wonTotal / closedTotal) * 100 : null
  const topEarner = rows.reduce<EmployeeRow | null>(
    (best, row) =>
      best === null || row.current.revenue.amount > best.current.revenue.amount ? row : best,
    null,
  )

  const status = query.isError ? 'error' : query.isPending ? 'loading' : 'ready'

  const columns: Column<EmployeeRow>[] = ([
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: t.table.employee,
      sortKey: 'name',
      render: (row) => (
        // The chip anchors the row the way an avatar would — see InitialChip.
        // aria-hidden there, so the announced name is not stuttered.
        <div className="flex min-w-0 items-center gap-2.5">
          <InitialChip name={row.fullName} />
          <div className="min-w-0">
            <p className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
              {row.fullName}
              {!row.isActive && (
                <span
                  className="ml-2 rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'var(--grid)', color: 'var(--ink-muted)' }}
                >
                  Faol emas
                </span>
              )}
            </p>
            <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.position ?? NO_VALUE}
              {row.departmentName && ` · ${row.departmentName}`}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'revenue',
      header: t.table.revenue,
      sortKey: 'revenue',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span
          style={{ color: 'var(--ink-primary)' }}
          title={formatUzs(row.current.revenue.amount)}
        >
          {formatCompactUzs(row.current.revenue.amount)}
        </span>
      ),
    },
    {
      key: 'share',
      header: t.table.share,
      width: '120px',
      render: (row) => (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--grid)' }}
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${teamRevenue > 0 ? (row.current.revenue.amount / teamRevenue) * 100 : 0}%`,
              background: 'var(--series-1)',
            }}
          />
        </div>
      ),
    },
    {
      key: 'dealsWon',
      header: t.table.dealsWon,
      sortKey: 'dealsWon',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.current.dealsWon),
    },
    {
      key: 'open',
      header: t.cards.dealsOpen,
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.current.dealsOpen),
    },
    {
      key: 'average',
      header: t.cards.averageDeal,
      align: 'right',
      numeric: true,
      render: (row) =>
        row.current.averageDeal ? formatCompactUzs(row.current.averageDeal.amount) : NO_VALUE,
    },
    {
      key: 'conversion',
      header: t.table.conversion,
      sortKey: 'conversion',
      align: 'right',
      numeric: true,
      render: (row) => formatPercent(row.current.conversionRatePercent),
    },
    {
      key: 'kpi',
      header: t.table.kpi,
      // Sortable only when there is something to sort. The `kpi` table is
      // empty on this portal, so every row is null — and sorting on a column
      // of nulls fell through to alphabetical order, which looks like a broken
      // sort rather than an absent metric.
      sortKey: hasKpiTargets ? 'kpi' : undefined,
      align: 'right',
      numeric: true,
      render: (row) => formatPercent(row.kpiAchievementPercent, 0),
    },
    {
      key: 'growth',
      header: t.table.growth,
      align: 'right',
      render: (row) => (
        <span title={t.period.closedBasis}>
          <TrendIndicator delta={row.revenueDelta} />
        </span>
      ),
    },
    // A column of 288 em dashes costs width and teaches the reader to skip it.
  ] as Column<EmployeeRow>[]).filter((column) => column.key !== 'kpi' || hasKpiTargets)

  return (
    <PageShell
      title={t.nav.employees}
      // The team family shares the leaderboard's slot — same people, same
      // stripe.
      accent="var(--series-5)"
      meta={query.data?.meta}
      filters={{ employees: true, departments: true }}
    >
      {/*
        Three subordinate tiles, no hero: the table IS this page's lead. A
        hero-sized figure over a client-side sum would claim an importance the
        derivation does not carry — the tiles orient, the rows answer.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Jami xodimlar"
          value={status === 'ready' ? rows.length : null}
          unit="count"
          status={status}
          hint={
            status === 'ready' && rows.length > 0
              ? `${formatNumber(producing)} / ${formatNumber(rows.length)} xodim tushum keltirgan`
              : undefined
          }
          context={
            status === 'ready' && rows.length > 0 ? (
              <Meter
                value={(producing / rows.length) * 100}
                tone="neutral"
                label="Tushum keltirgan xodimlar ulushi"
              />
            ) : undefined
          }
        />
        <StatTile
          label="Jami tushum"
          value={status === 'ready' ? teamRevenue : null}
          unit="money"
          status={status}
          hint="Roʻyxatdagi xodimlar boʻyicha yigʻindi"
          context={
            // Concentration is the context a bare sum needs: the same total
            // means different things when one person holds a seventh of it.
            topEarner && teamRevenue > 0 ? (
              <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {`Eng katta ulush: ${topEarner.fullName} · ${formatPercent(
                  (topEarner.current.revenue.amount / teamRevenue) * 100,
                )}`}
              </p>
            ) : undefined
          }
        />
        <StatTile
          label="Oʻrtacha konversiya"
          value={status === 'ready' ? teamConversion : null}
          unit="percent"
          status={status}
          // A rate states its fraction — the tile carries its own denominator.
          hint={
            status === 'ready' && closedTotal > 0
              ? `${formatNumber(wonTotal)} yutilgan / ${formatNumber(closedTotal)} yakunlangan bitim`
              : undefined
          }
        />
      </div>

      <Card className="px-4 py-4">
        <DataTable
          columns={columns}
          rows={rows}
          // 288 people rendered a 16,605px page. The rest are one click away.
          initialRows={30}
          moreLabel={(hidden) => `Yana ${hidden} ta xodimni koʻrsatish`}
          rowKey={(row) => row.employeeId}
          status={status}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          onRowClick={(row) => router.push(`/employees/${row.employeeId}`)}
          sort={sort}
          order={order}
          onSort={onSort}
          emptyBody="Tanlangan davr va filtrlar boʻyicha xodim topilmadi."
          minWidth={980}
          // Bounded height so the header has something to stick to: the rows
          // slide under the sunken header band instead of taking it away.
          maxHeight={620}
        />
      </Card>
    </PageShell>
  )
}
