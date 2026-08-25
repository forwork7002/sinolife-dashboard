'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter, RankBadge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type CallActivityDto, apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * Who actually spoke to customers.
 *
 * Ranked by talk time, not by call count. Dialling a hundred numbers and
 * reaching none of them is not work with customers, and a leaderboard sorted
 * by attempts rewards exactly that.
 *
 * The recordings behind these calls are stored but not scored. A quality
 * rating would need a rubric nobody has agreed yet; the data is here for the
 * day one exists.
 */
export function CallsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['calls', apiParams],
    queryFn: ({ signal }) =>
      apiGet<CallActivityDto[]>('/insights/calls', apiParams, signal),
  })

  const rows = query.data?.data ?? []
  const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0)
  const totalConnected = rows.reduce((sum, r) => sum + r.connected, 0)
  const totalTalk = rows.reduce((sum, r) => sum + r.talkSeconds, 0)

  const columns: Column<CallActivityDto & { rank: number }>[] = [
    {
      key: 'rank',
      header: '#',
      width: '48px',
      render: (row) => <RankBadge rank={row.rank} />,
    },
    {
      key: 'name',
      header: 'Xodim',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.employeeName}
        </span>
      ),
    },
    {
      key: 'talk',
      header: 'Gaplashgan vaqt',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{formatDuration(row.talkSeconds)}</span>
      ),
    },
    {
      key: 'calls',
      header: 'Qoʻngʻiroq',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.calls),
    },
    {
      key: 'connected',
      header: 'Ulandi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.connected),
    },
    {
      key: 'connectRate',
      header: 'Ulanish %',
      width: '150px',
      render: (row) => (
        <Meter value={row.connectRateBp / 100} tone="neutral" label={row.employeeName} />
      ),
    },
    {
      key: 'avg',
      header: 'Oʻrtacha suhbat',
      align: 'right',
      numeric: true,
      render: (row) => formatDuration(row.averageTalkSeconds),
    },
  ]

  return (
    <PageShell
      title="Qoʻngʻiroqlar"
      description="Kim mijoz bilan qancha gaplashgani. Gaplashgan vaqt — faqat ulangan qoʻngʻiroqlar."
      accent="var(--series-1)"
      meta={query.data?.meta}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Qoʻngʻiroqlar" value={totalCalls || null} unit="count" />
        <StatTile label="Ulangan" value={totalConnected || null} unit="count" tone="good" />
        <StatTile
          label="Ulanish darajasi"
          value={totalCalls === 0 ? null : Math.round((totalConnected / totalCalls) * 1000) / 10}
          unit="percent"
          hint="Terilgan raqamlardan javob berganlari"
          /*
            Neutral, not graded.

            A third of outbound calls connecting is ordinary for this kind of
            dialling, and there is no agreed target to grade it against.
            Painting it red would be the dashboard asserting a standard nobody
            set.
          */
          context={
            <Meter
              value={totalCalls === 0 ? null : (totalConnected / totalCalls) * 100}
              tone="neutral"
            />
          }
        />
        <StatTile
          label="Jami suhbat"
          value={totalTalk === 0 ? null : Math.round(totalTalk / 3600)}
          unit="hours"
          hint="Barcha xodimlar boʻyicha"
        />
      </div>

      <ChartCard
        title="Xodimlar"
        hint="Gaplashgan vaqt boʻyicha tartiblangan — urinishlar soni boʻyicha emas. Yuz raqamni terib hech kimga ulanmaslik mijoz bilan ishlash emas."
      >
        <DataTable
          columns={columns}
          rows={rows.map((row, index) => ({ ...row, rank: index + 1 }))}
          rowKey={(row) => row.employeeId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Bu davrda qoʻngʻiroq yoʻq"
          emptyBody="Telefoniya maʼlumoti oxirgi oy uchun import qilinadi."
          minWidth={900}
        />
      </ChartCard>
    </PageShell>
  )
}

/** Seconds as h:mm:ss, or m:ss below an hour. Never a bare second count. */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
