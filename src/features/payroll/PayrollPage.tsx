'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SearchInput, SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/features/shared/PageShell'
import { type PayrollDto, type PayrollHalf, type PayrollSellerDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatFullUzs, formatNumber } from '@/lib/format'

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
 * THIS IS THE ONE SCREEN WHERE A NUMBER IS SOMEBODY'S MONEY, and the second
 * pass on 2026-09-14 («maksimal chiroyliroq va yoqimliroq aniqroq qulayroq»)
 * spent its whole budget on that: ONE hero figure — the fund actually paid out
 * — with the three inputs beside it and a rail showing what the fund is made
 * of; a search box, because the office looks up one person by name out of a
 * hundred; a bar in the fiksa column, because «who is close to the next rung»
 * was a repeated grey sentence nobody could read down a column; a per-ROP
 * summary, because the money is handed out through the team leaders; and a
 * copy button, because the last step of a payroll is pasting it to somebody.
 * Everything else stays quiet. The only ornament on the page is the leader's
 * badge, and it earns its place: +25$ depends on it.
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
 * fixed part, and the fiksa column says which rung they are short of.
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
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: ['payroll', month, half],
    queryFn: ({ signal }) => apiGet<PayrollDto>('/payroll/sellers', { month, half }, signal),
  })

  const viewStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const errorMessage = (query.error as Error | null)?.message
  const retry = () => void query.refetch()

  const data = query.data?.data
  const totals = data?.totals
  /*
    Memoised because the two groupings below depend on it: `data?.sellers ?? []`
    mints a fresh empty array on every render while the request is in flight,
    which would rebuild both of them for nothing.
  */
  const sellers = useMemo(() => data?.sellers ?? EMPTY_SELLERS, [data])

  /*
    THE SEARCH NARROWS THE TABLE AND NOTHING ELSE.

    The hero and the ЖАМИ row keep stating the whole period — they are the
    payroll, and a fund that changed while somebody typed a name would be a
    different claim every keystroke. Matching runs over the name AND the team,
    because «Sevinch» is how a floor manager asks for eleven people at once.
  */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return sellers
    return sellers.filter(
      (row) =>
        row.fullName.toLowerCase().includes(needle) ||
        (row.rop ?? '').toLowerCase().includes(needle),
    )
  }, [sellers, search])

  const lines: PayrollLine[] = [
    ...visible.map((row): PayrollLine => ({ kind: 'seller', row })),
    // The footer states the PERIOD, so it is dropped while a search is on
    // rather than left standing over a subset it does not describe.
    ...(data && !search.trim() ? [{ kind: 'total' as const, row: totalLine(data) }] : []),
  ]

  const teams = useMemo(() => teamRows(sellers), [sellers])

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
          <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki ROP…" />
          <CopyButton rows={sellers} month={month} half={half} />
        </>
      }
    >
      {/*
        ONE FIGURE, AND IT IS THE ONE THAT LEAVES THE SAFE.

        The three inputs sit beside it rather than beneath it as equals: FAKT 2
        is the measurement, 8% and fiksa are the rule applied to it, and the
        fund is the only number anybody acts on. The rail under it is the same
        two numbers as a proportion — a payroll that is nine-tenths commission
        is a different business from one that is half fixed pay, and that is
        readable at a glance and in no other form on this page.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Davr yigʻmasi">
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {monthLabel(month)} · {halfLabel(half)}
          {data?.open && ' · davr davom etmoqda'}
        </p>

        <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start">
          <div>
            <p
              className="tabular text-[34px] leading-none font-semibold"
              style={{ color: 'var(--ink-primary)' }}
            >
              {totals ? formatFullUzs(totals.total.amount) : NO_VALUE}
              <span className="ml-1.5 text-[13px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                soʻm
              </span>
            </p>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
              Davr uchun jami toʻlov
              {totals && totals.bonusUsd > 0 && (
                <>
                  <span style={{ color: 'var(--ink-muted)' }}> · ustiga </span>
                  <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {formatNumber(totals.bonusUsd)}$
                  </span>
                  <span style={{ color: 'var(--ink-muted)' }}> bonus</span>
                </>
              )}
            </p>

            {totals && totals.total.amount > 0 && (
              <div className="mt-4 max-w-[380px]">
                <div
                  className="flex h-[7px] w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--grid)' }}
                  role="img"
                  aria-label={`Foiz ${sharePercent(totals.percent.amount, totals.total.amount)}%, fiksa ${sharePercent(totals.fixed.amount, totals.total.amount)}%`}
                >
                  <div
                    style={{
                      width: `${sharePercent(totals.percent.amount, totals.total.amount)}%`,
                      background: 'var(--series-3)',
                    }}
                  />
                  <div
                    style={{
                      width: `${sharePercent(totals.fixed.amount, totals.total.amount)}%`,
                      background: 'var(--series-4)',
                    }}
                  />
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Toʻlovning {sharePercent(totals.percent.amount, totals.total.amount)}% i — foiz,
                  {' '}
                  {sharePercent(totals.fixed.amount, totals.total.amount)}% i — fiksa.
                </p>
              </div>
            )}
          </div>

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:pt-1">
            <Figure
              term="FAKT 2 · Успешно"
              value={totals ? formatFullUzs(totals.fakt2.amount) : NO_VALUE}
              note={totals ? `${formatNumber(totals.sellers)} ta sotuvchi` : undefined}
            />
            <Figure
              term="Foiz · 8%"
              value={totals ? formatFullUzs(totals.percent.amount) : NO_VALUE}
              swatch="var(--series-3)"
            />
            <Figure
              term="Fiksa"
              value={totals ? formatFullUzs(totals.fixed.amount) : NO_VALUE}
              note={totals ? `${formatNumber(sellers.filter((s) => s.fixed.amount > 0).length)} kishiga` : undefined}
              swatch="var(--series-4)"
            />
          </dl>
        </div>

        {data?.open && (
          /*
            A period that has not finished is a partial payroll, and it looks
            exactly like a final one. The window is deliberately not clipped to
            today (see `payrollPeriod`), so this line is the only thing between
            a mid-month figure and somebody paying it.
          */
          <p className="mt-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Davr hali tugamagan — raqamlar hozirgacha yetkazilgan buyurtmalar boʻyicha va davr
            oxirigacha oʻsadi.
          </p>
        )}
      </section>

      <ChartCard
        title="Hisob-kitob · har bir sotuvchi"
        hint="8% har doim aniq FAKT 2 dan olinadi. Fiksa — sotuvchi bosib oʻtgan bosqichga qarab. $ bonus: 40 mln dan 50$, 50 mln dan 100$, 1-oʻrin uchun +25$."
      >
        {search.trim() && (
          <p className="mb-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            «{search.trim()}» boʻyicha {formatNumber(visible.length)} ta sotuvchi. Yuqoridagi
            yigʻma butun davrniki.
          </p>
        )}
        <DataTable<PayrollLine>
          columns={COLUMNS}
          rows={lines}
          rowKey={(line) => (line.kind === 'total' ? TOTAL_ROW_KEY : line.row.employeeId)}
          status={viewStatus}
          errorMessage={errorMessage}
          onRetry={retry}
          emptyTitle={search.trim() ? 'Topilmadi' : 'Maʼlumot yoʻq'}
          emptyBody={
            search.trim()
              ? 'Bu ism yoki ROP boʻyicha sotuvchi yoʻq. Boshqa yozib koʻring.'
              : 'Bu davrda yetkazib berilgan buyurtma topilmadi.'
          }
          minWidth={1020}
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
        THE MONEY IS HANDED OUT THROUGH THE ROPs, so it is added up that way
        too. Grouped in the browser from rows already on the payload — a second
        endpoint for a sum of fifteen numbers would be a second definition of
        the same payroll, and this one cannot drift from the table above it
        because it IS the table above it.
      */}
      <ChartCard
        title="ROP lar boʻyicha"
        hint="Har bir jamoaning davr uchun toʻlovi. Yuqoridagi jadvalning ROP boʻyicha yigʻmasi."
      >
        <div className="max-w-[680px]">
          <DataTable<TeamRow>
            columns={TEAM_COLUMNS}
            rows={teams}
            rowKey={(row) => row.rop}
            status={viewStatus}
            errorMessage={errorMessage}
            onRetry={retry}
            emptyTitle="ROP topilmadi"
            emptyBody="Bu davrda yetkazib berilgan buyurtma topilmadi."
            minWidth={620}
            maxHeight="none"
          />
        </div>
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
        title={`Qoida · ${halfLabel(half).toLowerCase()}`}
        hint="Mijozning oʻz jadvali. Bosqich — FAKT 2 shu chegaradan oshganda fiksa shu boʻladi."
      >
        {/* 720, because «45 mln → 3 600 000 + 500 000 = 4 100 000» wrapped onto
            two lines at 560 and a worked example that breaks mid-sum is worse
            than no example. */}
        <div className="max-w-[720px]">
          <DataTable<RuleRow>
            columns={RULE_COLUMNS}
            rows={half === 'full' ? MONTH_RULES : HALF_RULES}
            rowKey={(row) => row.label}
            status="ready"
            emptyTitle=""
            emptyBody=""
            minWidth={560}
            maxHeight="none"
          />
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          30 mln dan past savdo ham hisoblanadi — 8% toʻlanadi, fiksa berilmaydi. Oʻrin shu
          davrdagi FAKT 2 boʻyicha, butun kompaniya ichida.
        </p>
      </ChartCard>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// The hero's supporting figures
// ---------------------------------------------------------------------------

function Figure({
  term,
  value,
  note,
  swatch,
}: {
  term: string
  value: string
  note?: string
  /** Ties the figure to its segment in the rail. Only the two that have one. */
  swatch?: string
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {swatch && (
          <span
            aria-hidden
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ background: swatch }}
          />
        )}
        {term}
      </dt>
      <dd
        className="tabular mt-0.5 text-[15px] leading-tight font-semibold"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {value}
      </dd>
      {note && (
        <dd className="mt-0.5 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
          {note}
        </dd>
      )}
    </div>
  )
}

function sharePercent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

// ---------------------------------------------------------------------------
// Copying the payroll out
// ---------------------------------------------------------------------------

/**
 * THE LAST STEP OF A PAYROLL IS SENDING IT TO SOMEBODY.
 *
 * Tab-separated, because that is what pastes into Excel, Google Sheets and a
 * Telegram message without a library and without a download the browser then
 * has to be trusted with. Full soʻm, no thousands separators inside the
 * numbers — a spreadsheet reads «4 480 000» as text and «4480000» as money.
 */
function CopyButton({
  rows,
  month,
  half,
}: {
  rows: readonly PayrollSellerDto[]
  month: string
  half: PayrollHalf
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  const copy = async () => {
    const header = ['Oʻrin', 'Sotuvchi', 'ROP', 'FAKT 2', '8%', 'Fiksa', 'Bonus $', 'JAMI'].join('\t')
    const body = rows.map((row) =>
      [
        row.rank,
        row.fullName,
        row.rop ?? '',
        row.fakt2.amount,
        row.percent.amount,
        row.fixed.amount,
        row.bonusUsd,
        row.total.amount,
      ].join('\t'),
    )
    const text = [`${monthLabel(month)} · ${halfLabel(half)}`, header, ...body].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      // A browser that refuses the clipboard says so rather than pretending.
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2500)
  }

  return (
    <Button variant="ghost" onClick={copy} disabled={rows.length === 0}>
      {state === 'done' ? 'Nusxa olindi' : state === 'failed' ? 'Nusxa olinmadi' : 'Nusxa olish'}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** One identity for "no rows yet", so a pending render is not a new array. */
const EMPTY_SELLERS: readonly PayrollSellerDto[] = []

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
    width: '250px',
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
        <span className="flex items-center gap-2">
          {/*
            THE RANK IS A MARK, NOT A SENTENCE. It was «1. Ism» run into the
            name, which reads as part of the name at a glance and gives the
            leader nothing. The leader is filled because the 25$ on their row
            depends on being first; everybody else gets the same quiet chip, so
            the column still scans as a ranking rather than a podium.
          */}
          <span
            aria-hidden
            className="tabular inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
            style={
              line.row.rank === 1
                ? { background: 'var(--series-4)', color: '#fff' }
                : { background: 'var(--grid)', color: 'var(--ink-muted)' }
            }
          >
            {line.row.rank}
          </span>
          <span className="block min-w-0">
            <span className="block truncate font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {line.row.fullName}
            </span>
            <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
              {line.row.rop ?? 'ROP yoʻq'}
            </span>
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
    header: '8% — foiz',
    align: 'right',
    numeric: true,
    width: '150px',
    render: (line) => (
      <span className="tabular text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
        {formatFullUzs(line.row.percent.amount)}
      </span>
    ),
  },
  {
    key: 'fixed',
    header: 'Fiksa · bosqich',
    align: 'right',
    numeric: true,
    width: '200px',
    /*
      THE TIER IS DRAWN, NOT DESCRIBED.

      This column used to print «45 mln gacha 4 450 000» under every zero — a
      true sentence, ninety times, that nobody could read down the column. The
      bar answers the question the sentence was for («kim yaqin qoldi») at a
      glance, and the figure it is short by stays beside it in compact soʻm.
      A cleared top tier gets no bar, because there is nothing left to reach.
    */
    render: (line) =>
      line.kind === 'total' ? (
        <span className="tabular text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {formatFullUzs(line.row.fixed.amount)}
        </span>
      ) : (
        <span className="block">
          <span className="tabular block text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
            {line.row.fixed.amount > 0 ? formatFullUzs(line.row.fixed.amount) : NO_VALUE}
          </span>
          {line.row.nextFloor && line.row.toNext ? (
            /*
              A RAIL WITH NO READOUT, which is why it is not `Meter`.

              Meter prints its own percentage beside the bar, and «36.0%» is
              not a fact anybody acts on here — it competed with the money in
              the same cell and made the column the busiest thing on the page.
              What the reader wants is the GAP, in soʻm, and the bar is there
              to be scanned rather than read. The screen-reader label carries
              the same sentence the caption does.
            */
            <span className="mt-1 flex items-center justify-end gap-2">
              <span
                className="h-1.5 w-[56px] shrink-0 overflow-hidden rounded-full"
                style={{ background: 'var(--track)' }}
                role="img"
                aria-label={`${formatCompactUzs(line.row.nextFloor.amount)} gacha ${formatCompactUzs(line.row.toNext.amount)}`}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${tierProgress(line.row)}%`,
                    background: 'var(--seq-450)',
                    transition: 'width var(--duration-enter) var(--ease-out)',
                  }}
                />
              </span>
              <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                {formatCompactUzs(line.row.nextFloor.amount)} gacha{' '}
                {formatCompactUzs(line.row.toNext.amount)}
              </span>
            </span>
          ) : (
            <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
              eng yuqori bosqich
            </span>
          )}
        </span>
      ),
  },
  {
    key: 'bonus',
    header: 'Bonus',
    align: 'right',
    numeric: true,
    width: '120px',
    render: (line) =>
      /*
        THE TOTAL'S DOLLARS ARE A SUM, NOT A BADGE. A pill on the ЖАМИ row
        reads as one person's award; the fund's own line states it plainly,
        the way the two soʻm columns beside it do.
      */
      line.kind === 'total' ? (
        <span className="tabular text-[12.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          {line.row.bonusUsd > 0 ? `${formatNumber(line.row.bonusUsd)}$` : NO_VALUE}
        </span>
      ) : line.row.bonusUsd > 0 ? (
        <span className="inline-flex flex-col items-end gap-1">
          <span
            className="tabular inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: line.row.firstPlaceUsd > 0 ? 'var(--series-4)' : 'var(--grid)',
              color: line.row.firstPlaceUsd > 0 ? '#fff' : 'var(--ink-primary)',
            }}
          >
            {formatNumber(line.row.bonusUsd)}$
          </span>
          {line.row.firstPlaceUsd > 0 && (
            <span className="text-[10px] leading-none" style={{ color: 'var(--ink-muted)' }}>
              1-oʻrin +{line.row.firstPlaceUsd}$
            </span>
          )}
        </span>
      ) : (
        <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {NO_VALUE}
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

/**
 * How far along the current rung a seller stands, 0–100.
 *
 * Measured from the tier they have already cleared, not from zero: from zero
 * every bar in the column would be nine-tenths full and they would all look
 * alike, which is the opposite of what the column is for. Null before the
 * first rung is not possible here — the caller only draws this when there IS
 * a next floor.
 */
function tierProgress(row: PayrollSellerDto): number {
  const floor = row.tierFloor?.amount ?? 0
  const next = row.nextFloor?.amount ?? 0
  if (next <= floor) return 0
  return Math.max(0, Math.min(100, ((row.fakt2.amount - floor) / (next - floor)) * 100))
}

// ---------------------------------------------------------------------------
// Per ROP
// ---------------------------------------------------------------------------

interface TeamRow {
  readonly rop: string
  readonly sellers: number
  readonly fakt2: number
  readonly total: number
  readonly bonusUsd: number
}

/** Grouped in the browser, from the rows the table above prints. */
function teamRows(rows: readonly PayrollSellerDto[]): TeamRow[] {
  const byRop = new Map<string, TeamRow>()
  for (const row of rows) {
    const key = row.rop ?? 'ROP yoʻq'
    const held = byRop.get(key)
    byRop.set(key, {
      rop: key,
      sellers: (held?.sellers ?? 0) + 1,
      fakt2: (held?.fakt2 ?? 0) + row.fakt2.amount,
      total: (held?.total ?? 0) + row.total.amount,
      bonusUsd: (held?.bonusUsd ?? 0) + row.bonusUsd,
    })
  }
  return [...byRop.values()].sort((a, b) => b.total - a.total)
}

const TEAM_COLUMNS: Column<TeamRow>[] = [
  {
    key: 'rop',
    header: 'ROP',
    rowHeader: true,
    width: '160px',
    render: (row) => (
      <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
        {row.rop}
      </span>
    ),
  },
  {
    key: 'sellers',
    header: 'Sotuvchi',
    align: 'right',
    numeric: true,
    width: '110px',
    render: (row) => formatNumber(row.sellers),
  },
  {
    key: 'fakt2',
    header: 'FAKT 2',
    align: 'right',
    numeric: true,
    width: '170px',
    render: (row) => formatFullUzs(row.fakt2),
  },
  {
    key: 'total',
    header: 'Toʻlov',
    align: 'right',
    numeric: true,
    width: '180px',
    render: (row) => (
      <span className="tabular inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
        <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {formatFullUzs(row.total)}
        </span>
        {row.bonusUsd > 0 && (
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            +{formatNumber(row.bonusUsd)}$
          </span>
        )}
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

function halfLabel(half: PayrollHalf): string {
  return half === 'first' ? '1–15-kunlar' : half === 'second' ? '16-kundan oy oxirigacha' : 'Butun oy'
}
