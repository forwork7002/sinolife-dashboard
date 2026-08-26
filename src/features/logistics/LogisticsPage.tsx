'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { GaugeTile, Meter, StatTile } from '@/components/ui/Stat'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
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

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const data = query.data?.data

  const returned = data?.reasons.filter((r) => r.stage === 'RETURNED') ?? []

  const cancelled = data?.reasons.filter((r) => r.stage === 'CANCELLED') ?? []
  /**
   * Losses before the order existed — where every recorded reason actually is.
   *
   * On this portal the delivery pipeline records no reason at all (82 losses,
   * all null) while the qualification funnel records 883. A page asking "why
   * did we lose them" that showed only the first was showing the only part
   * with no answer.
   */
  const preSale = data?.reasons.filter((r) => r.stage === 'PRE_SALE') ?? []

  /** Failures as a share of RESOLVED orders — the delivery rate's own base. */
  const failureRate = (() => {
    if (!data) return null
    const { delivered, refused, cancelledEarly } = data.totals
    const resolved = delivered + refused + cancelledEarly
    return resolved === 0 ? null : ((refused + cancelledEarly) / resolved) * 100
  })()
  const totals = data?.totals

  const columns: Column<LogisticsRowDto>[] = [
    {
      key: 'label',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
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
      // Both failure columns are emphasised the same way. Marking only
      // `refused` in critical red made one returned parcel louder than eighty
      // cancellations sitting in plain ink in the next column.
      render: (row) => <Failures count={row.refused} />,
    },
    {
      key: 'cancelled',
      header: 'Joʻnatilmay bekor',
      align: 'right',
      numeric: true,
      render: (row) => <Failures count={row.cancelledEarly} />,
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
          status={tileStatus}
          label="Buyurtmalar"
          value={totals?.orders ?? null}
          unit="count"
          hint={totals ? `${formatNumber(totals.inFlight)} tasi hali yoʻlda` : undefined}
        />
        {/* A count is a fact, not a judgement — a permanently green number
            spends the status hue on nothing. */}
        <StatTile status={tileStatus} label="Yetkazildi" value={totals?.delivered ?? null} unit="count" />
        <GaugeTile
          status={tileStatus}
          label="Yetkazish darajasi"
          value={totals?.deliveryRate ?? null}
          tone="auto"
          hint="Yakunlangan buyurtmalar ichida"
        />
        <StatTile
          status={tileStatus}
          label="Qaytdi / bekor"
          value={totals ? totals.refused + totals.cancelledEarly : null}
          unit="count"
          hint={
            totals
              ? `${formatNumber(totals.refused)} yoʻldan qaytdi, ${formatNumber(totals.cancelledEarly)} joʻnatilmay bekor`
              : undefined
          }
          /*
            Graded on the RATE, not on whether any failure exists at all.
            
            `refused > 0` turned the tile critical red for a single returned
            parcel out of 2,191 orders, while the 81 cancellations it also
            counts sat in plain ink. A threshold that trips on one is not a
            threshold. Against resolved orders — the same denominator the
            delivery rate uses — the two agree instead of contradicting.
          */
          tone={
            totals === undefined
              ? 'neutral'
              : failureRate === null || failureRate < 5
                ? 'neutral'
                : failureRate < 15
                  ? 'warning'
                  : 'critical'
          }
        />
        <StatTile
          status={tileStatus}
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
          // It rendered the error state with no way out of it: no message and
          // no retry, unlike the identical table directly above.
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
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
        {query.isError && (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        )}
        {data && !query.isError && returned.length === 0 && (
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
        {query.isError && (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        )}
        {data && !query.isError && cancelled.length === 0 && (
          <EmptyState
            title="Bekor qilingan buyurtma yoʻq"
            body="Bu davrda hech bir buyurtma joʻnatishdan oldin bekor qilinmagan."
          />
        )}
        {cancelled.length > 0 && <ReasonList reasons={cancelled} />}
      </ChartCard>

      <ChartCard
        title="Buyurtmagacha yoʻqotilganlar"
        hint="Buyurtmaga aylanmay, kvalifikatsiya bosqichida yoʻqolganlar. Operator koʻrsatgan sabab shu yerda yoziladi — yetkazish bosqichida sabab umuman qayd etilmaydi."
      >
        {query.isPending && <ChartSkeleton height={140} />}
        {query.isError && (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        )}
        {data && !query.isError && preSale.length === 0 && (
          <EmptyState
            title="Yoʻqotish yoʻq"
            body="Bu davrda buyurtmagacha bosqichda hech narsa yoʻqolmagan."
          />
        )}
        {preSale.length > 0 && <ReasonList reasons={preSale} />}
      </ChartCard>
    </PageShell>
  )
}

/** A failure count: zero recedes, anything else is stated in ink. */
function Failures({ count }: { count: number }) {
  return (
    <span style={{ color: count === 0 ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>
      {formatNumber(count)}
    </span>
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
 * The portal prefixes reason labels with pictographs — "✅ олиш нияти ёк".
 * A green checkmark in front of a LOSS reason reads as approval, so the
 * decoration is stripped for display; the raw string stays in the title.
 */
function reasonLabel(reason: string): string {
  return reason.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '') || reason
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
    readonly lost: { readonly amount: number } | null
  }[]
}) {
  const max = Math.max(...reasons.map((r) => r.orders), 1)

  /*
    No bar for a list of one.
    
    These bars are normalised to the largest row, so a lone row is ALWAYS
    full-width — one returned parcel drew exactly the same mark as eighty-one
    cancellations in the card above it. A comparison chart with nothing to
    compare is decoration wearing a data costume; the count says everything.
  */
  const comparable = reasons.length > 1

  return (
    <ul className="space-y-2">
      {reasons.map((reason) => (
        <li key={`${reason.stage}-${reason.reason}`} className="flex items-center gap-3">
          <span
            className="w-56 shrink-0 truncate text-xs"
            style={{ color: 'var(--ink-secondary)' }}
            title={reason.reason}
          >
            {reasonLabel(reason.reason)}
          </span>
          {comparable && (
            /*
              House bar geometry — the same height, radius and single
              magnitude hue as BarList, so the app speaks one bar language.
              The previous ordinal ramp restated what row order already says,
              and its lightest step fell under the 3:1 mark floor in light
              mode.
            */
            <div
              className="h-2 flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
            >
              <div
                className="grow-x h-full rounded-full"
                style={{
                  width: `${(reason.orders / max) * 100}%`,
                  background: 'var(--seq-450)',
                }}
              />
            </div>
          )}
          <span
            className="tabular w-14 shrink-0 text-right text-xs font-medium"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatNumber(reason.orders)}
          </span>
          <span
            className="tabular w-24 shrink-0 text-right text-xs"
            style={{ color: 'var(--ink-muted)' }}
            title={reason.lost === null ? 'Bu bosqichda summa hisoblanmaydi' : undefined}
          >
            {reason.lost === null ? NO_VALUE : formatCompactUzs(reason.lost.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}
