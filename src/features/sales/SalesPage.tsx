'use client'

import dynamic from 'next/dynamic'
import { useEffect } from 'react'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import {
  ConfirmationFaktSection,
  FaktHeadline,
  useFaktBoard,
} from '@/features/sales/ConfirmationFaktSection'
import { DeliveryBoardSection } from '@/features/sales/DeliveryBoardSection'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet, type FaktTrendPointDto } from '@/lib/api'
import { t } from '@/lib/messages'

/**
 * Savdo dinamikasi — FAKT 1 and FAKT 2, and nothing else.
 *
 * WHAT THIS PAGE STOPPED BEING, on the client's instruction of 2026-09-10:
 * «bu boʻlimda koʻp malumotlar ortiqcha boʻlib ketgan… qolgan pastdagisini
 * toʻliqligicha tozalashliging kerak… menga bu boʻlim fakt 1 va fakt 2 va
 * bitrix24dan». Five blocks came off the screen in one pass —
 *
 *   · the «Yopilgan tushum» hero figure and the composition line under it
 *   · «Yopilgan bitimlar boʻyicha» — six tiles on the CLOSE-date clock
 *   · «Savdo pulsi» — cycle time, velocity, value-weighted win rate
 *   · «Bosqichlar qamrovi» and «Mahsulotlar boʻyicha»
 *   · «Manbalar boʻyicha» — the sources table
 *
 * — and with them five of the page's seven requests: `/analytics/sales`,
 * `/analytics/sources`, `/analytics/products`, `/insights/pulse` and
 * `/insights/flow` are all gone. That is the second half of the same ask
 * («yengil va optimal ishlashligi tarafdoriman»), and it is not a saving that
 * had to be engineered: the blocks WERE the requests.
 *
 * ONE COHORT, ONE CLOCK, AND SO NO RECONCILIATION. Everything removed was
 * measured on a different clock from what remains — revenue and the tile band
 * on the deal's CLOSE date and its assignee, the FAKT spine on the order's
 * arrival in the confirmation queue (C4:NEW) and its operator. Half the prose
 * this file used to carry existed to stop a reader concluding one of the two
 * was broken. With one clock on the page that prose is not shortened, it is
 * unnecessary.
 *
 * TWO REQUESTS REMAIN AND THEY ARE THE SAME ENDPOINT: `useFaktBoard` for the
 * totals, teams and band, and `?include=faktTrend` for the daily series. Both
 * are `/analytics/sellers` on `basis=queue`, so the headline pair, the chart
 * under it and the tiles under that cannot disagree.
 *
 * THE PRODUCT AND STAGE FILTERS ARE NOT OFFERED HERE ANY MORE. Nothing left
 * on the screen honours them — an order has no product until it is itemised,
 * and the queue cohort has no stage of its own — so the toolbar used to hand
 * the reader two controls that changed nothing and a caption apologising for
 * them. `insightsIgnoreFilters` and every line it gated went with them.
 */

/**
 * The trend chart is loaded on its own, not with the page.
 *
 * recharts is 379 KB unparsed — 109 KB over the wire — and it sat in the
 * SYNCHRONOUS entry set of this route, which is about 65% of what the screen
 * downloads and all of it parsed before hydration, i.e. before the first
 * `/api/v1` request is issued. The reader was waiting on a charting library
 * to compile in order to be shown a skeleton.
 *
 * `ssr: false` forfeits nothing: the chart draws inside recharts'
 * `ResponsiveContainer`, which measures the DOM in an effect and renders an
 * empty box on the server either way. The fallback is the SAME
 * `ChartSkeleton height={300}` the slot below already shows while the query is
 * in flight, so a late chunk is not a second visible state.
 */
const FaktTrendChart = dynamic(
  () => import('@/components/charts/FaktTrendChart').then((m) => m.FaktTrendChart),
  { ssr: false, loading: () => <ChartSkeleton height={300} /> },
)

/**
 * Fetch the chart chunk DURING the round trip that has to happen anyway.
 *
 * Left to the render that first has data, the download starts only once the
 * API answers and two costs that could overlap are serialised instead.
 * Fire-and-forget on purpose — a failed warm-up is not an error state; the
 * real import runs again at render and reports its own failure there.
 */
function useWarmTrendChart() {
  useEffect(() => {
    void import('@/components/charts/FaktTrendChart')
  }, [])
}

export function SalesPage() {
  const { apiParams } = useDashboardFilters()
  useWarmTrendChart()

  /*
    THE SAME REQUEST THE FAKT SECTION MAKES, AND THAT IS THE POINT.

    `useFaktBoard` issues one query under one key; TanStack serves both call
    sites from the one cache entry, so the hero's FAKT 1 / FAKT 2 and the band
    under them are the same answer for the same window and cannot drift apart
    by a refetch. Fetching the board here separately would have been a second
    request for one payload and a second chance to disagree.
  */
  const faktBoard = useFaktBoard()

  /*
    THE DAILY SERIES, on its own key rather than as a field on the board.

    Same endpoint, same cohort, same `basis=queue` default — `include=faktTrend`
    asks for the per-bucket breakdown the board answers only in total. Keeping
    it separate is what lets the headline pair render the moment the board
    lands, without waiting on the heavier per-day aggregation.

    A FAILURE HERE NO LONGER FAILS SILENTLY. It used to: the chart's subject
    was the revenue area and these two were references drawn over it, so losing
    them left a working panel. They ARE the panel now, so the slot below
    carries its own error state and its own retry.
  */
  const faktTrend = useQuery({
    queryKey: ['sellers', 'faktTrend', apiParams],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<readonly FaktTrendPointDto[]>(
        '/analytics/sellers',
        { ...apiParams, include: 'faktTrend' },
        signal,
      ),
    placeholderData: keepPreviousData,
  })

  const faktPoints = faktTrend.data?.data ?? []

  /**
   * The dashed reference on the chart: the mean of FAKT 1 across the buckets
   * on screen, so "is this day above or below the period's own bar?" is
   * answerable from the plot. Context in ink, not a series — and pointless
   * under two buckets, where the average IS the data.
   *
   * OF FAKT 1, AND THE LABEL SAYS SO. One hairline cannot be the average of
   * two series; drawing it unnamed over a two-line chart invites the reader to
   * attach it to whichever line is nearer.
   */
  const trendAverage =
    faktPoints.length >= 2
      ? faktPoints.reduce((sum, point) => sum + point.fakt1, 0) / faktPoints.length
      : undefined

  /**
   * What one point on the chart actually is.
   *
   * READ OFF THE DATA, not off the preset. The server widens the bucket as the
   * window grows — daily up to about two months, then weekly, then monthly —
   * and the payload carries no granularity field, so the honest way to caption
   * the chart is to measure the gap between the points it is drawing. Nothing
   * to measure under two points, and then the caption drops the claim rather
   * than guessing.
   */
  const bucketLabel = (() => {
    if (faktPoints.length < 2) return null

    const days =
      (new Date(faktPoints[1]!.date).getTime() - new Date(faktPoints[0]!.date).getTime()) /
      86_400_000

    if (days <= 2) return t.chart.buckets.day
    if (days <= 10) return t.chart.buckets.week
    return t.chart.buckets.month
  })()

  return (
    <PageShell
      title={t.nav.sales}
      meta={faktTrend.data?.meta ?? faktBoard.query.data?.meta}
      stale={[faktBoard.query, faktTrend].some((q) => q.isPlaceholderData)}
      /*
        THREE CONTROLS, NOT FIVE. `/analytics/sellers` honours the employee,
        department and source filters and drops the other two
        (`sellerBoardService.boardFilters`), and nothing else is left on this
        screen to honour them — so a product or stage control here would be a
        control that does nothing.
      */
      filters={{ employees: true, departments: true, sources: true }}
    >
      {/*
        The lead instrument — the page's ONE hero, and now its only chart.

        The pair sits above the plot that draws it: figure and chart are one
        panel, so the numbers are never a blank tile and the chart is never an
        unheadlined plot. `.card-hero` + `.brackets` mark it as the flagship;
        nothing else on the page wears either class.
      */}
      <Card className="card-hero brackets reveal">
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--ink-primary)' }}
            >
              {t.chart.faktTrend}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {t.chart.faktTrendBasis}
              {bucketLabel && `, ${bucketLabel}`}
            </p>
          </div>
        </header>

        {/*
          THE PAIR IS NEVER STACKED, NESTED OR SUBTRACTED — see `FaktHeadline`.
          Two peers on one row, each naming its own clock above.

          A THIRD FIGURE USED TO SIT BESIDE THEM. «Yopilgan tushum» — closed
          revenue, on the close-date clock — came off on 2026-09-10 with the
          «Shundan …%» composition line that explained it. Both were true and
          both were about a different cohort from everything else on this
          screen; the client asked for one subject («menga bu boʻlim fakt 1 va
          fakt 2»), and two of three columns is what one subject looks like.
        */}
        <div className="px-5 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <FaktHeadline data={faktBoard.data} status={faktBoard.status} />
          </div>
        </div>

        {/*
          The chart keeps the guard the old page had: an API failure or an
          empty payload renders a message and a retry, never a silent blank
          plot area under a confident headline.
        */}
        <div className="px-5 pt-4 pb-5">
          {faktTrend.isPending ? (
            <ChartSkeleton height={300} />
          ) : faktTrend.isError ? (
            <ErrorState
              message={(faktTrend.error as Error | null)?.message}
              onRetry={() => void faktTrend.refetch()}
            />
          ) : faktPoints.length === 0 ? (
            <EmptyState
              title="Bu davrda maʼlumot yoʻq"
              body="Tanlangan davrda tasdiqlash navbatiga tushgan buyurtma topilmadi."
            />
          ) : (
            <FaktTrendChart
              data={faktPoints}
              height={300}
              referenceValue={trendAverage}
              referenceLabel="FAKT 1 · davr oʻrtachasi"
            />
          )}
        </div>
      </Card>

      {/*
        THE REST OF THE CONFIRMATION COHORT, directly under the pair it
        explains — the page's spine since 2026-09-09 and, since 2026-09-10,
        the whole of the rest of the page.

        It answers what the hero cannot: where the rest of FAKT 1 went and
        which ROP team is carrying the month. See `ConfirmationFaktSection`.
      */}
      <ConfirmationFaktSection />

      {/*
        WHERE THOSE ORDERS PHYSICALLY ARE, and the last thing on the page.

        The client asked for the Доставка funnel's own figures to stay on this
        screen and for its columns to be named as Bitrix24 names them
        (2026-09-10). It reads last because it answers last: the chart says
        what was confirmed and delivered, the band says what is left of FAKT 1,
        and this says which hub or courier is holding it right now.

        IT IS THE ONE BLOCK HERE ON A DIFFERENT CLOCK — a snapshot, not a
        window — which is why it carries its own caption saying so rather than
        sitting silently under the page's date range. See
        `DeliveryBoardSection`.
      */}
      <DeliveryBoardSection />
    </PageShell>
  )
}
