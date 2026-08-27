'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, type MouseEvent } from 'react'

import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DataTable, InitialChip, type Column } from '@/components/ui/DataTable'
import { Meter } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type LeaderboardRowDto } from '@/lib/api'
import {
  NO_VALUE,
  formatCompactUzs,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'
import { t } from '@/lib/messages'

type Metric = 'revenue' | 'deals_won' | 'conversion' | 'kpi_achievement'

const METRICS = [
  { value: 'revenue' as const, label: t.metric.revenue },
  { value: 'deals_won' as const, label: t.metric.deals_won },
  { value: 'conversion' as const, label: t.metric.conversion },
  { value: 'kpi_achievement' as const, label: t.metric.kpi_achievement },
]

/**
 * Feeds `--mx`/`--my` to the `.glow-track` radial — the CSS paints, this only
 * reports where the pointer is, in pixels from the card's own corner. The
 * class' hover/reduced-motion media guards live in globals.css, so on touch or
 * with motion off this handler runs into a pseudo-element that was never
 * created: harmless by construction, no JS feature-checks needed.
 */
function trackGlow(event: MouseEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`)
  event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`)
}

export function LeaderboardPage() {
  const { apiParams } = useDashboardFilters()
  const [metric, setMetric] = useState<Metric>('revenue')

  const query = useQuery({
    queryKey: ['leaderboard', apiParams, metric],
    queryFn: ({ signal }) =>
      apiGet<readonly LeaderboardRowDto[]>(
        '/analytics/leaderboard',
        { ...apiParams, metric },
        signal,
      ),
    placeholderData: (previous) => previous,
  })

  const rows = query.data?.data ?? []
  // Split on whether the person produced anything, not on rank: a rank exists
  // for everyone, including the 162 rows that are entirely zeros.
  const ranked = rows.filter((row) => row.revenue.amount > 0 || row.dealsWon > 0)
  const unranked = rows.filter((row) => !(row.revenue.amount > 0 || row.dealsWon > 0))
  const podium = ranked.slice(0, 3)

  /** The metric's own value, so the podium works whichever one is selected. */
  const value = (row: LeaderboardRowDto) =>
    metric === 'revenue'
      ? row.revenue.amount
      : metric === 'deals_won'
        ? row.dealsWon
        : metric === 'conversion'
          ? (row.conversionPercent ?? 0)
          : (row.kpiAchievementPercent ?? 0)

  const teamTotal = ranked.reduce((sum, row) => sum + value(row), 0)
  const share = (row: LeaderboardRowDto) =>
    teamTotal === 0 ? null : (value(row) / teamTotal) * 100

  /**
   * The metric's value AS TEXT, in the metric's own unit.
   *
   * Used for the runner-up cards' value line and the gap captions. The gap
   * used to run every metric through the money formatter, so a deals gap of
   * 12 printed as "12 soʻm-compact" and a conversion gap as currency — one
   * formatter per unit, chosen once, keeps a number and its unit agreeing
   * everywhere the podium states one.
   */
  const metricText = (amount: number | null) => {
    if (amount === null) return NO_VALUE
    switch (metric) {
      case 'revenue':
        return `${formatCompactUzs(amount)} soʻm`
      case 'deals_won':
        return `${formatNumber(amount)} ta bitim`
      case 'conversion':
        return formatPercent(amount)
      case 'kpi_achievement':
        return formatPercent(amount, 0)
    }
  }

  /**
   * Are there any KPI targets at all?
   *
   * The `kpi` table is empty on this portal, so `kpiAchievementPercent` is null
   * for all 288 rows and the column rendered as a full page of em dashes —
   * costing table width and teaching the reader to ignore a column that will
   * matter the day targets are loaded. Selecting the KPI metric was worse: it
   * sorted every row to null and produced a "ranking" in employee-id order.
   */
  const hasKpiTargets = rows.some((row) => row.kpiAchievementPercent !== null)

  const columns: Column<LeaderboardRowDto>[] = ([
    {
      key: 'rank',
      header: t.table.rank,
      width: '56px',
      align: 'right',
      numeric: true,
      // --ink-muted is 3.4:1. On a ranking screen the rank was the least
      // legible text on the row for 285 of 288 rows.
      render: (row) => (
        <span
          style={{
            color: row.rank <= 3 ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: row.rank <= 3 ? 600 : 400,
          }}
        >
          {row.rank}
          {/* Ties share a rank; marking them stops the repeat looking like a bug. */}
          {row.tied && <span title="Teng natija"> =</span>}
        </span>
      ),
    },
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: t.table.employee,
      render: (row) => (
        // The chip anchors the row the way an avatar would — see InitialChip.
        // aria-hidden there, so the announced name is not stuttered.
        <div className="flex min-w-0 items-center gap-2.5">
          <InitialChip name={row.fullName} />
          <div className="min-w-0">
            <p className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
              {row.fullName}
            </p>
            {row.departmentName && (
              <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {row.departmentName}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'revenue',
      header: t.table.revenue,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span
          style={{ color: metric === 'revenue' ? 'var(--ink-primary)' : undefined }}
          title={formatUzs(row.revenue.amount)}
        >
          {formatCompactUzs(row.revenue.amount)}
        </span>
      ),
    },
    {
      key: 'dealsWon',
      header: t.table.dealsWon,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'deals_won' ? 'var(--ink-primary)' : undefined }}>
          {formatNumber(row.dealsWon)}
        </span>
      ),
    },
    {
      key: 'conversion',
      header: t.table.conversion,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'conversion' ? 'var(--ink-primary)' : undefined }}>
          {formatPercent(row.conversionPercent)}
        </span>
      ),
    },
    {
      key: 'kpi',
      header: t.table.kpi,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'kpi_achievement' ? 'var(--ink-primary)' : undefined }}>
          {formatPercent(row.kpiAchievementPercent, 0)}
        </span>
      ),
    },
    {
      key: 'growth',
      // Closed-date basis, and the median order closes 25 days after it is
      // sold — so this column moves with fulfilment as much as with selling.
      header: t.table.growth,
      align: 'right',
      render: (row) => (
        <span title={t.period.closedBasis}>
          <TrendIndicator delta={row.delta} />
        </span>
      ),
    },
    // A column of 288 em dashes costs width and teaches the reader to skip it.
  ] as Column<LeaderboardRowDto>[]).filter((column) => column.key !== 'kpi' || hasKpiTargets)

  const leader = podium[0]

  return (
    <PageShell
      title={t.nav.leaderboard}
      // The one screen with no accent rule, so it inherited the overview's
      // blue and was the only page not identifiable at a glance.
      accent="var(--series-5)"
      description="Bitta koʻrsatkich boʻyicha tartiblangan"
      meta={query.data?.meta}
      filters={{ departments: true }}
      actions={
        <SegmentedControl
          ariaLabel="Koʻrsatkich"
          value={metric}
          // Selecting KPI with no targets sorts every row to null and produces
          // a "ranking" in employee-id order. Offer it only when it can rank.
          options={METRICS.filter((m) => m.value !== 'kpi_achievement' || hasKpiTargets)}
          onChange={setMetric}
        />
      }
    >
      {podium.length === 3 && leader && (
        /*
          The podium is the page's lead band, and the LEADER is its lead
          instrument: hero surface, registration brackets, the ranking's one
          hero-sized figure. Second and third stay plain cards on purpose —
          the whole point of a ranking is that first place outranks them, and
          hierarchy-by-size is how the screen says so before a single number
          is read. The wider first column at lg is the same statement made by
          layout.
        */
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[1.45fr_1fr_1fr]">
          {/*
            Brackets on the wrapper, glow on the card — NOT both on one
            element: each claims ::after, and stacking them welds the two
            rules into one broken pseudo (documented at `.brackets`).
          */}
          <div className="brackets">
            <section
              className="card-hero glow-track flex h-full flex-col px-5 py-4"
              onMouseMove={trackGlow}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{
                    /*
                      Neutral, not a colour ramp — same reasoning as the
                      runner-up chips below: the numeral is the rank, the
                      figure is the magnitude, and hue stays out of it.
                    */
                    background: 'var(--grid)',
                    color: 'var(--ink-primary)',
                    boxShadow: 'inset 0 0 0 1px var(--border-strong)',
                  }}
                  aria-hidden="true"
                >
                  {leader.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {leader.fullName}
                  </p>
                  {leader.departmentName && (
                    <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {leader.departmentName}
                    </p>
                  )}
                </div>
                <TrendIndicator delta={leader.delta} />
              </div>

              {/*
                The page's single hero figure, in the selected metric's own
                unit. Money keeps the exact-soʻm Tooltip the tiles use — the
                compact figure is a summary, and the full number must stay
                reachable by keyboard and touch, not only by the table below.
              */}
              <div className="mt-3.5">
                {metric === 'revenue' ? (
                  <Tooltip content={<span className="tabular">{formatUzs(leader.revenue.amount)}</span>}>
                    <span
                      tabIndex={0}
                      className="focusable figure-hero block w-fit rounded-[var(--radius-panel-sm)]"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      <AnimatedNumber
                        value={leader.revenue.amount}
                        format={formatCompactUzs}
                        duration={900}
                      />
                      <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                        soʻm
                      </span>
                    </span>
                  </Tooltip>
                ) : (
                  <span className="figure-hero block" style={{ color: 'var(--ink-primary)' }}>
                    {metric === 'deals_won' ? (
                      <>
                        <AnimatedNumber
                          value={leader.dealsWon}
                          format={(v) => formatNumber(Math.round(v))}
                          duration={900}
                        />
                        <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                          ta bitim
                        </span>
                      </>
                    ) : metric === 'conversion' ? (
                      // Null stays an em dash even at hero size — a leader
                      // with no measurable rate is not a leader at 0%.
                      leader.conversionPercent === null ? (
                        NO_VALUE
                      ) : (
                        <AnimatedNumber
                          value={leader.conversionPercent}
                          format={(v) => formatPercent(v)}
                          duration={900}
                        />
                      )
                    ) : leader.kpiAchievementPercent === null ? (
                      NO_VALUE
                    ) : (
                      <AnimatedNumber
                        value={leader.kpiAchievementPercent}
                        format={(v) => formatPercent(v, 0)}
                        duration={900}
                      />
                    )}
                  </span>
                )}
              </div>

              {/*
                Not a blank hero: the figure keeps its relational context —
                the leader-normalised track (full by definition: this IS the
                leader) and the exact team share as text. Share of the team's
                total is a fact a table of independent rows cannot state.
              */}
              <div className="mt-auto pt-3.5">
                <Meter
                  value={share(leader) === null ? null : 100}
                  tone="neutral"
                  label={leader.fullName}
                />
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {`Jamoaning ${formatPercent(share(leader))} ulushi`}
                </p>
              </div>
            </section>
          </div>

          {podium.slice(1).map((row, offset) => {
            const index = offset + 1
            const gap = value(podium[index - 1]!) - value(row)
            return (
              <Card key={row.employeeId} className="px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                    style={{
                      /*
                        Neutral, not a colour ramp.

                        A sequential ramp encodes MAGNITUDE, and the gap between
                        first and second here is 576 mln to 238 mln — nothing the
                        three evenly-spaced steps convey. The numeral is the
                        rank; the value beside it is the magnitude. Painting the
                        chips as well made rank the third thing on the screen
                        encoded by hue, and the only one doing it with the same
                        blue as the revenue series.
                      */
                      background: 'var(--grid)',
                      color: 'var(--ink-primary)',
                      boxShadow: 'inset 0 0 0 1px var(--border-strong)',
                    }}
                    aria-hidden="true"
                  >
                    {row.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      {row.fullName}
                    </p>
                    <p className="tabular truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      {metricText(
                        metric === 'conversion'
                          ? row.conversionPercent
                          : metric === 'kpi_achievement'
                            ? row.kpiAchievementPercent
                            : value(row),
                      )}
                    </p>
                  </div>
                  <TrendIndicator delta={row.delta} />
                </div>

                {/*
                  What the table below cannot say.

                  The podium used to repeat rows 1–3 verbatim — same name, same
                  value, same delta — while omitting the department, deal count
                  and conversion the row carried, so it was strictly LESS
                  informative than the thing directly beneath it and cost 66px to
                  say so. Share of the team's total and the gap to the rank above
                  are relational facts a table of independent rows cannot show.
                */}
                <div className="mt-3">
                  {/*
                    Normalised to the LEADER, not to the team total. The top
                    seller holds ~14% of a 126-person team's revenue, so a
                    team-share bar rendered the podium as three nearly-empty
                    tracks — and the overview's identical-looking bars are
                    leader-normalised, so the same mark read two ways. The text
                    below still states the team share exactly.
                  */}
                  <Meter
                    value={
                      share(podium[0]!) ? ((share(row) ?? 0) / (share(podium[0]!) ?? 1)) * 100 : null
                    }
                    tone="neutral"
                    label={row.fullName}
                  />
                  <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {/* A zero gap is a tie, and "0 behind" reads as a bug. */}
                    {gap === 0
                      ? 'Yuqoridagi bilan teng natija'
                      : `Yuqoridagidan ${metricText(gap)} orqada`}
                  </p>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/*
        Ranked rows first; everyone with nothing behind a disclosure.

        The full roster is 288 people, of whom 126 sold anything — the other
        162 rendered as identical rows of zeros and dashes and made the page
        17,400px tall. They are not noise in general (an active person selling
        nothing is a management signal) but they are not a ranking, so they do
        not belong above the fold of one.
      */}
      <Card className="px-4 py-4">
        <DataTable
          columns={columns}
          rows={ranked}
          rowKey={(row) => row.employeeId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          minWidth={880}
          initialRows={25}
          // Bounded height so the header has something to stick to: the rows
          // slide under the sunken header band instead of taking it away.
          maxHeight={620}
          moreLabel={(hidden) => `Yana ${hidden} ta xodimni koʻrsatish`}
        />
      </Card>

      {unranked.length > 0 && (
        <Card className="px-4 py-4">
          <DataTable
            columns={columns}
            rows={unranked}
            rowKey={(row) => row.employeeId}
            status="ready"
            minWidth={880}
            initialRows={0}
            // Once disclosed, 162 rows scroll inside the card — the sticky
            // header keeps the columns named the whole way down.
            maxHeight={520}
            moreLabel={(hidden) => `Natijasiz xodimlar (${hidden})`}
          />
        </Card>
      )}
    </PageShell>
  )
}
