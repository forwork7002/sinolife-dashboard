'use client'

import dynamic from 'next/dynamic'

import { CategoryBarList, type CategoryBarRow } from '@/components/charts/CategoryBarList'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { CallRowTable } from '@/features/customers/CallRowTable'
import type { CallActivityDto } from '@/lib/api'
import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import { formatDate, formatDuration, formatNumber, formatPercent } from '@/lib/format'

/**
 * recharts is loaded with the chart, not with the page — the reason SalesPage
 * gives: it is most of what the route downloads and all of it parses before
 * the first request is issued. The fallback is the skeleton the card shows
 * while the query is in flight, so a late chunk is not a second visible state.
 */
const CallTalkChart = dynamic(
  () => import('@/components/charts/CallTalkChart').then((m) => m.CallTalkChart),
  { ssr: false, loading: () => <ChartSkeleton height={260} /> },
)

type Status = 'loading' | 'error' | 'ready'

/**
 * «Qoʻngʻiroqlar» — the telephony block, on the dashboard's window.
 *
 * FIVE TILES AND THE LAST TWO ARE A PAIR. «Oʻrtacha» and «Median» sit side by
 * side because either alone misdescribes this floor: 169 s against 53 s above
 * the data floor, because 8.4% of calls pass ten minutes and hold half the talk
 * time. The pair is the block's claim and the band card is its evidence.
 *
 * THE MEAN TILE IS NULL WHEN NOTHING CONNECTED, never zero — `StatTile` renders
 * null as an em dash and zero as a measurement.
 *
 * «BAZA / BAZA EMAS» COMES FIRST AMONG THE CARDS, because it is what the client
 * asked for by name («база не база мижозларга call duration»). A База customer
 * is one who had a База deal BEFORE the call — the card's hint says so,
 * because «bazada» alone reads as today.
 *
 * THE BAND CARD'S TWO PANELS SHARE ONE ROW ORDER. `CategoryBarList` stacked:
 * share of calls above, talk hours below, the lower panel never re-sorted.
 * That is the component's stated mechanism, and it is what makes «few calls,
 * most of the hours» readable in one glance.
 *
 * THE FLOOR CLAUSE IS CONDITIONAL. It prints only when the window reached below
 * `CALL_DATA_FLOOR`, so a reader whose window is wholly honest is not told
 * about a problem they do not have.
 */
export function CallActivitySection({
  data,
  status,
  errorMessage,
  onRetry,
}: {
  data: CallActivityDto | undefined
  status: Status
  errorMessage?: string
  onRetry?: () => void
}) {
  const total = data?.total
  const floorDate = formatDate(CALL_DATA_FLOOR.toISOString())

  const hint = [
    'Qoʻngʻiroq sanasi boʻyicha · tanlangan davr',
    data?.floorApplied
      ? `${floorDate} dan oldingi qoʻngʻiroqlar koʻrsatilmaydi — ular portaldan chala yozib olingan`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const meanSec = total && total.connected > 0 ? total.talkSec / total.connected : null

  const shareRows: CategoryBarRow[] = (data?.durationBands ?? []).map((band) => ({
    key: band.key,
    label: band.label,
    value: band.sharePercent,
    display: formatPercent(band.sharePercent),
    meta: `${formatNumber(band.calls)} ta qoʻngʻiroq`,
  }))

  const hourRows: CategoryBarRow[] = (data?.durationBands ?? []).map((band) => ({
    key: band.key,
    label: band.label,
    value: band.talkSec,
    display: `${formatNumber(Math.round((band.talkSec / 3600) * 10) / 10)} soat`,
  }))

  const customerRows: CategoryBarRow[] = (data?.customerBands ?? []).map((band) => ({
    key: band.key,
    label: `${band.label} ta qoʻngʻiroq`,
    value: band.customers,
    display: `${formatNumber(band.customers)} ta mijoz`,
    meta: band.customers > 0 ? `oʻrtacha suhbat ${formatDuration(band.avgTalkSec)}` : undefined,
  }))

  const hasSeries = (data?.seriesBySide.length ?? 0) > 0

  return (
    <section className="flex flex-col gap-3" aria-label="Qoʻngʻiroqlar">
      <SectionHeader title="Qoʻngʻiroqlar" hint={hint} />

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          status={status}
          label="Qoʻngʻiroqlar soni"
          value={total?.calls ?? null}
          unit="count"
          hint={total ? `${formatNumber(total.customers)} ta mijozga` : undefined}
        />
        <StatTile
          status={status}
          label="Ulangan"
          value={total?.connectPercent ?? null}
          unit="percent"
          hint={total ? `${formatNumber(total.connected)} ta suhbat boʻldi` : undefined}
        />
        <StatTile
          status={status}
          label="Suhbat vaqti"
          value={total ? total.talkSec / 3600 : null}
          unit="hours"
        />
        <StatTile
          status={status}
          label="Oʻrtacha suhbat"
          value={meanSec}
          unit="duration"
          hint="bir necha uzun suhbat koʻtaradi"
        />
        <StatTile
          status={status}
          label="Median suhbat"
          value={total?.medianSec ?? null}
          unit="duration"
          hint={
            total?.p90Sec != null
              ? `yarmi shundan qisqa · p90 ${formatDuration(total.p90Sec)}`
              : 'yarmi shundan qisqa'
          }
        />
      </div>

      <ChartCard
        title="Baza va baza emas mijozlar"
        hint="Baza mijozi — qoʻngʻiroq paytida «База» voronkasida deali boʻlgan mijoz."
      >
        <CallRowTable
          rows={data?.sides ?? []}
          nameHeader="Mijoz turi"
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
        />
      </ChartCard>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title="Kunlik suhbat vaqti"
          hint="Ulangan suhbatlar, soatda. Ustunlar yigʻindisi — «Suhbat vaqti»."
        >
          {status === 'loading' ? (
            <ChartSkeleton height={260} />
          ) : status === 'error' ? (
            <ErrorState message={errorMessage} onRetry={onRetry} />
          ) : !hasSeries ? (
            <EmptyState
              title="Bu davrda qoʻngʻiroq yoʻq"
              body="Tanlangan davrda portal hech qanday ulangan suhbat yozmagan."
            />
          ) : (
            <CallTalkChart data={data?.seriesBySide ?? []} height={260} />
          )}
        </ChartCard>

        <ChartCard
          title="Suhbat davomiyligi boʻyicha"
          hint="Yuqorida — qoʻngʻiroqlar ulushi, pastda — shu qoʻngʻiroqlarga ketgan vaqt. Qatorlar tartibi bir xil."
        >
          <div className="flex flex-col gap-4">
            <CategoryBarList rows={shareRows} mode="share" status={status} />
            <CategoryBarList rows={hourRows} mode="magnitude" status={status} />
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="Komandalar"
        hint="Xodimning asosiy boʻlimi boʻyicha. Qatorlar yigʻindisi yuqoridagi koʻrsatkichlarga teng."
      >
        <CallRowTable
          rows={data?.teams ?? []}
          nameHeader="Komanda"
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
        />
      </ChartCard>

      <ChartCard title="Operatorlar" hint="Suhbat vaqti boʻyicha tartiblangan.">
        <CallRowTable
          rows={data?.operators ?? []}
          nameHeader="Operator"
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
          maxHeight="60dvh"
        />
      </ChartCard>

      <ChartCard
        title="Bitta mijozga qancha qoʻngʻiroq"
        hint="Davr ichida har bir mijozga qilingan qoʻngʻiroqlar soni."
      >
        <CategoryBarList rows={customerRows} mode="magnitude" status={status} />
        {data && data.unlinkedCalls > 0 && (
          <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {formatNumber(data.unlinkedCalls)} ta qoʻngʻiroq hech bir mijozga bogʻlanmagan va bu
            yerda hisobga olinmagan.
          </p>
        )}
      </ChartCard>
    </section>
  )
}
