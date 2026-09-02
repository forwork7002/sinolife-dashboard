'use client'

import { useQuery } from '@tanstack/react-query'

import { ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, ChartCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type MoneyDto, type PeriodDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatDate, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

interface KpiItem {
  readonly kpiId: string
  readonly employeeId: string | null
  readonly fullName: string
  readonly metric: string
  readonly unit: 'money' | 'count' | 'percent'
  readonly target: MoneyDto | null
  readonly actual: MoneyDto | null
  readonly targetValue: number
  readonly actualValue: number
  readonly achievementPercent: number | null
  readonly status: string
}

interface KpiPayload {
  /**
   * The span every figure here is measured over: the PLAN's period, not the
   * window in the address bar.
   *
   * Null when no targets are set, which is the portal's state today. The
   * preset above still chooses which plan is in view — it picks the plan whose
   * period contains the window's last day — but it does not slice it, because
   * a month's target says nothing about a Tuesday.
   */
  readonly planPeriod: PeriodDto | null
  readonly elapsedPercent: number
  readonly overallPercent: number | null
  readonly counts: {
    readonly achieved: number
    readonly onTrack: number
    readonly atRisk: number
    readonly behind: number
  }
  readonly items: readonly KpiItem[]
}

const METRIC_LABELS: Record<string, string> = {
  REVENUE: 'Tushum',
  DEALS_WON: 'Yopilgan bitimlar',
  DEALS_CREATED: 'Yangi bitimlar',
  AVERAGE_DEAL: 'Oʻrtacha bitim',
  CONVERSION_RATE: 'Konversiya',
}

export function KpiPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['kpi', apiParams],
    queryFn: ({ signal }) => apiGet<KpiPayload>('/kpi', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  const data = query.data?.data

  const formatValue = (item: KpiItem, which: 'target' | 'actual') => {
    const money = which === 'target' ? item.target : item.actual
    const raw = which === 'target' ? item.targetValue : item.actualValue

    if (item.unit === 'money') return money ? formatCompactUzs(money.amount) : NO_VALUE
    if (item.unit === 'percent') return formatPercent(raw / 100)
    return formatNumber(raw)
  }

  const columns: Column<KpiItem>[] = [
    {
      key: 'employee',
      header: t.table.employee,
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.fullName}
        </span>
      ),
    },
    {
      key: 'metric',
      header: 'Koʻrsatkich',
      render: (row) => METRIC_LABELS[row.metric] ?? row.metric,
    },
    {
      key: 'target',
      header: 'Reja',
      align: 'right',
      numeric: true,
      render: (row) => formatValue(row, 'target'),
    },
    {
      key: 'actual',
      header: 'Haqiqiy',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{formatValue(row, 'actual')}</span>
      ),
    },
    {
      key: 'progress',
      header: 'Bajarilishi',
      width: '160px',
      render: (row) => <ProgressBar percent={row.achievementPercent} expected={data?.elapsedPercent ?? 0} />,
    },
    {
      key: 'status',
      header: t.table.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  return (
    <PageShell
      title={t.nav.kpi}
      /*
        The methodology is named HERE, not in the nav label.

        The section used to be called "Yanovskiy tizimi bahosi". The label lost
        the surname — a nav rail is for finding a screen, and a person's name
        tells an operator nothing about what is on it — but the client calls
        the method that, so it has to survive somewhere a reader can connect it
        to the numbers. This line is that place.
      */
      /*
        THE PLAN'S DATES, NOT THE ADDRESS BAR'S.

        The pace figure beside them is the plan's own clock. Both used to come
        from the report window, which is to-date — so on the 2nd of a 30-day
        month this line read "79% qismi oʻtdi" and every target below it was
        graded BEHIND against a month that was six per cent gone.
      */
      description={
        data?.planPeriod
          ? `Yanovskiy tizimi boʻyicha baholash · ${formatDate(
              data.planPeriod.start,
            )} – ${formatDate(
              new Date(new Date(data.planPeriod.end).getTime() - 1).toISOString(),
            )} rejasi · ${formatPercent(data.elapsedPercent, 0)} qismi oʻtdi`
          : 'Yanovskiy tizimi boʻyicha baholash'
      }
      meta={query.data?.meta}
      filters={{ employees: true, departments: true }}
    >
      {/*
        The lead instrument — the page's one hero, the only panel wearing the
        registration brackets.

        An achievement percentage is meaningless without the clock: 40% on
        the 12th is ahead, on the 28th it is a problem. So the hero states
        the comparison in one breath — elapsed beside achieved — and draws it
        as the same pace bar every table row below carries, at hero width.
        When the portal's KPI table is empty (it is, today) the figure is an
        em dash, never a confident zero: "no plans set" is a different fact
        from "nothing achieved".
      */}
      <section
        className="card-hero brackets reveal px-5 py-5 sm:px-6"
        aria-label={t.cards.kpiAchievement}
      >
        {!data && query.isError ? (
          <ErrorState
            message={query.error instanceof ApiClientError ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {t.cards.kpiAchievement}
            </p>

            {!data ? (
              // Sized to the hero figure below, so ready never reflows loading.
              <div className="skeleton mt-2 h-[40px] w-40" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : data.overallPercent !== null ? (
              <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                <AnimatedNumber
                  value={data.overallPercent}
                  format={(v) => formatPercent(v, 0)}
                  duration={900}
                />
              </p>
            ) : (
              <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                {NO_VALUE}
              </p>
            )}

            {data && (
              /*
                The pace comparison, stated as words before it is drawn as a
                bar: the two percentages share a sentence so the reader never
                has to carry one across the panel to reach the other.
              */
              <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                reja oʻtishi {formatPercent(data.elapsedPercent, 0)} · bajarilish{' '}
                {formatPercent(data.overallPercent, 0)}
              </p>
            )}

            {data && data.overallPercent !== null && (
              <div className="mt-3 max-w-md">
                <ProgressBar percent={data.overallPercent} expected={data.elapsedPercent} />
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CountCard label={t.kpiStatus.ACHIEVED} value={data?.counts.achieved} tone="good" />
        <CountCard label={t.kpiStatus.ON_TRACK} value={data?.counts.onTrack} tone="good" />
        <CountCard label={t.kpiStatus.AT_RISK} value={data?.counts.atRisk} tone="warning" />
        <CountCard label={t.kpiStatus.BEHIND} value={data?.counts.behind} tone="critical" />
      </div>

      <ChartCard
        title="KPI rejalari"
        hint="Har bir reja oʻz davri boʻyicha — rejadan oʻtgan vaqtga nisbatan baholanadi"
      >
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.kpiId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          emptyBody="Tanlangan davr uchun KPI rejalari belgilanmagan."
          minWidth={860}
        />
      </ChartCard>
    </PageShell>
  )
}

function CountCard({
  label,
  value,
  tone,
}: {
  label: string
  value?: number
  tone: 'good' | 'warning' | 'critical'
}) {
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : 'var(--status-critical)'

  return (
    <Card className="px-4 py-3.5">
      <p
        className="flex items-center gap-1.5 text-xs font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
        />
        {label}
      </p>
      <p
        className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink-primary)' }}
      >
        {value === undefined ? NO_VALUE : formatNumber(value)}
      </p>
    </Card>
  )
}

/**
 * Attainment bar with an expected-pace marker.
 *
 * The marker is the point of it: 40% of a monthly target on the 12th is ahead,
 * and on the 28th it is a problem. A bare percentage cannot express that, so
 * the bar carries the pace line and the colour follows the comparison.
 */
function ProgressBar({ percent, expected }: { percent: number | null; expected: number }) {
  if (percent === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  const clamped = Math.min(100, Math.max(0, percent))
  const onPace = percent >= expected
  const color = percent >= 100 ? 'var(--status-good)' : onPace ? 'var(--seq-450)' : 'var(--status-warning)'

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2 flex-1 overflow-hidden rounded-full"
        style={{ background: 'var(--grid)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: color }}
        />
        {expected > 0 && expected < 100 && (
          <span
            className="absolute top-0 h-full w-px"
            style={{ left: `${expected}%`, background: 'var(--ink-muted)' }}
            title={`Kutilgan: ${Math.round(expected)}%`}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="tabular w-11 text-right text-xs" style={{ color: 'var(--ink-primary)' }}>
        {formatPercent(percent, 0)}
      </span>
    </div>
  )
}
