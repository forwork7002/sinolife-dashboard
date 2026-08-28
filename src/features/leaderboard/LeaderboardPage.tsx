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
import {
  ApiClientError,
  apiGet,
  isSellerCloseMetric,
  type LeaderboardMetricValue,
  type LeaderboardRowDto,
} from '@/lib/api'
import {
  NO_VALUE,
  formatCompactUzs,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * The switcher, grouped by BASIS: delivered pair, seller-closed pair, rates.
 *
 * Order is the first thing that teaches the distinction — the two `Yetkazilgan`
 * options sit together, the two `Yopgan` options sit together, and a reader who
 * never opens the explainer still sees two families rather than six synonyms.
 */
const METRICS = [
  { value: 'revenue' as const, label: t.metric.revenue },
  { value: 'deals_won' as const, label: t.metric.deals_won },
  { value: 'closed_deals' as const, label: t.metric.closed_deals },
  { value: 'closed_value' as const, label: t.metric.closed_value },
  { value: 'conversion' as const, label: t.metric.conversion },
  { value: 'kpi_achievement' as const, label: t.metric.kpi_achievement },
]

/** Which metrics are money, which are counts. Decides formatter and unit word. */
const MONEY_METRICS = new Set<LeaderboardMetricValue>(['revenue', 'closed_value'])
const COUNT_METRICS = new Set<LeaderboardMetricValue>(['deals_won', 'closed_deals'])

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
  const [metric, setMetric] = useState<LeaderboardMetricValue>('revenue')

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

  /**
   * How the seller-close columns were arrived at, and whether they were
   * measured at all.
   *
   * `undefined` is NOT `resolved: false`: the first is "this response predates
   * the basis" (an older cache, a snapshotted demo), the second is "the seller
   * pipeline's won stage no longer exists". The first shows nothing; the second
   * says so out loud, because a board silently ranking by an unmeasured figure
   * would put every seller in employee-id order and call it a ranking.
   */
  const basis = query.data?.meta.sellerCloseBasis
  const basisBroken = basis !== undefined && !basis.resolved
  /** Columns and options only exist once the basis has actually measured. */
  const hasCloseBasis = basis?.resolved === true
  /** The active metric asks a question this response cannot answer. */
  const unmeasurable = basisBroken && isSellerCloseMetric(metric)

  /**
   * The stage the portal itself named, never a hardcoded `C12:WON`.
   *
   * The id is resolved by pipeline ROLE server-side precisely so a reconfigured
   * portal cannot leave a caption asserting a stage that stopped existing — so
   * the caption reads the resolved name back rather than repeating a constant.
   */
  const stageName =
    hasCloseBasis && basis.stages.length > 0
      ? basis.stages.map((stage) => stage.name).join(' / ')
      : t.basis.stageFallback

  /**
   * What the active metric COUNTS, in one sentence.
   *
   * PageShell prints the reporting window straight after this string, so the
   * caption a manager reads is "<what is counted> · 1-avg 2026 – 28-avg 2026"
   * — basis and window in one line, before a single figure. docs/DESIGN.md,
   * "A number names its basis when a sibling screen computes one differently":
   * the home screen's leaderboard card ranks the same people from the same
   * endpoint on the delivered basis, and without this line the two orderings
   * read as a bug rather than as two different questions.
   */
  const basisCaption = (() => {
    switch (metric) {
      case 'revenue':
        return t.basis.deliveredRevenue
      case 'deals_won':
        return t.basis.deliveredDeals
      case 'conversion':
        return t.basis.conversion
      case 'kpi_achievement':
        return t.basis.kpi
      case 'closed_deals':
        return t.basis.closedDeals(stageName)
      case 'closed_value':
        return `${t.basis.closedValue(stageName)} ${t.basis.amountCaveat}`
    }
  })()

  /**
   * The metric's own value, or null when it was never measured.
   *
   * Split from `value` below so the hero can print an em dash for a genuine
   * null while the share and gap arithmetic still has a number to work with.
   * `closedCount` / `closedValue` are null on an UNRESOLVED basis, which is not
   * a zero — see `SellerCloseBasisDto`.
   */
  const rawValue = (row: LeaderboardRowDto): number | null => {
    switch (metric) {
      case 'revenue':
        return row.revenue.amount
      case 'deals_won':
        return row.dealsWon
      case 'conversion':
        return row.conversionPercent
      case 'kpi_achievement':
        return row.kpiAchievementPercent
      /*
        `typeof` rather than `!== null`, here and in the two columns below.
        The contract says `number | null`, and a live response honours it — but
        a static-demo snapshot frozen before this basis existed carries neither
        key, and `undefined` would sail past a null check into
        `formatCompactUzs(undefined.amount)`. Missing and unmeasured are the
        same em dash to a reader; only one of them may be a crash.
      */
      case 'closed_deals':
        return typeof row.closedCount === 'number' ? row.closedCount : null
      case 'closed_value':
        return row.closedValue ? row.closedValue.amount : null
    }
  }

  const value = (row: LeaderboardRowDto) => rawValue(row) ?? 0

  /**
   * Split on whether the person produced anything, not on rank: a rank exists
   * for everyone, including the sellers whose rows are entirely zeros.
   *
   * The seller-close figures are part of the test, not an afterthought. 1 646
   * of last August's closes had not been delivered by month end, so a seller
   * can carry a real month's work with zero delivered revenue — and testing
   * delivery alone would have filed exactly those people under "natijasiz".
   */
  const produced = (row: LeaderboardRowDto) =>
    row.revenue.amount > 0 || row.dealsWon > 0 || (row.closedCount ?? 0) > 0

  const ranked = rows.filter(produced)
  const unranked = rows.filter((row) => !produced(row))
  const podium = ranked.slice(0, 3)

  /**
   * Who the server actually ranked.
   *
   * Absent on an older cached or snapshotted response, and the footnote below
   * then renders nothing at all rather than a row of zeros — "0 rahbar hisobga
   * olinmadi" would be a claim, and an untrue one.
   */
  const scope = query.data?.meta.leaderboardScope

  /**
   * Which filial produced these standings.
   *
   * docs/DESIGN.md asks this board to name its SCOPE in the same breath as its
   * basis, and the scope is not a small filter: on last month's data, scoping
   * to Навоий removes 59% of the company's revenue. A reader who does not know
   * that concludes the dashboard is broken.
   *
   * `/analytics/leaderboard` does not put `branchScope` in its meta yet — its
   * handler composes period, leaderboard-scope and seller-close blocks only —
   * so this renders nothing today and starts speaking the moment the block
   * arrives. Absent is NOT "all branches": the endpoint saying nothing and the
   * endpoint saying "no branch filter" are different facts, and only the
   * second is a caption.
   */
  const branchScope = query.data?.meta.branchScope

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
    if (MONEY_METRICS.has(metric)) return `${formatCompactUzs(amount)} soʻm`
    if (COUNT_METRICS.has(metric)) return `${formatNumber(amount)} ta bitim`
    return formatPercent(amount, metric === 'kpi_achievement' ? 0 : 1)
  }

  /**
   * Are there any KPI targets at all?
   *
   * The `kpi` table is empty on this portal, so `kpiAchievementPercent` is null
   * for every row and the column rendered as a full page of em dashes —
   * costing table width and teaching the reader to ignore a column that will
   * matter the day targets are loaded. Selecting the KPI metric was worse: it
   * sorted every row to null and produced a "ranking" in employee-id order.
   */
  const hasKpiTargets = rows.some((row) => row.kpiAchievementPercent !== null)

  /**
   * Both bases, side by side, paired BY UNIT.
   *
   * Delivered money sits next to closed money and delivered count next to
   * closed count, because the comparison a manager makes is 217 mln against
   * 190 mln, not 217 mln against 46 deals. Switching the metric changes which
   * column is ranked, never which columns exist: the whole point of carrying
   * both is that one person's divergence is visible without toggling.
   */
  const columns: Column<LeaderboardRowDto>[] = ([
    {
      key: 'rank',
      header: t.table.rank,
      width: '56px',
      align: 'right',
      numeric: true,
      // --ink-muted is 3.4:1. On a ranking screen the rank was the least
      // legible text on the row for everyone below the podium.
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
      // Not the bare "Tushum" the delivered-only screens use: with a second
      // money column beside it, an unqualified heading is the confusion.
      header: t.basis.deliveredRevenueColumn,
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
      key: 'closedValue',
      header: t.basis.closedValueColumn,
      align: 'right',
      numeric: true,
      // Null is UNMEASURED, never 0 — the em dash is the whole contract of
      // `SellerCloseBasisDto.resolved`.
      render: (row) => (
        <span
          style={{ color: metric === 'closed_value' ? 'var(--ink-primary)' : undefined }}
          title={row.closedValue ? formatUzs(row.closedValue.amount) : undefined}
        >
          {row.closedValue ? formatCompactUzs(row.closedValue.amount) : NO_VALUE}
        </span>
      ),
    },
    {
      key: 'dealsWon',
      header: t.basis.deliveredDealsColumn,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'deals_won' ? 'var(--ink-primary)' : undefined }}>
          {formatNumber(row.dealsWon)}
        </span>
      ),
    },
    {
      key: 'closedCount',
      header: t.basis.closedDealsColumn,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'closed_deals' ? 'var(--ink-primary)' : undefined }}>
          {typeof row.closedCount === 'number' ? formatNumber(row.closedCount) : NO_VALUE}
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
      // DELIVERED-revenue growth on every metric, because that is the only
      // basis with a comparison window behind it — the seller-close figures
      // have none yet, and inventing one from the other basis is the blend
      // this whole page exists to prevent.
      header: t.table.growth,
      align: 'right',
      render: (row) => (
        <span title={t.period.closedBasis}>
          <TrendIndicator delta={row.delta} />
        </span>
      ),
    },
    // A column of 288 em dashes costs width and teaches the reader to skip it.
    // Same rule for the two close columns: when the seller stage resolved to
    // nothing, they are not a quiet zero, they are not there.
  ] as Column<LeaderboardRowDto>[]).filter((column) => {
    if (column.key === 'kpi') return hasKpiTargets
    if (column.key === 'closedValue' || column.key === 'closedCount') return !basisBroken
    return true
  })

  const leader = podium[0]
  const isMoney = MONEY_METRICS.has(metric)
  const isCount = COUNT_METRICS.has(metric)

  return (
    <PageShell
      title={t.nav.leaderboard}
      // The one screen with no accent rule, so it inherited the overview's
      // blue and was the only page not identifiable at a glance.
      accent="var(--series-5)"
      /*
        Basis first, scope second, window third — PageShell appends the
        reporting window to whatever this string says, so the header line reads
        "<what is counted> · Faqat sotuvchilar… · 1-avg 2026 – 28-avg 2026".

        The scope half is not decoration either. Ranking the whole roster put
        the head of Операцион first with 575.7 mln and a ROP second with 235.3
        mln — team totals attributed to the person who manages the team — and
        pushed the best actual seller to third on a page that exists to find
        her. The exact counts live in the footnote under the table.
      */
      description={`${basisCaption} Faqat sotuvchilar — boʻlim rahbarlari (ROP) va boshqa boʻlimlar hisobga olinmaydi.`}
      meta={query.data?.meta}
      filters={{ departments: true }}
      actions={
        /*
          Six options do not fit a phone. The control itself is a nowrap flex
          row (a segmented control that wraps stops reading as one control), so
          the overflow is given somewhere to go instead of pushing the page
          into a horizontal scroll.
        */
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            ariaLabel="Koʻrsatkich"
            value={metric}
            options={METRICS.filter((option) => {
              // Selecting KPI with no targets sorts every row to null and
              // produces a "ranking" in employee-id order. Offer a metric only
              // when it can actually rank — which is the same reason the two
              // seller-close options disappear when the stage is unresolved.
              if (option.value === 'kpi_achievement') return hasKpiTargets
              if (isSellerCloseMetric(option.value)) return !basisBroken
              return true
            })}
            onChange={setMetric}
          />
        </div>
      }
    >
      {unmeasurable ? (
        /*
          A ranking this response cannot produce.

          With no resolvable won stage every `closedCount` is null, and
          `buildLeaderboard` puts null values last in employee-id order — ranks
          1..n over an ordering that means nothing. Printing that with a podium
          on top would be the most confident lie on the site, so the page
          declines and says which measurement failed. The switcher above has
          already dropped the two options, so the way out is one click.
        */
        <Card className="px-4 py-6">
          <p className="text-sm" style={{ color: 'var(--ink-primary)' }}>
            {t.basis.unmeasured}
          </p>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Yetkazilgan tushum boʻyicha reyting oʻzgarishsiz ishlaydi.
          </p>
        </Card>
      ) : (
        <>
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
                  {/* Always the DELIVERED-revenue delta — the arrow does not
                      follow the metric, so it is labelled where it sits. */}
                  <span title={t.basis.deliveredRevenue}>
                    <TrendIndicator delta={leader.delta} />
                  </span>
                </div>

                {/*
                  The page's single hero figure, in the selected metric's own
                  unit. Money keeps the exact-soʻm Tooltip the tiles use — the
                  compact figure is a summary, and the full number must stay
                  reachable by keyboard and touch, not only by the table below.
                */}
                <div className="mt-3.5">
                  {rawValue(leader) === null ? (
                    // Null stays an em dash even at hero size — a leader with no
                    // measurable figure is not a leader at 0.
                    <span className="figure-hero block" style={{ color: 'var(--ink-primary)' }}>
                      {NO_VALUE}
                    </span>
                  ) : isMoney ? (
                    <Tooltip content={<span className="tabular">{formatUzs(value(leader))}</span>}>
                      <span
                        tabIndex={0}
                        className="focusable figure-hero block w-fit rounded-[var(--radius-panel-sm)]"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        <AnimatedNumber
                          value={value(leader)}
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
                      {isCount ? (
                        <>
                          <AnimatedNumber
                            value={value(leader)}
                            format={(v) => formatNumber(Math.round(v))}
                            duration={900}
                          />
                          <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                            ta bitim
                          </span>
                        </>
                      ) : (
                        <AnimatedNumber
                          value={value(leader)}
                          format={(v) => formatPercent(v, metric === 'kpi_achievement' ? 0 : 1)}
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
                          first and second here is 217.6 mln to 135.3 mln — nothing
                          the three evenly-spaced steps convey. The numeral is the
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
                        {metricText(rawValue(row))}
                      </p>
                    </div>
                    <span title={t.basis.deliveredRevenue}>
                      <TrendIndicator delta={row.delta} />
                    </span>
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
                      seller holds ~4.9% of what the 105 selling sellers earned,
                      so a team-share bar rendered the podium as three nearly-empty
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

          The board holds 203 sellers, of whom 105 sold anything — the other 98
          render as identical rows of zeros and dashes. They are not noise in
          general (an active seller selling nothing is a management signal) but
          they are not a ranking, so they do not belong above the fold of one.
        */}
        <Card className="px-4 py-4">
          <DataTable
            columns={columns}
            rows={ranked}
            rowKey={(row) => row.employeeId}
            status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
            errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
            // Two more numeric columns than the board carried before; below this
            // the cells start wrapping and the figures stop lining up.
            minWidth={1120}
            initialRows={25}
            // Bounded height so the header has something to stick to: the rows
            // slide under the sunken header band instead of taking it away.
            maxHeight={620}
            moreLabel={(hidden) => `Yana ${hidden} ta sotuvchini koʻrsatish`}
          />

          {/*
            The footnote the scope earns.

            A board that silently drops 85 of 288 people is not more honest than
            one that ranks the wrong people — it is the same omission with better
            manners. Stating both halves (who was ranked, who was not, and how
            many of each) is what lets a reader reconcile this page with the
            Employees page, which still lists everybody.

            Quiet by design: muted, 11px, below the table rather than above it.
            The rule belongs in the description; the count belongs here.
          */}
          {scope && (
            <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              <span className="tabular">{formatNumber(scope.sellers)}</span> ta sotuvchi
              tartiblandi.{' '}
              <span className="tabular">{formatNumber(scope.excludedManagers)}</span> ta boʻlim
              rahbari va{' '}
              <span className="tabular">{formatNumber(scope.excludedOther)}</span> ta sotuvdan
              tashqari xodim hisobga olinmadi — ular jamoa bitimlarini yopadi, sotmaydi.
            </p>
          )}

          {/*
            The explainer, once per page.

            Two columns of this table disagree with each other by design, and a
            reader who does not know why will report it as a bug — or, worse,
            decide which column is "the real one" on their own. It states the
            mechanism, names the stage the portal itself named, adds the one
            caveat the summed value owes, and stops. No advice about which figure
            to manage by: that is not a decision a footnote gets to make.
          */}
          {hasCloseBasis && (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {t.basis.explainer} «{stageName}» bosqichiga oʻtish tarixidan olinadi.{' '}
              {t.basis.amountCaveat}
            </p>
          )}
        </Card>

        {unranked.length > 0 && (
          <Card className="px-4 py-4">
            <DataTable
              columns={columns}
              rows={unranked}
              rowKey={(row) => row.employeeId}
              status="ready"
              minWidth={1120}
              initialRows={0}
              // Once disclosed, 98 rows scroll inside the card — the sticky
              // header keeps the columns named the whole way down.
              maxHeight={520}
              moreLabel={(hidden) => `Natijasiz sotuvchilar (${hidden})`}
            />
          </Card>
        )}
        </>
      )}
    </PageShell>
  )
}
