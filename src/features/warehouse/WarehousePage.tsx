'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { GaugeTile, Meter, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type DispatchDto, apiGet } from '@/lib/api'
import { formatCompactUzs, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Fulfilment, not inventory.
 *
 * The portal defines four stores and keeps no balances in any of them:
 * `catalog.storeproduct.list` returns zero rows and there are no stock
 * documents. On-hand quantity genuinely does not exist to be shown, and
 * drawing an empty shelf would state that the warehouses are empty — which is
 * a different and false claim.
 *
 * What the portal does record on every order is which point fulfils it. That
 * answers the question this page was wanted for: where the volume goes, which
 * point delivers reliably, and where parcels come back.
 */
export function WarehousePage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['dispatch', apiParams],
    queryFn: ({ signal }) =>
      apiGet<DispatchDto[]>('/insights/dispatch', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const rows = query.data?.data ?? []
  const known = rows.filter((r) => r.point !== 'Belgilanmagan')
  const unknown = rows.find((r) => r.point === 'Belgilanmagan')

  const totalOrders = rows.reduce((sum, r) => sum + r.orders, 0)
  const totalDelivered = rows.reduce((sum, r) => sum + r.delivered, 0)
  const totalRefused = rows.reduce((sum, r) => sum + r.refused, 0)
  /**
   * Delivered over RESOLVED, not over everything shipped this window.
   *
   * The tile used delivered/orders and rendered a critical-red 40.5% ring
   * directly above a table whose every row graded 91–100% green — the same
   * mid-month mistake the repository's own comment warns about: dividing by
   * orders still in transit "reported 42% for a business that actually
   * delivers 93%". Same rate, same denominator, everywhere.
   */
  const resolved = totalDelivered + totalRefused
  const deliveryRate = resolved === 0 ? null : Math.round((totalDelivered / resolved) * 1000) / 10
  const inFlight = totalOrders - resolved
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue.amount, 0)

  const columns: Column<DispatchDto>[] = [
    {
      key: 'point',
      header: 'Joʻnatish nuqtasi',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.point}
        </span>
      ),
    },
    {
      key: 'orders',
      header: 'Buyurtma',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.orders),
    },
    {
      key: 'delivered',
      header: 'Yetkazildi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.delivered),
    },
    {
      key: 'refused',
      header: 'Qaytdi',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.refused === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>0</span>
        ) : (
          <span style={{ color: 'var(--status-critical)' }}>{formatNumber(row.refused)}</span>
        ),
    },
    {
      key: 'rate',
      header: 'Yetkazish %',
      width: '160px',
      render: (row) => <Meter value={row.deliveryRate} label={row.point} />,
    },
    {
      key: 'revenue',
      header: 'Tushum',
      align: 'right',
      numeric: true,
      render: (row) => formatCompactUzs(row.revenue.amount),
    },
  ]

  return (
    <PageShell
      title={t.modules.warehouse.title}
      description={t.modules.warehouse.lead}
      accent="var(--series-6)"
      meta={query.data?.meta}
    >
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile status={tileStatus} label="Joʻnatilgan buyurtma" value={totalOrders || null} unit="count" />
        <StatTile status={tileStatus} label="Nuqtalar" value={known.length || null} unit="count" hint="Sklad, kuryer, marketpleys" />
        <GaugeTile
          status={tileStatus}
          label="Yetkazish darajasi"
          value={deliveryRate}
          tone="auto"
          hint={`${formatNumber(totalDelivered)} / ${formatNumber(resolved)} yakunlangan · ${formatNumber(
            inFlight,
          )} yoʻlda`}
        />
        <StatTile status={tileStatus} label="Tushum" value={totalRevenue || null} unit="money" />
      </div>

      <div
        className="rounded-[var(--radius-panel)] border px-4 py-3 text-xs"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--ink-secondary)',
        }}
      >
        <strong style={{ color: 'var(--ink-primary)' }}>Ombor qoldigʻi Bitrix24da yuritilmaydi.</strong>{' '}
        Portalda 4 ta sklad eʼlon qilingan, lekin ularda hech qanday qoldiq yoʻq — kirim-chiqim
        hujjatlari ham nolga teng. Shuning uchun bu sahifa «nechta qoldi» emas, «kim qancha joʻnatdi
        va qanchasi qaytdi» degan savolga javob beradi. Agar Bitrix24 katalogida ombor hisobini
        yoʻlga qoʻysangiz, qoldiqlar shu yerda avtomatik paydo boʻladi.
        {unknown && unknown.orders > 0 && (
          <div className="mt-2">
            Bundan tashqari {formatNumber(unknown.orders)} ta buyurtmada joʻnatish nuqtasi
            belgilanmagan — ular quyidagi jadvalda alohida qator sifatida turibdi.
          </div>
        )}
      </div>

      <ChartCard
        title="Nuqtalar boʻyicha"
        hint="Har bir sklad, kuryer va marketpleys qancha buyurtma bajargani. Yetkazish % — muvaffaqiyatli yakunlangan ulush."
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.point}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Bu davrda joʻnatma yoʻq"
          minWidth={820}
        />
      </ChartCard>
    </PageShell>
  )
}
