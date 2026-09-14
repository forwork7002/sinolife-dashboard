'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/features/shared/PageShell'
import { type PayrollDto, type PayrollHalf, type PayrollSellerDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatFullUzs, formatNumber } from '@/lib/format'

/**
 * «Sotuvchilar oyligi» — what the office owes each seller for a payroll period.
 *
 * THE CLIENT'S OWN SCHEME, AND IT IS STATED ON THE SCREEN. Written out by them
 * on 2026-09-14: 8% of FAKT 2 from the first soʻm, a fixed part decided by
 * which tier that figure clears, and a dollar incentive on top. Every one of
 * those three is its own column here, because the instruction asked for the
 * working and not the answer — «shunchaki fiksa boʻldi deb koʻrsat va bonusni
 * ham koʻrsat, shuncha bonus bilan shuncha summa kelib chiqdi deb». A single
 * «JAMI» column would be the same number and an unverifiable one.
 *
 * FAKT 2, NEVER FAKT 1. «sotuvchilar oyligi fakt 2 ga qarab olinadi» —
 * delivered money. It is the same figure the sellers board calls Успешно and
 * the logistics screen sums into its hero, read from the same query, so a
 * seller who disputes their pay can be shown the orders behind it on a screen
 * they already read.
 *
 * THE PERIOD IS A CALENDAR FACT, not the dashboard's window. The office pays
 * 1–15, 16–end, or the whole month, so this screen carries its own control and
 * PageShell's period row is switched off. The window is resolved on the SERVER
 * from the month and the half; see `payrollPeriod`.
 *
 * NOBODY IS MISSING AND NOBODY IS ZEROED. The client's sheet carries a line
 * saying a seller under 30 mln leaves the company; they corrected it in the
 * same conversation — «ishdan ketmaydi… uni ham hisoblayver». So every seller
 * with delivered money in the period is on this table, with their 8% and no
 * fixed part, and the tier column says which rung they are short of.
 */
export function PayrollPage() {
  /*
    SCREEN STATE, NOT URL STATE. A payroll period is a question — «sentabrning
    birinchi yarmi» — and it would belong in the URL if this page shared the
    dashboard's filter bar. It does not: `useDashboardFilters` carries a preset
    and a from/to this endpoint refuses to take, and adding two more keys to
    that hook would make every screen in the product re-render for a control
    only this one has.
  */
  const [month, setMonth] = useState(() => currentMonth())
  const [half, setHalf] = useState<PayrollHalf>('full')

  const query = useQuery({
    queryKey: ['payroll', month, half],
    queryFn: ({ signal }) =>
      apiGet<PayrollDto>('/payroll/sellers', { month, half }, signal),
  })

  const viewStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const errorMessage = (query.error as Error | null)?.message
  const retry = () => void query.refetch()

  const data = query.data?.data
  const totals = data?.totals

  const lines: PayrollLine[] = [
    ...(data?.sellers ?? []).map((row): PayrollLine => ({ kind: 'seller', row })),
    ...(totals && data
      ? [{ kind: 'total' as const, row: totalLine(data) }]
      : []),
  ]

  return (
    <PageShell
      title="Sotuvchilar oyligi"
      description="Har bir sotuvchining davr uchun oyligi: FAKT 2 dan 8% + bosqich fiksasi + dollar bonusi. Hisob faqat FAKT 2 (Успешно — yetkazib berilgan pul) boʻyicha yuritiladi."
      period={false}
      accent="var(--series-3)"
      toolbar={
        <>
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Oldingi oy">
              ‹
            </Button>
            <span
              className="tabular min-w-[120px] text-center text-xs font-semibold"
              style={{ color: 'var(--ink-primary)' }}
            >
              {monthLabel(month)}
            </span>
            <Button
              variant="ghost"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Keyingi oy"
              /* Nothing has been delivered in a month that has not started. */
              disabled={month >= currentMonth()}
            >
              ›
            </Button>
          </div>
          <SegmentedControl<PayrollHalf>
            value={half}
            onChange={setHalf}
            ariaLabel="Toʻlov davri"
            options={[
              { value: 'full', label: 'Butun oy' },
              { value: 'first', label: '1–15' },
              { value: 'second', label: '16–oxiri' },
            ]}
          />
        </>
      }
    >
      {/*
        THE FUND, AND WHAT IT IS MADE OF.

        Four figures rather than one: the office pays the last of them, and the
        three in front are the only way to check it without a calculator. The
        dollar total stands apart because it is a different currency and this
        application has no rate — see `PayrollSellerDto.bonusUsd`.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Davr yigʻmasi">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="FAKT 2 · davr boʻyicha" value={totals ? formatFullUzs(totals.fakt2.amount) : NO_VALUE} note={totals ? `${formatNumber(totals.sellers)} ta sotuvchi` : undefined} />
          <Figure label="8% — foiz" value={totals ? formatFullUzs(totals.percent.amount) : NO_VALUE} />
          <Figure label="Fiksa" value={totals ? formatFullUzs(totals.fixed.amount) : NO_VALUE} />
          <Figure
            label="JAMI toʻlov"
            value={totals ? formatFullUzs(totals.total.amount) : NO_VALUE}
            note={totals ? `+ ${formatNumber(totals.bonusUsd)}$ bonus` : undefined}
            strong
          />
        </div>

        {data?.open && (
          /*
            A period that has not finished is a partial payroll, and it looks
            exactly like a final one. The window is deliberately not clipped to
            today (see `payrollPeriod`), so this line is the only thing between
            a mid-month figure and somebody paying it.
          */
          <p className="mt-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Bu davr hali tugamagan — raqamlar hozirgacha yetkazilgan buyurtmalar boʻyicha va davr
            oxirigacha oʻsadi.
          </p>
        )}
      </section>

      <ChartCard
        title="Hisob-kitob · har bir sotuvchi"
        hint="8% har doim aniq FAKT 2 dan olinadi. Fiksa — sotuvchi bosib oʻtgan bosqichga qarab. $ bonus: 40 mln dan 50$, 50 mln dan 100$, 1-oʻrin uchun +25$."
      >
        <DataTable<PayrollLine>
          columns={COLUMNS}
          rows={lines}
          rowKey={(line) => (line.kind === 'total' ? TOTAL_ROW_KEY : line.row.employeeId)}
          status={viewStatus}
          errorMessage={errorMessage}
          onRetry={retry}
          emptyTitle="Maʼlumot yoʻq"
          emptyBody="Bu davrda yetkazib berilgan buyurtma topilmadi."
          minWidth={980}
          /*
            EVERY SELLER AT ONCE. This is a payroll: a scrollbar inside the card
            hides people who are owed money, and the reader's next act is
            usually to read the whole list top to bottom against another one.
          */
          maxHeight="none"
          stickyColumns={1}
        />
      </ChartCard>

      {/*
        THE TABLE THE PAY COMES FROM, printed rather than trusted.

        Same argument as the logistics screen's audit block: everything above
        is checkable only if the rule itself is on the page. It switches with
        the control, because the two schemes are the client's two tables and
        showing the month's rungs beside a fortnight's pay is how somebody
        concludes the screen is broken.
      */}
      <ChartCard
        title="Qoida · shu davr uchun"
        hint="Mijozning oʻz jadvali. Bosqich — FAKT 2 shu chegaradan oshganda fiksa shu boʻladi."
      >
        <div className="max-w-[560px]">
          <DataTable<RuleRow>
            columns={RULE_COLUMNS}
            rows={half === 'full' ? MONTH_RULES : HALF_RULES}
            rowKey={(row) => row.label}
            status={viewStatus === 'loading' ? 'ready' : viewStatus}
            emptyTitle=""
            emptyBody=""
            minWidth={420}
            maxHeight="none"
          />
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          30 mln dan past savdo ham hisoblanadi — 8% toʻlanadi, fiksa berilmaydi. Oʻrin shu davrdagi
          FAKT 2 boʻyicha, butun kompaniya ichida.
        </p>
      </ChartCard>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// The figures at the top
// ---------------------------------------------------------------------------

function Figure({
  label,
  value,
  note,
  strong = false,
}: {
  label: string
  value: string
  note?: string
  strong?: boolean
}) {
  return (
    <div>
      <p className="eyebrow" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </p>
      <p
        className={`tabular mt-1 ${strong ? 'text-[22px]' : 'text-[18px]'} leading-tight font-semibold`}
        style={{ color: strong ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
      >
        {value}
        <span className="ml-1 text-[11px] font-normal" style={{ color: 'var(--ink-muted)' }}>
          soʻm
        </span>
      </p>
      {note && (
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {note}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

type PayrollLine = { readonly kind: 'seller' | 'total'; readonly row: PayrollSellerDto }

/** Nothing in the employee id can collide with it. */
const TOTAL_ROW_KEY = '__jami__'

/**
 * The footer, built from the SERVER's own totals rather than summed here.
 *
 * The same rule every table in this product keeps: a footer computed in the
 * browser is a second definition of the payroll fund, and the two would agree
 * until a row was filtered or rounded differently.
 */
function totalLine(data: PayrollDto): PayrollSellerDto {
  return {
    rank: 0,
    employeeId: TOTAL_ROW_KEY,
    fullName: 'ЖАМИ',
    rop: null,
    fakt2: data.totals.fakt2,
    fakt2Orders: 0,
    percent: data.totals.percent,
    fixed: data.totals.fixed,
    total: data.totals.total,
    tierFloor: null,
    nextFloor: null,
    toNext: null,
    tierUsd: 0,
    firstPlaceUsd: 0,
    bonusUsd: data.totals.bonusUsd,
  }
}

const COLUMNS: Column<PayrollLine>[] = [
  {
    key: 'seller',
    header: 'Sotuvchi',
    rowHeader: true,
    width: '230px',
    render: (line) =>
      line.kind === 'total' ? (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="eyebrow" style={{ color: 'var(--ink-primary)' }}>
            ЖАМИ
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            barcha sotuvchi
          </span>
        </span>
      ) : (
        <span className="block">
          <span className="block truncate font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {line.row.rank}. {line.row.fullName}
          </span>
          <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
            {line.row.rop ?? 'ROP yoʻq'}
          </span>
        </span>
      ),
  },
  {
    key: 'fakt2',
    header: 'FAKT 2 · Успешно',
    align: 'right',
    numeric: true,
    width: '190px',
    render: (line) => (
      <span className="tabular inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
        <span className="text-[12.5px]" style={{ color: 'var(--ink-primary)' }}>
          {formatFullUzs(line.row.fakt2.amount)}
        </span>
        {line.kind === 'seller' && (
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            {formatNumber(line.row.fakt2Orders)} ta
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'percent',
    header: '8%',
    align: 'right',
    numeric: true,
    width: '160px',
    render: (line) => (
      <span className="tabular text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
        {formatFullUzs(line.row.percent.amount)}
      </span>
    ),
  },
  {
    key: 'fixed',
    header: 'Fiksa',
    align: 'right',
    numeric: true,
    width: '170px',
    /*
      THE TIER IS NAMED BESIDE THE MONEY, and an empty fixed part says what it
      is short of. A column of «0» with no explanation is the one thing that
      brings a seller to the office; «45 mln gacha 6.9 mln» is the same fact
      as a target.
    */
    render: (line) =>
      line.kind === 'total' ? (
        <span className="tabular text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {formatFullUzs(line.row.fixed.amount)}
        </span>
      ) : (
        <span className="block">
          <span className="tabular block text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
            {formatFullUzs(line.row.fixed.amount)}
          </span>
          <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
            {line.row.toNext && line.row.nextFloor
              ? `${formatFullUzs(line.row.nextFloor.amount / 1_000_000)} mln gacha ${formatFullUzs(line.row.toNext.amount)}`
              : 'eng yuqori bosqich'}
          </span>
        </span>
      ),
  },
  {
    key: 'bonus',
    header: 'Bonus',
    align: 'right',
    numeric: true,
    width: '110px',
    render: (line) => (
      <span className="block">
        <span className="tabular block text-[12.5px]" style={{ color: 'var(--ink-primary)' }}>
          {line.row.bonusUsd > 0 ? `${formatNumber(line.row.bonusUsd)}$` : NO_VALUE}
        </span>
        {line.kind === 'seller' && line.row.firstPlaceUsd > 0 && (
          <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
            1-oʻrin +{line.row.firstPlaceUsd}$
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'total',
    header: 'JAMI',
    align: 'right',
    numeric: true,
    width: '190px',
    render: (line) => (
      <span className="tabular text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
        {formatFullUzs(line.row.total.amount)}
      </span>
    ),
  },
]

// ---------------------------------------------------------------------------
// The rule, printed
// ---------------------------------------------------------------------------

interface RuleRow {
  readonly label: string
  readonly fixed: string
  readonly example: string
}

/**
 * HAND-COPIED FROM THE DOMAIN, and that is a deliberate duplication.
 *
 * `domain/payroll/sellerPayroll` is the rule; this is a picture of it, in the
 * client's own words and units. Deriving these strings from the constants
 * would mean shipping the tier table to the browser to render four rows, and
 * the numbers here have to read as the client wrote them («45 mln»), not as
 * whatever a formatter makes of 4 500 000 000 minor units.
 */
const MONTH_RULES: readonly RuleRow[] = [
  { label: '45 mln gacha', fixed: '—', example: 'faqat 8%' },
  { label: '45 mln dan', fixed: '500 000', example: '45 mln → 3 600 000 + 500 000 = 4 100 000' },
  { label: '60 mln dan', fixed: '750 000', example: '60 mln → 4 800 000 + 750 000 = 5 550 000' },
  { label: '70 mln dan', fixed: '1 000 000', example: '70 mln → 5 600 000 + 1 000 000 = 6 600 000' },
]

const HALF_RULES: readonly RuleRow[] = [
  { label: '22,5 mln gacha', fixed: '—', example: 'faqat 8%' },
  { label: '22,5 mln dan', fixed: '500 000', example: '22,5 mln → 1 800 000 + 500 000 = 2 300 000' },
  { label: '30 mln dan', fixed: '750 000', example: '30 mln → 2 400 000 + 750 000 = 3 150 000' },
  { label: '35 mln dan', fixed: '1 000 000', example: '35 mln → 2 800 000 + 1 000 000 = 3 800 000' },
]

const RULE_COLUMNS: Column<RuleRow>[] = [
  { key: 'label', header: 'FAKT 2', rowHeader: true, width: '140px', render: (row) => row.label },
  {
    key: 'fixed',
    header: 'Fiksa',
    align: 'right',
    numeric: true,
    width: '120px',
    render: (row) => row.fixed,
  },
  { key: 'example', header: 'Misol', render: (row) => row.example },
]

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
]

/**
 * The current month, as the SERVER's timezone would name it.
 *
 * Asia/Tashkent rather than the browser's zone: a laptop left on UTC would
 * open the payroll on the previous month for five hours every night, and the
 * window this string selects is built in Tashkent at the other end.
 */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  return `${year}-${month}`
}

function shiftMonth(yearMonth: string, by: number): string {
  const [year, month] = yearMonth.split('-').map(Number)
  const index = (year ?? 1970) * 12 + (month ?? 1) - 1 + by
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number)
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`
}
