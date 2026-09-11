'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SegmentedControl } from '@/components/ui/Controls'
import { Meter, RingGauge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type MarginDto, type MarginRowDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Gross margin, with its own coverage stated.
 *
 * Only some of the catalogue carries a purchase price in Bitrix24, so the
 * margin figure describes part of the business. The coverage bar says how
 * much — without it a 42% margin over a fifth of revenue reads exactly like a
 * 42% margin over all of it, and only one of those is worth acting on.
 *
 * Products with no cost show a dash. Treating an unpriced product as free
 * would report 100% margin on it and quietly lift the company average.
 */
export function MarginPage() {
  const { filters, apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['margin', apiParams],
    queryFn: ({ signal }) =>
      apiGet<MarginDto>('/insights/margin', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const data = query.data?.data

  /*
    THE SEARCH FILTERS THE TABLE AND NOTHING ELSE, and the card says so.

    The catalogue runs to ~160 rows and the ~22 that carry a cost — the only
    rows the margin figure is computed from — are scattered through it. Finding
    one product meant scrolling. The box narrows the LIST in the browser: the
    endpoint is period-only and already returns every row, so this costs no
    request and cannot straddle a sync.

    What it deliberately does NOT touch is every figure above it. The hero
    rate, the coverage bar and the two tiles are the WINDOW's totals, and a
    band that followed its own filter could not be compared against anything —
    the same fault the confirmation board's tiles exist to avoid. The card
    heading prints «N / M» whenever a search is active so the reader can see
    that the table is a subset and the figures above it are not.
  */
  const search = (filters.q ?? '').trim().toLocaleLowerCase('uz')
  const allRows = data?.rows ?? []

  /*
    TWO NARROWINGS AND ONE ORDER, ALL IN THE BROWSER.

    The endpoint takes a period and returns every row, so none of this costs a
    request or can straddle a sync — and none of it touches the figures above,
    which stay the window's totals.

    `costed` is the narrowing the page most needs and had no way to express:
    the margin, the coverage and the hero are computed from the ~22 rows that
    carry a purchase price, and those rows are scattered through ~160 sorted by
    revenue. «Tannarxi bor» isolates the set the page is actually about;
    «Tannarxsiz» isolates the gap the coverage banner is asking to be filled.
  */
  const [costFilter, setCostFilter] = useState<'all' | 'costed' | 'uncosted'>('all')
  const [sort, setSort] = useState<string | null>(null)
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const sortValue = (row: MarginRowDto, key: string): number | null => {
    if (key === 'revenue') return row.revenue.amount
    if (key === 'gross') return row.gross?.amount ?? null
    if (key === 'margin') return row.margin
    if (key === 'discount') return row.discount.amount - row.overList.amount
    return null
  }

  const narrowed = allRows
    .filter((row) => (search === '' ? true : row.productName.toLocaleLowerCase('uz').includes(search)))
    .filter((row) =>
      costFilter === 'all' ? true : costFilter === 'costed' ? row.cost !== null : row.cost === null,
    )

  /*
    NULLS LAST IN BOTH DIRECTIONS. A product with no purchase price has no
    gross and no margin — sorting it as a zero would put the unmeasured rows at
    the top of an ascending «eng past marja», which is the one reading this
    page exists to prevent.
  */
  /** Is the table showing a subset? Drives the «N / M» heading and the hint. */
  const narrowing = search !== '' || costFilter !== 'all'

  const visibleRows =
    sort === null
      ? narrowed
      : [...narrowed].sort((a, b) => {
          const av = sortValue(a, sort)
          const bv = sortValue(b, sort)
          if (av === null && bv === null) return 0
          if (av === null) return 1
          if (bv === null) return -1
          return order === 'asc' ? av - bv : bv - av
        })

  // Both totals come from the server, already split by sign. Summing the
  // rows here would net a giveaway against a markup and report neither.
  const discountTotal = data?.discount.amount ?? null
  const overListTotal = data?.overList.amount ?? null

  /*
    The giveaway as a share of what was taken — the figure that makes the
    number above it readable. Null over an empty window rather than 0%: no
    revenue is not "we gave nothing away", it is nothing to divide by.
  */
  const discountShare =
    data && data.revenue.amount > 0 ? (data.discount.amount / data.revenue.amount) * 100 : null

  /**
   * Neutral while coverage is thin.
   *
   * A 57% margin measured over a quarter of revenue is not a good result, it
   * is an unknown one — and painting it green tells the reader the opposite.
   * Grading resumes once most of the catalogue carries a purchase price —
   * with the page's own 40/20 thresholds, because a supplement margin is
   * judged on a different scale from a delivery rate.
   */
  const heroTone =
    data === undefined || data.coverage < 50
      ? 'neutral'
      : data.margin >= 40
        ? 'good'
        : data.margin >= 20
          ? 'warning'
          : 'critical'

  const columns: Column<MarginRowDto>[] = [
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: 'Mahsulot',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.productName}
        </span>
      ),
    },
    {
      key: 'units',
      header: 'Dona',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.units),
    },
    {
      key: 'revenue',
      sortKey: 'revenue',
      header: 'Tushum',
      align: 'right',
      numeric: true,
      render: (row) => formatCompactUzs(row.revenue.amount),
    },
    {
      key: 'cost',
      header: 'Tannarx',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.cost === null ? (
          <span style={{ color: 'var(--ink-muted)' }} title="Bitrix24 katalogida tannarx yoʻq">
            {NO_VALUE}
          </span>
        ) : (
          formatCompactUzs(row.cost.amount)
        ),
    },
    {
      key: 'gross',
      sortKey: 'gross',
      header: 'Yalpi foyda',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.gross === null ? (
          <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        ) : (
          <span
            style={{
              color: row.gross.amount >= 0 ? 'var(--ink-primary)' : 'var(--status-critical)',
            }}
          >
            {formatCompactUzs(row.gross.amount)}
          </span>
        ),
    },
    {
      key: 'margin',
      sortKey: 'margin',
      header: 'Marja',
      width: '150px',
      render: (row) =>
        row.margin === null ? (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            tannarx yoʻq
          </span>
        ) : row.revenue.amount === 0 ? (
          // A known cost and no revenue: given away outright. The old code
          // reported this as "tannarx yoʻq" while printing the cost in the
          // column beside it.
          <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
            butunlay chegirma
          </span>
        ) : (
          <Meter value={row.margin} tone="neutral" label={row.productName} />
        ),
    },
    {
      key: 'discount',
      sortKey: 'discount',
      header: 'Chegirma',
      align: 'right',
      numeric: true,
      /*
        BOTH FACTS, WHEN A ROW CARRIES BOTH — this cell used to print only one.

        A product row is an aggregate over many lines, so a product with some
        lines discounted and some sold above list has a non-zero discount AND a
        non-zero over-list. The old three-way ternary took the discount branch
        and dropped `overList` on the floor for exactly those rows — and per the
        note below, a discount is on almost every row with volume, so the
        markup branch was effectively unreachable and the column's second fact
        was never seen. The repository splits the two by sign precisely so they
        are not netted (406 markup lines in one month); rendering one of them is
        the same loss by another route, one layer later.

        Unnetted here too: the giveaway on the first line, the markup under it
        in muted ink. The row now reconciles against the two tiles above it.
      */
      render: (row) => {
        const hasDiscount = row.discount.amount > 0
        const hasOverList = row.overList.amount > 0

        if (!hasDiscount && !hasOverList) {
          return <span style={{ color: 'var(--ink-muted)' }}>0</span>
        }

        return (
          <span className="inline-flex flex-col items-end leading-tight">
            {hasDiscount && (
              /*
                Ink. Every product carries some discount, so painting the column
                --status-serious made 100% of rows orange — and a colour that is
                on every row informs on none, while quietly spending a reserved
                status hue on an ordinary fact. The TILE above grades the total.
              */
              <span style={{ color: 'var(--ink-secondary)' }}>
                {formatCompactUzs(row.discount.amount)}
              </span>
            )}
            {hasOverList && (
              // Sold ABOVE the catalogue price. This used to render in the same
              // warning orange as a giveaway, with a minus sign as the only clue —
              // so money earned and money surrendered looked identical.
              <span
                className={hasDiscount ? 'text-[11px]' : undefined}
                style={{ color: 'var(--ink-muted)' }}
                title="Narx katalog narxidan yuqori — chegirma emas, ustama"
              >
                +{formatCompactUzs(row.overList.amount)}
              </span>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <PageShell
      title={t.modules.margin.title}
      description={t.modules.margin.lead}
      accent="var(--series-2)"
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
      /*
        Search only. The roster, department, source and stage pickers are
        deliberately absent: this endpoint takes a period and nothing else, so
        offering a control the SQL never reads would be a filter that lies —
        which is exactly the fault the ⌘K product link had before it was
        pointed here.
      */
      filters={{ search: true, searchPlaceholder: 'Mahsulot nomi…' }}
    >
      {/*
        The lead instrument — the page's one hero, the only panel wearing the
        registration brackets.

        The page exists to answer one rate: of the revenue whose cost is
        known, how much stayed. The ring carries the rate, the hero figure
        carries the fraction it was computed from — a rate without its
        denominator is an opinion — and the caption names the coverage,
        because THIS rate's honesty depends on how much of the catalogue it
        can actually see. The tiles and the table below are detail under this
        one claim.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Marja">
        {query.isError ? (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {query.isPending ? (
              <div className="skeleton h-[116px] w-[116px] shrink-0 rounded-full" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : (
              <RingGauge
                /*
                  Null when nothing costed sold: a margin over a zero base is
                  arithmetic, not information, and the ring showing "0%" would
                  claim the company kept nothing — the opposite of unknown.
                */
                value={data && data.costedRevenue.amount > 0 ? data.margin : null}
                size={116}
                thickness={9}
                tone={heroTone}
                label="Marja"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Marja
              </p>

              {query.isPending ? (
                // Sized to the hero figure below, so ready never reflows loading.
                <div className="skeleton mt-2 h-[38px] w-56" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ) : data && data.costedRevenue.amount > 0 ? (
                /*
                  The fraction, not a second copy of the percentage — the ring
                  already states that. Gross profit leads at hero size, the
                  base it came from sits beside it a register quieter, so the
                  42% can be checked against the two numbers it divides.
                */
                <p className="figure-hero figure-wrap mt-2" style={{ color: 'var(--ink-primary)' }}>
                  <AnimatedNumber value={data.gross.amount} format={formatCompactUzs} />
                  <span className="text-lg font-normal" style={{ color: 'var(--ink-muted)' }}>
                    {' '}/ {formatCompactUzs(data.costedRevenue.amount)} soʻm
                  </span>
                </p>
              ) : (
                // Genuine null: no costed product sold. An em dash, never 0 —
                // "unmeasurable" is a different fact from "kept nothing".
                <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                  {NO_VALUE}
                </p>
              )}

              {!query.isPending && data && (
                <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                  {data.costedRevenue.amount > 0
                    ? `Yalpi foyda / tannarxi maʼlum tushum · qamrov ${formatPercent(data.coverage)}`
                    : 'Bu davrda tannarxi maʼlum mahsulot sotilmagan — marja oʻlchanmaydi'}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/*
        Kept: the honesty banner. The hero states the coverage in passing; this
        spells out WHY it is short and what fixes it, right under the claim it
        qualifies.

        GUARDED ON THERE BEING REVENUE AT ALL. `coverageBp` is 0 when nothing
        closed in the window, so a quiet period rendered «Marja tushumning 0%
        qismi boʻyicha hisoblandi — qolgan mahsulotlarda tannarx
        koʻrsatilmagan»: a confident accusation about the Bitrix24 catalogue,
        one line under a hero that is correctly an em dash. Nothing is wrong
        with the catalogue on a day nobody sold anything.
      */}
      {data && data.revenue.amount > 0 && data.coverage < 99 && (
        <div
          className="rounded-[var(--radius-panel)] border px-4 py-3 text-xs"
          style={{
            /*
              A rule down the edge, not a wash across the panel.

              8% of a saturated amber mixed into a near-black surface is a
              muddy brown at 1.12:1 — it neither reads as a warning nor stays
              out of the way. A full-strength bar on the leading edge is
              unambiguous at any surface lightness, and the panel itself keeps
              the ordinary card colour.
            */
            background: 'var(--surface-raised)',
            borderColor: 'var(--border)',
            borderInlineStartWidth: 3,
            borderInlineStartColor: 'var(--status-warning)',
            color: 'var(--ink-secondary)',
          }}
        >
          <strong style={{ color: 'var(--ink-primary)' }}>
            Marja tushumning {formatPercent(data.coverage)} qismi boʻyicha hisoblandi.
          </strong>{' '}
          Qolgan mahsulotlarda Bitrix24 katalogida tannarx (закупочная цена) koʻrsatilmagan. Ularni
          katalogda toʻldirsangiz, marja avtomatik toʻliq boʻladi — nol tannarx yozilmaydi, chunki u
          100% foyda boʻlib koʻrinardi.
          <div className="mt-2 max-w-md">
            <Meter value={data.coverage} tone="neutral" label="Qamrov" />
          </div>
        </div>
      )}

      {/*
        Supporting tiles, subordinate on purpose. "Yalpi foyda" is no longer a
        tile: the hero figure IS the gross, and the same number at two sizes
        on one screen makes the reader ask which one is wrong.
      */}
      <div className="stagger grid gap-3 sm:grid-cols-2">
        <StatTile
          status={tileStatus}
          label="Tushum"
          value={data?.revenue.amount ?? null}
          unit="money"
          /*
            NAMED, because «Tushum» means something else on every other screen.

            This sums `deal_item.totalMinor` across an INNER JOIN to product;
            the rest of the dashboard sums `deal.amountMinor`. A revenue-
            bearing WON deal with no product lines contributes nothing here, so
            this tile is silently ≤ the closed revenue the sellers board prints
            under the same word, and nothing said which was which.
          */
          hint={
            data
              ? `Mahsulot qatorlari boʻyicha · ${formatCompactUzs(data.costedRevenue.amount)} soʻmda tannarx maʼlum`
              : undefined
          }
        />
        <StatTile
          status={tileStatus}
          label="Berilgan chegirma"
          value={discountTotal}
          unit="money"
          /*
            NEUTRAL, and the number that would actually grade it in the hint.

            The tone was `warning` on `discountTotal > 0` — a condition that
            never turns off, because every product with volume carries some
            discount. That is the argument this page already makes one column
            to the left («a colour that is on every row informs on none»),
            spending a reserved status hue on an ordinary fact. What a reader
            can act on is the SHARE: 3% of revenue given away is housekeeping,
            18% is a conversation. Both totals are already on the payload.
          */
          tone="neutral"
          hint={[
            discountShare === null ? null : `Tushumning ${formatPercent(discountShare)}`,
            'Toʻgʻridan-toʻgʻri marjadan chiqadi',
            overListTotal && overListTotal > 0
              ? `${formatCompactUzs(overListTotal)} ustama alohida`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </div>

      <ChartCard
        title={
          narrowing ? `Mahsulotlar · ${visibleRows.length} / ${allRows.length}` : 'Mahsulotlar'
        }
        hint={
          narrowing
            ? 'Filtr va qidiruv faqat shu jadvalni oʻzgartiradi. Yuqoridagi marja, qamrov va summalar butun davrniki.'
            : 'Chegirma ustuni — sotuvda berilgan yon berish; u toʻgʻridan-toʻgʻri foydadan ketadi. Ustun nomini bosib tartiblang.'
        }
        action={
          <SegmentedControl
            value={costFilter}
            onChange={setCostFilter}
            ariaLabel="Tannarx boʻyicha filtr"
            options={[
              { value: 'all', label: 'Hammasi' },
              { value: 'costed', label: 'Tannarxi bor' },
              { value: 'uncosted', label: 'Tannarxsiz' },
            ]}
          />
        }
      >
        <DataTable
          columns={columns}
          rows={visibleRows}
          sort={sort ?? undefined}
          order={order}
          onSort={(key) => {
            // Same column toggles direction; a new column opens descending,
            // which is what "biggest first" means on every figure here.
            setOrder((previous) => (sort === key ? (previous === 'asc' ? 'desc' : 'asc') : 'desc'))
            setSort(key)
          }}
          rowKey={(row) => row.productId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle={narrowing ? 'Bu filtr boʻyicha mahsulot topilmadi' : 'Bu davrda sotuv yoʻq'}
          minWidth={940}
          /*
            The catalogue runs long. Bounded, the rows scroll INSIDE the card
            under the sticky header, so the column names never leave the
            reader mid-list; short result sets keep today's behaviour — the
            cap only exists when there is something to cap.
          */
        />
      </ChartCard>
    </PageShell>
  )
}
