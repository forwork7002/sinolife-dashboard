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
import {
  ApiClientError,
  apiGet,
  type DeltaDto,
  type MoneyDto,
  type SellerCloseBasisDto,
} from '@/lib/api'
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
  /**
   * The SELLER-CLOSE basis, alongside `current.revenue` and never folded into
   * it: `current` is the DELIVERED summary, and these two count entries into
   * the won stage of the sellers' own pipeline instead. Different deals — last
   * August the two sets overlapped in 1 152 of 5 375 — so they sit outside
   * `current` for the same reason the server puts them there.
   *
   * Null means the stage could not be resolved: UNMEASURED, never zero.
   */
  readonly closedCount: number | null
  readonly closedValue: MoneyDto | null
}

type SortKey =
  | 'revenue'
  | 'dealsWon'
  | 'conversion'
  | 'kpi'
  | 'name'
  | 'closedValue'
  | 'closedDeals'

export function EmployeesPage() {
  const { apiParams } = useDashboardFilters()
  const router = useRouter()
  const [sort, setSort] = useState<SortKey>('revenue')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const query = useQuery({
    queryKey: ['employees', apiParams],
    queryFn: ({ signal }) =>
      apiGet<{
        readonly rows: readonly EmployeeRow[]
        /**
         * How `closedCount` / `closedValue` were arrived at. This endpoint
         * carries it in `data`, not in `meta` — the leaderboard is the one
         * that puts it in `meta`, so the two are read from different places
         * on purpose rather than by oversight.
         */
        readonly sellerCloseBasis?: SellerCloseBasisDto
      }>('/analytics/employees', apiParams, signal),
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
        // Undefined on a response predating this basis; null when the stage
        // could not be resolved. Both sort last, like every other "no data".
        case 'closedValue':
          return row.closedValue ? row.closedValue.amount : null
        case 'closedDeals':
          return typeof row.closedCount === 'number' ? row.closedCount : null
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

  /**
   * The seller-close basis, and the team totals on it.
   *
   * Summed from the SAME rows the table renders, exactly like `teamRevenue`
   * above, so the tile and the column it summarises can never disagree.
   *
   * Both totals go null the moment the basis did not resolve: a partial sum
   * over rows that were never measured would print a smaller number with the
   * same confidence as a real one. `undefined` (a response from before this
   * basis existed) lands in the same branch and prints the same em dash, but
   * without the hint that names a failure nobody has actually observed.
   */
  const basis = query.data?.data.sellerCloseBasis
  const hasCloseBasis = basis?.resolved === true
  const teamClosedValue = hasCloseBasis
    ? rows.reduce((sum, row) => sum + (row.closedValue?.amount ?? 0), 0)
    : null
  const teamClosedCount = hasCloseBasis
    ? rows.reduce((sum, row) => sum + (row.closedCount ?? 0), 0)
    : null

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
      // Not the bare "Tushum" this table used to carry: a second money column
      // now sits two cells away, and an unqualified heading is the confusion
      // the whole seller-close basis exists to remove.
      header: t.basis.deliveredRevenueColumn,
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
      /*
        Paired BY UNIT with the column above, not tucked at the end of the row.
        The comparison a manager makes is delivered money against closed money;
        putting a deal count between them turns a glance into arithmetic.

        `?` rather than `!== null`, here and below: the contract says
        `number | null`, but a static-demo snapshot frozen before this basis
        existed carries no key at all, and `undefined.amount` is a crash where
        an em dash was wanted.
      */
      key: 'closedValue',
      header: t.basis.closedValueColumn,
      sortKey: 'closedValue',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span title={row.closedValue ? formatUzs(row.closedValue.amount) : undefined}>
          {row.closedValue ? formatCompactUzs(row.closedValue.amount) : NO_VALUE}
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
      header: t.basis.deliveredDealsColumn,
      sortKey: 'dealsWon',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.current.dealsWon),
    },
    {
      key: 'closedCount',
      header: t.basis.closedDealsColumn,
      sortKey: 'closedDeals',
      align: 'right',
      numeric: true,
      render: (row) =>
        typeof row.closedCount === 'number' ? formatNumber(row.closedCount) : NO_VALUE,
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
    // The same rule retires the two close columns when the seller stage
    // resolved to nothing: they are not a quiet zero, they are not there.
  ] as Column<EmployeeRow>[]).filter((column) => {
    if (column.key === 'kpi') return hasKpiTargets
    if (column.key === 'closedValue' || column.key === 'closedCount') {
      return basis === undefined || basis.resolved
    }
    return true
  })

  return (
    <PageShell
      title={t.nav.employees}
      // The team family shares the leaderboard's slot — same people, same
      // stripe.
      accent="var(--series-5)"
      /*
        Both bases named before either is shown, and PageShell prints the
        reporting window straight after this sentence — so the header reads
        "<what the two columns count> · 1-avg 2026 – 28-avg 2026". Reyting
        states the same distinction in the same words; a reader moving between
        the two screens must not have to work out that they agree.
      */
      description="Har bir xodim ikki oʻlchovda: yetkazib berilgan tushum va sotuvchining oʻzi yopgan bitimlar."
      meta={query.data?.meta}
      filters={{ employees: true, departments: true }}
    >
      {/*
        Three subordinate tiles, no hero: the table IS this page's lead. A
        hero-sized figure over a client-side sum would claim an importance the
        derivation does not carry — the tiles orient, the rows answer.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          // "Jami tushum" until a second money total joined it on the same
          // row. Two sums a manager is meant to compare must not share a name.
          label={t.basis.deliveredRevenueColumn}
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
        {/*
          The other basis, at the same size as the one beside it.

          Delivered money and closed money are the comparison this page now
          exists to make, so they are two tiles of equal weight rather than a
          headline and a footnote. Where the pair diverges for the whole team,
          it diverges hardest for individuals — which is what the two columns
          in the table below are for.
        */}
        <StatTile
          label={t.basis.closedValueLabel}
          value={status === 'ready' ? teamClosedValue : null}
          unit="money"
          status={status}
          // Short by necessity: StatTile truncates its hint to one line. The
          // amount caveat and the mechanism ride the explainer under the table
          // instead, where they have room to be read rather than clipped.
          hint={
            basis === undefined
              ? undefined
              : basis.resolved
                ? `${formatNumber(teamClosedCount ?? 0)} ta yopilgan bitim`
                : t.basis.unmeasuredShort
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
          // Two more numeric columns than this table carried before.
          minWidth={1180}
          // Bounded height so the header has something to stick to: the rows
          // slide under the sunken header band instead of taking it away.
          maxHeight={620}
        />

        {/*
          The explainer, once per page — the same sentence Reyting prints, from
          the same string, because two screens describing one mechanism two
          ways is how a reader decides the dashboard is guessing.

          It states what makes the two columns disagree and stops. Which figure
          a manager should manage by is not a decision a footnote gets to make.
        */}
        {hasCloseBasis && (
          <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {t.basis.explainer} {t.basis.amountCaveat}
          </p>
        )}
      </Card>
    </PageShell>
  )
}
