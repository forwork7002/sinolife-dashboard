'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { useFaktBoard } from '@/features/sales/ConfirmationFaktSection'
import {
  OUTCOME_SPECS,
  confirmedRateSeries,
  describeRateSpread,
} from '@/features/sales/confirmationOutcomes'
import { QUEUE_BASIS } from '@/features/shared/faktVocabulary'
import type { FaktTrendPointDto, SellerBoardTotalsDto } from '@/lib/api'
import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

/**
 * WHERE THE WHOLE QUEUE WENT — the five states of the confirmation cohort as
 * a partition of one total, and the confirmation rate day by day.
 *
 * Asked for on 2026-09-15: «tasdiqlanganlar, tasdiqlanmay chiqdilar bilan
 * tasdiqlanmaganlar nisbati … toʻliqroq malumot, oʻrtachasi». The hero above
 * prints FAKT 1 with Тасдиқланди and Тасдиқланмай чиқди already folded
 * together, and its hint says how many orders entered the queue in all; this
 * block is that hint opened up — every state with its count, its share of the
 * cohort and its money — directly under the figure it explains.
 *
 * NOTHING NEW IS FETCHED. The partition rides on the board `useFaktBoard`
 * already holds (`totals.outcomes`), and the daily line divides counts that
 * ride on the same trend points the FAKT chart draws. The page still makes
 * two requests to one endpoint, so nothing here can disagree with anything
 * above it — which is the property the 2026-09-10 rebuild of this screen was
 * about, and the reason this is not a third request to a third query.
 *
 * SHARES ARE OF THE COHORT, NEVER OF FAKT 1. 3 222 orders entered in August
 * and 2 890 left as an order; Тасдиқланмай чиқди is 0.5% of the first and
 * 0.6% of the second, and a reader comparing against the Тасдиқлаш board —
 * which divides by everything that entered — needs the first.
 */
export function ConfirmationOutcomeSection({
  points,
  trendStatus,
  trendError,
  onRetry,
}: {
  /** The same `?include=faktTrend` answer the hero chart draws. */
  points: readonly FaktTrendPointDto[]
  trendStatus: 'loading' | 'error' | 'ready'
  trendError?: string
  onRetry: () => void
}) {
  const { query, data, status } = useFaktBoard()
  const totals = data?.totals
  const series = useMemo(() => confirmedRateSeries(points), [points])
  const spread = describeRateSpread(series)

  return (
    <section
      aria-labelledby="outcome-heading"
      className="space-y-3"
      style={{
        opacity: query.isPlaceholderData ? 0.6 : 1,
        transition: 'opacity 150ms var(--ease-out)',
      }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="outcome-heading" className="eyebrow">
          Tasdiqlash natijasi · holatlar nisbati
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {QUEUE_BASIS} · butun kompaniya boʻyicha
        </p>
      </div>

      <Card className="reveal">
        <div className="grid gap-6 px-5 pt-4 pb-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <h3
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--ink-primary)' }}
            >
              Navbatga tushgan buyurtmalar qayerga ketdi
            </h3>
            <p className="mt-0.5 mb-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {totals && totals.cohortOrders > 0
                ? `${formatNumber(totals.cohortOrders)} ta buyurtmadan — soni, ulushi va summasi`
                : 'Har bir holatning soni, ulushi va summasi'}
            </p>
            {status === 'error' ? (
              <ErrorState
                message={(query.error as Error | null)?.message}
                onRetry={() => void query.refetch()}
              />
            ) : (
              <OutcomePartition totals={totals} status={status} />
            )}
          </div>

          <RateFigure totals={totals} status={status} />
        </div>

        {/*
          THE LINE UNDER THE PARTITION — the same rate, day by day, with the
          period's rate drawn across it. Its own states: the trend is a second
          request, and a failure here must not blank the partition above.
        */}
        <div className="border-t px-5 pt-4 pb-5" style={{ borderColor: 'var(--grid)' }}>
          <h3
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--ink-primary)' }}
          >
            Тасдиқланиш % kunlar kesimida
          </h3>
          <p className="mt-0.5 mb-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
            Punktir chiziq — davr oʻrtachasi: davrning barcha buyurtmalari boʻyicha, kunlar
            oʻrtachasi emas
          </p>
          {trendStatus === 'loading' ? (
            <ChartSkeleton height={240} />
          ) : trendStatus === 'error' ? (
            <ErrorState message={trendError} onRetry={onRetry} />
          ) : series.pooledRate === null ? (
            <EmptyState
              title="Bu davrda maʼlumot yoʻq"
              body="Tanlangan davrda tasdiqlash navbatiga tushgan buyurtma topilmadi."
            />
          ) : (
            <>
              <ConfirmedRateChart
                data={series.points}
                height={240}
                referenceValue={series.pooledRate}
                referenceLabel={`Davr oʻrtachasi · ${formatPercent(series.pooledRate)}`}
              />
              {spread && (
                <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {spread}
                </p>
              )}
            </>
          )}
        </div>
      </Card>
    </section>
  )
}

/**
 * Loaded on its own, like the hero chart: recharts is the heaviest thing on
 * this route and it is already being fetched for the FAKT chart, so this
 * costs one more small chunk rather than a second copy of the library.
 */
const ConfirmedRateChart = dynamic(
  () => import('@/components/charts/ConfirmedRateChart').then((m) => m.ConfirmedRateChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
)

/**
 * The five states as one bar and a legend that carries every figure.
 *
 * HAND-DRAWN, like `StatusCompositionBar` on Logistika and for the same
 * reason: five fixed categories summing to one total need no axis and no
 * hover — the legend prints count, share and money in full, so the picture
 * and the numbers are the same object. Not that component itself, because it
 * partitions MONEY and prints money alone; this partitions ORDERS (the ratio
 * the client asked for is a count) and prints the money beside each count.
 *
 * NO MINIMUM SEGMENT WIDTH, and a 0% state draws nothing: its number is in
 * the legend, and padding it to a legible sliver is how a composition bar
 * starts lying about the thing it exists to show.
 *
 * Exported for `tests/features/confirmationOutcomes.test.tsx`.
 */
export function OutcomePartition({
  totals,
  status,
}: {
  totals: SellerBoardTotalsDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  if (status === 'loading') {
    return (
      <div className="skeleton h-[152px] w-full rounded-lg" role="status">
        <span className="sr-only">Yuklanmoqda</span>
      </div>
    )
  }

  if (status === 'error' || !totals) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--status-critical)' }}>
        Olinmadi
      </p>
    )
  }

  const outcomes = totals.outcomes
  const cohort = totals.cohortOrders

  /*
    Two different absences, said differently. `outcomes` is null on the intake
    basis, which has no queue to have states in; a cohort of 0 is a window
    nothing entered. Neither is drawn as an empty rail — that would read as
    "everything is in the first state", the one thing an empty month is not.
  */
  if (outcomes === null) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        Bu asosda navbat holatlari oʻlchanmaydi.
      </p>
    )
  }
  if (cohort <= 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        Bu davrda navbatga buyurtma tushmagan.
      </p>
    )
  }

  const segments = OUTCOME_SPECS.map((spec) => {
    const slice = outcomes[spec.key]
    return {
      ...spec,
      orders: slice.orders,
      amount: slice.amount.amount,
      // The queue board's rounding, so a share here equals a rate there.
      sharePercent: Math.round((slice.orders / cohort) * 1000) / 10,
    }
  })

  return (
    <div>
      <div
        className="flex h-4 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--grid)' }}
        role="img"
        aria-label={segments.map((s) => `${s.label} ${formatPercent(s.sharePercent)}`).join(', ')}
      >
        {segments.map((segment) => {
          const width = (segment.orders / cohort) * 100
          if (width <= 0) return null
          return (
            <div
              key={segment.key}
              style={{ width: `${width}%`, background: segment.colour }}
              title={`${segment.label} · ${formatNumber(segment.orders)} ta`}
            />
          )
        })}
      </div>

      <ul className="mt-3 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-baseline gap-2 text-[12px]">
            <span
              aria-hidden
              className="mt-[3px] inline-block size-2 shrink-0 rounded-full"
              style={{ background: segment.colour }}
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-secondary)' }}>
              {segment.label}
            </span>
            <span
              className="w-[4.5rem] shrink-0 text-right tabular-nums"
              style={{ color: 'var(--ink-primary)' }}
            >
              {formatNumber(segment.orders)} ta
            </span>
            <span
              className="w-[3.5rem] shrink-0 text-right tabular-nums"
              style={{ color: 'var(--ink-muted)' }}
            >
              {formatPercent(segment.sharePercent)}
            </span>
            {/* Money in full, like every figure on this screen: reconciled
                against the Тасдиқлаш board's tiles, not scanned. */}
            <span
              className="hidden w-[8.5rem] shrink-0 text-right tabular-nums sm:inline"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {formatFullUzs(segment.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * «Тасдиқланиш %» as the block's one headline figure — the queue board's own
 * rate, from the payload, never recomputed here from the legend's rows.
 */
function RateFigure({
  totals,
  status,
}: {
  totals: SellerBoardTotalsDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const confirmed = totals?.outcomes?.CONFIRMED.orders ?? null

  return (
    <div className="min-w-0 lg:border-l lg:pl-6" style={{ borderColor: 'var(--grid)' }}>
      <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        Тасдиқланиш %
      </p>
      {status === 'loading' ? (
        <div className="skeleton mt-1.5 h-10 w-28" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' || !totals ? (
        <p className="mt-1.5 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        <p
          className="tabular mt-1.5 text-[2rem] leading-none font-semibold tracking-tight"
          style={{ color: 'var(--ink-primary)' }}
        >
          {formatPercent(totals.confirmedRate)}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
        {totals && confirmed !== null && totals.cohortOrders > 0
          ? `${formatNumber(confirmed)} / ${formatNumber(totals.cohortOrders)} ta — Тасдиқланди, navbatga tushganlarning hammasidan`
          : 'Тасдиқланди ÷ navbatga tushganlar'}
      </p>
      <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
        Tasdiqlash navbati sahifasidagi «Тасдиқланиш %» bilan bir xil hisob.
      </p>
    </div>
  )
}
