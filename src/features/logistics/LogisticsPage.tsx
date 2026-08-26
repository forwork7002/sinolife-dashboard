'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { Meter, StatTile } from '@/components/ui/Stat'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ChartSkeleton, EmptyState } from '@/components/states/States'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type LogisticsDto, type LogisticsRowDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Delivery performance.
 *
 * Two cuts of the same orders — by route (hub or carrier) and by customer
 * region — because they answer different questions: one is about the operation
 * we run, the other about the geography we serve, and a parcel from Tashkent
 * can travel through any of the hubs.
 *
 * Timings come from stage history, so "median hours" means from entering the
 * hub to being marked delivered, not from the order being created. The
 * distinction matters: an order that sat unconfirmed for three days did not
 * take three days to deliver.
 */
export function LogisticsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['logistics', apiParams],
    queryFn: ({ signal }) =>
      apiGet<LogisticsDto>('/insights/logistics', apiParams, signal),
  })

  const data = query.data?.data

  const returned = data?.reasons.filter((r) => r.stage === 'RETURNED') ?? []

  const cancelled = data?.reasons.filter((r) => r.stage !== 'RETURNED') ?? []
  const totals = data?.totals

  const columns: Column<LogisticsRowDto>[] = [
    {
      key: 'label',
      header: 'Yoʻnalish',
      render: (row) => (
        <span
          className="font-medium"
          style={{ color: 'var(--ink-primary)' }}
          title={row.label}
        >
          {routeName(row.label)}
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
      key: 'rate',
      header: 'Yetkazish %',
      width: '150px',
      render: (row) => <Meter value={row.deliveryRate} label={row.label} />,
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
      key: 'cancelled',
      header: 'Joʻnatilmay bekor',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.cancelledEarly),
    },
    {
      key: 'inFlight',
      header: 'Yoʻlda',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.inFlight),
    },
    {
      key: 'median',
      header: 'Median soat',
      align: 'right',
      numeric: true,
      render: (row) => (row.medianHours === null ? NO_VALUE : formatNumber(row.medianHours)),
    },
    {
      key: 'p90',
      header: 'p90 soat',
      align: 'right',
      numeric: true,
      render: (row) => (row.p90Hours === null ? NO_VALUE : formatNumber(row.p90Hours)),
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
      title={t.modules.logistics.title}
      description={t.modules.logistics.lead}
      accent="var(--series-3)"
      meta={query.data?.meta}
    >
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Buyurtmalar"
          value={totals?.orders ?? null}
          unit="count"
          hint={totals ? `${formatNumber(totals.inFlight)} tasi hali yoʻlda` : undefined}
        />
        <StatTile label="Yetkazildi" value={totals?.delivered ?? null} unit="count" tone="good" />
        <StatTile
          label="Yetkazish darajasi"
          value={totals?.deliveryRate ?? null}
          unit="percent"
          hint="Yakunlangan buyurtmalar ichida"
          tone={
            totals === undefined
              ? 'neutral'
              : totals.deliveryRate >= 85
                ? 'good'
                : totals.deliveryRate >= 60
                  ? 'warning'
                  : 'critical'
          }
          context={<Meter value={totals?.deliveryRate ?? null} />}
        />
        <StatTile
          label="Qaytdi / bekor"
          value={totals ? totals.refused + totals.cancelledEarly : null}
          unit="count"
          hint={
            totals
              ? `${formatNumber(totals.refused)} yoʻldan qaytdi, ${formatNumber(totals.cancelledEarly)} joʻnatilmay bekor`
              : undefined
          }
          tone={totals && totals.refused > 0 ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Median yetkazish"
          value={totals?.medianHours ?? null}
          unit="hours"
          hint="Buyurtmadan yopilishgacha"
        />
      </div>

      <ChartCard
        title="Hudud boʻyicha"
        hint="Davr ichida yaratilgan buyurtmalar boʻyicha. Hudud — bitimdagi region maydonidan."
      >
        <DataTable
          columns={columns}
          rows={data?.regions ?? []}
          rowKey={(row) => row.label}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Bu davrda buyurtma yoʻq"
          minWidth={980}
        />
      </ChartCard>

      <ChartCard
        title="Sklad va tashuvchi boʻyicha"
        hint="Buyurtma qaysi hudud omboridan yoki qaysi pochta orqali ketgani — bosqichlar tarixidan olingan."
      >
        <DataTable
          columns={columns}
          rows={data?.routes ?? []}
          rowKey={(row) => row.label}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          emptyTitle="Yoʻnalish maʼlumoti yoʻq"
          emptyBody="Bosqichlar tarixi hali import qilinmagan boʻlishi mumkin."
          minWidth={980}
        />
      </ChartCard>

      {/*
        Two cards, because a return and a cancellation are different events.
        
        A parcel that travelled and came back cost the delivery, the handling
        and the return leg. An order killed before anything shipped cost a
        phone call. Merged, 81 of one month's 82 losses were cancellations, and
        135.5 mln soʻm of goods that never moved were reported as lost value
        under a heading about returns.
      */}
      <ChartCard
        title="Qaytgan buyurtmalar"
        hint="Yoʻlga chiqib, mijozga yetmagan yoki qaytarilgan buyurtmalar. Yoʻqotilgan summa — real yetkazish xarajati bilan birga."
      >
        {query.isPending && <ChartSkeleton height={140} />}
        {data && returned.length === 0 && (
          <EmptyState
            title="Qaytgan buyurtma yoʻq"
            body="Bu davrda yoʻlga chiqqan birorta buyurtma qaytmagan."
          />
        )}
        {returned.length > 0 && <ReasonList reasons={returned} />}
      </ChartCard>

      <ChartCard
        title="Joʻnatilmay bekor qilinganlar"
        hint="Ombordan chiqmasdan bekor qilingan buyurtmalar. Tovar qimirlamagani uchun bu yoʻqotilgan tushum emas, oʻtkazib yuborilgan savdo."
      >
        {query.isPending && <ChartSkeleton height={140} />}
        {data && cancelled.length === 0 && (
          <EmptyState
            title="Bekor qilingan buyurtma yoʻq"
            body="Bu davrda hech bir buyurtma joʻnatishdan oldin bekor qilinmagan."
          />
        )}
        {cancelled.length > 0 && <ReasonList reasons={cancelled} />}
      </ChartCard>
    </PageShell>
  )
}

/**
 * Stage names arrive prefixed with their pipeline — "Доставка · CARAVAN".
 *
 * The prefix earns its place in a filter list, where stage ids repeat across
 * pipelines and the name alone is ambiguous. On a page whose title is already
 * "Logistika" it is thirteen characters of noise repeated down every row, so
 * it is dropped here and kept in the tooltip.
 */
function routeName(label: string): string {
  const separator = label.indexOf(' · ')
  return separator === -1 ? label : label.slice(separator + 3)
}

/**
 * Refusal reasons, ranked.
 *
 * Ordered by order count rather than by lost money on purpose: the top reason
 * is the one to fix operationally, and sorting by value would put a single
 * large refused order above a systemic problem affecting fifty small ones.
 * The value is shown beside it so the trade is visible either way.
 */
function ReasonList({
  reasons,
}: {
  readonly reasons: readonly {
    readonly stage: string
    readonly reason: string
    readonly orders: number
    readonly lost: { readonly amount: number }
  }[]
}) {
  const max = Math.max(...reasons.map((r) => r.orders), 1)

  return (
    <ul className="space-y-2">
      {reasons.map((reason, index) => (
        <li key={`${reason.stage}-${reason.reason}`} className="flex items-center gap-3">
          <span
            className="w-56 shrink-0 truncate text-xs"
            style={{ color: 'var(--ink-secondary)' }}
            title={reason.reason}
          >
            {reason.reason}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded" style={{ background: 'var(--grid)' }}>
            <div
              className="h-full rounded"
              style={{
                width: `${(reason.orders / max) * 100}%`,
                // The top reason is the one being acted on; the rest are
                // context, so they recede rather than competing for attention.
                background: index === 0 ? 'var(--status-critical)' : 'var(--status-serious)',
              }}
            />
          </div>
          <span
            className="tabular w-14 shrink-0 text-right text-xs font-medium"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatNumber(reason.orders)}
          </span>
          <span
            className="tabular w-24 shrink-0 text-right text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            {formatCompactUzs(reason.lost.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}
