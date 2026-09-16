'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { CategoryBarList } from '@/components/charts/CategoryBarList'
import { CustomerFlowChart } from '@/components/charts/CustomerFlowChart'
import { CohortHeatmap, type CohortMatrixRow, type CohortView } from '@/components/charts/Heatmap'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { GaugeTile, Meter, SectionHeader, StatTile } from '@/components/ui/Stat'
import { InfoTip } from '@/components/ui/Tooltip'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { SimpleView } from '@/features/cohort/SimpleView'
import { StateBars } from '@/features/cohort/StateBars'
import { RopPicker } from '@/features/cohort/RopPicker'
import { useCohortMode, useCohortRop } from '@/features/cohort/useCohortMode'
import { PageShell } from '@/features/shared/PageShell'
import {
  type CohortDto,
  type CohortRopDto,
  type CohortSummaryDto,
  type CustomerFlowDto,
  type ConcentrationDto,
  type ConcentrationRepeatDto,
  apiGet,
} from '@/lib/api'
import {
  NO_VALUE,
  formatCompactUzs,
  formatDate,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'
import { CUSTOMER_ACTIVE_DAYS, CUSTOMER_AT_RISK_DAYS } from '@/lib/customerStates'
import { t } from '@/lib/messages'

/**
 * Retention, two ways — then who the money actually stands on.
 *
 * The matrix answers "do customers come back", and the four-state bar list
 * beside it answers "where are they right now" — the portal runs a follow-up
 * cycle whose live headcount is a different and more actionable fact than a
 * historical curve.
 *
 * The headline is second-order revenue share. That is the number that decides
 * whether the retention team is worth funding, and it is not visible anywhere
 * in Bitrix24 itself.
 *
 * The concentration band at the bottom closes the loop: retention says the
 * customers return, concentration says how few of them the period's revenue
 * would survive losing — and how fast a first buyer becomes a second one.
 *
 * THE PAGE TAKES NO REPORTING WINDOW, and that is a change rather than an
 * omission. Every block on it is period-independent: the matrix needs the
 * whole history to be a matrix, the База bars are a snapshot of today, and the
 * concentration band resolves its own ninety days on the server (see its
 * route). While the shell's period control was here it drove NOTHING on the
 * screen except, by its «Bugun» default, the concentration band — twelve
 * customers on 2026-09-15, with «Top-10 mijoz ulushi 89%» in red over them. A
 * control that does nothing is worse than no control, because a reader assumes
 * it must be filtering something; the same reasoning `PageShell` gives for
 * `/users`.
 */
/**
 * Nothing to draw — and WHY there is nothing, which is two different facts.
 *
 * With no team cut, an empty matrix means the portal's delivered orders are
 * not linked to a customer at all, which is a data problem somebody has to go
 * and fix in Bitrix24. With a cut, it almost always means the team name in the
 * URL no longer exists — a link shared before somebody renamed a department —
 * and the fix is one press of the picker.
 *
 * Telling a reader on a stale link to go and check the CRM's customer links
 * sends them after a defect that is not there, which is why this is one
 * component with a branch rather than one sentence repeated.
 */
function CohortEmpty({ rop }: { readonly rop: string | null }) {
  return rop === null ? (
    <EmptyState
      title="Kogorta uchun maʼlumot yoʻq"
      body="Yetkazilgan buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin."
    />
  ) : (
    <EmptyState
      title={`«${rop}» boʻyicha kogorta yoʻq`}
      body="Bu jamoa hech kimga birinchi marta sotmagan, yoki uning nomi Bitrix24da oʻzgargan. Roʻyxatdan qaytadan tanlang yoki «Butun kompaniya»ga qayting."
    />
  )
}

/** The three widths the matrix opens at. `null` draws every month there is. */
type MonthWindow = '6' | '12' | 'all'

const MONTH_WINDOWS: Record<MonthWindow, number | null> = { '6': 6, '12': 12, all: null }

/**
 * How much history `/insights/cohorts` is asked for — the ONE number the
 * matrix's own span is built from, so the section header's prose has to read
 * it rather than repeat it.
 *
 * A literal `18` used to sit in both the query below and in the
 * `SectionHeader`'s hint two hundred lines away. The portal added a
 * nineteenth Доставка stage on 2026-09-10 and two places in this product
 * said «eighteen» on a live screen for a day; a hand-mirrored number is
 * exactly that failure waiting for the day these two literals disagree.
 */
const COHORT_HISTORY_MONTHS = 18

/**
 * The DTO's money, formatted, on its way into a presentation component.
 *
 * `CohortDto` used to satisfy `CohortMatrixRow` structurally, so the rows went
 * to the grid untouched. They stopped the day the payload grew two `MoneyDto`
 * fields, and there were two ways to repair it: widen the matrix row to take a
 * `MoneyDto`, or format here. Formatting here, because `Heatmap.tsx` draws — it
 * has no currency, no locale and no rounding rule, and every other figure on
 * that grid already arrives as text.
 *
 * TWO STRINGS PER FIGURE, compact for the column and full for the hover.
 * `formatCompactUzs` is what a money COLUMN prints everywhere in this
 * application (Yalpi marja, Logistika), and the full-digit exception is the
 * sellers board's, because that screen is reconciled digit-for-digit against a
 * Bitrix24 board and a Telegram channel. NOTHING reconciles a cohort's
 * lifetime revenue — the portal prints it on no screen — so the trade
 * `formatCompactUzs`'s own comment describes is the right one here: precision
 * deferred to the tooltip, not lost. It also buys back 52px of pinned width on
 * a grid whose months were being squeezed under their legibility floor.
 *
 * The lossy `amount` travels too, for the one ratio the panel computes. It is
 * never printed.
 *
 * One named function, and the call site is one `.map`, so hoisting the mapping
 * further up the page later is a move rather than a rewrite.
 */
function toMatrixRow(row: CohortDto): CohortMatrixRow {
  return {
    cohort: row.cohort,
    size: row.size,
    returned: row.returned,
    retention: row.retention,
    customers: row.customers,
    cumulative: row.cumulative,
    cumulativeCustomers: row.cumulativeCustomers,
    revenue: row.revenue,
    orders: row.orders,
    revenueTotal: formatCompactUzs(row.revenueTotal.amount),
    revenueTotalExact: formatUzs(row.revenueTotal.amount),
    revenueTotalAmount: row.revenueTotal.amount,
    revenuePerCustomer: formatCompactUzs(row.revenuePerCustomer.amount),
    revenuePerCustomerExact: formatUzs(row.revenuePerCustomer.amount),
    ageMonths: row.ageMonths,
  }
}

export function CohortPage() {
  /**
   * Which team's customers are on screen. URL-backed — see the hook.
   *
   * IT IS IN THE QUERY KEY, and that is the whole difference between this and
   * the two controls on the matrix card. «Jami qaytgan» / «Oylik» / «Pul» and
   * the 6 / 12 / Hammasi window are renderings of one payload and touch no
   * key; a team cut is a different cohort with a different denominator, so it
   * is a different answer and gets a different cache entry. Switching back to
   * «Butun kompaniya» is then instant, from the entry the page opened on.
   */
  const { rop, setRop } = useCohortRop()

  /**
   * Whether anybody has reached for the team picker yet.
   *
   * ONE-WAY, and never reset: the options are cached under their own key for
   * five minutes, so re-opening the control is free, and a flag that fell back
   * to false would re-issue the request the next time the component
   * remounted. It gates the request and nothing else — the control renders
   * either way, because a reader on a shared `?rop=` link needs the way back
   * to the company view before any list has loaded.
   */
  const [picking, setPicking] = useState(false)

  /*
    THE TEAM LIST IS ITS OWN QUERY, AND ITS OWN CACHE ENTRY.

    It could have ridden the matrix response — the arm that answers it is on
    the same statement — and that is exactly what it must not do: the arm
    costs a grouping and two joins, and putting it on the default request
    charges every cold load of the slowest screen in the product for a picker
    most readers never touch.

    `months: 3` because the list arm ignores the window entirely and the
    matrix arm does not: this request throws its matrix away, so it asks for
    the smallest one the route will accept rather than eighteen months of
    cells nothing will draw. The scans underneath are unchanged — this saves
    payload, not time, and the saving is honest about which it is.
  */
  const ropOptions = useQuery({
    queryKey: ['cohorts', 'rops'],
    queryFn: ({ signal }) =>
      apiGet<CohortSummaryDto>('/insights/cohorts', { months: 3, include: 'rops' }, signal),
    enabled: picking,
    staleTime: 5 * 60_000,
  })

  const query = useQuery({
    queryKey: ['cohorts', rop],
    queryFn: ({ signal }) =>
      apiGet<CohortSummaryDto>(
        '/insights/cohorts',
        /* `rop` is omitted rather than sent as null: the route's schema takes
           an optional string, and an explicit empty one is a 400. */
        { months: COHORT_HISTORY_MONTHS, ...(rop === null ? {} : { rop }) },
        signal,
      ),
    /*
      EIGHTEEN MONTHS DO NOT MOVE IN A MINUTE.

      This read is deliberately unkeyed by the period — the matrix needs the
      whole history to be a matrix — and it is two of the most expensive scans
      in the application: `first_win` groups every won revenue deal by customer
      with no date bound, and `retentionStages` counts distinct customers over
      the entire Baza pipeline. On the global one-minute clock that pair ran
      sixty times an hour, per open tab, to redraw a matrix in which a single
      cell can move once a day.

      `refetchInterval` as well as `staleTime`, because the timer does not
      consult staleness — see `useFilterOptions`.
    */
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  /**
   * Which reading of this screen is on — the manager's or the analyst's.
   *
   * URL-backed (`useCohortMode`), unlike `view` and `months` below, and the
   * difference is what each one is FOR: those two decide how one card draws an
   * answer, this decides which answer the page opens on, and a manager is sent
   * a link to the latter. It is written with `replaceState`, so it costs no
   * navigation.
   *
   * BOTH MODES READ THE SAME `useQuery(['cohorts'])` RESULT — that key is
   * above this hook and does not mention the mode, so switching readings
   * issues no cohort request, shows no skeleton and cannot produce a second
   * answer. That is not a convenience: a second endpoint for the manager's
   * view would have doubled the most expensive read in this product to print
   * numbers that were already in the first response — and the two views would
   * then have been free to disagree about the same customers across a sync.
   *
   * It is read BEFORE the concentration query below, which is the one query
   * on this page the mode does gate. See that query's own comment.
   */
  const { mode, setMode } = useCohortMode()

  /*
    NO `apiParams`, AND NO KEY THAT COULD CARRY ONE.

    The endpoint resolves its own trailing ninety days from the server clock
    (see its route and this file's header), so there is nothing for the
    dashboard filters to change and a key naming them would invent cache
    entries that all hold the same answer. Same cadence as the matrix above: a
    ninety-day shape does not move in a minute either.

    AND IT IS ONLY ASKED FOR IN «BATAFSIL», WHICH IS NOT THE DEFAULT.

    Every consumer of this response — the four tiles and `RepeatShareCard` —
    is inside the `detail` branch. When «Batafsil» was the whole page that
    made this a rendered query; making «Oddiy» the default turned it into a
    DISCARDED one on every first load of the slowest screen in the product,
    for the majority of visits, which never press the toggle at all.

    THE TRADE, STATED: the first press of «Batafsil» now waits for this
    request instead of finding it already in hand. That cost is paid once —
    TanStack caches the result under the constant key, so toggling back and
    forth afterwards costs nothing and the band redraws from cache — and it
    is paid by the reader who asked for the analyst's view, which is the
    reader who is prepared to wait for it. A prefetch on every load spends a
    real query on every manager who never asks, and the band already degrades
    to honest skeletons while it loads (`concStatus`), so what the waiting
    reader sees is the state the page was built to show.

    The gate is on the MODE and not on the query key: a key mentioning the
    mode would be a second cache entry for one answer, which is the mistake
    the cohort read's own comment is about.
  */
  /*
    «MIJOZLAR OQIMI» — THE BAND AT THE TOP, AND ITS OWN CLOCK.

    A literal key with no `apiParams`, like the concentration read above it:
    the endpoint resolves its OWN trailing ninety days from the server clock
    (its route says why — the screen's period control was removed on
    2026-09-15 and a parameter wired to a control that does not exist is how
    the sibling endpoint came to report twelve customers under a critical-red
    gauge). A key that COULD carry a window would invite somebody to pass one.

    GATED ON «Batafsil», which the plan's own snippet did not do — and this
    is a deliberate departure from it, for the reason the concentration query
    beside it already gives at length: every consumer of this response is
    inside the `detail` branch, so on the default «Oddiy» view an ungated
    read would be a discarded request on every first load of the slowest
    screen in the product. The trade is the same one, paid by the same
    reader: the first press of «Batafsil» waits for it, once, and TanStack
    caches it under this constant key afterwards.
  */
  const flow = useQuery({
    queryKey: ['customer-flow'],
    queryFn: ({ signal }) => apiGet<CustomerFlowDto>('/insights/customers', {}, signal),
    /* Ninety days do not move in a minute, and the server memoises on the day
       this window lands on. Matched to the cohort read below. */
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: mode === 'detail',
  })

  const concentration = useQuery({
    queryKey: ['concentration', 'trailing-90'],
    queryFn: ({ signal }) => apiGet<ConcentrationDto>('/insights/concentration', {}, signal),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: mode === 'detail',
  })

  /**
   * Which reading of the matrix is on screen.
   *
   * Local state, not the URL: it is a way of LOOKING at one answer, both
   * arrays are already on the payload, and switching costs no request. The
   * same rule the FAKT 1 / FAKT 2 switch on `/sellers` follows.
   */
  const [view, setView] = useState<CohortView>('cumulative')

  /**
   * How far along the curve the grid opens.
   *
   * Local state for the same reason `view` is: the whole payload is already
   * here, so this changes nothing but how much of it is drawn. Twelve months
   * by default — the query asks for eighteen, and beyond the first year only
   * the oldest one or two cohorts have any cells at all, so the columns that
   * made the table scroll were mostly hatch.
   */
  const [months, setMonths] = useState<MonthWindow>('12')

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'

  const concStatus = concentration.isPending
    ? 'loading'
    : concentration.isError
      ? 'error'
      : 'ready'

  const data = query.data?.data
  const conc = concentration.data?.data

  /*
    ONE MAPPING, ABOVE THE MODE SWITCH.

    The grid and the manager's view are handed the SAME array. Mapping per mode
    would be a parallel construction of one payload, and `columnAverage` — which
    draws both the matrix's summary row and «Ular qaytadimi?»'s milestones —
    reads `size` and `cumulativeCustomers` straight off these rows. Two
    constructions is how two renderings of one fetch start to differ.

    Memoised on the payload rather than recomputed: `view`, `months` and the
    mode all re-render this component, and none of them changes a row.
  */
  const matrixRows = useMemo(() => (data ? data.rows.map(toMatrixRow) : []), [data])

  /*
    The picker's options, from their own cache entry.

    `?? []` rather than a loading branch: the control renders the current
    choice and «Butun kompaniya» whatever the list holds, so an empty array is
    the honest state both before the request and after a failed one. A team
    list that could not be fetched leaves a reader exactly where they already
    were, which is more use than an error over a matrix that drew fine.
  */
  const ropList: readonly CohortRopDto[] = ropOptions.data?.data.rops ?? []

  /* The band's own payload, and the window the SERVER resolved for it. The
     span is not on the DTO — the route resolves it, so it rides in
     `meta.period`, exactly where `/insights/concentration` puts its own. The
     screen prints the dates it actually got rather than the ninety it asked
     for. */
  const f = flow.data?.data
  const flowPeriod = flow.data?.meta?.period
  const flowStatus = flow.isPending ? 'loading' : flow.isError ? 'error' : 'ready'
  const lost = f?.states.rows.find((row) => row.key === 'LOST') ?? null

  /**
   * «Kogorta tushumi», added up over the rows the grid draws.
   *
   * Folded from `matrixRows` and from nothing else, so the footer is the
   * column above it and a reader who checks it finds it checks out. See the
   * comment on `totalRevenue` at the `CohortHeatmap` call for why the DTO's
   * own whole-history `revenueTotalAll` is deliberately NOT what goes here.
   */
  const visibleRevenueTotal = useMemo(
    () => matrixRows.reduce((sum, row) => sum + row.revenueTotalAmount, 0),
    [matrixRows],
  )

  /*
   * Concentration grades the WRONG way round for the gauge's `auto` tone,
   * which was built for delivery-style rates where high is good. Here a high
   * top-10 share means the period's revenue stands on a handful of customers,
   * and losing one of them is an event, not a statistic — so the judgement is
   * made where the domain reading lives and stated explicitly:
   *
   *   <25%    good     — no short list of customers can sink the period
   *   25–40%  warning  — dependence worth watching
   *   >40%    critical — the revenue line is a client list
   */
  const top10 = conc?.pareto.top10SharePercent ?? null
  const top10Tone =
    top10 === null ? 'neutral' : top10 < 25 ? 'good' : top10 <= 40 ? 'warning' : 'critical'

  /*
    The band's honesty caption. Pareto shares can only count revenue that HAS
    a customer attached — whatever share does not is the blind spot, and it
    is printed in the section header rather than footnoted, so the shares are
    never read as covering everything.
  */
  const nullCustomerShare = conc?.pareto.nullCustomerSharePercent ?? null
  /*
    The window is NAMED here, and it is the endpoint's own.

    It is not a window anybody chose — see this file's header and the route —
    so it has to be printed where the figures it governs are, in the dates the
    server actually resolved rather than as the words "ninety days".
  */
  const concentrationWindow = concentration.data?.meta.period
  const concentrationCaption = [
    concentrationWindow
      ? `${formatDate(concentrationWindow.start)} – ${formatDate(
          new Date(new Date(concentrationWindow.end).getTime() - 1).toISOString(),
        )} oraligʻida yutilgan bitimlar boʻyicha. Bu blok sahifaning boshqa qismlaridan mustaqil oʻlchanadi.`
      : 'Soʻnggi 90 kunda yutilgan bitimlar boʻyicha.',
    nullCustomerShare !== null && nullCustomerShare > 0
      ? `Tushumning ${formatPercent(nullCustomerShare)} qismi mijozga bogʻlanmagan — ulushlar faqat aniqlangan mijozlarni hisoblaydi.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')

  /*
    WHICH FIRST BUYERS, and when they bought.

    This gauge cannot use the window the rest of the band uses. Giving every
    buyer a full ninety days to come back means the cohort has to be drawn
    from ninety days EARLIER — a first purchase made yesterday cannot have had
    its horizon yet, and counting it would flatter the rate. The repository
    does exactly that (`horizon` in concentrationRepository), and the hint said
    only "toʻliq 90 kunlik ufq berilgan" while the caption above the band named
    the unshifted window. Two different spans, one of them unnamed.
  */
  const horizonWindow = (() => {
    if (!concentrationWindow) return null

    const shift = 90 * 86_400_000
    const from = new Date(new Date(concentrationWindow.start).getTime() - shift)
    const to = new Date(new Date(concentrationWindow.end).getTime() - shift - 1)
    return `${formatDate(from.toISOString())} – ${formatDate(to.toISOString())}`
  })()

  /* p90 beside the median, and the honest denominator: percentile claims on
     a dozen pairs and on a thousand read very differently. */
  const repeatIntervalHint = conc
    ? [
        conc.repeat.p90Days !== null
          ? `p90: ${formatNumber(Math.round(conc.repeat.p90Days * 10) / 10)} kun`
          : null,
        `${formatNumber(conc.repeat.pairsMeasured)} ta ikkinchi xarid asosida`,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <PageShell
      title={t.modules.cohort.title}
      description={t.modules.cohort.lead}
      accent="var(--series-7)"
      meta={query.data?.meta}
      /*
        NO `stale`, AND NO REPORTING WINDOW — the two are one decision.

        `stale` dims the whole page to say «these figures belong to the
        previous window». Nothing on this screen has a window: `['cohorts']`
        is a constant key and so is the concentration band's, so no query here
        can ever hold placeholder data for a key it has not fetched. A prop
        that reads like a live signal and is a literal `false` is the claim
        `tests/features/cohortStale.test.tsx` exists to keep off this page —
        and the same test pins that a visit to «Batafsil» and back leaves
        «Oddiy» undimmed, which it once did not (the concentration query is
        disabled in «Oddiy», and a disabled query's placeholder state has
        nothing able to clear it).
      */
      period={false}
      /*
        `actions`, not `toolbar`. The toolbar row is for FILTERS — controls
        that narrow rows — and this narrows nothing: it chooses which reading
        of one answer the page opens on. It is also the first thing a reader
        needs to find, which is what the slot beside the title is for.
      */
      actions={
        <SegmentedControl
          value={mode}
          onChange={setMode}
          ariaLabel="Sahifa koʻrinishi"
          options={[
            { value: 'simple', label: 'Oddiy' },
            { value: 'detail', label: 'Batafsil' },
          ]}
        />
      }
    >
      {/*
        ONE FETCH, TWO READINGS — and the switch is directly below the title.

        «Oddiy» opens on the three questions a manager asks out loud; «Batafsil»
        is the matrix and the bands under it. Neither is a permission and
        neither is a second question: both are drawn from the `['cohorts']`
        result already in hand, off the SAME mapped rows, so pressing the
        toggle redraws and asks nothing.

        The empty and error states are stated in whichever mode is on, rather
        than only under the matrix. A manager who never opens «Batafsil» still
        has to be told the difference between "no customer was linked to a
        delivered order" and "we could not ask".
      */}
      {mode === 'simple' ? (
        <>
          {query.isPending && <ChartSkeleton height={360} />}
          {query.isError && (
            <ErrorState
              message={(query.error as Error).message}
              onRetry={() => void query.refetch()}
            />
          )}
          {data && data.rows.length === 0 && <CohortEmpty rop={data.rop} />}
          {data && data.rows.length > 0 && (
            <SimpleView
              data={{
                /* THE GRID'S OWN ROWS. Mapped once, above. */
                rows: matrixRows,
                repeatCustomers: data.repeatCustomers,
                totalCustomers: data.totalCustomers,
                repeatRevenueShare: data.repeatRevenueShare,
                /* From the server, in APP_TIMEZONE. Never `new Date()` —
                   see `CohortSummaryDto.currentMonth`. */
                currentMonth: data.currentMonth,
                revenuePerCustomerAll: data.revenuePerCustomerAll,
                /* The bound the query above asked for, so the view can state
                   the window it draws without carrying a second copy of the
                   number. */
                historyMonths: COHORT_HISTORY_MONTHS,
              }}
            />
          )}
        </>
      ) : (
        <>
        {/*
          «MIJOZLAR OQIMI» — THE BAND THIS SCREEN WAS MISSING, AND THE SECOND
          CLOCK IT INTRODUCES.

          Everything below answers whether customers COME BACK, dated from the
          day a customer's first order was DELIVERED. Nothing answered how
          customers are ARRIVING, from which source, or which of them have gone
          quiet — and those are dated from the day they ORDERED. The two
          populations legitimately disagree and the DTO says so at length; both
          clocks are named on screen, here and on «Kogorta tahlili» below,
          because unlabelled the two totals read as one of them being broken.

          THE WINDOW IS THE SERVER'S. It is printed from `meta.period`, not
          from the ninety the route defaults to, so if that default is ever
          changed the sentence follows it instead of contradicting it.
        */}
        <SectionHeader
          title="Mijozlar oqimi"
          hint={
            flowPeriod
              ? `Buyurtma berilgan sana boʻyicha · ${formatDate(flowPeriod.start)} — ${formatDate(
                  flowPeriod.end,
                )}`
              : 'Buyurtma berilgan sana boʻyicha · soʻnggi 90 kun'
          }
        />

        <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatTile
            status={flowStatus}
            label="Yangi mijozlar"
            value={f?.summary.newCustomers ?? null}
            unit="count"
            /*
              THE HEADLINE COUNTS ARRIVALS, AND A QUARTER OF ORDERS NEVER LAND.
              «Yangi mijozlar» over a figure already filtered to delivered
              orders would be a different fact under the same word, and it is
              the arrival this band is about. The hint carries the other half
              rather than the tile silently choosing one.
            */
            hint={f ? `${formatNumber(f.summary.newCustomersWon)} tasi xarid qildi` : undefined}
          />
          <StatTile
            status={flowStatus}
            label="Qaytgan mijozlar"
            value={f?.summary.returningCustomers ?? null}
            unit="count"
            hint="Ilgari xarid qilgan · shu davrda yana buyurtma bergan"
          />
          {/*
            A SOʻM FIGURE, NOT A THIRD «TAKRORIY TUSHUM ULUSHI» — and this is a
            deliberate departure from the plan, which asked for a gauge here.

            That label is ALREADY on this screen twice: once over the whole
            history («Kogorta tahlili» below) and once over the last ninety days
            (`RepeatShareCard`, at the bottom). Two was accepted on one stated
            condition — each names its own SPAN, so a reader can tell them
            apart — and a third whose span also reads «soʻnggi 90 kun» would
            break the very rule that made two safe: two ninety-day repeat
            shares, on two different clocks, printing two different numbers
            under one name.

            The money collides with nothing, is this band's own window and
            clock, and is the figure that share is computed from. The share is
            one card away, twice.
          */}
          <StatTile
            status={flowStatus}
            label="Takroriy xarid tushumi"
            value={f?.summary.repeatRevenue.amount ?? null}
            unit="money"
            hint="Shu davrdagi buyurtmalardan · birinchi xarid emas"
          />
          <StatTile
            status={flowStatus}
            label="Yoʻqotilgan mijozlar"
            value={lost?.customers ?? null}
            unit="count"
            /*
              THE ONE TILE IN THIS ROW THAT IS NOT ABOUT THE WINDOW. Silence is
              measured against a customer's own last order as of TODAY, so it
              does not move with the ninety days beside it, and the hint says
              so rather than leaving the row to imply one span.
            */
            /* NOT «bugungi holat», although that is what it is: the База card
               further down owns that phrase and says it about a different
               population. Two blocks wearing one sentence is how a reader
               starts comparing two numbers that were never comparable. */
            hint={`${CUSTOMER_AT_RISK_DAYS} kundan beri buyurtma yoʻq · davrga bogʻliq emas`}
            tone="warning"
          />
        </div>

        <ChartCard
          title="Yangi va qaytgan mijozlar"
          hint="Ikkala chiziq ham ODAM sanaydi — buyurtma emas. Bir mijoz bir kunda ikki buyurtma bersa ham bitta."
        >
          {flow.isPending && <ChartSkeleton height={280} />}
          {/* ALL THREE BRANCHES. The «База» card shipped without an error
              branch once and a failed request read as an empty funnel. */}
          {flow.isError && (
            <ErrorState
              message={(flow.error as Error | null)?.message}
              onRetry={() => void flow.refetch()}
            />
          )}
          {f && f.series.length === 0 && (
            <EmptyState
              title="Bu davrda buyurtma yoʻq"
              body="Buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin."
            />
          )}
          {f && f.series.length > 0 && <CustomerFlowChart data={f.series} height={280} />}
        </ChartCard>

        <ChartCard
          title="Mijoz qayerdan kelayapti"
          /*
            TWO PANELS, TWO CLOCKS, AND THE HINT HAS TO SAY SO. The count is
            this band's ninety days; the rate is the WHOLE history on a fixed
            ninety-day maturity horizon, because a customer who arrived last
            week has not yet had the chance to come back and counting them
            would drag every source's rate towards zero.
          */
          hint="Yuqorida — shu davrda kelgan mijozlar soni. Pastda — oʻsha manbaning qaytish foizi, butun tarix boʻyicha, 90 kunlik yetilish muddati bilan."
        >
          {flow.isPending && <ChartSkeleton height={200} />}
          {flow.isError && (
            <ErrorState
              message={(flow.error as Error | null)?.message}
              onRetry={() => void flow.refetch()}
            />
          )}
          {f && f.sources.length === 0 && (
            <EmptyState
              title="Manba koʻrsatilmagan"
              body="Bitimlarda «Manba» maydoni toʻldirilmagan boʻlishi mumkin."
            />
          )}
          {f && f.sources.length > 0 && (
            <div className="space-y-4">
              <CategoryBarList
                mode="magnitude"
                status="ready"
                rows={f.sources.map((source) => ({
                  key: source.key,
                  label: source.label,
                  value: source.newCustomers,
                  display: formatNumber(source.newCustomers),
                  meta:
                    source.sharePercent === null
                      ? undefined
                      : `${formatPercent(source.sharePercent)} ulush`,
                }))}
              />
              {/*
                THE SAME ROW ORDER, NEVER RE-SORTED. What makes these two panels
                readable as one answer is that the reader's eye runs down ONE
                column of labels: sorting the lower panel by its own value would
                put a source's count and its rate on different lines and quietly
                turn one card into two.
              */}
              <CategoryBarList
                mode="share"
                status="ready"
                rows={f.sources.map((source) => ({
                  key: source.key,
                  label: source.label,
                  value: source.repeatPercent,
                  display: formatPercent(source.repeatPercent),
                  meta: `${formatNumber(source.maturedCustomers)} ta yetilgan mijozdan`,
                }))}
              />
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Mijozlar holati — bugun"
          hint={`Mijozning oxirgi buyurtmasidan beri oʻtgan vaqt: ${CUSTOMER_ACTIVE_DAYS} kungacha faol, ${CUSTOMER_AT_RISK_DAYS} kungacha xavf ostida, undan keyin yoʻqotilgan.`}
        >
          {flow.isPending && <ChartSkeleton height={160} />}
          {flow.isError && (
            <ErrorState
              message={(flow.error as Error | null)?.message}
              onRetry={() => void flow.refetch()}
            />
          )}
          {f && f.states.customers === 0 && (
            <EmptyState
              title="Mijoz topilmadi"
              body="Buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin."
            />
          )}
          {f && f.states.customers > 0 && (
            <div className="space-y-2.5">
              {f.states.rows.map((row) => {
                const share =
                  f.states.customers > 0 ? (row.customers / f.states.customers) * 100 : null
                return (
                  <div key={row.key} className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ background: `var(${row.colour})` }}
                    />
                    <span
                      className="w-28 shrink-0 text-xs"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      {row.label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Meter value={share} tone="neutral" />
                    </span>
                    <span className="tabular w-24 shrink-0 text-right text-xs">
                      {formatNumber(row.customers)}
                      <span className="ml-1" style={{ color: 'var(--ink-muted)' }}>
                        {formatPercent(share)}
                      </span>
                    </span>
                  </div>
                )
              })}
              {/*
                IT DOES NOT REDRAW THE PORTAL'S OWN VERDICT. «База — mijozlar
                hozir qayerda» further down this page draws the FOUR states
                Bitrix24 itself assigns, from the retention pipeline's stages.
                This block measures silence from order dates and nothing else;
                the two answer different questions, so the caption points at the
                other card rather than inviting a comparison of the numbers.
              */}
              <p className="pt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                Jami {formatNumber(f.states.customers)} ta mijoz. Portal oʻz hukmini «База —
                mijozlar hozir qayerda» kartasida aytadi.
              </p>
            </div>
          )}
        </ChartCard>

        {/*
          TWO SPANS SIT UNDER ONE HEADING, and the hint used to claim one.

          The three tiles are whole-history (the totals arm of the cohort query
          takes no `months` bound); the matrix below is the last 18 months of
          cohorts. «Butun tarix boʻyicha hisoblanadi» was true of the tiles and
          false of the matrix, and a reader who took it at face value read the
          grid as the company's whole history. Said in two clauses rather than
          a paragraph: this is 12px muted text over a band somebody scans, not
          a methodology note.

          «Faol bazada» used to be a fourth tile here and was the odd one out
          three ways: a snapshot rather than a history, a count of a different
          population, and — on 2026-09-15 — 12 558 sitting beside «Jami
          mijozlar 11 512», two numbers that contradict each other on their
          faces unless the reader already knows one counts База deals and the
          other counts first purchases. It now lives on the База card, where
          its own denominator is.
        */}
        {/*
          AND THE CLOCK, NOW THAT THERE ARE TWO ON ONE SCREEN.

          The band above counts a customer from the day they ORDERED; this
          block counts them from the day their first order was DELIVERED. Both
          are right, they are different events, and the two customer totals
          differ on purpose — unlabelled they read as one of them being broken,
          which is the reading a reader reaches for first and the one nothing
          else on the page would correct.
        */}
        <SectionHeader
          title="Kogorta tahlili"
          hint={`Yetkazilgan sana boʻyicha · koʻrsatkichlar — butun tarix · matritsa — soʻnggi ${COHORT_HISTORY_MONTHS} oy.`}
        />

        <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-3">
          <GaugeTile
            status={tileStatus}
            label="Takroriy tushum ulushi"
            value={data?.repeatRevenueShare ?? null}
            /*
              Deliberately uncoloured.
            
              There is no benchmark for what repeat share SHOULD be in this
              business, and painting 9% red would be the dashboard asserting a
              judgement it cannot support. The number and its trend are the
              finding; the reader supplies the target.
            */
            tone="neutral"
            /*
              THE WINDOW IS IN THE HINT because this label appears twice on one
              screen. `RepeatShareCard` at the bottom carries the same words over
              the band's own ninety days and legitimately prints a different
              number; with neither naming its span, the two read as a
              contradiction.
            */
            hint="Butun tarix boʻyicha · birinchi xariddan keyingi savdolar"
          />
          <StatTile
            status={tileStatus}
            label="Qaytgan mijozlar"
            value={data?.repeatCustomers ?? null}
            unit="count"
            hint={
              data ? `${formatNumber(data.totalCustomers)} ta mijozdan` : undefined
            }
          />
          <StatTile
            status={tileStatus}
            label="Jami mijozlar"
            value={data?.totalCustomers ?? null}
            unit="count"
            /*
              «YETKAZILGAN» AND «YOPILGAN (WON)» NAME THE SAME EVENT, not two
              clocks — a deal becomes WON the instant it reaches Успешно,
              which is the same instant Logistika would call delivered. An
              earlier version of this comment claimed a 20-25 day gap between
              the two; that gap is real but it is order→delivery, and this
              figure already sits on the delivery side of it (`SimpleView`'s
              own clock line says so). The word was never the risk.

              What does not reconcile against Logistika is the DENOMINATOR.
              Logistika counts ORDERS that arrived in a bounded window (the
              C4:NEW / Тасдиклаш arrival); this figure counts DISTINCT
              CUSTOMERS by their first purchase, over ALL HISTORY. A customer
              with three orders is one here and three there, and a customer
              whose first order predates the window is here and not there.
              «Yopilgan (WON)» stays this tile's own word because it is the
              more precise one for a count of PEOPLE rather than orders — see
              `cohort-total-hint` below for where the population difference is
              said out loud, to the reader, once.
            */
            hint="Yopilgan (WON) birinchi xaridi boʻlgan mijozlar"
          />
        </div>

        {/*
          THE POPULATION, NAMED BEFORE ANYBODY GOES LOOKING FOR A DIFFERENT
          NUMBER — not a second clock, a second DENOMINATOR.

          «Yetkazilgan» and «yopilgan (WON)» name the same instant (a deal
          becomes WON the moment it reaches Успешно), so «Jami mijozlar» and
          «Qaytgan mijozlar» above are not sitting on a clock anybody could
          dispute. What a reader who has just read Logistika, or any
          order-arrival board, WILL find different is the population: those
          screens count ORDERS that arrived in one bounded window; these two
          tiles count DISTINCT CUSTOMERS by their first purchase, over every
          month there has ever been. Scoped to exactly the two tiles this
          sentence reconciles — «Faol bazada», a today-snapshot on a different
          question, sits on the База card and is not swept in here.
        */}
        <p
          data-testid="cohort-total-hint"
          className="px-1 text-[11px] leading-snug"
          style={{ color: 'var(--ink-muted)' }}
        >
          «Jami mijozlar» va «Qaytgan mijozlar» — mijozning birinchi xaridi{' '}
          <strong>yetkazilgan</strong> (yopilgan, WON) boʻlgan sanaga koʻra,
          har bir mijozni BITTA marta, butun tarix boʻyicha sanaydi. Boshqa
          joyda — masalan, buyurtma{' '}
          <strong>tasdiqlash navbatiga tushgan</strong> sana boʻyicha, bitta
          davr oynasida — son boshqacha chiqadi, chunki u mijozlarni emas,
          buyurtmalarni sanaydi. Ikkalasi ham toʻgʻri — soati emas, nima
          sanalayotgani boshqacha.
        </p>

        {/*
          The lead instrument. The matrix is the one thing this page exists to
          show that nothing else in the product can, so it wears the hero
          surface and the registration brackets — once per page, and only here.
          The tiles above and the band below stay ordinary cards on purpose:
          the treatment ranks the panel because nothing else wears it.
        */}
        <ChartCard
          title="Kogorta matritsasi"
          className="card-hero brackets"
          /* The matrix now carries its own column group, its own legend and a
             worked example from the reader's own data, so the card hint no longer
             repeats the mechanics. It says the one thing the table cannot: WHY a
             row is a row. */
          hint="Mijozlar birinchi xarid qilgan oyi boʻyicha guruhlanadi — har bir guruh keyin qanchalik qaytib kelgani shu qatorda koʻrinadi."
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* FIRST, because it is the only one of the three that changes
                  the ANSWER. The two beside it change how that answer is
                  drawn, and putting a question and two renderings of it in one
                  row without ordering them leaves the reader to discover which
                  is which by pressing. */}
              <RopPicker
                value={rop}
                options={ropList}
                loading={ropOptions.isFetching}
                onOpen={() => setPicking(true)}
                onChange={setRop}
              />
              <SegmentedControl
                value={view}
                onChange={setView}
                ariaLabel="Matritsa koʻrinishi"
                /*
                  THREE READINGS OF ONE PAYLOAD, AND THE THIRD COSTS NOTHING
                  EITHER.

                  «Pul» is built in the browser from `revenue`, which has
                  ridden every row of this response since the matrix learned to
                  print a cohort's money — so the page still makes the two
                  requests it made before, and the money reading cannot
                  disagree with the customer readings beside it. Same argument
                  as «Oddiy» / «Batafsil» one level up, and as the FAKT 1 /
                  FAKT 2 switch on the sellers board: a second question would
                  be a second answer, and two answers straddle a sync.

                  It is a THIRD OPTION on this control rather than a control of
                  its own. The card already carries two, and «what is in a
                  cell» is one question with three answers, not two questions.
                */
                options={[
                  { value: 'cumulative', label: 'Jami qaytgan' },
                  { value: 'monthly', label: 'Oylik' },
                  { value: 'money', label: 'Pul' },
                ]}
              />
              {/* The window, beside the reading: both controls change how the
                  same answer is LOOKED at, neither asks the server anything. */}
              <SegmentedControl
                value={months}
                onChange={setMonths}
                ariaLabel="Nechta oy koʻrsatilsin"
                options={[
                  { value: '6', label: '6 oy' },
                  { value: '12', label: '12 oy' },
                  { value: 'all', label: 'Hammasi' },
                ]}
              />
            </div>
          }
        >
          {query.isPending && <ChartSkeleton height={320} />}
          {query.isError && (
            <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
          )}
          {data && data.rows.length === 0 && <CohortEmpty rop={data.rop} />}
          {/*
            WHAT THE CUT MEANS, AND WHAT IT DOES NOT REACH.

            Printed from `data.rop` — the response's own echo — and never from
            the control, which holds the team the reader has just picked while
            the rows on screen are still the previous one's. For the one render
            that differs, a heading built from the control names a team whose
            numbers are not there yet.

            THREE SENTENCES, AND EACH ONE ANSWERS A WRONG READING THIS CUT
            INVITES. That the returns are not re-attributed is the one a reader
            will otherwise assume the other way round and use to judge a team's
            follow-up work. That «База» and the concentration band below are
            NOT cut is the one that would otherwise have them reading a
            company-wide partition under a team's heading — the retention cycle
            is run centrally, so there is no acquiring team to cut it by.
          */}
          {/* TRUTHY, not `!== null`. The field is typed non-optional, which is
              a promise about the SERVER and not about every object that ever
              reaches this component: a fixture or an older cached payload
              carries `undefined`, and `undefined !== null` drew the whole
              banner with an empty «» where the team name goes. A cut is a team
              NAME; the absence of one is the absence of a cut, whichever way
              it is spelled. */}
          {data && data.rop && (
            <p
              className="mb-3 text-[11px] leading-relaxed"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Faqat <strong>{data.rop}</strong> birinchi marta sotgan mijozlar.{' '}
              Qaytib kelgan xaridni keyin kim sotgani muhim emas — u ham shu
              jamoaga yoziladi, chunki bu «kim mijoz olib keladi» savoli,
              «kim ushlab qoladi» emas.{' '}
              Pastdagi «База» va mijozlar kontsentratsiyasi bloklari
              kesilmaydi — ular butun kompaniya boʻyicha qoladi.
            </p>
          )}
          {data && data.rows.length > 0 && (
            <CohortHeatmap
              rows={matrixRows}
              view={view}
              months={MONTH_WINDOWS[months]}
              /*
                THE SUMMARY ROW'S «Kogorta tushumi», which printed «—» until
                now because the grid is handed money already formatted and had
                nothing to add. So it is added HERE, beside the formatters —
                and what is added is the column the reader can see.

                NOT `revenueTotalAll`, although the DTO now carries it. That is
                the company's whole history, and it would have made its only
                appearance on this screen in a table FOOTER, whose grammar
                already promises «the column, added up». The tiles at the top
                can carry a whole-history figure because each wears a visible
                hint line naming its span; this cell has a `title` and an
                `aria-label` and no visible marker at all, so a sighted reader
                scanning the column would see one number under a column of
                numbers and read it as their total. It would have been right
                far more often than it looked wrong, which is the worst way for
                a figure to be wrong.

                Well-defined, and it stays well-defined: `months` bounds the
                grid's COLUMNS, not its rows, so every row handed over is drawn
                whichever width the reader picks and this sum does not move
                under the 6 / 12 / Hammasi control. `revenueTotalAmount` is the
                lossy major-unit number, which is exactly the right one here —
                it is the same number already printed in every cell of this
                column.

                «1 mijozga» keeps its «—» and its sentence. A mean of
                per-customer figures across cohorts of different ages is not a
                fact about anything.
              */
              totalRevenue={{
                compact: formatCompactUzs(visibleRevenueTotal),
                exact: formatUzs(visibleRevenueTotal),
              }}
            />
          )}
        </ChartCard>

        <ChartCard
          title="База — mijozlar hozir qayerda"
          /*
            The hint no longer lists the cadence stages, because the card no
            longer lists stages: it lists the four STATES, and each bar names
            its own stages in its hover. The old copy promised «1 kun, 3 kun,
            10 kun, 20 kun, 30 kun» over a list of fifteen rows, ten of which
            it never mentioned.
          */
          hint="Bu tarixiy egri chiziq emas, bugungi holat: База voronkasidagi har bir mijoz hozir qaysi holatda."
        >
          {query.isPending && <ChartSkeleton height={200} />}
          {/*
            THE ERROR BRANCH, which this card did not have. Both guards below
            test `data`, so a failed request left the card body empty — a title
            and a hint over nothing, which reads as "База is empty" rather than
            "we could not ask". The matrix card above has carried all three
            states from the start; this one now matches it.
          */}
          {query.isError && (
            <ErrorState
              message={(query.error as Error | null)?.message}
              onRetry={() => void query.refetch()}
            />
          )}
          {data && data.groups.length === 0 && (
            <EmptyState
              title="Retention voronkasi boʻsh"
              body="База voronkasidagi bitimlar mijozga bogʻlanmagan."
            />
          )}
          {data && data.groups.length > 0 && (
            <StateBars
              groups={data.groups}
              baseCustomers={data.baseCustomers}
              workedCustomers={data.workedCustomers}
            />
          )}
        </ChartCard>

        {/*
          The dependency chapter — /insights/concentration.

          Everything above says whether customers come back; this band says how
          much of the last ninety days' money would leave with a handful of
          them, and what the second purchase actually looks like when it
          happens. Its own query and its own window, so a failure here degrades
          these five cards to honest error states without touching the matrix.
        */}
        <SectionHeader title="Mijozlar kontsentratsiyasi" hint={concentrationCaption} />

        <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
          <GaugeTile
            status={concStatus}
            label="Top-10 mijoz ulushi"
            /*
              SMALL SAMPLES DO NOT GET A RING, and this is the guard that was
              missing. On a twelve-customer window the top ten ARE 89% of the
              revenue arithmetically and the ring painted it critical red — a
              statement about a business that was really a statement about a
              sample. `null` here draws the tile's own no-value state, and the
              hint says which it is.
            */
            value={enoughCustomers(conc) ? top10 : null}
            tone={enoughCustomers(conc) ? top10Tone : 'neutral'}
            hint={
              conc
                ? enoughCustomers(conc)
                  ? `10 ta eng yirik mijoz davr tushumida · Top-5: ${formatPercent(conc.pareto.top5SharePercent)}`
                  : `Namuna kichik — bu oynada ${formatNumber(conc.pareto.totalCustomers)} ta mijoz (kamida ${MIN_CUSTOMERS} kerak)`
                : undefined
            }
          />

          <FigureTile
            status={concStatus}
            label="80% tushumni beruvchilar"
            hint={
              conc
                ? enoughCustomers(conc)
                  ? `Jami ${formatNumber(conc.pareto.totalCustomers)} mijozdan shunchasi davr tushumining 80 foizini beradi`
                  : `Namuna kichik — ${formatNumber(conc.pareto.totalCustomers)} ta mijoz`
                : undefined
            }
          >
            {conc && enoughCustomers(conc) && conc.pareto.customersFor80Percent !== null ? (
              <>
                <AnimatedNumber
                  value={conc.pareto.customersFor80Percent}
                  format={(v) => formatNumber(Math.round(v))}
                />
                {/* The denominator rides along muted, soʻm-suffix style:
                    "12 / 480" IS the finding — a wide base carried by a short
                    list — and neither number means much alone. */}
                <span className="ml-1.5 text-base font-normal" style={{ color: 'var(--ink-muted)' }}>
                  / {formatNumber(conc.pareto.totalCustomers)}
                </span>
              </>
            ) : (
              NO_VALUE
            )}
          </FigureTile>

          <FigureTile
            status={concStatus}
            label="Takroriy xarid oraligʻi"
            hint={
              conc && !enoughPairs(conc)
                ? `Namuna kichik — ${formatNumber(conc.repeat.pairsMeasured)} ta ikkinchi xarid (kamida ${MIN_PAIRS} kerak)`
                : repeatIntervalHint
            }
          >
            {conc && enoughPairs(conc) && conc.repeat.medianDaysBetweenFirstAndSecond !== null ? (
              <>
                <AnimatedNumber
                  value={conc.repeat.medianDaysBetweenFirstAndSecond}
                  format={(v) => formatNumber(Math.round(v * 10) / 10)}
                />
                <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                  kun
                </span>
              </>
            ) : (
              NO_VALUE
            )}
          </FigureTile>

          <GaugeTile
            status={concStatus}
            label="90 kunda qaytish"
            value={enoughCohort(conc) ? (conc?.repeat.repurchaseWithin90Percent ?? null) : null}
            /*
              Neutral like the repeat-share gauge at the top of the page, and
              for the same reason: there is no benchmark for how fast THIS
              business's buyers should return, so the ring states the magnitude
              and the reader supplies the target. The cohort in the hint is the
              part that must be said: only first buyers old enough to have had
              a full 90 days are counted, or the rate would flatter itself.
            */
            tone="neutral"
            hint={
              conc
                ? enoughCohort(conc)
                  ? `Kohorta: ${formatNumber(conc.repeat.cohortSize)} ta birinchi xaridor${
                      horizonWindow ? ` (${horizonWindow})` : ''
                    }, har biriga toʻliq 90 kunlik ufq berilgan`
                  : `Namuna kichik — ${formatNumber(conc.repeat.cohortSize)} ta birinchi xaridor (kamida ${MIN_COHORT} kerak)`
                : undefined
            }
          />
        </div>

        <RepeatShareCard status={concStatus} repeat={conc?.repeat} />
        </>
      )}
    </PageShell>
  )
}

/*
  THE FLOORS UNDER THE CONCENTRATION BAND.

  Not statistical thresholds — none of these figures has a confidence interval
  the screen could print — but the point below which the number says more about
  the sample than about the business. They are separate because the three
  denominators are different populations: how many customers bought at all, how
  many second purchases there were to measure an interval between, and how many
  first buyers are old enough to have had their ninety days.

  Deliberately low. The job is to catch a day's trading (12 customers, 1 pair,
  4 first buyers — measured 2026-09-15), not to refuse a quiet fortnight.
*/
const MIN_CUSTOMERS = 30
const MIN_PAIRS = 10
const MIN_COHORT = 30

function enoughCustomers(conc: ConcentrationDto | undefined): boolean {
  return conc !== undefined && conc.pareto.totalCustomers >= MIN_CUSTOMERS
}

function enoughPairs(conc: ConcentrationDto | undefined): boolean {
  return conc !== undefined && conc.repeat.pairsMeasured >= MIN_PAIRS
}

function enoughCohort(conc: ConcentrationDto | undefined): boolean {
  return conc !== undefined && conc.repeat.cohortSize >= MIN_COHORT
}

/**
 * A band tile for figures StatTile has no unit for — a "12 / 480" fraction,
 * a day interval. Deliberately the same voice as StatTile (12.5px sentence-
 * case label, 30px `.figure`, skeleton sized to the ready figure so ready
 * never reflows loading, error as a word in critical ink): a fourth tile
 * dialect would cost more than these two value shapes are worth.
 */
function FigureTile({
  label,
  status,
  hint,
  children,
}: {
  readonly label: string
  readonly status: 'loading' | 'error' | 'ready'
  readonly hint?: string
  /** The ready-state figure markup. Render NO_VALUE for a genuine null. */
  readonly children: ReactNode
}) {
  return (
    <div className="card flex flex-col px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>

      {status === 'loading' ? (
        <div className="skeleton mt-2 h-[30px] w-2/3" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--status-critical)' }}
          // Decorative title — it only repeats the visible word (Stat.tsx
          // precedent); data-carrying titles ride the Tooltip primitive.
          title="Maʼlumot olinmadi"
        >
          <span className="text-base font-medium">Olinmadi</span>
        </p>
      ) : (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          {children}
        </p>
      )}

      {hint && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * The same claim from two instruments, deliberately unreconciled.
 *
 * Both rows answer "what share of the period's revenue is repeat business".
 * The first is computed from deal history — every win after a customer's
 * first counts. The second is Bitrix24's own hand-set «takroriy mijoz» flag.
 * If the portal's data were clean the two bars would sit on top of each
 * other, so the GAP between them is itself a measurement: of how reliable
 * the flag is and how many deals are missing their customer link. Averaging
 * or picking one would destroy exactly the signal being shown.
 *
 * Two neutral meters on the same scale, because the divergence must be
 * readable as a length difference, not recomputed from two printed numbers.
 */
function RepeatShareCard({
  status,
  repeat,
}: {
  readonly status: 'loading' | 'error' | 'ready'
  readonly repeat: ConcentrationRepeatDto | undefined
}) {
  const computed = repeat?.repeatRevenueSharePercent ?? null
  const flagged = repeat?.bitrixFlagSharePercent ?? null
  const gap = computed !== null && flagged !== null ? Math.abs(computed - flagged) : null

  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-1">
        {/*
          THE WINDOW IS IN THE TITLE. The gauge at the top of this screen wears
          the same three words over the WHOLE HISTORY and legitimately prints a
          different number; two identical labels with two numbers on one page
          read as an error in one of them. Neither is dropped and neither is
          averaged — they answer the same question over different spans.
        */}
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
          Takroriy tushum ulushi — soʻnggi 90 kunda, ikki oʻlchov
        </p>
        <InfoTip
          label="Nega ikkita raqam"
          content={
            <span className="block max-w-[280px]">
              Ikkala qator bir savolga javob beradi: davr tushumining qancha qismi takroriy
              xariddan. Birinchisi bitimlar tarixidan hisoblanadi, ikkinchisi — Bitrix24ning oʻz
              «takroriy mijoz» belgisidan. Farqning oʻzi maʼlumot sifati signali: belgi qoʻlda
              qoʻyiladi, mijozga bogʻlanmagan bitim esa ikkala oʻlchovni ham buzadi. Farqni
              yaqinlashtirish emas, kuzatib borish kerak.
            </span>
          }
        />
      </div>

      {status === 'loading' ? (
        <div className="mt-3 space-y-2.5" role="status">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p className="mt-3 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-2.5">
            <MeasureRow label="Bitimlar tarixidan" value={computed} />
            <MeasureRow label="Bitrix24 belgisidan" value={flagged} />
          </div>
          {gap !== null && (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Farq: {formatNumber(Math.round(gap * 10) / 10)} foiz punkti
            </p>
          )}
        </>
      )}
    </div>
  )
}

function MeasureRow({ label, value }: { readonly label: string; readonly value: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-44 shrink-0 truncate text-xs"
        style={{ color: 'var(--ink-secondary)' }}
        title={label}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <Meter value={value} tone="neutral" label={label} />
      </div>
    </div>
  )
}
