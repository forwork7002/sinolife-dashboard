'use client'

import { useQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useState } from 'react'

import { Card, ChartCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  ArrowOutGlyph,
  ArrowUpGlyph,
  BarsGlyph,
  CheckCircleGlyph,
  ClockGlyph,
  CrossCircleGlyph,
  EyeGlyph,
  EyeOffGlyph,
  PhoneMissedGlyph,
  type GlyphProps,
} from '@/components/ui/Icons'
import {
  ColumnFilter,
  ColumnFilterList,
  ColumnFilterRange,
  MultiSelect,
  Pagination,
} from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { boardSummaryKey } from './summaryKey'
import {
  type ConfirmationOrderDto,
  type ConfirmationOutcome,
  type ConfirmationQueueDto,
  type ConfirmationRegionOptionsDto,
  type ConfirmationVisitDto,
  type MoneyDto,
  apiGet,
} from '@/lib/api'
import { APP_TIME_ZONE, NO_VALUE, formatFullUzs, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * The Тасдиклаш queue, one row per order.
 *
 * Laid out against the client's own ROP dashboard (rustamov0277-cmd.github.io/
 * sales-dashboard) on their instruction: same five states, same twelve columns
 * in the same order, same vocabulary. That dashboard is what the floor reads
 * every day, and a second screen describing the same process in different
 * words is a screen nobody trusts.
 *
 * THE STATE NAMES ARE VERBATIM. They are the status keys the Telegram bot
 * (`sinolifesalesadmin_v2`) writes into the РОП channels, so an operator who
 * sees `Кутармади (нд)` in Telegram finds the same words here. The emoji are
 * the bot's too, and they earn their place beyond familiarity: colour plus a
 * distinct glyph survives a colourblind reader and a greyscale print where
 * colour alone does not. The surrounding copy stays in the dashboard's voice.
 *
 * WHAT THE PERIOD SELECTS: the orders that REACHED the queue in it.
 * "Today" means every deal that arrived in `C4:NEW` today — the move out of
 * «Регистрация» / «Сделка успешна» that hands an order to Тасдиклаш, and the
 * moment the bot posts it to the ROP channel. It is the same date the
 * reference board carries, so the two can be read side by side.
 *
 * It is NOT Дата создания, which this screen used to select on. A deal can
 * sit in Регистрация for days before anyone can work it, so intake and
 * arrival are different days for a large minority of orders: on 2026-09-03
 * one order had arrived and four had been created.
 *
 * WHERE THIS SCREEN IS DELIBERATELY BETTER THAN THE ONE IT MIRRORS
 * The reference renders from `deal_state.json`, which the bot builds by
 * polling and never prunes — so its rate is lifetime-to-date, and it can only
 * hold orders whose ROP has a mapped Telegram channel. This one runs on the
 * imported stage history, so it has a real reporting window, it sees every
 * ROP, and it catches transitions that happen between two of the bot's polls.
 */

interface OutcomeSpec {
  readonly key: ConfirmationOutcome
  /**
   * A drawn mark, not the bot's emoji.
   *
   * The emoji stay the floor's vocabulary and the LABELS keep them company in
   * Telegram; on this screen they were the wrong material. An emoji renders in
   * the platform's palette rather than `currentColor`, so it cannot take the
   * state's own colour, and it lands four different ways across Windows,
   * macOS, Android and Linux. Each glyph here is a different SILHOUETTE, so
   * the five stay apart without colour at all.
   */
  readonly Glyph: (props: GlyphProps) => React.ReactElement
  /** Verbatim from Bitrix24 and the bot. Not translated — see above. */
  readonly label: string
  readonly color: string
}

/** In the reference's order: the queue, then the two ways it stalls, then the outcomes. */
const OUTCOMES: readonly OutcomeSpec[] = [
  /*
    "КУТИЛМОҚДА", not "Тасдиқлаш".

    This tile is the state an order is WAITING in, and it sat first in a row
    that then reads Тасдиқланди / Тасдиқланмади / Тасдиқланмай чиқди. A reader
    scanning five labels that all begin "Тасдиқлан-" cannot tell which one is
    the queue and which is the outcome, and the one that named the ACTION
    rather than the state read as if it were the total of confirmations. The
    bell in the header already calls this population "тасдиқлашни кутмоқда";
    the tile now agrees with it.
  */
  { key: 'CONFIRM_NEW', Glyph: ClockGlyph, label: 'Кутилмоқда', color: 'var(--series-1)' },
  {
    key: 'NO_ANSWER',
    Glyph: PhoneMissedGlyph,
    label: 'Кутармади (нд)',
    color: 'var(--status-warning)',
  },
  { key: 'CONFIRMED', Glyph: CheckCircleGlyph, label: 'Тасдиқланди', color: 'var(--status-good)' },
  {
    key: 'REJECTED',
    Glyph: CrossCircleGlyph,
    label: 'Тасдиқланмади',
    color: 'var(--status-critical)',
  },
  {
    key: 'UNCONFIRMED_SHIPPED',
    Glyph: ArrowOutGlyph,
    label: 'Тасдиқланмай чиқди',
    /*
      Violet — the 🟣 the spec marks this state with, not an approximation.

      This state is a problem — the parcel left without anyone reaching the
      customer — so it first wore --status-serious, the orange that says
      "attention". But the board already spends orange on Кутармади (нд) and
      red on Тасдиқланмади, and three warm tiles in a row stopped separating:
      the eye read one alarm zone instead of three distinct outcomes. A cool
      colour is what keeps this one out of that zone.

      It then spent a while on --series-5, the pink, on the argument that
      --series-7 is the violet washed behind every page. That wash is an 11%
      mix UNDER the cards; a 28px semibold figure sitting on one is not
      mistaken for it. The spec in src/server/domain/types.ts names this state
      🟣, so the tile now says what the spec says — and it reads better for it:
      --series-7 clears 4.8:1 on the light card where the pink managed 3.9:1,
      and it stands 33 ΔE from the --series-1 of Кутилмоқда, the only other
      cool tile in the row. Unused elsewhere on this screen, whose own page
      accent is --series-4.
    */
    color: 'var(--series-7)',
  },
]

const SPEC_BY_KEY = new Map(OUTCOMES.map((spec) => [spec.key, spec]))

/** The queue's own sort columns. The URL may carry another page's default. */
const SORTS = ['createdAt', 'movedAt', 'queuedAt', 'decidedAt', 'amountMinor', 'title'] as const

/**
 * The queue table, one definition for the life of the module.
 *
 * Thirteen columns and fourteen render closures were rebuilt on every
 * render of a page that re-renders on a two-minute poll and on every
 * keystroke of the search box. Nothing in them reads component state —
 * proved by the move compiling — so the allocation bought nothing.
 */
const QUEUE_COLUMNS: Column<ConfirmationOrderDto>[] = [
  {
    key: 'rop',
    header: 'РОП',
    width: '116px',
    /*
      A pill, not bold text.

      РОП is a GROUP an order belongs to, and it repeats down the column in
      runs — as bold ink it competed with the customer name for the eye. A
      bordered token reads as a label rather than a name, and the repetition
      stops looking like emphasis.
    */
    render: (row) =>
      row.rop === null ? (
        <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
      ) : (
        <span
          className="inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--grid)',
            color: 'var(--ink-primary)',
          }}
        >
          {row.rop}
        </span>
      ),
  },
  {
    key: 'no',
    header: '№',
    width: '58px',
    numeric: true,
    // Zero-padded to three, as the floor writes it. It is an identifier for
    // the day's Nth order, not a quantity, so it never gets a thousands
    // separator and never changes when the table is re-sorted.
    render: (row) => (
      <span className="tabular text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
        {String(row.dailyNo).padStart(3, '0')}
      </span>
    ),
  },
  {
    key: 'date',
    // The row's name: what a screen reader announces the row BY, and the
    // only column that is unique per row without being an opaque id.
    rowHeader: true,
    header: 'САНА',
    sortKey: 'queuedAt',
    width: '112px',
    // The arrival in the queue, which is what the window selects on and what
    // the daily № restarts on — the three have to name the same instant or
    // the row is numbered into a day its own date denies.
    //
    // `queuedAt` is typed nullable for the DTO's sake; the cohort cannot
    // admit a row without one, and the fallback is here so a future reader
    // that can never sees an epoch date instead of a blank.
    //
    // Дата создания rides along in the tooltip. It is still worth reaching —
    // it is the field an operator sees first in Bitrix — but it decides
    // nothing on this board any more.
    render: (row) => (
      <div
        className="whitespace-nowrap"
        title={`Яратилган: ${tashkentDate(row.createdAt)} ${tashkentTime(row.createdAt)}`}
      >
        <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
          {tashkentDate(row.queuedAt ?? row.createdAt)}
        </span>
        <span
          className="tabular flex items-center gap-1 text-[11px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          {tashkentTime(row.queuedAt ?? row.createdAt)}
          <RepeatMark row={row} />
        </span>
      </div>
    ),
  },
  {
    key: 'bitrixId',
    header: 'ID СДЕЛКИ',
    width: '96px',
    numeric: true,
    render: (row) => (
      <span className="tabular text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
        {row.bitrixId ?? NO_VALUE}
      </span>
    ),
  },
  {
    key: 'customer',
    header: 'МИЖОЗ',
    width: '140px',
    render: (row) => (
      <span className="truncate" style={{ color: 'var(--ink-primary)' }}>
        {row.customerName ?? NO_VALUE}
      </span>
    ),
  },
  {
    key: 'phone',
    header: 'ТЕЛЕФОН',
    width: '170px',
    render: (row) => <PhoneCell phones={row.customerPhones} />,
  },
  {
    key: 'operator',
    header: 'ОПЕРАТОР',
    width: '180px',
    render: (row) => (
      <span className="block truncate" style={{ color: 'var(--ink-secondary)' }}>
        {row.employeeName}
      </span>
    ),
  },
  {
    key: 'products',
    header: 'ПРОДУКТ',
    width: '230px',
    render: (row) =>
      row.products.length === 0 ? (
        <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
      ) : (
        <ul className="space-y-1">
          {row.products.map((product) => (
            <li key={product} className="flex items-start gap-1.5 text-[11px] leading-snug">
              {/* A drawn dot, not the • character: the glyph's size and
                  baseline follow the font and drifted against the text. */}
              <span
                aria-hidden="true"
                className="mt-[5px] h-[3px] w-[3px] shrink-0 rounded-full"
                style={{ background: 'var(--ink-muted)' }}
              />
              <span className="truncate" style={{ color: 'var(--ink-secondary)' }}>
                {product}
              </span>
            </li>
          ))}
        </ul>
      ),
  },
  {
    key: 'amount',
    header: 'СУММА',
    sortKey: 'amountMinor',
    align: 'right',
    numeric: true,
    width: '110px',
    // The full figure, spaced — not compacted. This is an order list, and an
    // operator reconciling it against Bitrix24 needs the exact so'm.
    render: (row) => (
      <span className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
        {formatNumber(row.amount.amount)}
      </span>
    ),
  },
  {
    key: 'region',
    header: 'РЕГИОН',
    width: '120px',
    render: (row) => (
      <span style={{ color: 'var(--ink-secondary)' }}>{row.region ?? NO_VALUE}</span>
    ),
  },
  {
    key: 'address',
    header: 'АДРЕС',
    width: '200px',
    /*
      Truncated with the full text on hover, focus and touch.

      Null until the Bitrix24 field UF_CRM_1748964117765 has been synced —
      it was never imported before this release, so historic rows carry an
      em dash and fill in as the resync walks them.
    */
    render: (row) =>
      row.deliveryAddress === null ? (
        <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
      ) : (
        <Tooltip content={<span className="block max-w-80">{row.deliveryAddress}</span>}>
          <span className="block truncate" style={{ color: 'var(--ink-secondary)' }}>
            {row.deliveryAddress}
          </span>
        </Tooltip>
      ),
  },
  {
    key: 'outcome',
    header: 'СТАТУС',
    width: '180px',
    render: (row) => <OutcomeCell row={row} />,
  },
  {
    key: 'source',
    // Last, as on the dashboard this mirrors: it answers "where did this
    // order come from", which is the question you ask AFTER you know what
    // happened to it.
    header: 'ИСТОЧНИК',
    width: '130px',
    render: (row) => (
      <span className="block truncate" style={{ color: 'var(--ink-secondary)' }}>
        {row.sourceName ?? NO_VALUE}
      </span>
    ),
  },
]

export function ConfirmationPage() {
  const { filters, update, apiParams } = useDashboardFilters()
  const [statsOpen, setStatsOpen] = useState(false)

  /*
    `sort` is shared URL state, and its dashboard-wide default is a deal
    column (`createdAtSource`) that this endpoint's allowlist rejects with a
    400. So an unrecognised value falls back to this page's own default —
    which is the ordinary case on first load, and the only thing standing
    between a bookmarked link from another screen and an empty page.

    That default is `queuedAt`, the column САНА shows. It has to be: the
    server's own default is only ever consulted by direct API callers,
    because this page always sends `sort` explicitly.
  */
  const sort = (SORTS as readonly string[]).includes(filters.sort) ? filters.sort : 'queuedAt'

  /*
    What the tiles, the ROP panel and the ROP options actually read — see
    `boardSummaryKey`. Stamped onto the answer so the page can tell an answer
    that is merely from another PAGE or another STATE selection, and therefore
    still correct above the table, from one that belongs to another window.
  */
  const summaryKey = boardSummaryKey(apiParams)

  /*
    WHAT THE РЕГИОН OPTIONS ARE ASKED FOR — the window, the search box and the
    mode, and deliberately nothing else.

    Built here rather than taken from `apiParams`, which now carries the column
    filters too: a list narrowed by the selection made in it cannot be
    un-narrowed. Pick «Хорезм» and every other region would leave the list, so
    the only way back would be the address bar. Keeping the four keys explicit
    also keeps this request's cache key stable while the reader ticks boxes —
    the options are fetched once and not again.
  */
  const regionOptionParams: Record<string, string> = {
    preset: filters.preset,
    ...(filters.preset === 'custom' && filters.from && filters.to
      ? { from: filters.from, to: filters.to }
      : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.queue === 'backlog' ? { queue: 'backlog' } : {}),
  }

  const query = useQuery({
    queryKey: ['confirmation-queue', apiParams, filters.page, filters.pageSize, sort, filters.order],
    queryFn: async ({ signal }) => {
      const answer = await apiGet<ConfirmationQueueDto>(
        '/insights/confirmations/orders',
        {
          ...apiParams,
          page: filters.page,
          pageSize: filters.pageSize,
          sort,
          order: filters.order,
        },
        signal,
      )
      return { ...answer, askedFor: summaryKey, askedOutcomes: apiParams.outcomes ?? '' }
    },
    // The table keeps the page it has while the next one loads, instead of
    // collapsing to a skeleton on every click of the pager.
    placeholderData: (previous) => previous,
    /*
      Two minutes, matching the reference dashboard's own cadence — and the
      bot's poll interval, so a row cannot be more than one poll stale.

      `placeholderData` above is what makes this safe to do while someone is
      reading: the refresh swaps the rows underneath without collapsing the
      table, and the URL holds every filter, so nothing the reader set is lost
      when the data comes back.
    */
    /*
      The global minute clock (src/app/providers.tsx), not a slower local one.

      This screen overrode the default with two minutes, and the worker behind
      it was itself stalled — so a confirmation that arrived in Bitrix could
      take four minutes to appear here, on the one screen whose whole job is
      showing what just arrived. The override bought nothing the default does
      not already give: `refetchIntervalInBackground` is false, so a hidden
      tab still costs nothing.

      NO WINDOW-FOCUS OVERRIDE EITHER. It used to force one on top of the
      global setting, so every return to the tab reloaded the board — a screen
      people leave open beside Bitrix and come back to constantly. The minute
      tick already covers freshness and the header's refresh button covers
      impatience; see the provider for why the global default went the same
      way.
    */
  })

  /*
    PLACEHOLDER DATA IS NOT AN ANSWER TO THE NEW QUESTION.

    `placeholderData: previous` keeps the table steady while the next page
    loads, which is right for paging — but on a PERIOD change it also left the
    five tiles showing last window's counts with no sign they were stale, so
    «Бугун» wore «Шу ой»'s numbers until the request came back. Placeholder
    rows read as loading, because that is what they are.
  */
  /**
   * Whether what is on screen answers the question now being asked ABOVE the
   * table — the window, the ROP, the search box.
   *
   * A response from another page, another sort or another state selection
   * still holds for the tiles and the ROP panel, because none of those three
   * read any of it.
   */
  const summaryIsCurrent = query.data?.askedFor === summaryKey

  /**
   * THE ROWS FOLLOW WHAT THE TILES DO NOT.
   *
   * The state selection, the page and the sort cannot move a tile — which is
   * why `summaryKey` drops them — but they are exactly what cuts and orders the
   * rows. So while a click on «Кутилмоқда» is in flight, the table below still
   * holds the answer to the previous selection, and saying nothing about that
   * presents one selection's rows as though they were another's.
   *
   * ANDed with `summaryIsCurrent` so the two never stack: when the WINDOW
   * moved, PageShell already dims the whole page, and 0.6 × 0.7 reads as
   * disabled rather than as loading.
   */
  const rowsStale = query.isPlaceholderData && summaryIsCurrent

  const tileStatus = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : summaryIsCurrent
        ? 'ready'
        : 'loading'
  const data = query.data?.data
  const totals = data?.totals

  /*
    A PAGE NUMBER PAST THE END OF A SHORTER WINDOW.

    Filter changes already drop the page — `useDashboardFilters.update` deletes
    it unless it is being set — but a pasted link can carry one, and the queue
    for «Bugun» is a fraction of the length it is for «Shu oy». The response
    for an out-of-range page comes back with no rows AND `totalItems: 0`,
    because the count travels on the rows: the pager then reported an empty
    queue that plainly is not empty, with no control on screen to get back to
    it. Stepping to the first page is the one move that always shows real
    rows if there are any, and it cannot loop — page 1 is not out of range.
  */
  useEffect(() => {
    if (query.isSuccess && filters.page > 1 && data?.items.length === 0) {
      update({ page: 1 })
    }
  }, [query.isSuccess, filters.page, data?.items.length, update])

  /**
   * Clicking a state adds it to the selection; clicking it again removes it.
   *
   * Add rather than replace, so the tiles and the dropdown are the same
   * control seen twice — pick 🟡 then ❌ and you get both, which is the
   * question "what did not get through" as one view instead of two.
   */
  const toggleOutcome = (key: ConfirmationOutcome) => {
    const selected = filters.outcomes
    update({
      outcomes: selected.includes(key)
        ? selected.filter((value) => value !== key)
        : [...selected, key],
    })
  }

  const onSort = (sortKey: string) => {
    update(
      sort === sortKey
        ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
        : { sort: sortKey, order: 'desc' },
    )
  }


  const shown = data?.pagination.totalItems ?? null

  /**
   * Whether the table's count can differ from the tile band's.
   *
   * ONLY THE STATE FILTER SEPARATES THEM. The ROP filter and the search box
   * narrow both — `confirmationQueue` scopes the breakdown by ROP and
   * `confirmationByRop` applies the same search predicate the page does — so
   * treating them as narrowing printed the same figure twice under two names,
   * one of them «Жами», which is how a reader ends up taking one group's
   * thirty-seven orders for the day's whole intake.
   */
  /*
    READ FROM THE ANSWER, NOT FROM THE URL.

    `shown` and the pager come from the response; `filters.outcomes` flips the
    instant the tile is clicked. Reading the label and the number it labels off
    two different clocks printed «Жами: 37 та» under the unfiltered count for
    the whole of the fetch — the same self-contradiction the comment over the
    count line records as a production bug, arriving by another door.
  */
  const narrowed = Boolean(query.data?.askedOutcomes)

  /**
   * Which question is on screen — the period's arrivals, or what is waiting.
   *
   * Reached from the header bell, which counts the backlog: the badge and this
   * board have to be the same set or the header is lying about the page it
   * links to. Everything the mode changes below — the absent period control,
   * the single tile, the banner that says so — exists because a board that
   * ignores the window must not look like one that reads it.
   */
  const backlog = filters.queue === 'backlog'

  /**
   * The РОП filter's options, WITH EVERY CURRENT SELECTION GUARANTEED PRESENT.
   *
   * `rops` is derived from the per-ROP breakdown, which obeys the search box
   * and now the region and сумма filters too — so narrowing by one of them can
   * take a group out of the list while the selection on it stands. The control
   * would then show a filtered column whose reason had vanished, and the only
   * way back would be the address bar. Carrying the selection keeps every
   * applied filter removable from the control that applied it.
   */
  const ropOptions = (() => {
    const names = data?.rops ?? []
    const missing = filters.rops.filter((rop) => !names.includes(rop))
    return [...names, ...missing].sort().map((rop) => ({ id: rop, label: rop }))
  })()

  /*
    THE THREE COLUMN FILTERS, ATTACHED TO THE MODULE-LEVEL COLUMNS.

    `QUEUE_COLUMNS` stays at module scope for the reason written above it —
    nothing in a render closure reads component state, so rebuilding thirteen
    of them on every keystroke of the search box bought nothing. That is still
    true of the RENDERERS; only these three header controls know about state,
    so only they are rebuilt here and grafted on. A column not named below is
    handed through by reference, unchanged.
  */
  const filterFor: Record<string, React.ReactNode> = {
    rop: (
      <ColumnFilter label="РОП" active={filters.rops.length > 0}>
        {() => (
          <ColumnFilterList
            options={ropOptions}
            selected={filters.rops}
            onChange={(rops) => update({ rops })}
            emptyLabel="РОП топилмади"
          />
        )}
      </ColumnFilter>
    ),
    region: (
      <ColumnFilter label="РЕГИОН" active={filters.regions.length > 0}>
        {/*
          A COMPONENT, SO THE FETCH HAPPENS ON FIRST OPEN AND NOT BEFORE.

          `children` is only called while the popover is open, so mounting
          `RegionFilterList` IS the trigger — no `onOpen` prop, no effect, and
          nothing to keep in step with the popover's own state. React Query
          caches the answer from there, so the second open is instant.
        */}
        {() => (
          <RegionFilterList
            params={regionOptionParams}
            selected={filters.regions}
            onChange={(regions) => update({ regions })}
          />
        )}
      </ColumnFilter>
    ),
    amount: (
      <ColumnFilter
        label="СУММА"
        active={filters.amountMin !== undefined || filters.amountMax !== undefined}
      >
        {(close) => (
          <ColumnFilterRange
            min={filters.amountMin}
            max={filters.amountMax}
            unit="soʻm — buyurtma summasi boʻyicha"
            onApply={({ min, max }) => {
              update({ amountMin: min, amountMax: max })
              // The only one of the three that closes itself: a submitted form
              // has said everything it had to say, while a checkbox list is
              // routinely ticked twice.
              close()
            }}
          />
        )}
      </ColumnFilter>
    ),
  }

  const columns = QUEUE_COLUMNS.map((column) =>
    filterFor[column.key] ? { ...column, filter: filterFor[column.key] } : column,
  )

  /** Moves with the board it belongs to — see `StatsToggle`. */
  const statsToggle = <StatsToggle open={statsOpen} onToggle={() => setStatsOpen((v) => !v)} />

  /*
    WHETHER A COHORT FILTER IS WHAT EMPTIED THE PANEL — and only those two.

    The РОП selection is excluded on purpose: it does not reach the breakdown,
    so it cannot be the reason the breakdown came back empty, and naming it
    would send the reader to clear a filter that was never applied there. The
    search box is excluded for the opposite reason — it DOES narrow the
    cohort, but it is on screen with its own text in it, so it does not need a
    caption to be found.
  */
  const cohortNarrowed =
    filters.regions.length > 0 || filters.amountMin !== undefined || filters.amountMax !== undefined

  return (
    <PageShell
      title={t.modules.confirmation.title}
      /*
        NOTHING UNDER THE TITLE, IN ANY MODE — `null`, which is the same
        statement `meta={undefined}` a few props below already makes.

        The sentence that used to sit here restated the controls immediately
        beneath it. The preset row names the window, the thirteen column
        headers name what a row is, and the state band names the five states;
        a paragraph explaining that orders in Тасдиклаш have states bought
        nothing on the one screen the floor works in all day. It wrapped to two
        lines at every width the board is actually read at, so dropping it
        returned 36px — half a row of a table nobody has enough of.

        BACKLOG MODE KEPT ITS OWN SENTENCE HERE LONGEST, and it was the one
        duplicate nobody could miss. That mode is reached exactly one way — the
        header bell — so every reader who ever saw the caption also saw the
        banner one element below it, which says the same thing at more length
        and carries the way back. Two statements of one fact, forty pixels
        apart, on the mode with the least room to spare. The banner is now the
        single statement; if it ever stops being enough, strengthen IT.

        `null` rather than an omitted prop, because PageShell RESERVES this
        line by default — see its own note: a page that WILL print dates claims
        the height before they land, so the filter row does not drop one line
        when they do. This page never prints them, so it opts out of the
        reservation instead of holding an empty line open forever.
      */
      description={null}
      /*
        IN BACKLOG MODE THE PERIOD DOES NOT APPLY, so it is not offered.

        `period={false}` takes away the preset row, which would otherwise
        describe a window this view ignores — a date control over a list that
        does not read it is worse than no control, because a reader assumes it
        must be filtering something. The banner above the tile says which
        question is on screen instead, where the eye actually lands.
      */
      period={!backlog}
      /*
        THE CONTROL ROW SITS ON THE TITLE'S LINE, right-aligned.

        Asked for on 2026-09-07, and the arithmetic is why it is right on this
        page and on almost no other. The title is two words, the page prints
        nothing under it (`description={null}` above, `meta={undefined}`
        below), and the row is about 900px of window, search box, РОП, status
        and Статистика — so a line of its own plus the 16px above it was
        costing fifty pixels of the one thing this screen is: a table the
        floor reads all day. Beside the title the row says exactly what it
        said before and the tile band starts a row higher.

        Below roughly 1300px the header wraps and the row lands back under the
        title, left-aligned and full width, which is the layout every narrow
        screen had anyway.
      */
      controlsAlign="end"
      accent="var(--series-4)"
      /*
        640 WAS A CEILING. IT IS NOW A FLOOR.

        This queue is an instrument, not a document: it is read beside the
        portal's own board all day, and every row it does not show is a row
        somebody pages for. The table was capped at a literal
        `maxHeight={640}`, which is a number that can only ever be wrong twice
        — too tall for a laptop, and permanently too short for the 27-inch
        screen a floor manager reads it on, where the browser had 800 spare
        pixels the board refused to use.

        `fill` turns the cap round. The card takes what the window has left, so
        the table grows with the screen; the floor below (see the Card) keeps
        it from ever showing less than the 640 it used to. Measured: a 2560
        window draws thirteen rows against eight, and a maximised 1080p one
        draws eight against seven — that last row is the caption this page no
        longer prints.

        Same mechanism as Kadrlar tuzilmasi's canvas: `Shell` is exactly 100dvh
        and `main` is `min-h-0 flex-1`, which gives a flex item a DEFINITE main
        size, so a percentage inside it resolves against what is actually left.
        Nothing here measures the header, and nothing breaks the day it
        changes.
      */
      fill
      /*
        NO DATE LINE UNDER THE TITLE, EVER — and it now has to stay that way.

        It used to print `meta.period`'s resolved dates whenever the window was
        bounded, but the preset row right below already says which window is
        active (Bugun / Kecha / Shu oy / Sana), so restating the exact dates
        duplicated a control the reader is already looking at.

        `description={null}` above suppresses that whole line, dates included,
        so a `meta` passed here would have nowhere to print rather than
        printing somewhere unwanted. The two props say one thing together:
        nothing goes between this title and the controls under it.
      */
      meta={undefined}
      /*
        Dimmed only when the numbers genuinely belong to another question. It
        used to dim on `isPlaceholderData`, which is also true while the next
        PAGE of the same window loads and on every click of a state tile — so
        the header greyed itself on interactions that could not change a single
        figure under it.
      */
      stale={query.isSuccess && !summaryIsCurrent}
      filters={{
        search: true,
        // Every column the table shows is searchable, so the box says so —
        // including the phone in the masked form it is displayed in.
        searchPlaceholder: 'ID, mijoz, telefon, operator, ROP, mahsulot, summa, region, manba…',
      }}
      /*
        IN THE FILTER ROW, NOT BESIDE THE TITLE.

        These three narrow the table, so they belong with the other things
        that narrow it. Passed as `actions` they were right-aligned in the
        header while the window and the search box sat left-aligned below, so
        one screen carried two toolbars a metre apart and the reader crossed
        the page to narrow one table. `actions` stays what it was — the slot
        for a page-level ACTION, which is what Foydalanuvchilar' «+ Yangi
        hisob» is and none of these is.

        A Fragment, not a wrapping <div>: the shell's row is already
        `flex-wrap gap-2`, so each control wraps on its own line on a narrow
        screen instead of the three of them moving as one block.
      */
      toolbar={
        /*
          No "Бугун" button here.

          The presets are the control immediately to the left of these three
          and already own the reporting window — Bugun / Kecha / Shu oy / Sana.
          A second Bugun in this same row would set the same URL parameter from
          a second place, so the two could disagree on screen about which day
          was selected, and a toolbar that contradicts itself is worse than one
          button fewer.
        */
        <>
          {/*
            «БАРЧА РОП» IS NOT HERE ANY MORE — it is on the РОП column.

            The client asked for it on 2026-09-09: «shu joyni olib tashlab
            oʻrniga jadvaldagi roplar ustuniga exceldagi filtrga oʻxshab filtr
            beriladigan boʻlsin». A toolbar select and the column it narrows
            were a page apart on a 1 860px-wide table, and it could only ever
            hold one group — comparing two was a page load each. See
            `QUEUE_FILTERS` below for the three that took its place.
          */}
          {/*
            Multi-select, not a single choice: the states are read in
            combinations. The house MultiSelect is what every other filter on
            the dashboard uses, so the checkbox affordance is already familiar.

            NOT IN BACKLOG MODE, where every row is «Кутилмоқда» by
            construction — the cohort there IS the state — so the control could
            only ever narrow the board to itself or to nothing.
          */}
          {!backlog && (
            <MultiSelect
              label="Барча статус"
              options={OUTCOMES.map((spec) => ({
                id: spec.key,
                label: spec.label,
              }))}
              selected={filters.outcomes}
              onChange={(outcomes) => update({ outcomes: outcomes as ConfirmationOutcome[] })}
            />
          )}

          {/*
            AND NEITHER IS «СТАТИСТИКА» — see `StatsToggle`. It sits in the
            corner of whichever card is on screen now, which is where the
            client asked for it: «statistika tugmasini ham pastga buyurtmalar
            ustunining oʻng tomon burchagiga qoʻyish kerak».
          */}
        </>
      }
    >
      {/*
        ONE CHILD, AND IT IS THE COLUMN.

        `fill` hands a page ONE plain block (`min-h-0 flex-1`) — not a flex
        container, and with no gap — because the page it was written for holds
        a single canvas. The four things on this board dropped straight into
        that block would sit flush against one another and none of them could
        claim the leftover height, so the column is built HERE rather than in
        PageShell: Kadrlar tuzilmasi keeps the wrapper it was designed around,
        and this page takes from it the only thing it needs — a box with a
        definite height.

        `gap-4` is exactly the `space-y-4` the scrolling body had. A gap and
        not a margin because margins cannot stretch a flex child, which is the
        same reason PageShell's own fill branch makes that swap.
      */}
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/*
          THE WAY BACK, and the sentence that says where you are.

          The mode used to be a two-button switch living among the filters. It
          was dropped because a chip in a filter row changed the QUESTION rather
          than the selection, and nothing on screen said so. It returns here
          instead: visible only in the mode it describes, next to the sentence
          that names what is on screen, so the control and its meaning arrive
          together. Without it, arriving from the header bell is a one-way trip —
          the period control is gone (it does not apply) and there is nothing
          left to click that gets back to the client's own board.
        */}
        {backlog && (
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
          >
            <p
              className="flex items-start gap-2 text-[13px] leading-snug"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span className="mt-0.5 shrink-0" style={{ color: 'var(--series-1)' }}>
                <ClockGlyph size={14} />
              </span>
              <span>
                <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  Hozir kutilmoqda
                </span>
                {' — '}
                yuqoridagi qoʻngʻiroq sanaydigan buyurtmalar: qachon kelganidan qatʼi
                nazar hali tasdiqlanmaganlari. Davr tanlovi bu roʻyxatga taʼsir qilmaydi.
              </span>
            </p>
            {/*
              DROPPED, not set to 'window'.

              `update` deletes a key whose value is undefined and writes every
              other one, so `queue: 'window'` would leave `?queue=window` in an
              otherwise empty address — and `useRestoreRememberedPeriod` only
              restores into an address with NOTHING in it. The dead parameter
              would have cost the reader the window this section was last read
              in, landing them on «Bugun» on the way back from a bell they only
              clicked to look at the backlog.
            */}
            <Button variant="secondary" size="sm" onClick={() => update({ queue: undefined })}>
              Davr boʻyicha koʻrish
            </Button>
          </div>
        )}

        {/*
          The state band, in the reference's own order: the queue, the two ways
          it stalls, then the two outcomes.

          Each tile is a filter as well as a figure — a count nobody can open is
          a number that ends the conversation instead of starting it. The counts
          follow the period, the ROP and the search box but deliberately NOT the
          state filter: a band whose numbers changed to match its own selection
          could not be used to compare one state against another, which is the
          only reason to put five of them side by side.

          ONE TILE IN BACKLOG MODE, because every row in it is «Кутилмоқда» by
          construction. Rendering the five-state band over a single-state list
          would put four zeros on screen and invite the reader to click them for
          an empty table.
        */}
        <div
          className={
            backlog
              ? // One tile takes the whole row on a phone rather than half of it
                // with a hole beside it, and a third of the width where there is
                // room — it is this board's headline figure, not one of six.
                'stagger grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
              : /*
                  SIX ACROSS FROM xl, NOT FROM lg — because of what each tile
                  has to PRINT now.

                  A tile in a six-across band is 113px wide on a 1024 window
                  behind the sidebar, and 85px of that is inside its padding.
                  The sum printed to the last digit is ~93px at thirteen
                  grouped digits, which is an ordinary month on this portal —
                  so at lg the figure did not merely crowd the tile, it left
                  it. The number could not shrink its way out either: fitting
                  fourteen digits and the unit into 85px needs about 7px of
                  type.

                  Between sm and xl the band is three across on two rows, where
                  a tile is ~240px and every sum fits on one line. It costs one
                  row of tiles on a 1024–1279 window and nothing at all on the
                  screens this board is actually read on (1280, 1920, 2560),
                  where six across still fits — measured, at 158px a tile on
                  the tightest of them.
                */
                'stagger grid shrink-0 gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6'
          }
        >
          <OutcomeTile
            Glyph={backlog ? ClockGlyph : undefined}
            label={backlog ? 'ҲОЗИР КУТИЛМОҚДА' : 'ЖАМИ'}
            status={tileStatus}
            count={totals?.orders ?? null}
            amount={totals?.amount ?? null}
            /*
              The bell's own colour in backlog mode: this figure IS the badge,
              and a reader who clicked a blue 7 should land on a blue 7. In the
              windowed band it stays ink, because there it is the total the five
              states are read against rather than a state of its own.
            */
            color={backlog ? 'var(--series-1)' : 'var(--ink-primary)'}
            active={filters.outcomes.length === 0}
            /*
              Also the only way to clear a stale `?outcomes=` that arrived on an
              older bell link, now that the status control is hidden here.
            */
            onSelect={() => update({ outcomes: [] })}
          />
          {!backlog &&
            OUTCOMES.map((spec) => (
              <OutcomeTile
                key={spec.key}
                Glyph={spec.Glyph}
                label={spec.label}
                status={tileStatus}
                count={totals?.byOutcome[spec.key] ?? null}
                amount={totals?.byOutcomeAmount[spec.key] ?? null}
                color={spec.color}
                active={filters.outcomes.includes(spec.key)}
                onSelect={() => toggleOutcome(spec.key)}
              />
            ))}
        </div>

        {statsOpen && (
          <RopPanel
            rows={data?.byRop ?? []}
            status={tileStatus}
            backlog={backlog}
            narrowed={cohortNarrowed}
            action={statsToggle}
          />
        )}

        {/*
          The rows, their count and the pager — the three things a state
          selection actually changes — fade while they are being replaced.

          Not a skeleton, and not the whole page: the tiles above are correct
          throughout and must not move. This is the smallest honest signal that
          the table is one selection behind, and it costs no layout, so nothing
          jumps under the pointer.
        */}
        {/*
          THE CARD IS THE ONE THING THAT STRETCHES.

          Everything above it — the banner and the six state tiles — is
          `shrink-0` and keeps the height it asks for; this takes what is left,
          whatever that is. (The Статистика panel used to be in that list and
          is not any more: it is `flex-1` now, and it and this card are never on
          screen together.) `min-h-0` is the load-bearing half:
          without it a flex item refuses to shrink below its content, so the
          table's own scroll box would push the card past the bottom of the
          screen and hand the page back the second scrollbar this change
          exists to remove.

          `min-h-[746px]` IS THE OLD CAP, PUT BACK AS A FLOOR — 640 of table
          plus this card's own 106px of chrome (padding, the counts header,
          the pager). Being a min-height at all is also what lets the card
          shrink below the table's natural height in the first place: `auto`,
          the default, is the content size, and the content here is 25 rows.

          IT IS 746 AND NOT A COMFORTABLE 540 BECAUSE OF WHEN IT BITES. The
          floor only ever applies when the column does not fit, and a column
          that does not fit makes `main` scroll — so on exactly the screens
          where the floor is in force, the page is scrolling anyway. There is
          no reason to show a SHORTER table than before on a page that scrolls
          just as much as before. A 540 floor read as a kindness and measured
          as a loss: 6 rows where the old cap gave 9 on a 1280x800 laptop, and
          on a phone a letterbox inside a page that still scrolled — both
          halves of the fault, for nothing.

          The break-even is a window about 1054px tall. Above it the floor is
          slack, the card takes the screen and nothing scrolls; below it the
          board is exactly what it was, plus the 36px the caption used to hold.

          IT USED TO NAME «Статистика open» AS THE OTHER CASE BELOW THAT LINE,
          because the panel opened above this card and took 300px off it. It
          is not a case any more: since 2026-09-09 Статистика is a MODE and
          this card is not rendered at all while it is on — see the guard
          below. A short window is the only thing this floor still covers.
        */}
        {/*
          «СТАТИСТИКА» IS A MODE NOW, NOT AN ADDITION.

          The client, 2026-09-09: «statistika bosilganda pastdagi barcha
          buyurtmalar boʻlimi koʻrinmasin faqat statistika boʻlimi koʻrinsin».
          The panel used to open as a 300px strip ABOVE this card, and the
          reader compared fifteen (ROP) groups through a letterbox — while
          this card carried a 746px floor partly BECAUSE the panel was taking
          300px off it.

          IT NAMES THIS SECTION AND ONLY THIS SECTION. The state band above
          stays: «Барча буюртмалар» is what was asked to go, and the band is
          this page's headline money figure and its only state filter. Hiding
          it would have taken away the very thing the same sentence asks for —
          «qaysi boʻlimda qancha pul borligi».

          THE QUERY IS UNTOUCHED. `pageSize` is part of the query key, so
          skipping the page rows while the panel is open would invalidate the
          cache and buy a round trip on the way INTO the mode and another on
          the way out. The rows are fetched and not rendered; that is the
          price of an instant toggle and it is the right one.

          THE PAGE-RESET EFFECT KEEPS RUNNING behind the panel and will still
          rewrite `?page=1`. Harmless — a URL change with nothing visible
          attached — and left alone: moving it inside hidden JSX would make it
          a hook that mounts and unmounts with a mode.
        */}
        {!statsOpen && (
          <Card
            className="card-hero brackets flex min-h-[746px] flex-1 flex-col px-4 py-4"
            style={{ opacity: rowsStale ? 0.7 : 1, transition: 'opacity 150ms var(--ease-out)' }}
            aria-busy={rowsStale || undefined}
          >
            <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              {/*
                THE HEADING AND ITS COUNTS ARE ONE BLOCK NOW, so the corner is
                free for the control the client asked to be put there. They
                keep `items-baseline` between themselves — the counts are a
                continuation of the heading's line — while the row that holds
                them centres, because a button hung off a text baseline sits
                visibly low against it.
              */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
                Барча буюртмалар
              </h2>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {/*
                  TWO NUMBERS, TWO NAMES.

                  This count obeys every filter — state, ROP, search — while the
                  ЖАМИ tile above follows the ROP and the search box but NOT the
                  state selection, because a band whose figures moved with its
                  own selection could not be used to compare one state against
                  another. Both were labelled «Жами», so picking
                  «Кутилмоқда» put 1 289 in the tile and «Жами: 37 та» directly
                  under it, and the screen contradicted itself. The filtered count
                  is now named as filtered, and the window's own total is printed
                  beside it so the reader can see both at once.
                */}
                {shown === null
                  ? ''
                  : narrowed
                    ? `Танланган: ${formatNumber(shown)} та`
                    : `Жами: ${formatNumber(shown)} та`}
                {/*
                  THE COMPARISON IS "ALL STATES", NOT "THE WHOLE WINDOW".

                  `totals.orders` is the same ROP and the same search as the line
                  beside it, summed across all five states — so it differs from the
                  count above ONLY when a state is selected, and calling it «Жами»
                  while a ROP was also applied printed the filtered figure twice
                  under two names. It is named for what it is, and shown only when
                  it has something to add.
                */}
                {narrowed && totals && (
                  <>
                    {' · '}
                    Барча ҳолатлар: <span className="tabular">{formatNumber(totals.orders)}</span> та
                  </>
                )}
                {/*
                  NOT IN BACKLOG MODE, where the numerator is zero by construction.

                  That cohort is «every order whose latest signal is still
                  CONFIRM_NEW», so CONFIRMED cannot occur in it and the rate comes
                  back a hard 0 — non-null, because the DENOMINATOR is not empty,
                  so `rateBp`'s own null-for-no-data guard has nothing to catch.
                  Printed, «Тасдиқланиш (барча ҳолатлардан): 0%» under a list of
                  44 waiting orders reads as "this company confirmed nothing",
                  which is a verdict rather than a measurement — the same reason
                  the four other state tiles are not rendered here.
                */}
                {!backlog && totals && totals.confirmedRate !== null && (
                  <>
                    {' · '}
                    {/*
                      The denominator is every order in this ROP and search across
                      all five states — INCLUDING the ones still waiting, which is
                      the client's own definition of Тасдиқланиш %. It is not the
                      selection's rate: filtering to «Тасдиқланди» would otherwise
                      report 100% every time. The label says which denominator it
                      is so nobody has to guess.
                    */}
                    Тасдиқланиш (барча ҳолатлардан):{' '}
                    <span className="tabular">{totals.confirmedRate}%</span>
                  </>
                )}
                {query.dataUpdatedAt > 0 && (
                  <>
                    {' · '}
                    {/*
                      THE PAGE'S CLOCK, NOT THE DATA'S.

                      `dataUpdatedAt` is when this browser last fetched, which is
                      not how old the numbers are — that is the Bitrix sync time,
                      and the header states it a few centimetres away. A bare
                      «Янгиланди» over the fetch clock claimed the figures were
                      minutes old on a morning the sync had been stuck for hours.
                    */}
                    Саҳифа янгиланди:{' '}
                    <span className="tabular">{tashkentTime(new Date(query.dataUpdatedAt).toISOString())}</span>
                    {' (ҳар 2 дақиқада)'}
                  </>
                )}
              </p>
              </div>
              {statsToggle}
            </header>

            {/*
              THE SCROLL BOX IS THE FLEX ITEM, not the table.

              DataTable renders its scroll container as its own root, so the
              wrapper is what claims the leftover height and `maxHeight="100%"`
              is what hands it down — a percentage resolves here because every
              box above it, up to `main`, has a definite height. The pager is
              OUTSIDE this wrapper on purpose: it is the one control that must
              never be the thing you scroll to find.
            */}
            <div className="flex min-h-0 flex-1 flex-col">
            <DataTable
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(row) => row.dealId}
              status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
              errorMessage={(query.error as Error | null)?.message}
              onRetry={() => void query.refetch()}
              sort={sort}
              order={filters.order}
              onSort={onSort}
              /*
                THE WINDOW DECIDES, NOT A NUMBER TYPED ONCE.

                `100%` is the height this card was given, and the card was given
                what the screen had left — never less than the 640 it used to
                have, because of the card's own floor. Still bounded, so the
                header row keeps pinning while the rows scroll under it; what
                changed is that the bound now knows how big the screen is.
              */
              maxHeight="100%"
              minWidth={1860}
              emptyTitle="Buyurtma topilmadi"
              emptyBody={
                filters.outcomes.length > 0 ||
                filters.rops.length > 0 ||
                filters.regions.length > 0 ||
                filters.amountMin !== undefined ||
                filters.amountMax !== undefined ||
                filters.q
                  ? 'Bu filtrlar boʻyicha buyurtma yoʻq. Filtrlarni tozalab koʻring.'
                  : backlog
                    ? // An empty backlog is the good news, and «bu davrda» would be
                      // a sentence about a window this board does not read.
                      'Hozir tasdiqlashni kutayotgan buyurtma yoʻq — navbat boʻsh.'
                    : 'Bu davrda hech bir buyurtma tasdiqlash navbatiga tushmagan.'
              }
            />
            </div>

            {data && (
              <Pagination
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                totalItems={data.pagination.totalItems}
                onPage={(next) => update({ page: next })}
              />
            )}
          </Card>
        )}
      </div>
    </PageShell>
  )
}

/**
 * «Статистика» — one button, drawn in the corner of whichever card is showing.
 *
 * ASKED FOR THERE BY NAME on 2026-09-09: «statistika tugmasini ham pastga
 * buyurtmalar ustunining oʻng tomon burchagiga qoʻyish kerak». It used to sit
 * in the page toolbar with the filters, which was the wrong company for it —
 * the other controls in that row NARROW the board, and this one REPLACES it.
 *
 * IT IS ONE COMPONENT AND NOT TWO BUTTONS. Pressing it hides the orders card,
 * so a control that only lived in that card's corner would leave the screen
 * with it and strand the reader in a mode with no way out. Rendering the same
 * element into whichever card is on screen keeps the corner the client asked
 * for AND keeps the way back — and because it is one element, the two can
 * never disagree about which state they are in.
 *
 * `aria-pressed` and not a label that changes: a toggle that renamed itself
 * «Ёпиш» when open would move under the pointer on every press, and a screen
 * reader is told the state properly by the attribute.
 */
function StatsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant={open ? 'primary' : 'secondary'}
      size="sm"
      onClick={onToggle}
      aria-pressed={open}
      className="shrink-0"
    >
      <span className="inline-flex items-center gap-1.5">
        <BarsGlyph size={13} />
        Статистика
      </span>
    </Button>
  )
}

/**
 * The РЕГИОН filter's option list, fetched the first time it is looked at.
 *
 * MOUNTING IS THE TRIGGER. `ColumnFilter` only calls its children while the
 * popover is open, so this component exists exactly when the reader has asked
 * to see the list — no `onOpen` prop, no effect, and no state to keep in step
 * with the popover's own. React Query caches the answer, so the second open is
 * instant and the board's own two-minute refresh never touches it.
 *
 * IT IS ITS OWN REQUEST for the reason the endpoint states: the board reloads
 * every two minutes on a screen the floor keeps open all day, and this answer
 * changes about as often as the portal grows a region.
 *
 * A FAILURE IS SAID, NOT SWALLOWED. An empty list and a list that could not be
 * fetched look identical, and the second one is the reader waiting for
 * something that is never coming.
 */
function RegionFilterList({
  params,
  selected,
  onChange,
}: {
  params: Record<string, string>
  selected: readonly string[]
  onChange: (regions: string[]) => void
}) {
  const query = useQuery({
    queryKey: ['confirmation-regions', params],
    queryFn: ({ signal }) =>
      apiGet<ConfirmationRegionOptionsDto>('/insights/confirmations/regions', params, signal),
    // The vocabulary of a CRM field. Refetching it on every open would be a
    // round trip to learn that Xorazm is still a region.
    staleTime: 10 * 60 * 1000,
  })

  if (query.isError)
    return (
      <p className="px-2 py-2 text-xs" style={{ color: 'var(--status-critical)' }}>
        Регионлар рўйхати олинмади.
      </p>
    )

  /*
    EVERY SELECTED REGION IS AN OPTION, even one the window no longer holds.

    The same guarantee `ropOptions` makes and for the same reason: change the
    period with a region ticked and that region can leave the list while the
    filter on it stands, leaving a narrowed table whose control cannot describe
    or undo itself.
  */
  // `apiGet` returns the envelope; the payload is under `data`, exactly as the
  // board's own query unwraps it.
  const fetched = query.data?.data.regions ?? []
  const missing = selected.filter((region) => !fetched.some((r) => r.region === region))

  return (
    <ColumnFilterList
      options={[
        ...fetched.map((r) => ({ id: r.region, label: r.region, count: r.orders })),
        ...missing.map((region) => ({ id: region, label: region })),
      ]}
      selected={selected}
      onChange={onChange}
      loading={query.isPending}
      emptyLabel="Регион топилмади"
    />
  )
}

/** One ROP group's row exactly as the panel receives it from the wire. */
type RopRow = ConfirmationQueueDto['byRop'][number]

/**
 * A line of the panel: a ROP group, or the ЖАМИ that adds them up.
 *
 * The total wears A GROUP'S OWN SHAPE rather than a parallel one, so every
 * render closure below reads `line.row.…` unchanged and branches on `kind`
 * only for ink and weight. MarketingTable's total arrives as a bare metrics
 * object instead, so it needs the branch written out in each of its two
 * hand-written columns and once more inside the map over its metric columns
 * — of which a Meta campaign has twenty-one. A column added HERE totals
 * itself.
 */
type PanelLine = { readonly kind: 'rop' | 'total'; readonly row: RopRow }

/** MarketingTable's own sentinel. No Bitrix24 ROP name can collide with it. */
const TOTAL_ROW_KEY = '__jami__'

/*
  THE MINOR-UNIT SCALE IS STATED HERE BECAUSE NOTHING ELSE ON THIS SIDE CAN.

  `MoneyDto` carries `amountMinor` (exact) and `amount` (lossy) but not the
  exponent between them, and `currencyExponent` lives in
  `@/server/domain/money/money`, which `src/features/**` may not import — the
  ESLint boundary, not a convention. So the sum stays exact all the way and
  becomes a major number exactly once, here. `formatFullUzs` carries the same
  assumption, which is why the two are used together everywhere.
*/
const SOM_MINOR = 100

/**
 * ЖАМИ — THE ROWS ON SCREEN ADDED UP, AND `totals` IS NOT AN OPTION.
 *
 * `totals` is cut from `scoped` in `insightsService` —
 * `query.rop ? byRop.filter(…) : byRop` — while this panel is handed the
 * UNFILTERED `byRop`, deliberately, for the reason its own hint gives: a
 * comparison table that narrowed to the one row you selected would have
 * nothing left to compare. So the moment anybody picks a ROP, `totals` equals
 * ONE of the lines still listed above this one, and the footer would not add
 * up to the column over it. That is the same fault the band records at «TWO
 * NUMBERS, TWO NAMES», and it is invisible: both figures are correct
 * measurements of different populations printed under one word.
 *
 * MONEY IS SUMMED IN BIGINT AND CONVERTED ONCE. Never over `.amount`, the
 * lossy major-unit double `MoneyDto` carries for charts — it happens to be
 * exact at this magnitude, which is precisely why summing it would go
 * unnoticed until the day it was not.
 *
 * THE COUNT COLUMN AND THE MONEY COLUMN TOTAL DIFFERENT POPULATIONS AND BOTH
 * ARE RIGHT. `orders` is `count(*)` per group, so this line's ЖАМИ count is
 * `count(*)` added down — a footer follows its own column. Its ЖАМИ money is
 * the five states added, because that is what `amountTotal` is. The two agree
 * today because `outcome` is exhaustive over the five, and the repository
 * forbids closing any future gap with a sixth SQL sum.
 */
function totalLine(rows: readonly RopRow[]): RopRow {
  // Unreachable: an empty `rows` renders DataTable's EmptyState and never
  // reaches here. Stated so nobody hard-codes 'UZS' at a print site instead.
  const currency = rows[0]?.amountTotal.currency ?? 'UZS'

  const count = (pick: (row: RopRow) => number) => rows.reduce((sum, row) => sum + pick(row), 0)
  const sum = (pick: (row: RopRow) => MoneyDto): MoneyDto => {
    const minor = rows.reduce((total, row) => total + BigInt(pick(row).amountMinor), 0n)
    return { amountMinor: minor.toString(), currency, amount: Number(minor) / SOM_MINOR }
  }

  return {
    rop: TOTAL_ROW_KEY,
    orders: count((row) => row.orders),
    pending: count((row) => row.pending),
    noAnswer: count((row) => row.noAnswer),
    confirmed: count((row) => row.confirmed),
    rejected: count((row) => row.rejected),
    unconfirmedShipped: count((row) => row.unconfirmedShipped),
    amounts: {
      CONFIRM_NEW: sum((row) => row.amounts.CONFIRM_NEW),
      NO_ANSWER: sum((row) => row.amounts.NO_ANSWER),
      CONFIRMED: sum((row) => row.amounts.CONFIRMED),
      REJECTED: sum((row) => row.amounts.REJECTED),
      UNCONFIRMED_SHIPPED: sum((row) => row.amounts.UNCONFIRMED_SHIPPED),
    },
    amountTotal: sum((row) => row.amountTotal),
  }
}

/**
 * THE SUM GOES UNDER ITS COUNT, NOT BESIDE IT.
 *
 * The client asked on 2026-09-09 for «har bir rop jami va qaysi boʻlimda
 * qancha pul borligi» — five states in money, per ROP — and the obvious build
 * is five more columns. It does not fit. This panel is read at 1280 behind a
 * 240px rail, which leaves 974px of table; thirteen columns of Cyrillic state
 * names plus full soʻm is about 1 640. That table scrolls sideways, and a
 * sideways scroll carries the РОП name off the left edge — a column of
 * ten-digit sums with nobody's name on it. DataTable cannot pin a column on
 * the x axis, and its `onScroll` reads `scrollTop` alone, so nothing on
 * screen would even say there was more table out there.
 *
 * Stacked, the panel stays EIGHT columns at 884px and fits inside 974 with
 * 90px to spare, and the eye still travels one row per ROP. It costs 8px of
 * row height, 41 → 49.
 *
 * NO HAIRLINE BETWEEN THE LINES, unlike `OutcomeTile`, which divides them
 * with a border. A tile is one object and needs an internal division; a table
 * already draws one on every row, and a hundred more hairlines inside the
 * cells would be a second grid arguing with the first.
 *
 * NO « soʻm » IN THE CELL. The tiles print the unit because a tile is read
 * alone; this is a column of money under a header, and the hint says
 * «Суммалар сўмда» once in place of a hundred repetitions. The queue's own
 * СУММА column has printed no unit since the board shipped, for that reason.
 *
 * A ZERO COUNT GETS AN EMPTY LINE BOX, NOT A SECOND ZERO. The money under a
 * count of nought is nought by construction, and printing it says the same
 * thing twice in a panel that is already fifteen rows of mostly zero.
 * Dropping the line instead would make the cell one line tall and
 * `vertical-align` would centre it against its two-line neighbours, breaking
 * the one thing this layout is for — reading a row of counts straight across.
 * So the box stays and the digits go. The INVERSE still prints: a state
 * holding three orders whose deals carry no amount reads «3» over «0», which
 * is a fact worth having.
 *
 * FULL DIGITS, AND THE WIDTH DID NOT FORCE THE QUESTION. `formatFullUzs` and
 * never `formatCompactUzs` — this board is reconciled against Bitrix24 and
 * the Telegram РОП channels, both of which print the sum out in full, the
 * same rule the tiles above already follow. Compacting all six money readings
 * would take the table from 884 to about 757, and it cannot spend the
 * difference: three of the five state columns are bound by their own HEADER,
 * not by their figure — ТАСДИҚЛАНМАДИ is wider than any soʻm this portal has
 * printed.
 */
function StackedFigure({
  count,
  amount,
  color,
  total,
}: {
  count: number
  amount: MoneyDto
  /** The state's own token. The ЖАМИ column passes none and inherits the cell. */
  color?: string
  total: boolean
}) {
  return (
    <>
      <span
        className="block leading-none"
        style={{
          color: total
            ? 'var(--ink-primary)'
            : count === 0
              ? 'var(--ink-muted)'
              : (color ?? 'var(--ink-secondary)'),
          fontWeight: total ? 600 : undefined,
        }}
      >
        {formatNumber(count)}
      </span>
      {count === 0 && !total ? (
        // The line box, and nothing in it — see above.
        <span aria-hidden="true" className="mt-[3px] block h-[11px]" />
      ) : (
        <span
          className="mt-[3px] block text-[11px] leading-none"
          style={total ? { color: 'var(--ink-primary)', fontWeight: 600 } : undefined}
        >
          {formatFullUzs(amount.amount)}
        </span>
      )}
    </>
  )
}

/**
 * Статистика — the queue by ROP group, in orders AND in money.
 *
 * The one cut the queue table cannot make. A ROP's confirmation rate is a
 * statement about their whole day, and the reader is looking at twenty-five
 * rows of it; ranking the groups is what turns "we are at 90%" into a name.
 *
 * Sorted by orders rather than by rate on purpose: a group with four orders
 * and one refusal is not the worst ROP on the floor, and rate-sorting would
 * put them at the top of a list managers act on. Nothing on this table can
 * re-sort it — no `sort`, no `onSort`, no column carries a `sortKey` — which
 * is also what keeps ЖАМИ at the bottom wherever the reader clicks.
 *
 * SINCE 2026-09-09 IT IS A MODE, NOT A STRIP. It used to open as a 300px
 * letterbox above the queue and the reader compared fifteen groups through
 * it. The client asked for the whole screen and for the money in it; both
 * halves of that sentence are why every cell now carries a sum and why the
 * board below is not rendered at all while this is open.
 */
export function RopPanel({
  rows,
  status,
  backlog,
  narrowed,
  action,
}: {
  rows: readonly ConfirmationQueueDto['byRop'][number][]
  status: 'loading' | 'error' | 'ready'
  /**
   * The «Статистика» toggle, which lives in whichever card is on screen.
   *
   * IT MOVED HERE WITH THE MODE. The button used to sit in the page toolbar
   * beside the filters; the client asked on 2026-09-09 for it to go «pastga
   * buyurtmalar ustunining oʻng tomon burchagiga» — the corner of the orders
   * card. That card is not rendered while this panel is, so the control would
   * have left the screen with it and the mode would have had no way out. One
   * button, drawn in the corner of whatever is showing, is what satisfies both
   * halves: it is where it was asked to be, and it is always reachable.
   *
   * Optional, so the panel still renders in a test that does not care.
   */
  action?: React.ReactNode
  /**
   * Whether the board behind this panel is the backlog.
   *
   * IT CHANGES WHICH COLUMNS ARE HONEST, not just their labels. Every backlog
   * row is CONFIRM_NEW by construction, so the four other state columns are
   * zero for every group and ТАСДИҚЛАНИШ % is `confirmed / orders` = 0 —
   * which this panel then paints `--status-critical` and semibold, putting a
   * red verdict on every ROP on the floor for a rate that could not have been
   * anything else. What survives is the one cut that still says something
   * here: who is sitting on the most unworked orders, and what that pile is
   * worth.
   */
  backlog: boolean
  /**
   * Whether a РЕГИОН or СУММА filter is applied — the two that reach these rows.
   *
   * IT ONLY EVER CHANGES THE EMPTY STATE, and it exists because the sentence
   * printed there was FALSE the moment a column filter was on. «Бу даврда
   * навбатга тушган буюртма йўқ» blames the period, and the period is not what
   * emptied the table: filter to a region nobody ordered from this month and
   * there are still eight hundred orders in the window, none of them here.
   * Measured on 2026-09-09 — `regions=Xorazm` against a local board holding
   * nine orders returned zero rows under that caption.
   *
   * A reader who believes the caption clears the WINDOW, which is the one
   * control that cannot help them, and the funnel they actually have to clear
   * is two metres away at the top of a column.
   */
  narrowed?: boolean
}) {
  /*
    APPENDED, AND ONLY OVER ROWS THAT EXIST. A ЖАМИ of zeros under no groups
    is a claim nobody made; DataTable returns its EmptyState before the scroll
    box when `rows.length === 0`, and this keeps that path reachable.
  */
  const lines: PanelLine[] =
    rows.length === 0
      ? []
      : [
          ...rows.map((row): PanelLine => ({ kind: 'rop', row })),
          { kind: 'total', row: totalLine(rows) },
        ]

  const columns: Column<PanelLine>[] = [
    {
      key: 'rop',
      rowHeader: true,
      header: 'РОП',
      // The same 116px the queue table gives РОП: the same names, one page.
      width: '116px',
      render: (line) =>
        line.kind === 'total' ? (
          /*
            ЖАМИ, AND THEN WHOSE.

            «ЖАМИ» already names the total COLUMN one cell to the right and the
            total TILE in the band above — and that tile follows the ROP filter
            while this table does not. (Neither follows the state selection;
            both follow the period and the search box.) One word, three
            populations, and this page has been burned by exactly that once:
            two counts were both labelled «Жами», so picking «Кутилмоқда» put
            1 289 in the tile and «Жами: 37 та» directly under it, and the
            screen contradicted itself. The second line is what stops it
            happening again, and it is the ROP filter's own string rather than
            a coinage.

            `.eyebrow` is the house's total-row voice — MarketingTable's JAMI
            cell — and this is a table header cell, one of the two places
            globals.css rations that style to.
          */
          <span className="block">
            <span className="eyebrow" style={{ color: 'var(--ink-primary)' }}>
              ЖАМИ
            </span>
            <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
              барча РОП
            </span>
          </span>
        ) : (
          <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {line.row.rop}
          </span>
        ),
    },
    {
      key: 'orders',
      header: backlog ? 'ҲОЗИР КУТИЛМОҚДА' : 'ЖАМИ',
      align: 'right',
      numeric: true,
      width: backlog ? '124px' : '112px',
      /*
        `amountTotal`, NOT `amounts.CONFIRM_NEW`, in backlog mode too — one
        code path with the windowed ЖАМИ column, and a total that keeps
        totalling if the backlog population ever admits a second state.
      */
      render: (line) => (
        <StackedFigure
          count={line.row.orders}
          amount={line.row.amountTotal}
          total={line.kind === 'total'}
        />
      ),
    },
    /*
      The four other states are zero for every group in backlog mode, so the
      columns are dropped rather than filled with zeros: a table of zeros
      invites the reader to look for the difference between them. Their MONEY
      is zero for the same reason and by the same construction, so it leaves
      with them — a column of «0» over a column of «0» is the fault twice.
      What survives carries both readings, which is the only question the
      backlog is asked.
    */
    ...(backlog ? [] : OUTCOMES).map((spec: OutcomeSpec) => ({
      key: spec.key,
      header: spec.label,
      align: 'right' as const,
      numeric: true,
      // Bound by the header on ТАСДИҚЛАНМАДИ, by the figure on the rest.
      width: '112px',
      render: (line: PanelLine) => (
        <StackedFigure
          count={countFor(line.row, spec.key)}
          amount={line.row.amounts[spec.key]}
          color={spec.color}
          total={line.kind === 'total'}
        />
      ),
    })),
  ]

  if (!backlog)
    columns.push({
      key: 'rate',
      header: 'ТАСДИҚЛАНИШ %',
      align: 'right',
      numeric: true,
      /*
        96, DOWN FROM 150. With seven columns to its left it no longer has to
        hold the right edge of the table open, and the header's longest word
        is what binds it — the content is never wider than «100.0%».

        IT IS STILL A RATE OF ORDERS, NOT OF MONEY, and the header does not
        say so with a «(ТА)» suffix: a parenthetical earns its place beside a
        control that could make the label mean something else, and there is no
        such control. The hint carries the clause instead — read once, not
        fifteen times.
      */
      width: '96px',
      render: (line) => {
        // Null, not zero: a group with no orders has no rate, and a 0% would
        // be a verdict on somebody who was not asked to do anything.
        if (line.row.orders === 0)
          return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        /*
          On the ЖАМИ line this runs over the SUMMED RAW COUNTS, through this
          same closure — MarketingTable's "never average the rendered
          percentages" rule satisfied by construction rather than by
          discipline. A four-order group cannot weigh like a four-hundred one.
        */
        const rate = Math.round((line.row.confirmed / line.row.orders) * 1000) / 10
        return (
          <span
            style={{
              color:
                rate < 70
                  ? 'var(--status-critical)'
                  : rate < 85
                    ? 'var(--status-warning)'
                    : 'var(--ink-secondary)',
              // The total keeps the threshold colouring — a red board-wide
              // rate is the fact a floor manager opened this panel for.
              fontWeight: line.kind === 'total' ? 600 : rate < 85 ? 600 : 400,
            }}
          >
            {rate}%
          </span>
        )
      },
    })

  return (
    <ChartCard
      /*
        THE PANEL IS THE PAGE NOW.

        It used to be `shrink-0` at a literal `maxHeight={300}`, bounded
        because it opened ABOVE the card that took what was left — fifteen
        (ROP) groups unbounded would have eaten the queue the reader opened it
        to compare against. That card is not on screen while this one is.

        `fill` supplies ChartCard's two inner levels (`flex min-h-0 flex-1
        flex-col` on the body, `min-h-0 flex-1` on the box that becomes the
        DataTable's containing block) and `flex-1` here supplies the outer
        one — provably the same three-level chain the orders Card hand-rolls.

        `min-h-[450px]` AND DELIBERATELY NOT `min-h-0`. A definite min-height
        releases the card from `min-height: auto` exactly as `min-h-0` would,
        so one utility does both jobs — and the floor is needed on its own
        account: the tile band and the backlog banner are both `shrink-0`, so
        this panel is the only thing in the column that CAN give. Without a
        floor it would collapse toward nothing on a short window while the
        tiles kept every pixel, and `main` would not scroll because nothing
        overflowed.

        450 IS THE OLD 300px CAP, PUT BACK HONESTLY. Rows are 49px now instead
        of 41, so a straight 300 would have shown FEWER groups than before and
        the panel would have been a downgrade on the one screen it was meant
        to help. 348 of table at 49px is the six-and-a-half groups 300px gave
        at 41px; plus this card's ~102px of chrome (header, a two-line hint,
        `pb-5`, borders) that is 450.
      */
      fill
      className="flex-1 min-h-[450px]"
      action={action}
      title="Статистика — РОП кесимида"
      /*
        The ROP filter belongs on this list too.

        The hint named the state filter and stopped there, but a ROP selection
        does not reach this panel either — while it DOES narrow the five tiles
        above it. So picking one ROP left the tiles showing that group and this
        table still showing every group, with nothing saying why the two
        disagreed. Both exclusions are deliberate and for the same reason: a
        comparison table that narrowed to the one row you selected would have
        nothing left to compare.

        AND IT NOW HAS TO NAME ЖАМИ'S POPULATION. There is a ЖАМИ tile in the
        band above, cut by the ROP filter, and a ЖАМИ row here that is not; the
        sentence is what keeps the reader from reading one as the other.
      */
      hint={
        backlog
          ? 'Қидирув бўйича, барча РОПлар — сони ва суммаси; ким энг кўп ишланмаган буюртма ва пул устида ўтирганини кўрсатади. Давр бу панелга таъсир қилмайди. ЖАМИ қатори — шу жадвалнинг ўз йиғиндиси, юқоридаги плиткалар эмас. Суммалар сўмда.'
          : 'Танланган давр ва қидирув бўйича, барча РОПлар — ҳар бир ҳолатнинг сони ва суммаси. Ҳолат ва РОП филтрлари бу панелга таъсир қилмайди — у гуруҳларни солиштириш учун. ЖАМИ қатори — шу жадвалнинг ўз йиғиндиси, юқоридаги плиткалар эмас. ТАСДИҚЛАНИШ % — буюртмалар сони бўйича. Суммалар сўмда.'
      }
    >
      {/*
        A two-column table has nothing to do with 974px. `w-full` stretches it
        anyway, and a figure 800px from the name it belongs to is not a table,
        it is two lists.

        `h-full` IS NOT OPTIONAL: `maxHeight="100%"` below resolves against
        this box, and a block at `height: auto` gives it none to resolve
        against.
      */}
      <div className={`h-full ${backlog ? 'max-w-[560px]' : ''}`}>
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(line) => (line.kind === 'total' ? TOTAL_ROW_KEY : line.row.rop)}
          status={status}
          // Eight columns: 116 РОП + 112 ЖАМИ + 5 × 112 + 96 rate. Two columns
          // in backlog mode, where a fixed 884 would scroll a two-column table
          // sideways for no reason.
          minWidth={backlog ? 240 : 884}
          // The card is the definite-height box now rather than a 300px cap —
          // the same mechanism and the same chain as the queue table.
          maxHeight="100%"
          /*
            ЖАМИ STAYS ON SCREEN. Production carries fifteen (ROP) groups and
            a maximised 1080p window fits about eleven rows, so the one figure
            the client asked for by name would otherwise be the one below the
            fold. MarketingTable's JAMI has that wart; this does not inherit
            it. A sticky element with nothing to stick to renders where it
            already was, so at 2560 it costs nothing.
          */
          stickyLastRow
          emptyTitle="РОП маълумоти йўқ"
          emptyBody={
            narrowed
              ? // Names the control that did it, because it is the only one
                // that can undo it — and the period never could.
                'Танланган регион ва сумма филтрлари бўйича буюртма йўқ. Устун филтрларини тозаланг.'
              : backlog
                ? 'Ҳозир кутаётган буюртма йўқ.'
                : 'Бу даврда навбатга тушган буюртма йўқ.'
          }
        />
      </div>
    </ChartCard>
  )
}

/**
 * «🔁 ҚАЙТА ТУШДИ» — this order has been in the queue before.
 *
 * THE FLOOR'S OWN MARK, and deliberately the bot's emoji rather than a drawn
 * glyph. The five state tiles gave their emoji up because they are a SET that
 * has to be told apart by silhouette and take the state's own colour; this is
 * one mark that means one thing, and the operators already read it in the
 * Telegram messages under exactly this symbol. Anything else here would be a
 * second vocabulary for a fact they already have a word for.
 *
 * ON THE TIME LINE, not beside the date: САНА is 112px and the date fills it,
 * while the time below leaves room. It sits where the eye is already going
 * when it asks "when did this arrive" — which is the question the mark
 * qualifies.
 *
 * The tooltip carries what the badge cannot. An order that came back three
 * minutes after it was confirmed is somebody undoing a misclick; one that came
 * back four days later is a customer reached again. Same badge, and only the
 * previous arrival separates them — so the previous arrival is what it says.
 */
function RepeatMark({ row }: { row: ConfirmationOrderDto }) {
  /*
    RETURNS, NOT ENTRIES. Deal 319494 entered the queue at 14:40, was confirmed
    at 14:49, came back at 14:55 and was confirmed again at 14:56 — two entries
    and one person correcting themselves. It wore the mark here while the bot,
    which requires six hours since its last message, correctly did not. The two
    say the same thing now.
  */
  if (row.queueReturns < 1) return null

  const previous =
    row.previousQueuedAt === null
      ? null
      : `${tashkentDate(row.previousQueuedAt)} ${tashkentTime(row.previousQueuedAt)}`

  return (
    <Tooltip
      content={
        <span className="block">
          ҚАЙТА ТУШДИ — {row.queueEntries}-марта навбатга тушган.
          {previous === null ? '' : ` Аввалгиси: ${previous}`}
        </span>
      }
    >
      <span
        aria-label={`Қайта тушган, ${row.queueEntries}-марта${previous === null ? '' : `, аввалгиси ${previous}`}`}
        className="cursor-default leading-none"
      >
        🔁
      </span>
    </Tooltip>
  )
}

/** The five counts live under five different names; this is the one map. */
function countFor(
  row: ConfirmationQueueDto['byRop'][number],
  key: ConfirmationOutcome,
): number {
  switch (key) {
    case 'CONFIRM_NEW':
      return row.pending
    case 'NO_ANSWER':
      return row.noAnswer
    case 'CONFIRMED':
      return row.confirmed
    case 'REJECTED':
      return row.rejected
    case 'UNCONFIRMED_SHIPPED':
      return row.unconfirmedShipped
  }
}

/**
 * One state: its count, what it is WORTH, and a way into the rows.
 *
 * A button rather than a card with a click handler, so it is reachable by Tab
 * and announced as pressed or not — the selection is real state and has to be
 * legible without seeing the border change.
 *
 * TWO FIGURES, AND ONLY ONE OF THEM IS THE HEADLINE. The count keeps the tile's
 * colour and stays the largest thing in it (22px); the sum sits under the label
 * in secondary ink, below a hairline, at the size the page's own prose is read
 * at. A sum printed as loud as the count gives the reader two headlines and no
 * answer to "how many are waiting", which is the first question this band is
 * asked.
 *
 * Exported for `tests/features/confirmationAmountTiles.test.tsx`, the same
 * reason `OutcomeCell` is: the rule below — full digits, never a compacted
 * reading — is a property of the RENDERED tile, and the only honest way to
 * check it is to render one.
 *
 * PRINTED TO THE LAST DIGIT, never «340 mln». The floor reconciles this board
 * against its own Bitrix24 kanban and the Telegram channel, both of which print
 * the sum out in full — the same reason `formatFullUzs` exists for the sellers
 * board. A rounded figure here is not a shorter reading of the same number, it
 * is a number that cannot be checked against the screen beside it.
 */
export function OutcomeTile({
  Glyph,
  label,
  count,
  amount,
  color,
  status,
  active,
  onSelect,
}: {
  Glyph?: (props: GlyphProps) => React.ReactElement
  label: string
  count: number | null
  amount: MoneyDto | null
  color: string
  status: 'loading' | 'error' | 'ready'
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="focusable card flex h-full flex-col px-3.5 py-2 text-left transition-colors hover:bg-[var(--grid)]"
      style={active ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` } : undefined}
    >
      {/*
        THE COUNT IS 22px, DOWN FROM 28 — and the skeleton above it with it.

        «Barcha buyurtmalar» under this band is what the reader came for, and
        the client said so on 2026-09-09: «shu joyni sal kichikroq qil… pastdagi
        barcha buyurtmalar boʻlimi ekranda koʻproq koʻrinishi kerak u
        muhimroqda». The band is `shrink-0` inside a flex column, so every pixel
        it gives up is a pixel the table takes — a shorter tile is literally
        more rows on screen, and at these counts (two and three digits) 22px is
        still the loudest thing in the tile.
      */}
      {status === 'loading' ? (
        <div className="skeleton h-[24px] w-2/3" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p className="text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        <p
          className="figure tabular text-[22px] leading-none font-semibold"
          style={{ color }}
        >
          {count === null ? NO_VALUE : formatNumber(count)}
        </p>
      )}

      <div className="mt-1 flex items-center gap-1.5">
        {/* Decorative, and inheriting the state's colour: the label right
            beside it is the accessible text. */}
        {Glyph && (
          <span className="shrink-0" style={{ color }}>
            <Glyph size={12} />
          </span>
        )}
        <span
          className="truncate text-[10.5px] font-medium tracking-wide uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          {label}
        </span>
      </div>

      {/*
        THE SUM, ON ITS OWN LINE UNDER A HAIRLINE.

        `mt-auto` and not a margin: six tiles are one grid row, so they are
        already the same height, and pushing this block to the bottom keeps the
        six sums on one baseline even if a label ever wraps or a figure runs to
        two lines.

        `overflow-wrap: anywhere` is the LAST RESORT, not the plan. The band's
        breakpoint (see above) is what makes every tile wide enough for its own
        sum; this is only what happens if a figure ever outgrows that anyway —
        it wraps inside the tile instead of spilling out of the card, which is
        the difference between a cramped number and a broken screen. `figure-wrap`
        was tried here first and does nothing: it permits a break at a SPACE,
        and a grouped number has none.

        The unit is a separate muted span at its own size, the way every other
        full figure in the app prints it, so the digits and the word are never
        the same weight.

        AND NOTHING AT ALL WHEN THE REQUEST FAILED. «Olinmadi» stands where the
        count is and it already answers for the whole tile; a second line under
        it could only be an em dash, and a dash beside a stated failure reads as
        a THIRD thing — as if the count were unavailable and the sum genuinely
        zero-ish. All six tiles fail together, so they lose the line together
        and the band stays level.
      */}
      {status !== 'error' && (
        <div
          className="mt-auto flex items-baseline gap-1 border-t pt-1"
          style={{ borderColor: 'var(--border)' }}
        >
          {status === 'loading' ? (
            <div className="skeleton mt-0.5 h-[12px] w-4/5" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </div>
          ) : (
            <>
              <span
                className="tabular text-[12px] leading-tight font-semibold [overflow-wrap:anywhere]"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {amount === null ? NO_VALUE : formatFullUzs(amount.amount)}
              </span>
              <span className="shrink-0 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                soʻm
              </span>
            </>
          )}
        </div>
      )}
    </button>
  )
}

/**
 * EVERY number on the contact, each masked until asked for.
 *
 * A contact routinely carries two — a mobile and a landline, or the buyer and
 * whoever actually answers — and the importer used to keep only the first, so
 * an operator saw one number and had no way to know another existed. On a
 * confirmation desk that is a call nobody makes.
 *
 * Masked by default, and one toggle reveals all of them: they belong to the
 * same person, so hiding half of a row tells nobody anything. The reference
 * dashboard masks because it is published on GitHub Pages; this one is behind
 * a login, so the reason here is narrower and still real — a queue is read
 * over someone's shoulder in an open office.
 */
function PhoneCell({ phones }: { phones: readonly string[] }) {
  const [shown, setShown] = useState(false)

  if (phones.length === 0) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>

  return (
    <span className="flex flex-col gap-0.5">
      {phones.map((phone) => (
        <span key={phone} className="flex items-center gap-1.5">
          <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
            {shown ? phone : mask(phone)}
          </span>
          <button
            type="button"
            onClick={(event) => {
              // The row is itself clickable on some tables; revealing a number
              // is not a row activation.
              event.stopPropagation()
              setShown((value) => !value)
            }}
            aria-label={shown ? 'Raqamlarni yashirish' : 'Raqamlarni koʻrsatish'}
            aria-pressed={shown}
            className="focusable rounded px-1 py-0.5 transition-opacity hover:opacity-70"
            style={{ color: shown ? 'var(--ink-secondary)' : 'var(--ink-muted)' }}
          >
            {shown ? <EyeOffGlyph size={13} /> : <EyeGlyph size={13} />}
          </button>
        </span>
      ))}
    </span>
  )
}

/** Keep the country code and the last four; hide the identifying middle. */
function mask(phone: string): string {
  if (phone.length <= 8) return phone
  return `${phone.slice(0, phone.length - 7)}***${phone.slice(-4)}`
}

/**
 * СТАТУС — where the order stands, and how it got there.
 *
 * THE ROW IS THE ORDER, AND IT IS DATED BY ITS LAST ARRIVAL. An order
 * confirmed on the 29th and pulled back into Тасдиклаш on the 31st is a row
 * on the 31st, so the 29th loses it — deal 834920 did exactly that, and the
 * operator who had watched their Telegram channel announce it that morning
 * found it simply gone. Six of the 127 orders that arrived on 2026-08-29
 * moved off the day the same way.
 *
 * Splitting the row per visit was the alternative and it is the wrong trade:
 * their bot and their board both keep one entry per deal, and a board that
 * counted visits would let «тасдиқланиш %» exceed the orders it divides. So
 * the row stays one and reads as a chain — the state now, then an arrow up
 * from where it came, one step per visit.
 *
 * ONLY THE LAST STATE IS LIT. The chip, with its tint and its ring, is the
 * order's answer; every state above which it arrived is plain text. That is
 * the whole visual grammar of the cell, and it is why the chip stays on top:
 * the eye lands on the state the row is filed under everywhere else.
 *
 * EVERY STEP CARRIES ITS OWN DATE, including the chip's. It did not, once,
 * because САНА two columns to the left already showed it — and on a table
 * this wide САНА is often scrolled off, which left the lit state as the only
 * undated thing in the cell and made it look like the OLDER one. A reader had
 * to know the rule to read the order. Now the dates say it.
 *
 * NOTHING HERE IS COUNTED. The five tiles, the Статистика panel, the state
 * filter and the header bell all read `outcome`, which is `queueHistory[0]`.
 * An order confirmed in August and refused in September is one order, refused.
 *
 * ONE VISIT RENDERS EXACTLY AS BEFORE — a single chip, no chain, no date.
 * That is 3 077 of the 3 269 orders that arrived in a month, and a table that
 * grew three lines on every row to serve the rest would have made the
 * exception invisible by charging the whole board for it.
 *
 * Exported for `tests/features/confirmationHistory.test.tsx` alone. What that
 * test guards is arithmetic, not layout: the moment an earlier visit reads as
 * a state of its own, one order is two.
 */
export function OutcomeCell({ row }: { row: ConfirmationOrderDto }) {
  /*
    `queueHistory[0]` IS `row.outcome` — same visit, same refinement, pinned
    server-side. The fallback is for a client that somehow received neither:
    the chip is the load-bearing half and it should not vanish because a list
    arrived empty.
  */
  const [current, ...earlier] = row.queueHistory

  if (earlier.length === 0) return <OutcomeChip outcome={current?.outcome ?? row.outcome} />

  return (
    <div className="flex flex-col items-start gap-0.5">
      <OutcomeChip outcome={current?.outcome ?? row.outcome} />
      <VisitDate at={current?.queuedAt ?? row.queuedAt} />
      {earlier.map((visit) => (
        <Fragment key={visit.no}>
          {/*
            The step, and the direction it was taken in. It points UP, at the
            state this one became — which is the state wearing the chip. A
            plain rule between them said only "there is more here"; the arrow
            says which way to read it, and that was the whole ask.

            It sits in the glyph column so the marks, the labels and the arrow
            hang off one vertical line.
          */}
          <span
            aria-hidden="true"
            className="inline-flex pl-2 leading-none"
            // As visible as the dates it sits between. At --border-strong it
            // read as a smudge rather than a direction.
            style={{ color: 'var(--ink-muted)' }}
          >
            <ArrowUpGlyph size={11} />
          </span>
          <EarlierVisit visit={visit} />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * When a step happened, under the state it belongs to.
 *
 * Tashkent, and the same `YYYY-MM-DD HH:mm` the САНА column uses, so a reader
 * comparing the two is comparing like with like.
 */
function VisitDate({ at }: { at: string | null }) {
  if (at === null) return null

  return (
    <span
      className="tabular pl-[26px] text-[10px] leading-tight whitespace-nowrap"
      style={{ color: 'var(--ink-muted)' }}
    >
      {tashkentDate(at)} {tashkentTime(at)}
    </span>
  )
}

/**
 * One visit the order has already finished, under the state it is in now.
 *
 * QUIETER THAN THE CHIP, DELIBERATELY. It wears no pill and no tint: the chip
 * above it is the answer to "what is this order", and a second object of equal
 * weight would make the cell a list of two equals rather than a state with a
 * history. Only the mark keeps the state's colour, which is the same rule the
 * chip follows and the reason the pair can be told apart at a glance.
 */
function EarlierVisit({ visit }: { visit: ConfirmationVisitDto }) {
  const spec = SPEC_BY_KEY.get(visit.outcome)

  /*
    A FINISHED VISIT CANNOT BE «КУТИЛМОҚДА», WHATEVER THE SIGNAL SAYS.

    Only five stages speak; every other one leaves the status alone. So an
    order that went C4:NEW → «Счёт» → C4:NEW reached no signal inside its first
    visit and the repository reports that visit as CONFIRM_NEW, which is true
    of the signal and false of the world: the order is not waiting in a queue
    it demonstrably left. Measured over a month, 19 of the 192 orders that came
    back have at least one such visit — deal 838632 has three.

    The label says what happened instead. It is NOT a sixth state: nothing
    counts it, no tile carries it, and the repository still reports the signal
    it read. It is this cell declining to repeat a present-tense word in the
    past tense.
  */
  const undecided = visit.outcome === 'CONFIRM_NEW'

  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 pl-2 text-[11px] leading-tight whitespace-nowrap"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {/*
          SPOKEN, NOT ONLY DRAWN. Sighted readers get the hierarchy from the
          pill above and the arrow between — a screen reader gets neither, and
          heard the cell as «Тасдиқланмади Тасдиқланди …»: two state names in
          the one column an operator reads the row's state from.
        */}
        <span className="sr-only">Аввалги ҳолат: </span>
        <span
          aria-hidden="true"
          className="inline-flex shrink-0"
          style={{ color: undecided ? 'var(--ink-muted)' : (spec?.color ?? 'var(--ink-muted)') }}
        >
          {spec ? <spec.Glyph size={12} /> : null}
        </span>
        {undecided ? 'Ҳал бўлмаган' : (spec?.label ?? visit.outcome)}
      </span>
      <VisitDate at={visit.queuedAt} />
    </>
  )
}

/** The state as it appears on a row — same mark, same colour, same words. */
function OutcomeChip({ outcome }: { outcome: ConfirmationOutcome }) {
  const spec = SPEC_BY_KEY.get(outcome)

  // An outcome the client has never heard of means the server grew a sixth
  // state. Printing the key beats printing nothing: it names what to look for.
  if (!spec) {
    return <span style={{ color: 'var(--ink-muted)' }}>{outcome}</span>
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[11px] font-medium whitespace-nowrap"
      style={{
        background: `color-mix(in oklab, ${spec.color} 11%, transparent)`,
        // A hairline of the state's own colour. The tint alone reads as a
        // wash at 11%; the ring is what makes it a deliberate object.
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${spec.color} 26%, transparent)`,
        /*
          The WORDS are ink; only the mark wears the state's colour — the
          StatusBadge idiom. Status-coloured 11px text on an 11% self-tint
          measured ~4.0:1 in dark, under the AA floor, and the colour is not
          the information anyway: the glyph and the label are.
        */
        color: 'var(--ink-primary)',
      }}
    >
      <span aria-hidden="true" className="inline-flex shrink-0" style={{ color: spec.color }}>
        <spec.Glyph size={12} />
      </span>
      {spec.label}
    </span>
  )
}

/*
  САНА is stamped in Tashkent, always.

  These two exist beside `lib/format` rather than inside it because the shapes
  differ — this column is `YYYY-MM-DD` and a bare `HH:mm`, not the Uzbek
  `1-sen 2026` the rest of the dashboard reads. The ZONE is the shared fact,
  and it is imported so there is one statement of it: the whole point of the
  daily № beside this column is that both agree on where the working day
  starts, and a manager opening this from Istanbul must not see an order
  numbered into a day the date column disagrees with.
*/
const TASHKENT_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const TASHKENT_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function tashkentDate(iso: string): string {
  return TASHKENT_DATE.format(new Date(iso))
}

function tashkentTime(iso: string): string {
  return TASHKENT_TIME.format(new Date(iso))
}
