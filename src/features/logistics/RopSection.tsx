'use client'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter } from '@/components/ui/Stat'
import type { LogisticsRopDto } from '@/lib/api'
import { formatFullUzs, formatNumber } from '@/lib/format'

/**
 * WHOSE ЗАКАЗ WAS IT, AND HOW MUCH OF IT ARRIVED.
 *
 * The client asked for this on 2026-09-12, in their own words: «ROP larni
 * FAKT 1 larini tortgansan dashboardga… keyingi tarafida FAKT 2 si ROP larni
 * har biriga kerak». FAKT 1 per team, FAKT 2 beside it, and the ratio.
 *
 * THE TEAM COMES OFF THE DEAL, NOT OFF TODAY'S ORG CHART. The client named
 * the source on 2026-09-14 — «Организация сотрудника (не удалять)» on the
 * deal card, «Azizbek(ROP)» — which the portal stamps at the moment of sale
 * and never rewrites. So a ROP who opens one order in Bitrix24 reads the same
 * team here, and a seller moving between teams no longer rewrites a settled
 * month. Where that field is empty (the portal began writing it in 2026) the
 * row falls back to the seller's department, which is what this table used
 * before. See the `rop` column in `logisticsCohortSql`.
 *
 * IT IS THE ONE QUESTION THE SHEET ABOVE IT CANNOT ANSWER. The six columns
 * partition ЗАКАЗ by where an order stands — «Отказ», «В пути», «Успешно» —
 * and every one of them is company-wide. A ROP reading that card learns what
 * happened to the month and nothing about their own half of it.
 *
 * IT SITS AMONG THE BREAKDOWN CARDS, not under the hero. Moved down on
 * 2026-09-14 at the client's word; `LogisticsPage` states the page's reading
 * order beside the call. What follows from that here is the drawing: one line
 * a row, the same 150px meter «Pochtalar» and «Hududlar» use, and a card no
 * wider than its own four columns.
 *
 * ЖАМИ IS THE SERVER'S OWN TOTAL, never a sum taken here — the rule every
 * table on this screen keeps. It is `by_rop`'s grouping-set row over the same
 * unfiltered cohort the hero is measured on, so the footer must equal the two
 * figures at the top of the page. That equality is what makes this table
 * checkable rather than trusted: if the rows do not add up to the hero, the
 * footer says so on the same screen instead of in a month's argument.
 *
 * HAND-DRAWN, like four of the five comparisons on this page. Fifteen teams
 * and three figures is a table; a chart of it is an axis nobody reads and a
 * hover that hides the numbers.
 */
export function RopSection({
  rops,
  total,
  status,
  errorMessage,
  onRetry,
}: {
  rops: readonly LogisticsRopDto[]
  total: LogisticsRopDto | null
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry: () => void
}) {
  /*
    THE TOTAL IS A DIFFERENT KIND OF LINE AND SAYS SO IN THE TYPE.

    The confirmation panel's own footer does exactly this. A sentinel `rop`
    name was the alternative and it is the worse one: no coinage is safe from a
    department Bitrix24 might one day be renamed to, and a table that silently
    treats one team as its own total is a fault nobody would look for.
  */
  const lines: RopLine[] = [
    ...rops.map((row): RopLine => ({ kind: 'rop', row })),
    ...(total ? [{ kind: 'total', row: total } as RopLine] : []),
  ]

  return (
    <ChartCard
      title="ROP lar boʻyicha · FAKT 1 va FAKT 2"
      /*
        ONE SENTENCE. The basis note directly above this card already states
        the cohort and what each FAKT means, at length and in the client's own
        vocabulary — repeating it here put four lines of prose between the hero
        and the only table on the screen anybody asked for.
      */
      hint="Buyurtma sdelkadagi «Организация сотрудника (не удалять)» maydoni boʻyicha. ЖАМИ yuqoridagi Qamrov paneli bilan aynan teng."
    >
      {/*
        CAPPED, BECAUSE A FOUR-COLUMN TABLE HAS NOTHING TO DO WITH 1 560px.

        Unbounded it filled the card and put «Sevinch» some 700 pixels from
        «269 250 000» — the exact fault the confirmation board's backlog table
        records at `max-w-[560px]`: a figure that far from the name it belongs
        to is not a table, it is two lists. The width is the four columns plus
        the table's own padding, so nothing inside it is compressed.

        NARROWED WITH THE ROWS on 2026-09-14, on the client's instruction
        («kichiroq qilib… oddiyroq va tushunarliroq»). One line a row instead
        of two took ~250px off the card, and 900px of table over 700px of
        content would have put the slack back as white space between a name
        and its money.
      */}
      <div className="max-w-[760px]">
        <DataTable<RopLine>
          columns={ROP_COLUMNS}
          rows={lines}
          rowKey={(line) => (line.kind === 'total' ? TOTAL_ROW_KEY : line.row.rop)}
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
          emptyTitle="ROP maʼlumoti yoʻq"
          emptyBody="Bu davrda tasdiqlash navbatiga tushgan buyurtma topilmadi."
          // 160 РОП + 2 × 200 full soʻm with its count + 150 Qamrov. Below
          // that the two sums would wrap, which is the one thing this table
          // may not do — it exists to be read across.
          minWidth={710}
          /*
            EVERY ROP AT ONCE, AND NO INNER SCROLL — the client asked for each
            of them by name, and the default 60dvh cap showed nine of fifteen
            behind a scrollbar inside a card, which reads as "these are the
            teams" rather than "these are nine of the teams".

            The six-column table on this same screen makes the same call for
            the same reason: this page scrolls as a page. `stickyLastRow` is
            therefore NOT set — it is ignored without a bounded height anyway,
            and ЖАМИ is the last row of a table the reader can see the end of.
            (The confirmation panel does the opposite because that page is
            exactly one viewport tall and its card takes what is left.)
          */
          maxHeight="none"
          /*
            THE NAME STAYS PUT — the day sheet on this same page pins its date
            for the identical reason. At 850px minimum the table scrolls
            sideways on a phone, and unpinned the reader who scrolls to read
            Успешно is looking at a column of ten-digit sums with nobody's name
            on it. ONE column, which is the whole of a row's identity here:
            pinning half an identity is worse than pinning none of it.
          */
          stickyColumns={1}
        />
      </div>
    </ChartCard>
  )
}

type RopLine = { readonly kind: 'rop' | 'total'; readonly row: LogisticsRopDto }

/** Nothing in the ROP column can collide with it — a real name is never this. */
const TOTAL_ROW_KEY = '__jami__'

/**
 * A sum with its own order count beside it, on ONE line.
 *
 * The two facts are one reading — «224 149 999, 312 ta» — and splitting them
 * into four columns is what turned the first draft of the confirmation panel
 * into a table that scrolled sideways and carried the ROP name off the left
 * edge. They were STACKED until 2026-09-14, which cost every row a second
 * line and made the card the tallest thing on the screen after the sheet
 * itself; side by side they read the same and the table halves in height.
 *
 * FULL SOʻM, NOT COMPACT, and that is the same decision the six-column table
 * above records: this block exists to be reconciled against the client's own
 * ROP dashboards, and «224 mln» cannot be checked against «224 149 999»
 * without opening something. The count is what gives way instead — it is the
 * smaller fact, and at 10px beside the sum it is still the same sentence.
 */
function Sum({ amount, orders }: { amount: number; orders: number }) {
  return (
    <span className="tabular inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
      <span className="text-[12.5px]" style={{ color: 'var(--ink-primary)' }}>
        {formatFullUzs(amount)}
      </span>
      <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        {formatNumber(orders)} ta
      </span>
    </span>
  )
}

const ROP_COLUMNS: Column<RopLine>[] = [
  {
    key: 'rop',
    header: 'РОП',
    rowHeader: true,
    width: '160px',
    render: (line) =>
      line.kind === 'total' ? (
        /*
          `.eyebrow` is the house's total-row voice — the confirmation panel's
          ЖАМИ and MarketingTable's. The second line names the population,
          because one word over three different populations is how this project
          has contradicted itself on screen before.
        */
        <span className="inline-flex items-baseline gap-1.5">
          <span className="eyebrow" style={{ color: 'var(--ink-primary)' }}>
            ЖАМИ
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            barcha ROP
          </span>
        </span>
      ) : (
        <span className="truncate font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {line.row.rop}
        </span>
      ),
  },
  {
    key: 'ordered',
    header: 'ЗАКАЗ · FAKT 1',
    align: 'right',
    numeric: true,
    width: '200px',
    render: (line) => <Sum amount={line.row.ordered.amount} orders={line.row.orders} />,
  },
  {
    key: 'won',
    header: 'Успешно · FAKT 2',
    align: 'right',
    numeric: true,
    width: '200px',
    render: (line) => <Sum amount={line.row.won.amount} orders={line.row.wonOrders} />,
  },
  {
    key: 'coverage',
    header: 'Qamrov',
    align: 'right',
    /*
      150px, THE WIDTH THE OTHER TWO BREAKDOWN TABLES ON THIS PAGE USE.

      It was 280 while this card sat second on the page and had 1 560px to
      spend; at the foot of the sheet, beside «Pochtalar» and «Hududlar», a
      bar twice their length is the one thing that would stop the three
      reading as one family. «Kim orqada qolgan» is still the bar's length and
      fifteen teams still separate — Meter draws a percentage, not pixels.
    */
    width: '150px',
    /*
      NEUTRAL, NOT GRADED — the hero's own decision, and it has to be the same
      one. On a young window nothing has been delivered yet, so `tone="auto"`
      would paint every team critical-red for being read on the 2nd of the
      month: a date rendered as fifteen failures. The bars still compare, which
      is the whole job of this column.
    */
    render: (line) => <Meter value={line.row.coveragePercent} tone="neutral" />,
  },
]
