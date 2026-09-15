'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { CohortHeatmap, type CohortMatrixRow, type CohortView } from '@/components/charts/Heatmap'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { GaugeTile, Meter, SectionHeader, StatTile } from '@/components/ui/Stat'
import { InfoTip } from '@/components/ui/Tooltip'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { SimpleView } from '@/features/cohort/SimpleView'
import { useCohortMode } from '@/features/cohort/useCohortMode'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type CohortDto,
  type CohortSummaryDto,
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
import { t } from '@/lib/messages'

/**
 * Retention, two ways — then who the money actually stands on.
 *
 * The matrix answers "do customers come back", and the ladder beside it
 * answers "where are they right now" — the portal runs a follow-up cycle
 * (1 day, 3, 10, 20, 30) whose live headcount is a different and more
 * actionable fact than a historical curve.
 *
 * The headline is second-order revenue share. That is the number that decides
 * whether the retention team is worth funding, and it is not visible anywhere
 * in Bitrix24 itself.
 *
 * The concentration band at the bottom closes the loop: retention says the
 * customers return, concentration says how few of them the period's revenue
 * would survive losing — and how fast a first buyer becomes a second one.
 */
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
  const query = useQuery({
    queryKey: ['cohorts'],
    queryFn: ({ signal }) =>
      apiGet<CohortSummaryDto>('/insights/cohorts', { months: COHORT_HISTORY_MONTHS }, signal),
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

  const { apiParams } = useDashboardFilters()

  /*
   * Period-scoped where the cohort read deliberately is not: the matrix needs
   * 18 months of history to be a matrix, but "whose money is this period
   * standing on" is a question about the selected window. Keyed on apiParams
   * so the cache follows the period control (and matches the channels page's
   * key — two pages, one fetch); the endpoint ignores the people/source
   * filters server-side, insights-style, but the key stays honest if that
   * ever changes.
   */
  /*
    AND IT IS ONLY ASKED FOR IN «BATAFSIL», WHICH IS NOT THE DEFAULT.

    Every consumer of this response — the four tiles and `RepeatShareCard` —
    is inside the `detail` branch. When «Batafsil» was the whole page that
    made this a rendered query; making «Oddiy» the default turned it into a
    DISCARDED one on every first load of the slowest screen in the product,
    for the majority of visits, which never press the toggle at all.

    THE TRADE, STATED: the first press of «Batafsil» now waits for this
    request instead of finding it already in hand. That cost is paid once —
    TanStack caches the result under `['concentration', apiParams]`, so
    toggling back and forth afterwards costs nothing and the band redraws from
    cache — and it is paid by the reader who asked for the analyst's view,
    which is the reader who is prepared to wait for it. A prefetch on every
    load spends a real query on every manager who never asks, and the band
    already degrades to honest skeletons while it loads (`concStatus`), so
    what the waiting reader sees is the state the page was built to show.

    The gate is on the MODE and not on the query key: a key mentioning the
    mode would be a second cache entry for one answer, which is the mistake
    the cohort read's own comment is about.
  */
  const concentration = useQuery({
    queryKey: ['concentration', apiParams],
    queryFn: ({ signal }) =>
      apiGet<ConcentrationDto>('/insights/concentration', apiParams, signal),
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
   * The band's honesty caption. Pareto shares can only count revenue that HAS
   * a customer attached — whatever share does not is the blind spot, and it
   * is printed in the section header rather than footnoted, so the shares are
   * never read as covering everything.
   */
  const nullCustomerShare = conc?.pareto.nullCustomerSharePercent ?? null
  /*
    The window is NAMED here rather than under the page title.

    PageShell prints the resolved dates beside the description, and the
    description on this page belongs to the cohort matrix — which has no
    window. So the dates are stated where they actually apply: on the one band
    the period control drives.
  */
  const concentrationWindow = concentration.data?.meta.period
  const concentrationCaption = [
    concentrationWindow
      ? `${formatDate(concentrationWindow.start)} – ${formatDate(
          new Date(new Date(concentrationWindow.end).getTime() - 1).toISOString(),
        )} oraligʻida yutilgan bitimlar boʻyicha.`
      : 'Davrda yutilgan bitimlar boʻyicha.',
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
      stale={concentration.isPlaceholderData}
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
          {data && data.rows.length === 0 && (
            <EmptyState
              title="Kogorta uchun maʼlumot yoʻq"
              body="Yetkazilgan buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin."
            />
          )}
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
          THE PERIOD CONTROL GOVERNS THE BOTTOM OF THIS PAGE, NOT THE TOP.

          Everything down to the ladder is a statement about the whole customer
          history — "how many of March's buyers came back" only means something
          if every month since is counted, so `/insights/cohorts` takes no
          window and none of it moves when the presets are clicked. The
          concentration band below IS period-scoped.

          A control that visibly changes half a screen and leaves the other half
          still is the reader's problem to solve unless the screen says which
          half is which. This header says it, and the band's own caption below
          states the window it is read in.
        */}
        {/*
          THREE SPANS SIT UNDER ONE HEADING, and the hint used to claim one.

          The four tiles are whole-history (the totals arm of the cohort query
          takes no `months` bound). «Faol bazada» is a snapshot of today. The
          matrix below is the last 18 months of cohorts. «Butun tarix boʻyicha
          hisoblanadi» was true of the tiles and false of the matrix, and a
          reader who took it at face value read the grid as the company's whole
          history. Said in three clauses rather than a paragraph: this is 12px
          muted text over a band somebody scans, not a methodology note.
        */}
        <SectionHeader
          title="Kogorta tahlili"
          hint={`Koʻrsatkichlar — butun tarix · matritsa — soʻnggi ${COHORT_HISTORY_MONTHS} oy · tanlangan davr bu blokka taʼsir qilmaydi.`}
        />

        <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
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
              the SELECTED PERIOD and legitimately prints a different number; with
              neither naming its span, the two read as a contradiction.
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
          <StatTile
            status={tileStatus}
            label="Faol bazada"
            /* Counted once each by the database. Adding the stage column up
               counted anyone with two open deals twice, and swept in the three
               stages where the cadence ends. */
            value={data?.workedCustomers ?? null}
            unit="count"
            hint="База da ochiq bitimi bor mijozlar"
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
          sentence reconciles — «Faol bazada» beside them is a today-snapshot
          on a different question and is not swept in here.
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
              <SegmentedControl
                value={view}
                onChange={setView}
                ariaLabel="Matritsa koʻrinishi"
                options={[
                  { value: 'cumulative', label: 'Jami qaytgan' },
                  { value: 'monthly', label: 'Oylik' },
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
          {data && data.rows.length === 0 && (
            <EmptyState
              title="Kogorta uchun maʼlumot yoʻq"
              body="Yetkazilgan buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin."
            />
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
          // The stage names in the data are 1/3/10/20/30 kun — the copy used to
          // promise a 7/14/21 cycle the portal does not run.
          hint="Takroriy aloqa sikli: 1 kun, 3 kun, 10 kun, 20 kun, 30 kun. Bu tarixiy egri chiziq emas, bugungi holat."
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
          {data && data.stages.length === 0 && (
            <EmptyState
              title="Retention voronkasi boʻsh"
              body="База voronkasidagi bitimlar mijozga bogʻlanmagan."
            />
          )}
          {data && data.stages.length > 0 && <StageLadder stages={data.stages} />}
        </ChartCard>

        {/*
          The dependency chapter — /insights/concentration.

          Everything above says whether customers come back; this band says how
          much of the period's money would leave with a handful of them, and
          what the second purchase actually looks like when it happens. Its own
          query, so a failure here degrades these five cards to honest error
          states without touching the matrix.
        */}
        <SectionHeader title="Mijozlar kontsentratsiyasi" hint={concentrationCaption} />

        <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
          <GaugeTile
            status={concStatus}
            label="Top-10 mijoz ulushi"
            value={top10}
            tone={top10Tone}
            hint={
              conc
                ? `10 ta eng yirik mijoz davr tushumida · Top-5: ${formatPercent(conc.pareto.top5SharePercent)}`
                : undefined
            }
          />

          <FigureTile
            status={concStatus}
            label="80% tushumni beruvchilar"
            hint={
              conc
                ? `Jami ${formatNumber(conc.pareto.totalCustomers)} mijozdan shunchasi davr tushumining 80 foizini beradi`
                : undefined
            }
          >
            {conc && conc.pareto.customersFor80Percent !== null ? (
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
            hint={repeatIntervalHint}
          >
            {conc && conc.repeat.medianDaysBetweenFirstAndSecond !== null ? (
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
            value={conc?.repeat.repurchaseWithin90Percent ?? null}
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
                ? `Kohorta: ${formatNumber(conc.repeat.cohortSize)} ta birinchi xaridor${
                    horizonWindow ? ` (${horizonWindow})` : ''
                  }, har biriga toʻliq 90 kunlik ufq berilgan`
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
          Takroriy tushum ulushi — tanlangan davrda, ikki oʻlchov
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

/**
 * The follow-up ladder as a bar list.
 *
 * Bars are proportional to the largest stage rather than to the total: the
 * stages are not parts of a whole — a customer sits in exactly one, but the
 * list is not exhaustive of the customer base — so a stacked or percentage
 * treatment would state something untrue.
 */
function StageLadder({
  stages,
}: {
  readonly stages: readonly { readonly stage: string; readonly customers: number }[]
}) {
  const max = Math.max(...stages.map((s) => s.customers), 1)

  return (
    <ul className="space-y-1.5">
      {stages.map((stage) => (
        <li key={stage.stage} className="flex items-center gap-3">
          <span
            className="w-44 shrink-0 truncate text-xs"
            style={{ color: 'var(--ink-secondary)' }}
            title={stage.stage}
          >
            {stage.stage.replace(/^.*·\s*/, '')}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
            <div
              className="grow-x h-full rounded-full"
              style={{
                width: `${(stage.customers / max) * 100}%`,
                /*
                  Sequential, not series-7.
                  
                  This is one quantitative measure, so it takes the magnitude
                  hue every other single-measure bar uses. series-7 also
                  happens to be THIS page's accent — so the bars were wearing
                  what looked exactly like page identity, the one thing a
                  value-encoding mark must never do, even by coincidence.
                */
                background: 'var(--seq-450)',
              }}
            />
          </div>
          <span
            className="tabular w-16 shrink-0 text-right text-xs font-medium"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatNumber(stage.customers)}
          </span>
        </li>
      ))}
    </ul>
  )
}
