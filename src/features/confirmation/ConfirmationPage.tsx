'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

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
import { NO_VALUE, formatNumber } from '@/lib/format'
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
 * WHERE THIS SCREEN IS DELIBERATELY BETTER THAN THE ONE IT MIRRORS
 * The reference renders from `deal_state.json`, which the bot builds by
 * polling and never prunes — so its rate is lifetime-to-date, and it can only
 * hold orders whose ROP has a mapped Telegram channel. This one runs on the
 * imported stage history, so it has a real reporting window, it sees every
 * ROP, and САНА is the actual stage-entry time rather than the moment a
 * two-minute poll noticed it (which is why our clock reads a minute earlier
 * than theirs, consistently).
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
  { key: 'CONFIRM_NEW', Glyph: ClockGlyph, label: 'Тасдиқлаш', color: 'var(--series-1)' },
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
    color: 'var(--series-7)',
  },
]

const SPEC_BY_KEY = new Map(OUTCOMES.map((spec) => [spec.key, spec]))

/** The queue's own sort columns. The URL may carry another page's default. */
const SORTS = ['movedAt', 'queuedAt', 'decidedAt', 'amountMinor', 'title'] as const

export function ConfirmationPage() {
  const { filters, update, apiParams } = useDashboardFilters()
  const [statsOpen, setStatsOpen] = useState(false)

  /*
    `sort` is shared URL state, and its dashboard-wide default is a deal
    column (`createdAtSource`) that this endpoint's allowlist rejects with a
    400. So an unrecognised value falls back to this page's own default —
    which is the ordinary case on first load, and the only thing standing
    between a bookmarked link from another screen and an empty page.
  */
  const sort = (SORTS as readonly string[]).includes(filters.sort) ? filters.sort : 'movedAt'

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
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  })

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const data = query.data?.data
  const totals = data?.totals

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

  const columns: Column<ConfirmationOrderDto>[] = [
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
      sortKey: 'movedAt',
      width: '112px',
      render: (row) => (
        <div className="whitespace-nowrap">
          <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
            {tashkentDate(row.movedAt)}
          </span>
          <span className="tabular block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {tashkentTime(row.movedAt)}
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

  const shown = data?.pagination.totalItems ?? null

  return (
    <PageShell
      title={t.modules.confirmation.title}
      description={t.modules.confirmation.lead}
      accent="var(--series-4)"
      meta={query.data?.meta}
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
          <Select
            label="Барча РОП"
            value={filters.rop ?? ''}
            options={(data?.rops ?? []).map((rop) => ({ value: rop, label: rop }))}
            onChange={(rop) => update({ rop: rop || undefined })}
          />

          {/*
            Multi-select, not a single choice: the states are read in
            combinations. The house MultiSelect is what every other filter on
            the dashboard uses, so the checkbox affordance is already familiar.
          */}
          <MultiSelect
            label="Барча статус"
            options={OUTCOMES.map((spec) => ({
              id: spec.key,
              label: spec.label,
            }))}
            selected={filters.outcomes}
            onChange={(outcomes) => update({ outcomes: outcomes as ConfirmationOutcome[] })}
          />

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
        The state band, in the reference's own order: the queue, the two ways
        it stalls, then the two outcomes.

        Each tile is a filter as well as a figure — a count nobody can open is
        a number that ends the conversation instead of starting it. The counts
        follow the period, the ROP and the search box but deliberately NOT the
        state filter: a band whose numbers changed to match its own selection
        could not be used to compare one state against another, which is the
        only reason to put five of them side by side.
      */}
      <div className="stagger grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <OutcomeTile
          label="ЖАМИ"
          status={tileStatus}
          count={totals?.orders ?? null}
          color="var(--ink-primary)"
          active={filters.outcomes.length === 0}
          onSelect={() => update({ outcomes: [] })}
        />
        {OUTCOMES.map((spec) => (
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

      {statsOpen && <RopPanel rows={data?.byRop ?? []} status={tileStatus} />}

      <Card className="card-hero brackets px-4 py-4">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Барча буюртмалар
          </h2>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {shown === null ? '' : `Кўрсатилмоқда: ${formatNumber(shown)} та`}
            {totals && totals.confirmedRate !== null && (
              <>
                {' · '}
                Тасдиқланиш: <span className="tabular">{totals.confirmedRate}%</span>
              </>
            )}
            {query.dataUpdatedAt > 0 && (
              <>
                {' · '}
                Янгиланди:{' '}
                <span className="tabular">{tashkentTime(new Date(query.dataUpdatedAt).toISOString())}</span>
                {' (ҳар 2 дақиқада)'}
              </>
            )}
          </p>
        </header>

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
            Bounded, so the header row pins while the page's rows scroll under
            it — and so the pager stays a glance away rather than a screen.
          */
          maxHeight={640}
          minWidth={1860}
          emptyTitle="Buyurtma topilmadi"
          emptyBody={
            filters.outcomes.length > 0 || filters.rop || filters.q
              ? 'Bu filtrlar boʻyicha buyurtma yoʻq. Filtrlarni tozalab koʻring.'
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
}: {
  rows: readonly ConfirmationQueueDto['byRop'][number][]
  status: 'loading' | 'error' | 'ready'
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
      header: 'ЖАМИ',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.orders),
    },
    ...OUTCOMES.map((spec) => ({
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
    {
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
    },
  ]

  return (
    <ChartCard
      title="Статистика — РОП кесимида"
      hint="Танланган давр ва қидирув бўйича. Ҳолат филтри бу панелга таъсир қилмайди — у гуруҳларни солиштириш учун."
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.rop}
        status={status}
        minWidth={900}
        emptyTitle="РОП маълумоти йўқ"
        emptyBody="Бу даврда навбатга тушган буюртма йўқ."
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
        color: spec.color,
      }}
    >
      <spec.Glyph size={12} className="shrink-0" />
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

  `formatDate` in lib/format renders in the BROWSER's zone, which is right for
  a dashboard read from one office and wrong for this column: the whole point
  of the daily № beside it is that both agree on where the working day starts.
  A manager opening this from Istanbul would otherwise see an order numbered
  into a day the date column disagrees with.
*/
const TASHKENT_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const TASHKENT_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tashkent',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function tashkentDate(iso: string): string {
  return TASHKENT_DATE.format(new Date(iso))
}

function tashkentTime(iso: string): string {
  return TASHKENT_TIME.format(new Date(iso))
}
