'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
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

  const columns: Column<EmployeeRow>[] = ([
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: t.table.employee,
      sortKey: 'name',
      render: (row) => (
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
      meta={query.data?.meta}
      filters={{ employees: true, departments: true }}
    >
      <Card className="px-4 py-4">
        <DataTable
          columns={columns}
          rows={rows}
          // 288 people rendered a 16,605px page. The rest are one click away.
          initialRows={30}
          moreLabel={(hidden) => `Yana ${hidden} ta xodimni koʻrsatish`}
          rowKey={(row) => row.employeeId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          onRowClick={(row) => router.push(`/employees/${row.employeeId}`)}
          sort={sort}
          order={order}
          onSort={onSort}
          emptyBody="Tanlangan davr va filtrlar boʻyicha xodim topilmadi."
          minWidth={980}
        />
      </Card>
    </PageShell>
  )
}
