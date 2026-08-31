'use client'

import { useQuery } from '@tanstack/react-query'

import { ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter, RingGauge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type DispatchDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber } from '@/lib/format'
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
  /*
    Cancelled-before-dispatch orders belong in the denominator.
  
    They were missing here while the Logistics page counted them, so the same
    orders produced a higher rate on this screen than on that one under the
    identical heading. A customer who cancelled before anything shipped is not
    still on its way anywhere; leaving them out flatters the figure forever.
  */
  const totalCancelledEarly = rows.reduce((sum, r) => sum + r.cancelledEarly, 0)
  const resolved = totalDelivered + totalRefused + totalCancelledEarly
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
      key: 'cancelledEarly',
      header: 'Bekor qilingan',
      align: 'right',
      numeric: true,
      // In the rate's denominator, so it is shown beside it rather than
      // implied. Zero renders muted: nothing cancelled is good news, not a
      // number that needs attention.
      render: (row) =>
        row.cancelledEarly === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>0</span>
        ) : (
          <span style={{ color: 'var(--status-warning)' }}>
            {formatNumber(row.cancelledEarly)}
          </span>
        ),
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
      {/*
        The lead instrument — the page's one hero, wearing the registration
        brackets alone.

        Fulfilment has exactly one headline claim: of the parcels whose story
        is over, how many reached a customer. The ring carries that rate, the
        hero figure carries the fraction it came from — a rate without its
        denominator is an opinion — and the in-flight count is named beside
        them as the number this rate deliberately leaves out. The tiles below
        stay subordinate: they are volume and money, not the verdict.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Yetkazish darajasi">
        {query.isError ? (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {query.isPending ? (
              <div className="skeleton h-[116px] w-[116px] shrink-0 rounded-full" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : (
              <RingGauge
                value={deliveryRate}
                size={116}
                thickness={9}
                tone="auto"
                label="Yetkazish darajasi"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Yetkazish darajasi
              </p>

              {query.isPending ? (
                // Sized to the hero figure below, so ready never reflows loading.
                <div className="skeleton mt-2 h-[38px] w-44" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ) : resolved > 0 ? (
                /*
                  The fraction, not a second copy of the percentage — the ring
                  already states that. Numbers only inside the nowrap hero
                  line, so no long Uzbek word can push it off a narrow screen.
                */
                <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                  <AnimatedNumber
                    value={totalDelivered}
                    format={(v) => formatNumber(Math.round(v))}
                  />
                  <span className="text-lg font-normal" style={{ color: 'var(--ink-muted)' }}>
                    {' '}/ {formatNumber(resolved)}
                  </span>
                </p>
              ) : (
                // Genuine null: nothing has resolved. An em dash, never 0 —
                // "no outcome yet" is not "nothing arrived".
                <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                  {NO_VALUE}
                </p>
              )}

              {!query.isPending && (
                <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                  {resolved > 0
                    ? `Yakunlangan joʻnatmalardan yetkazilgani · ${formatNumber(inFlight)} tasi hali yoʻlda — ular darajaga kirmaydi`
                    : 'Bu davrda birorta joʻnatma hali yakunlanmagan — daraja yakun chiqqanda paydo boʻladi'}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="stagger grid gap-3 sm:grid-cols-3">
        {/* "Buyurtmalar", not "joʻnatilgan": the number is every order
            created in the window, including the ones cancelled before any
            dispatch point took them. */}
        <StatTile status={tileStatus} label="Buyurtmalar" value={totalOrders || null} unit="count" />
        <StatTile status={tileStatus} label="Nuqtalar" value={known.length || null} unit="count" hint="Sklad, kuryer, marketpleys" />
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
          // Bounded so the sticky header engages if the point list ever grows
          // past a screen; today's handful of rows never reaches the cap.
          maxHeight={560}
        />
      </ChartCard>
    </PageShell>
  )
}
