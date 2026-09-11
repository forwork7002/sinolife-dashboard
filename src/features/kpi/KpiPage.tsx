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
  /** Null when the metric could not be measured at all — see `actualForMetric`. */
  readonly actualValue: number | null
  readonly achievementPercent: number | null
  /**
   * How much of THIS row's plan has elapsed.
   *
   * Per row, not per page: a monthly plan and an annual one are on screen
   * together by design, and the page-wide `elapsedPercent` is the widest of
   * them. Positioning a row's pace marker from that made the bar contradict
   * the badge printed beside it.
   */
  readonly expectedPercent: number
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
  /** Null when no targets are set at all — «0% elapsed» would be a measurement. */
  readonly elapsedPercent: number | null
  readonly overallPercent: number | null
  readonly counts: {
    readonly achieved: number
    readonly onTrack: number
    readonly atRisk: number
    readonly behind: number
  }
  readonly items: readonly KpiItem[]
}

/*
  THE HOUSE'S WORDS FOR THE HOUSE'S BASIS.

  Both of these are measured on the DELIVERED basis — `findForAnalysis` is
  revenue-only and `summarizeDeals` counts WON deals by `closedAt` — and they
  used to be labelled «Tushum» and «Yopilgan bitimlar», which are the words
  this dashboard reserves for the OTHER reading. `t.basis` already holds the
  right pair, so a KPI row now reconciles against the board a supervisor checks
  it against instead of inviting the question.
*/
const METRIC_LABELS: Record<string, string> = {
  REVENUE: t.basis.deliveredRevenueColumn,
  DEALS_WON: t.basis.deliveredDealsColumn,
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

  const formatValue = (item: KpiItem, which: 'target' | 'actual' | 'actual-raw') => {
    const money = which === 'target' ? item.target : item.actual
    const raw = which === 'target' ? item.targetValue : item.actualValue

    /*
      'actual-raw' formats `actualValue` in the row's own unit WITHOUT reaching
      for the Money DTO beside it — the «Qoldi» column passes a derived gap,
      which has no DTO of its own and must not borrow the actual's.
    */
    if (which === 'actual-raw') {
      if (raw === null) return NO_VALUE
      if (item.unit === 'money') return formatCompactUzs(raw / 100)
      if (item.unit === 'percent') return formatPercent(raw / 100)
      return formatNumber(raw)
    }

    if (item.unit === 'money') return money ? formatCompactUzs(money.amount) : NO_VALUE
    /*
      An em dash for an actual that was never measured — see `actualForMetric`.
      A conversion rate over a window in which nothing resolved is unknown, and
      this cell used to print «0%» beside an «Ortda» badge for it.
    */
    if (raw === null) return NO_VALUE
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
      key: 'remaining',
      header: 'Qoldi',
      align: 'right',
      numeric: true,
      /*
        THE NUMBER A SUPERVISOR ACTS ON, and it was the one figure not printed.

        «Reja 320 mln» and «Haqiqiy 190 mln» are two right-aligned compact
        amounts two columns apart, and the thing anybody does with them is
        subtract — before lunch, out loud, «130 mln qoldi». Both operands ride
        every row already, so this is a derivation and not a request.

        An em dash rather than «0» when the actual is unmeasurable: there is no
        gap to a target you cannot score against. Clamped at zero when the plan
        is beaten — a negative «remaining» is a surplus, and the attainment
        column two cells right already says so at 140%.
      */
      render: (row) => {
        if (row.actualValue === null) {
          return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        }
        const gap = Math.max(0, row.targetValue - row.actualValue)
        if (gap === 0) {
          return <span style={{ color: 'var(--status-good)' }}>bajarildi</span>
        }
        return (
          <span style={{ color: 'var(--ink-secondary)' }}>
            {formatValue({ ...row, actualValue: gap }, 'actual-raw')}
          </span>
        )
      },
    },
    {
      key: 'progress',
      header: 'Bajarilishi',
      width: '160px',
      render: (row) => (
        <ProgressBar percent={row.achievementPercent} expected={row.expectedPercent} />
      ),
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
          : // The state the portal is actually in. Saying so in the subtitle
            // costs nothing and stops the page reading as broken.
            'Yanovskiy tizimi boʻyicha baholash · bu davr uchun reja belgilanmagan'
      }
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
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

            {data?.planPeriod && (
              /*
                The pace comparison, stated as words before it is drawn as a
                bar: the two percentages share a sentence so the reader never
                has to carry one across the panel to reach the other.

                GUARDED ON THE PLAN, NOT ON THE RESPONSE. With no targets set —
                the portal's state today — there is no plan period to have
                elapsed, and this line printed «reja oʻtishi 0%» beside a hero
                that is correctly an em dash: one half saying "nothing is set",
                the other asserting that none of it has passed. The em dash and
                the table's «rejalar belgilanmagan» already say the whole truth
                without it.
              */
              <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                reja oʻtishi {formatPercent(data.elapsedPercent, 0)} · bajarilish{' '}
                {formatPercent(data.overallPercent, 0)}
              </p>
            )}

            {data && data.overallPercent !== null && (
              <div className="mt-3 max-w-md">
                <ProgressBar
                  percent={data.overallPercent}
                  expected={data.elapsedPercent ?? undefined}
                />
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CountCard
          label={t.kpiStatus.ACHIEVED}
          value={data?.counts.achieved}
          tone="good"
          loading={query.isPending}
          failed={query.isError}
        />
        <CountCard
          label={t.kpiStatus.ON_TRACK}
          value={data?.counts.onTrack}
          tone="good"
          loading={query.isPending}
          failed={query.isError}
        />
        <CountCard
          label={t.kpiStatus.AT_RISK}
          value={data?.counts.atRisk}
          tone="warning"
          loading={query.isPending}
          failed={query.isError}
        />
        <CountCard
          label={t.kpiStatus.BEHIND}
          value={data?.counts.behind}
          tone="critical"
          loading={query.isPending}
          failed={query.isError}
        />
      </div>

      <ChartCard
        title="Kim rejada, kim orqada?"
        /*
          THE PRESET PICKS THE PLAN; IT DOES NOT SLICE IT — said here because
          the control above offers «Bugun», «Kecha» and «Shu oy», and inside one
          monthly plan all three return byte-identical numbers. A reader who
          presses two of them and sees nothing move concludes the screen is
          stuck, not that the chips do not apply.

          The pace mark is explained ONCE, on the card, rather than in a
          `title` on every row — a tooltip is not an explanation on a touch
          device, and the mark is the same mark in all of them.
        */
        hint="Har bir reja oʻz davri boʻyicha baholanadi · ▏ belgisi — shu kunga kutilgan surʼat · davr rejani tanlaydi, uni kesmaydi"
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
  loading = false,
  failed = false,
}: {
  label: string
  value?: number
  tone: 'good' | 'warning' | 'critical'
  /** The em dash means "no plans set" — it must not also mean "still loading". */
  loading?: boolean
  /** Nor may it mean "the request failed" — that is a third fact. */
  failed?: boolean
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
      {loading ? (
        <div className="skeleton mt-1.5 h-6 w-10" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : failed ? (
        <p className="mt-1.5 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        /* .tabular, like every other counting tile: four of these sit in one
           row, and proportional figures let the same digit count come out at
           four different widths. */
        <p
          className="tabular mt-1.5 text-2xl leading-none font-semibold tracking-tight"
          style={{ color: 'var(--ink-primary)' }}
        >
          {value === undefined ? NO_VALUE : formatNumber(value)}
        </p>
      )}
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
function ProgressBar({
  percent,
  expected,
}: {
  percent: number | null
  /** Undefined when there is no plan period — draw no marker and pass no verdict. */
  expected?: number
}) {
  if (percent === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  const clamped = Math.min(100, Math.max(0, percent))
  /*
    NO EXPECTED PACE MEANS NO VERDICT, not "behind".

    `expected` is undefined when there is no plan period to have elapsed. The
    old `?? 0` made every bar pass a zero pace and paint itself on-track, which
    is the same class of confident answer the em dash beside it refuses.
  */
  const onPace = expected === undefined ? null : percent >= expected
  const color =
    percent >= 100
      ? 'var(--status-good)'
      : onPace === false
        ? 'var(--status-warning)'
        : 'var(--seq-450)'

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
        {expected !== undefined && expected > 0 && expected < 100 && (
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
