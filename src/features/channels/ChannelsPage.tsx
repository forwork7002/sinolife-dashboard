'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { GaugeTile, Meter, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type ChannelDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Where the business comes from.
 *
 * The portal records the source of every deal across all nine pipelines, so
 * "leads" here is the honest top of the funnel — every enquiry the channel
 * produced, including the ones that never reached a sales pipeline. Revenue
 * counts only what a revenue pipeline actually won.
 *
 * ROI columns appear per row only where someone has entered that month's ad
 * spend. A channel with no spend recorded shows a dash, never a zero cost and
 * never an infinite return.
 */
export function ChannelsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['channels', apiParams],
    queryFn: ({ signal }) =>
      apiGet<ChannelDto[]>('/insights/channels', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const rows = query.data?.data ?? []
  const totalLeads = rows.reduce((sum, r) => sum + r.leads, 0)
  const totalWon = rows.reduce((sum, r) => sum + r.won, 0)
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue.amount, 0)
  const withSpend = rows.filter((r) => r.spend !== null)

  const columns: Column<ChannelDto>[] = [
    {
      key: 'name',
      header: 'Manba',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.sourceName}
        </span>
      ),
    },
    {
      key: 'leads',
      header: 'Murojaat',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.leads),
    },
    {
      key: 'deals',
      header: 'Savdo voronkasida',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.deals),
    },
    {
      key: 'won',
      header: 'Sotildi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.won),
    },
    {
      key: 'conversion',
      header: 'Konversiya',
      width: '140px',
      render: (row) => <Meter value={row.conversion} tone="neutral" label={row.sourceName} />,
    },
    {
      key: 'revenue',
      header: 'Tushum',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{formatCompactUzs(row.revenue.amount)}</span>
      ),
    },
    {
      key: 'cheque',
      header: 'Oʻrtacha chek',
      align: 'right',
      numeric: true,
      render: (row) => formatCompactUzs(row.averageCheque.amount),
    },
    {
      key: 'spend',
      header: 'Reklama xarajati',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.spend === null ? (
          <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        ) : (
          formatCompactUzs(row.spend.amount)
        ),
    },
    {
      key: 'roas',
      header: 'ROI',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.roas === null ? (
          <span style={{ color: 'var(--ink-muted)' }} title="Xarajat kiritilmagan">
            {NO_VALUE}
          </span>
        ) : (
          <span
            style={{
              color: row.roas >= 1 ? 'var(--delta-up)' : 'var(--delta-down)',
              fontWeight: 500,
            }}
          >
            {formatNumber(row.roas)}×
          </span>
        ),
    },
  ]

  return (
    <PageShell
      title={t.modules.channels.title}
      description={t.modules.channels.lead}
      accent="var(--series-5)"
      meta={query.data?.meta}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile status={tileStatus} label="Murojaatlar" value={totalLeads || null} unit="count" />
        <StatTile status={tileStatus} label="Sotuvlar" value={totalWon || null} unit="count" />
        <StatTile status={tileStatus} label="Tushum" value={totalRevenue || null} unit="money" />
        <GaugeTile
          status={tileStatus}
          label="Umumiy konversiya"
          value={totalLeads === 0 ? null : Math.round((totalWon / totalLeads) * 1000) / 10}
          tone="neutral"
          hint={`${formatNumber(totalWon)} savdo / ${formatNumber(totalLeads)} murojaat`}
        />
      </div>

      {rows.length > 0 && withSpend.length === 0 && (
        <div
          className="rounded-[var(--radius-panel)] border px-4 py-3 text-xs"
          style={{
            /*
              A rule down the edge, not a wash across the panel.
              
              8% of a saturated amber mixed into a near-black surface is a
              muddy brown at 1.12:1 — it neither reads as a warning nor stays
              out of the way. A full-strength bar on the leading edge is
              unambiguous at any surface lightness, and the panel itself keeps
              the ordinary card colour.
            */
            background: 'var(--surface-raised)',
            borderColor: 'var(--border)',
            borderInlineStartWidth: 3,
            borderInlineStartColor: 'var(--status-warning)',
            color: 'var(--ink-secondary)',
          }}
        >
          <strong style={{ color: 'var(--ink-primary)' }}>ROI hisoblanmadi.</strong> Bitrix24 bitim
          qayerdan kelganini yozadi, lekin uni olish qancha turganini yozmaydi. Har oy kanal boʻyicha
          reklama xarajatini kiritsangiz — CPO, CAC va ROI avtomatik chiqadi. Xarajatsiz faqat hajm va
          konversiya koʻrsatiladi, chunki nolga boʻlingan daromad «cheksiz foyda» boʻlib koʻrinadi.
        </div>
      )}

      <ChartCard
        title="Kanallar"
        hint="Davr ichida YARATILGAN bitimlar boʻyicha — kanal shu oyda nima olib kelganini koʻrsatadi. Bosh sahifadagi tushum esa yopilgan sana boʻyicha, shuning uchun ikki raqam bir xil boʻlmaydi."
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.sourceId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Bu davrda murojaat yoʻq"
          minWidth={1040}
        />
      </ChartCard>

      <ChartCard title="Tushum ulushi" hint="Har bir kanal umumiy tushumning qancha qismini bergani.">
        <ShareBars
          rows={rows
            .filter((r) => r.revenue.amount > 0)
            .slice(0, 12)
            .map((r) => ({ label: r.sourceName, value: r.revenue.amount }))}
          total={totalRevenue}
        />
      </ChartCard>
    </PageShell>
  )
}

/**
 * Share of a total, as a ranked bar list.
 *
 * A bar list rather than a pie: twelve channels in a pie is twelve wedges
 * nobody can compare, and the question here is ordinal — which channels are
 * carrying the business — which a sorted list answers directly.
 */
function ShareBars({
  rows,
  total,
}: {
  readonly rows: readonly { label: string; value: number }[]
  total: number
}) {
  if (rows.length === 0 || total === 0) return null
  const max = Math.max(...rows.map((r) => r.value))

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span
            className="w-44 shrink-0 truncate text-xs"
            style={{ color: 'var(--ink-secondary)' }}
            title={row.label}
          >
            {row.label}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded" style={{ background: 'var(--grid)' }}>
            <div
              className="h-full rounded"
              style={{ width: `${(row.value / max) * 100}%`, background: 'var(--series-5)' }}
            />
          </div>
          <span
            className="tabular w-24 shrink-0 text-right text-xs font-medium"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatCompactUzs(row.value)}
          </span>
          <span
            className="tabular w-14 shrink-0 text-right text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            {formatPercent((row.value / total) * 100)}
          </span>
        </li>
      ))}
    </ul>
  )
}
