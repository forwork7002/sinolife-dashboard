'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { GaugeTile, Meter, RankBadge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type CallActivityDto, type CallsDto, apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

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
      apiGet<CallsDto>('/insights/calls', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const rows = query.data?.data.rows ?? []
  const outbound = query.data?.data.outbound
  const inbound = query.data?.data.inbound
  const totalTalk = rows.reduce((sum, r) => sum + r.talkSeconds, 0)

  const rate = (part: number, whole: number) =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 10

  const columns: Column<CallActivityDto & { rank: number }>[] = [
    {
      key: 'rank',
      header: '#',
      width: '48px',
      render: (row) => <RankBadge rank={row.rank} />,
    },
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
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
      title={t.modules.calls.title}
      description={t.modules.calls.lead}
      // Not series-1: that is the app default AND the colour --seq-450 sits
      // next to, so page identity, rank and every rate bar were the same blue.
      accent="var(--series-7)"
      meta={query.data?.meta}
    >
      {/*
        Two directions, two tiles, because they are two different questions.
        
        A single blended "connection rate" read 31.5% on a log that is 92%
        inbound, under a hint about dialled numbers — so it described outbound
        performance using, almost entirely, inbound data. The missed-call count
        below is the most actionable number in this dataset and it appeared
        nowhere at all.
      */}
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <GaugeTile
          status={tileStatus}
          label="Chiquvchi — ulandi"
          value={outbound ? rate(outbound.connected, outbound.calls) : null}
          /*
            Neutral, not graded. Two thirds of dials connecting is ordinary for
            this kind of calling and nobody has set a target; painting it red
            would be the dashboard asserting a standard that does not exist.
          */
          tone="neutral"
          hint={
            outbound
              ? `${formatNumber(outbound.connected)} / ${formatNumber(outbound.calls)} terilgan`
              : undefined
          }
        />
        <GaugeTile
          status={tileStatus}
          label="Kiruvchi — javob berildi"
          value={inbound ? rate(inbound.connected, inbound.calls) : null}
          /*
            Graded, unlike outbound — with the page's own 80/50 thresholds
            rather than the house 85/60. A customer who called and got no
            answer is a loss in a way an unanswered dial is not, so this one
            HAS an agreed direction even without a target.
          */
          tone={
            inbound === undefined
              ? 'neutral'
              : (rate(inbound.connected, inbound.calls) ?? 0) >= 80
                ? 'good'
                : (rate(inbound.connected, inbound.calls) ?? 0) >= 50
                  ? 'warning'
                  : 'critical'
          }
          hint={
            inbound
              ? `${formatNumber(inbound.calls - inbound.connected)} ta javobsiz qoldi`
              : undefined
          }
        />
        <StatTile
          status={tileStatus}
          label="Qoʻngʻiroqlar"
          value={outbound && inbound ? outbound.calls + inbound.calls || null : null}
          unit="count"
          hint={
            outbound && inbound
              ? `${formatNumber(inbound.calls)} kiruvchi · ${formatNumber(outbound.calls)} chiquvchi`
              : undefined
          }
        />
        <StatTile
          status={tileStatus}
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
          // 144 and 92 rows made these pages 6,919px and 4,457px tall.
          initialRows={25}
          moreLabel={(hidden) => `Yana ${hidden} ta xodimni koʻrsatish`}
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
