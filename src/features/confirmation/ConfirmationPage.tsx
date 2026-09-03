'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Card, ChartCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  ArrowOutGlyph,
  BarsGlyph,
  CheckCircleGlyph,
  ClockGlyph,
  CrossCircleGlyph,
  EyeGlyph,
  EyeOffGlyph,
  PhoneMissedGlyph,
  type GlyphProps,
} from '@/components/ui/Icons'
import { MultiSelect, Pagination } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type ConfirmationOrderDto,
  type ConfirmationOutcome,
  type ConfirmationQueueDto,
  apiGet,
} from '@/lib/api'
import { APP_TIME_ZONE, NO_VALUE, formatNumber } from '@/lib/format'
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
        <span className="tabular block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {tashkentTime(row.queuedAt ?? row.createdAt)}
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
    render: (row) => <OutcomeChip outcome={row.outcome} />,
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

  const query = useQuery({
    queryKey: ['confirmation-queue', apiParams, filters.page, filters.pageSize, sort, filters.order],
    queryFn: ({ signal }) =>
      apiGet<ConfirmationQueueDto>(
        '/insights/confirmations/orders',
        {
          ...apiParams,
          page: filters.page,
          pageSize: filters.pageSize,
          sort,
          order: filters.order,
        },
        signal,
      ),
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
    */
    refetchOnWindowFocus: true,
  })

  /*
    PLACEHOLDER DATA IS NOT AN ANSWER TO THE NEW QUESTION.

    `placeholderData: previous` keeps the table steady while the next page
    loads, which is right for paging — but on a PERIOD change it also left the
    five tiles showing last window's counts with no sign they were stale, so
    «Бугун» wore «Шу ой»'s numbers until the request came back. Placeholder
    rows read as loading, because that is what they are.
  */
  const tileStatus = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : query.isPlaceholderData
        ? 'loading'
        : 'ready'
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
  const narrowed = filters.outcomes.length > 0

  /**
   * Which question is on screen — the period's arrivals, or what is waiting.
   *
   * Reached from the header bell, which counts the backlog: the badge and this
   * board have to be the same set or the header is lying about the page it
   * links to. Everything the mode changes below — the description, the absent
   * period control, the single tile, the banner that says so — exists because
   * a board that ignores the window must not look like one that reads it.
   */
  const backlog = filters.queue === 'backlog'

  /** The ROP list, with the current selection guaranteed present. */
  const ropOptions = (() => {
    const names = data?.rops ?? []
    const withSelection =
      filters.rop && !names.includes(filters.rop) ? [...names, filters.rop].sort() : names
    return withSelection.map((rop) => ({ value: rop, label: rop }))
  })()

  return (
    <PageShell
      title={t.modules.confirmation.title}
      /*
        IN BACKLOG MODE THE PERIOD DOES NOT APPLY, so it is not offered.

        `period={false}` takes away the preset row and the date line under the
        title, both of which would otherwise describe a window this view
        ignores — a date control over a list that does not read it is worse
        than no control, because a reader assumes it must be filtering
        something. The description says which question is on screen instead,
        and the banner above the tile repeats it where the eye actually lands.
      */
      description={
        backlog
          ? 'Hozir tasdiqlashni kutayotgan barcha buyurtmalar — qachon kelganidan qatʼi nazar. Davr bu roʻyxatga taʼsir qilmaydi.'
          : t.modules.confirmation.lead
      }
      period={!backlog}
      accent="var(--series-4)"
      meta={backlog ? undefined : query.data?.meta}
      stale={query.isPlaceholderData}
      filters={{
        search: true,
        // Every column the table shows is searchable, so the box says so —
        // including the phone in the masked form it is displayed in.
        searchPlaceholder: 'ID, mijoz, telefon, operator, ROP, mahsulot, summa, region, manba…',
      }}
      actions={
        /*
          No "Бугун" button here.

          The period control in the page toolbar already owns the reporting
          window and carries its own Bugun / Kecha / Shu hafta row. A second
          one beside the ROP filter set the same URL parameter from a second
          place, so the two could disagree on screen about which day was
          selected — and a filter bar that contradicts the control above it is
          worse than one button fewer.
        */
        <div className="flex flex-wrap items-center gap-2">
          {/*
            THE SELECTED ROP IS ALWAYS AN OPTION, even when the search hides it.

            `rops` is derived from the per-ROP breakdown, which obeys the search
            box — so typing a term that no order of the selected group matches
            removed that group from the list while the filter stayed applied.
            The control then showed blank over a table narrowed to a group the
            reader could no longer see, and the only way out was to clear the
            search first. Carrying the current value keeps the control able to
            describe its own state.
          */}
          <Select
            label="Барча РОП"
            value={filters.rop ?? ''}
            options={ropOptions}
            onChange={(rop) => update({ rop: rop || undefined })}
          />

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

          <Button
            variant={statsOpen ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setStatsOpen((open) => !open)}
          >
            <span className="inline-flex items-center gap-1.5">
              <BarsGlyph size={13} />
              Статистика
            </span>
          </Button>
        </div>
      }
    >
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5"
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
              'stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
            : 'stagger grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
        }
      >
        <OutcomeTile
          Glyph={backlog ? ClockGlyph : undefined}
          label={backlog ? 'ҲОЗИР КУТИЛМОҚДА' : 'ЖАМИ'}
          status={tileStatus}
          count={totals?.orders ?? null}
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
              color={spec.color}
              active={filters.outcomes.includes(spec.key)}
              onSelect={() => toggleOutcome(spec.key)}
            />
          ))}
      </div>

      {statsOpen && <RopPanel rows={data?.byRop ?? []} status={tileStatus} backlog={backlog} />}

      <Card className="card-hero brackets px-4 py-4">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Барча буюртмалар
          </h2>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {/*
              TWO NUMBERS, TWO NAMES.

              This count obeys every filter — state, ROP, search — while the
              ЖАМИ tile above obeys none of them, because a band whose figures
              moved with its own selection could not be used to compare one
              state against another. Both were labelled «Жами», so picking
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
        </header>

        <DataTable
          columns={QUEUE_COLUMNS}
          rows={data?.items ?? []}
          rowKey={(row) => row.dealId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          sort={sort}
          order={filters.order}
          onSort={onSort}
          /*
            Bounded, so the header row pins while the page's rows scroll under
            it — and so the pager stays a glance away rather than a screen.
          */
          maxHeight={640}
          minWidth={1860}
          emptyTitle="Buyurtma topilmadi"
          emptyBody={
            filters.outcomes.length > 0 || filters.rop || filters.q
              ? 'Bu filtrlar boʻyicha buyurtma yoʻq. Filtrlarni tozalab koʻring.'
              : backlog
                ? // An empty backlog is the good news, and «bu davrda» would be
                  // a sentence about a window this board does not read.
                  'Hozir tasdiqlashni kutayotgan buyurtma yoʻq — navbat boʻsh.'
                : 'Bu davrda hech bir buyurtma tasdiqlash navbatiga tushmagan.'
          }
        />

        {data && (
          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            totalItems={data.pagination.totalItems}
            onPage={(next) => update({ page: next })}
          />
        )}
      </Card>
    </PageShell>
  )
}

/**
 * Статистика — the queue by ROP group.
 *
 * The one cut the table below cannot make. A ROP's confirmation rate is a
 * statement about their whole day, and the reader is looking at twenty-five
 * rows of it; ranking the groups is what turns "we are at 90%" into a name.
 *
 * Sorted by orders rather than by rate on purpose: a group with four orders
 * and one refusal is not the worst ROP on the floor, and rate-sorting would
 * put them at the top of a list managers act on.
 */
function RopPanel({
  rows,
  status,
  backlog,
}: {
  rows: readonly ConfirmationQueueDto['byRop'][number][]
  status: 'loading' | 'error' | 'ready'
  /**
   * Whether the board behind this panel is the backlog.
   *
   * IT CHANGES WHICH COLUMNS ARE HONEST, not just their labels. Every backlog
   * row is CONFIRM_NEW by construction, so the four other state columns are
   * zero for every group and ТАСДИҚЛАНИШ % is `confirmed / orders` = 0 —
   * which this panel then paints `--status-critical` and semibold, putting a
   * red verdict on every ROP on the floor for a rate that could not have been
   * anything else. What survives is the one cut that still says something
   * here: who is sitting on the most unworked orders.
   */
  backlog: boolean
}) {
  const columns: Column<ConfirmationQueueDto['byRop'][number]>[] = [
    {
      key: 'rop',
      rowHeader: true,
      header: 'РОП',
      render: (row) => (
        <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {row.rop}
        </span>
      ),
    },
    {
      key: 'orders',
      header: backlog ? 'ҲОЗИР КУТИЛМОҚДА' : 'ЖАМИ',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.orders),
    },
    /*
      The four other states are zero for every group in backlog mode, so the
      columns are dropped rather than filled with zeros: a table of zeros
      invites the reader to look for the difference between them.
    */
    ...(backlog ? [] : OUTCOMES).map((spec: OutcomeSpec) => ({
      key: spec.key,
      header: spec.label,
      align: 'right' as const,
      numeric: true,
      render: (row: ConfirmationQueueDto['byRop'][number]) => {
        const count = countFor(row, spec.key)
        return count === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>0</span>
        ) : (
          <span style={{ color: spec.color }}>{formatNumber(count)}</span>
        )
      },
    })),
  ]

  if (!backlog)
    columns.push({
      key: 'rate',
      header: 'ТАСДИҚЛАНИШ %',
      align: 'right',
      numeric: true,
      width: '150px',
      render: (row) => {
        // Null, not zero: a group with no orders has no rate, and a 0% would
        // be a verdict on somebody who was not asked to do anything.
        if (row.orders === 0) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        const rate = Math.round((row.confirmed / row.orders) * 1000) / 10
        return (
          <span
            style={{
              color:
                rate < 70
                  ? 'var(--status-critical)'
                  : rate < 85
                    ? 'var(--status-warning)'
                    : 'var(--ink-secondary)',
              fontWeight: rate < 85 ? 600 : 400,
            }}
          >
            {rate}%
          </span>
        )
      },
    })

  return (
    <ChartCard
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
      */
      hint={
        backlog
          ? 'Қидирув бўйича, барча РОПлар — ким энг кўп ишланмаган буюртма устида ўтирганини кўрсатади. Давр бу панелга ҳам таъсир қилмайди.'
          : 'Танланган давр ва қидирув бўйича, барча РОПлар. Ҳолат ва РОП филтрлари бу панелга таъсир қилмайди — у гуруҳларни солиштириш учун.'
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.rop}
        status={status}
        // Two columns in backlog mode, seven in the windowed one: a fixed 900
        // would scroll a two-column table sideways for no reason.
        minWidth={backlog ? 320 : 900}
        emptyTitle="РОП маълумоти йўқ"
        emptyBody={
          backlog ? 'Ҳозир кутаётган буюртма йўқ.' : 'Бу даврда навбатга тушган буюртма йўқ.'
        }
      />
    </ChartCard>
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
 * One state: its count and a way into the rows.
 *
 * A button rather than a card with a click handler, so it is reachable by Tab
 * and announced as pressed or not — the selection is real state and has to be
 * legible without seeing the border change.
 */
function OutcomeTile({
  Glyph,
  label,
  count,
  color,
  status,
  active,
  onSelect,
}: {
  Glyph?: (props: GlyphProps) => React.ReactElement
  label: string
  count: number | null
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
      className="focusable card flex flex-col px-3.5 py-3 text-left transition-colors hover:bg-[var(--grid)]"
      style={active ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` } : undefined}
    >
      {status === 'loading' ? (
        <div className="skeleton h-[30px] w-2/3" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p className="text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        <p
          className="figure tabular text-[28px] leading-none font-semibold"
          style={{ color }}
        >
          {count === null ? NO_VALUE : formatNumber(count)}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
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

/**
 * A single-choice filter, in the house style.
 *
 * A native select rather than the MultiSelect popover: these two are
 * single-choice and the reference the page mirrors uses a dropdown for both,
 * so the affordance stays the one the floor already knows.
 */
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="focusable rounded-lg border px-2.5 py-1.5 text-xs font-medium"
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border)',
        color: value ? 'var(--ink-primary)' : 'var(--ink-secondary)',
      }}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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
