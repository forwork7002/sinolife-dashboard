'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type MarginDto, type MarginRowDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Gross margin, with its own coverage stated.
 *
 * Only some of the catalogue carries a purchase price in Bitrix24, so the
 * margin figure describes part of the business. The coverage bar says how
 * much — without it a 42% margin over a fifth of revenue reads exactly like a
 * 42% margin over all of it, and only one of those is worth acting on.
 *
 * Products with no cost show a dash. Treating an unpriced product as free
 * would report 100% margin on it and quietly lift the company average.
 */
export function MarginPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['margin', apiParams],
    queryFn: ({ signal }) =>
      apiGet<MarginDto>('/insights/margin', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const data = query.data?.data
  // Both totals come from the server, already split by sign. Summing the
  // rows here would net a giveaway against a markup and report neither.
  const discountTotal = data?.discount.amount ?? null
  const overListTotal = data?.overList.amount ?? null

  const columns: Column<MarginRowDto>[] = [
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: 'Mahsulot',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.productName}
        </span>
      ),
    },
    {
      key: 'units',
      header: 'Dona',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.units),
    },
    {
      key: 'revenue',
      header: 'Tushum',
      align: 'right',
      numeric: true,
      render: (row) => formatCompactUzs(row.revenue.amount),
    },
    {
      key: 'cost',
      header: 'Tannarx',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.cost === null ? (
          <span style={{ color: 'var(--ink-muted)' }} title="Bitrix24 katalogida tannarx yoʻq">
            {NO_VALUE}
          </span>
        ) : (
          formatCompactUzs(row.cost.amount)
        ),
    },
    {
      key: 'gross',
      header: 'Yalpi foyda',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.gross === null ? (
          <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        ) : (
          <span
            style={{
              color: row.gross.amount >= 0 ? 'var(--ink-primary)' : 'var(--status-critical)',
            }}
          >
            {formatCompactUzs(row.gross.amount)}
          </span>
        ),
    },
    {
      key: 'margin',
      header: 'Marja',
      width: '150px',
      render: (row) =>
        row.margin === null ? (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            tannarx yoʻq
          </span>
        ) : row.revenue.amount === 0 ? (
          // A known cost and no revenue: given away outright. The old code
          // reported this as "tannarx yoʻq" while printing the cost in the
          // column beside it.
          <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
            butunlay chegirma
          </span>
        ) : (
          <Meter value={row.margin} tone="neutral" label={row.productName} />
        ),
    },
    {
      key: 'discount',
      header: 'Chegirma',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.discount.amount === 0 && row.overList.amount === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>0</span>
        ) : row.discount.amount > 0 ? (
          <span style={{ color: 'var(--status-serious)' }}>
            {formatCompactUzs(row.discount.amount)}
          </span>
        ) : (
          // Sold ABOVE the catalogue price. This used to render in the same
          // warning orange as a giveaway, with a minus sign as the only clue —
          // so money earned and money surrendered looked identical.
          <span
            style={{ color: 'var(--ink-secondary)' }}
            title="Narx katalog narxidan yuqori — chegirma emas, ustama"
          >
            +{formatCompactUzs(row.overList.amount)}
          </span>
        ),
    },
  ]

  return (
    <PageShell
      title={t.modules.margin.title}
      description={t.modules.margin.lead}
      accent="var(--series-2)"
      meta={query.data?.meta}
    >
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/*
          Tushum is ALL revenue; Yalpi foyda is the profit on the fraction with
          a known cost. Side by side and unlabelled they invite the reader to
          divide one by the other and get 15%, next to a Marja tile saying 57%.
          The hint states the base so the three tiles reconcile.
        */}
        <StatTile
          status={tileStatus}
          label="Tushum"
          value={data?.revenue.amount ?? null}
          unit="money"
          hint={
            data
              ? `${formatCompactUzs(data.costedRevenue.amount)} soʻmda tannarx maʼlum`
              : undefined
          }
        />
        <StatTile
          status={tileStatus}
          label="Yalpi foyda"
          value={data?.gross.amount ?? null}
          unit="money"
          hint="Faqat tannarxi maʼlum mahsulotlar · satr boʻyicha"
        />
        <StatTile
          status={tileStatus}
          label="Marja"
          value={data?.margin ?? null}
          unit="percent"
          /**
           * Neutral while coverage is thin.
           *
           * A 57% margin measured over a quarter of revenue is not a good
           * result, it is an unknown one — and painting it green tells the
           * reader the opposite. Grading resumes once most of the catalogue
           * carries a purchase price.
           */
          tone={
            data === undefined || data.coverage < 50
              ? 'neutral'
              : data.margin >= 40
                ? 'good'
                : data.margin >= 20
                  ? 'warning'
                  : 'critical'
          }
          context={<Meter value={data?.margin ?? null} tone="neutral" />}
        />
        <StatTile
          status={tileStatus}
          label="Berilgan chegirma"
          value={discountTotal}
          unit="money"
          tone={discountTotal && discountTotal > 0 ? 'warning' : 'neutral'}
          hint={
            overListTotal && overListTotal > 0
              ? `Toʻgʻridan-toʻgʻri marjadan chiqadi · ${formatCompactUzs(overListTotal)} ustama alohida`
              : 'Toʻgʻridan-toʻgʻri marjadan chiqadi'
          }
        />
      </div>

      {data && data.coverage < 99 && (
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
          <strong style={{ color: 'var(--ink-primary)' }}>
            Marja tushumning {formatPercent(data.coverage)} qismi boʻyicha hisoblandi.
          </strong>{' '}
          Qolgan mahsulotlarda Bitrix24 katalogida tannarx (закупочная цена) koʻrsatilmagan. Ularni
          katalogda toʻldirsangiz, marja avtomatik toʻliq boʻladi — nol tannarx yozilmaydi, chunki u
          100% foyda boʻlib koʻrinardi.
          <div className="mt-2 max-w-md">
            <Meter value={data.coverage} tone="neutral" label="Qamrov" />
          </div>
        </div>
      )}

      <ChartCard
        title="Mahsulotlar"
        hint="Tushum boʻyicha tartiblangan. Chegirma ustuni — sotuvda berilgan yon berish; u toʻgʻridan-toʻgʻri foydadan ketadi."
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.productId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Bu davrda sotuv yoʻq"
          minWidth={940}
        />
      </ChartCard>
    </PageShell>
  )
}
