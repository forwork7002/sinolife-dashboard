'use client'

import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useMemo } from 'react'

import { type CallTimePoint, dayPoints, hourPoints } from '@/components/charts/callTimePoints'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/Stat'
import { CallTable } from '@/features/calls/CallTable'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type CallActivityDto, type PeriodDto, apiGet } from '@/lib/api'
import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import { formatDate, formatDateTime, formatDuration, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * recharts is loaded with the chart, not with the page — the reason SalesPage
 * gives: it is most of what the route downloads and all of it parses before
 * the first request is issued.
 */
const CallTimeChart = dynamic(
  () => import('@/components/charts/CallTimeChart').then((m) => m.CallTimeChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
)

type Status = 'loading' | 'error' | 'ready'

/**
 * «Qoʻngʻiroqlar» — who spoke to customers, how long, and when.
 *
 * RENAMED AND STRIPPED ON 2026-09-17, on the client's instruction: «Mijozlar va
 * qoʻngʻiroqlar» → «Qoʻngʻiroqlar», «eng asosiy malumotlarni koʻrsat, keraksiz
 * narsalarni olib tashla… har bir narsa aniq vaqti bilan… kim qancha
 * gaplashayapti». Gone: the customer-flow band (its endpoint still serves
 * «Mijoz qaytishi»), the База / not-База split, the duration and
 * calls-per-customer bands, the unlinked-calls note and p90. What stayed is
 * what answers «who talks how much»: five tiles, the operators, the teams,
 * and two charts that say WHEN.
 *
 * THE URL AND THE SECTION ID STAY `/customers` / `customers`. Section ids are
 * stored on every account's grant list; renaming the id would silently take the
 * screen away from everyone who holds it. Only the words changed.
 *
 * ONE REQUEST, ONE CLOCK. Every figure is a grouping of one scan of
 * `call_record` on the call's START time, clamped at `CALL_DATA_FLOOR` — so the
 * tiles, both tables and both charts sum to each other by construction.
 *
 * THE QUERY SENDS THE WINDOW AND NOTHING ELSE. `apiParams` also carries any
 * employee, stage or source filter left in the URL by another screen;
 * `/insights/calls` honours none of them, so sending them would only mint
 * cache entries that all hold the same answer.
 */
export function CallsPage() {
  const { apiParams } = useDashboardFilters()

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const calls = useQuery({
    queryKey: ['insights-calls', windowParams],
    queryFn: ({ signal }) => apiGet<CallActivityDto>('/insights/calls', windowParams, signal),
  })

  const status: Status = calls.isPending ? 'loading' : calls.isError ? 'error' : 'ready'

  return (
    <PageShell
      title={t.modules.calls.title}
      description={t.modules.calls.lead}
      accent="var(--series-1)"
      meta={calls.data?.meta}
      stale={calls.isPlaceholderData}
    >
      <CallActivity
        data={calls.data?.data}
        period={calls.data?.meta.period}
        status={status}
        errorMessage={calls.error instanceof Error ? calls.error.message : undefined}
        onRetry={() => void calls.refetch()}
      />
    </PageShell>
  )
}

/**
 * The screen's body, separate from the query so it renders from a fixture —
 * the demo seed holds no calls, so production figures in a test are the only
 * way anybody sees it outside production.
 */
export function CallActivity({
  data,
  period,
  status,
  errorMessage,
  onRetry,
}: {
  data: CallActivityDto | undefined
  period: PeriodDto | undefined
  status: Status
  errorMessage?: string
  onRetry?: () => void
}) {
  const total = data?.total
  const meanSec = total && total.connected > 0 ? total.talkSec / total.connected : null
  const hours = hourPoints(data?.hours ?? [])
  const days = dayPoints(data?.days ?? [])
  const manyDays = days.length > 1

  return (
    <div className="flex flex-col gap-4">
      <WhenLine data={data} period={period} />

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          status={status}
          label="Qoʻngʻiroqlar"
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
          label="Jami suhbat vaqti"
          value={total?.talkSec ?? null}
          unit="duration"
          hint="faqat ulangan qoʻngʻiroqlar"
        />
        <StatTile
          status={status}
          label="Median suhbat"
          value={total?.medianSec ?? null}
          unit="duration"
          hint={
            meanSec !== null
              ? `yarmi shundan qisqa · oʻrtacha ${formatDuration(meanSec)}`
              : 'yarmi shundan qisqa'
          }
        />
        <StatTile
          status={status}
          label="Gaplashgan operatorlar"
          value={data ? data.operators.length : null}
          unit="count"
          hint={data ? `${formatNumber(data.teams.length)} ta komandadan` : undefined}
        />
      </div>

      <ChartCard
        title="Operatorlar — kim qancha gaplashdi"
        hint="Suhbat vaqti boʻyicha tartiblangan. Foiz — davrdagi jami suhbat vaqtidan ulushi; vaqtlar Toshkent vaqti."
      >
        <CallTable
          kind="operator"
          rows={data?.operators ?? []}
          totalTalkSec={total?.talkSec ?? 0}
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
          maxHeight="65dvh"
        />
      </ChartCard>

      <div className={`grid gap-3 ${manyDays ? 'xl:grid-cols-2' : ''}`}>
        <ChartCard
          title="Soatlar boʻyicha"
          hint={
            manyDays
              ? 'Qoʻngʻiroq boshlangan soat (Toshkent vaqti), davrdagi barcha kunlar yigʻindisi.'
              : 'Qoʻngʻiroq boshlangan soat, Toshkent vaqti.'
          }
        >
          <TimeBody
            status={status}
            points={hours}
            errorMessage={errorMessage}
            onRetry={onRetry}
            headerLabel={(point) => {
              const hour = point.label.slice(0, 2)
              return `${hour}:00 – ${hour}:59`
            }}
          />
        </ChartCard>

        {manyDays && (
          <ChartCard title="Kunlar boʻyicha" hint="Har bir kun, Toshkent vaqti.">
            <TimeBody
              status={status}
              points={days}
              errorMessage={errorMessage}
              onRetry={onRetry}
            />
          </ChartCard>
        )}
      </div>

      <ChartCard
        title="Komandalar"
        hint="Xodimning asosiy boʻlimi boʻyicha. Qatorlar yigʻindisi yuqoridagi koʻrsatkichlarga teng."
      >
        <CallTable
          kind="team"
          rows={data?.teams ?? []}
          totalTalkSec={total?.talkSec ?? 0}
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
        />
      </ChartCard>
    </div>
  )
}

/**
 * THE WINDOW AND THE FRESHNESS, TO THE MINUTE, BEFORE ANY NUMBER.
 *
 * Three facts a reader needs to trust «Bugun»: the exact span asked for, the
 * newest call the sync has actually written (CALLS arrives on the three-hourly
 * reference pass, so at 14:30 the newest can honestly be 11:48), and — only
 * when it bit — that the window was clamped at the data floor.
 */
function WhenLine({
  data,
  period,
}: {
  data: CallActivityDto | undefined
  period: PeriodDto | undefined
}) {
  if (!data || !period) return null

  const last = data.total.lastCallAt
  const parts = [
    `Davr: ${formatDateTime(period.start)} – ${formatDateTime(new Date(new Date(period.end).getTime() - 60_000).toISOString())}`,
    last ? `oxirgi yozilgan qoʻngʻiroq: ${formatDateTime(last)}` : 'bu davrda qoʻngʻiroq yozilmagan',
    'Bitrix24 dan har ~3 soatda keladi',
  ]

  return (
    <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
      <p data-testid="calls-when">{parts.join(' · ')}</p>
      {data.floorApplied && (
        <p style={{ color: 'var(--status-warning)' }}>
          {formatDate(CALL_DATA_FLOOR.toISOString())} dan oldingi qoʻngʻiroqlar koʻrsatilmaydi —
          ular portaldan chala yozib olingan.
        </p>
      )}
    </div>
  )
}

function TimeBody({
  status,
  points,
  errorMessage,
  onRetry,
  headerLabel,
}: {
  status: Status
  points: readonly CallTimePoint[]
  errorMessage?: string
  onRetry?: () => void
  headerLabel?: (point: CallTimePoint) => string
}) {
  if (status === 'loading') return <ChartSkeleton height={240} />
  if (status === 'error') return <ErrorState message={errorMessage} onRetry={onRetry} />
  if (points.length === 0) {
    return (
      <EmptyState
        title="Bu davrda qoʻngʻiroq yoʻq"
        body="Tanlangan davrda portal hech qanday qoʻngʻiroq yozmagan."
      />
    )
  }
  return <CallTimeChart points={points} headerLabel={headerLabel} height={240} />
}
