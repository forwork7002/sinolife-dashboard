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
 * «Sotuvchilar oyligi» — what the office owes each seller, in TWO SECTIONS.
 *
 * «Haftalik» and «Oylik», one tab each (2026-10-03, «ikkita boʻlim boʻladi.
 * haftalik alohida va oylik alohida»). They are the client's two Word files
 * on one screen: the weekly income — a rate that rises with the tier (5 / 8 /
 * 10 / 12%) plus a weekly oklad, and nothing under 15 mln — and the monthly
 * payroll — 8% from the first soʻm plus a fixed part per tier, for the whole
 * month or one half of it. Both pay on FAKT 2 and nothing else.
 *
 * THE WORKING, NOT THE ANSWER. Rate, fixed part and total are their own
 * columns, and the rate is printed on every row of a week, because there it
 * IS the tier and a seller checks their pay by redoing one multiplication.
 *
 * FAKT 2, NEVER FAKT 1. «sotuvchilar oyligi fakt 2 ga qarab olinadi» —
 * delivered money, read from the same query the sellers board reads, so a
 * seller who disputes their pay can be shown the orders behind it on a screen
 * they already read.
 *
 * THIS IS THE ONE SCREEN WHERE A NUMBER IS SOMEBODY'S MONEY: ONE hero figure —
 * the fund actually paid out — with the three inputs beside it and a rail
 * showing what the fund is made of; a search box, because the office looks up
 * one person by name out of a hundred; a bar in the fixed-part column for «who
 * is close to the next rung»; the rule itself, with how many people stand on
 * each rung; a per-ROP summary, because the money is handed out through the
 * team leaders; and a copy button, because the last step of a payroll is
 * pasting it to somebody.
 *
 * THE PERIOD IS A CALENDAR FACT, not the dashboard's window: a Monday-to-
 * Sunday week, or 1–15 / 16–end / the whole month. This screen carries its own
 * control and PageShell's period row is switched off. The window is resolved on
 * the SERVER (`payrollWeekPeriod`, `payrollPeriod`).
 *
 * NOBODY IS MISSING. Every seller with delivered money in the period is on the
 * table — in a week under 15 mln with a zero and the distance to 15 mln, in a
 * month with their 8% (the client: «ishdan ketmaydi… uni ham hisoblayver»).
 */
export function PayrollPage() {
  /*
    SCREEN STATE, NOT URL STATE. A payroll period is a question — «sentabrning
    birinchi yarmi», «shu hafta» — and it would belong in the URL if this page
    shared the dashboard's filter bar. It does not: `useDashboardFilters`
    carries a preset and a from/to these endpoints refuse to take.
  */
  const [view, setView] = useState<PayrollView>('week')
  const [week, setWeek] = useState(() => currentMonday())
  const [month, setMonth] = useState(() => currentMonth())
  const [half, setHalf] = useState<PayrollHalf>('full')
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: view === 'week' ? ['payroll', 'week', week] : ['payroll', 'month', month, half],
    queryFn: ({ signal }) =>
      view === 'week'
        ? apiGet<PayrollDto>('/payroll/weekly', { week }, signal)
        : apiGet<PayrollDto>('/payroll/sellers', { month, half }, signal),
  })

  const viewStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const errorMessage = (query.error as Error | null)?.message
  const retry = () => void query.refetch()

  const scheme: Scheme = view === 'week' ? 'week' : half === 'full' ? 'month' : 'half'
  const words = WORDS[scheme]
  const periodText =
    view === 'week' ? weekLabel(week) : `${monthLabel(month)} · ${halfLabel(half)}`

  /*
    A week's rows never sit under the month's headings, not even for a frame:
    the payload is used only when it answers the scheme on screen.
  */
  const data = query.data?.data.scheme === scheme ? query.data.data : undefined
  const totals = data?.totals
  /*
    Memoised because the groupings below depend on it: `data?.sellers ?? []`
    mints a fresh empty array on every render while the request is in flight.
  */
  const sellers = useMemo(() => data?.sellers ?? EMPTY_SELLERS, [data])

  /*
    THE SEARCH NARROWS THE TABLE AND NOTHING ELSE. The hero and the ЖАМИ row
    keep stating the whole period. Matching runs over the name AND the team,
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
  const columns = useMemo(() => payrollColumns(scheme), [scheme])
  const rules = RULES[scheme]
  const onRung = useMemo(() => rungCounts(rules, sellers), [rules, sellers])
  const paid = sellers.filter((row) => row.percent.amount > 0).length

  return (
    <PageShell
      title="Sotuvchilar oyligi"
      description="Haftalik daromad va oylik maosh — mijozning ikki jadvali boʻyicha. Ikkalasi ham faqat FAKT 2 (Успешно — yetkazib berilgan pul) dan hisoblanadi."
      period={false}
      accent="var(--series-3)"
      toolbar={
        <>
          <SegmentedControl<PayrollView>
            value={view}
            onChange={setView}
            ariaLabel="Boʻlim"
            options={[
              { value: 'week', label: 'Haftalik' },
              { value: 'month', label: 'Oylik' },
            ]}
          />
          {view === 'week' ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                onClick={() => setWeek(shiftWeek(week, -1))}
                aria-label="Oldingi hafta"
              >
                ‹
              </Button>
              <span
                className="tabular min-w-[150px] text-center text-xs font-semibold"
                style={{ color: 'var(--ink-primary)' }}
              >
                {weekLabel(week)}
              </span>
              <Button
                variant="ghost"
                onClick={() => setWeek(shiftWeek(week, 1))}
                aria-label="Keyingi hafta"
                /* Nothing has been delivered in a week that has not started. */
                disabled={week >= currentMonday()}
              >
                ›
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={() => setMonth(shiftMonth(month, -1))}
                  aria-label="Oldingi oy"
                >
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
          )}
          <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki ROP…" />
          <CopyButton rows={sellers} title={`${words.section} · ${periodText}`} words={words} />
        </>
      }
    >
      {/*
        ONE FIGURE, AND IT IS THE ONE THAT LEAVES THE SAFE. FAKT 2 is the
        measurement, the rate and the fixed part are the rule applied to it,
        and the fund is the only number anybody acts on. The rail under it is
        the same two parts as a proportion.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Davr yigʻmasi">
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            {words.section}
          </span>
          {' · '}
          {periodText}
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
              {words.fund}
            </p>

            {totals && totals.total.amount > 0 && (
              <div className="mt-4 max-w-[380px]">
                <div
                  className="flex h-[7px] w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--grid)' }}
                  role="img"
                  aria-label={`Foiz ${sharePercent(totals.percent.amount, totals.total.amount)}%, ${words.fixed.toLowerCase()} ${sharePercent(totals.fixed.amount, totals.total.amount)}%`}
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
                  {sharePercent(totals.fixed.amount, totals.total.amount)}% i —{' '}
                  {words.fixed.toLowerCase()}.
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
              term={`Foiz · ${words.rate}`}
              value={totals ? formatFullUzs(totals.percent.amount) : NO_VALUE}
              note={totals ? `${formatNumber(paid)} kishiga` : undefined}
              swatch="var(--series-3)"
            />
            <Figure
              term={words.fixed}
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
            today, so this line is the only thing between a mid-period figure
            and somebody paying it.
          */
          <p className="mt-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Davr hali tugamagan — raqamlar hozirgacha yetkazilgan buyurtmalar boʻyicha va davr
            oxirigacha oʻsadi.
          </p>
        )}
      </section>

      <ChartCard title="Hisob-kitob · har bir sotuvchi" hint={words.tableHint}>
        {search.trim() && (
          <p className="mb-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            «{search.trim()}» boʻyicha {formatNumber(visible.length)} ta sotuvchi. Yuqoridagi
            yigʻma butun davrniki.
          </p>
        )}
        <DataTable<PayrollLine>
          columns={columns}
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
          minWidth={920}
          /*
            EVERY SELLER AT ONCE. This is a payroll: a scrollbar inside the card
            hides people who are owed money.
          */
          maxHeight="none"
          stickyColumns={1}
        />
      </ChartCard>

      {/*
        THE RULE THE PAY COMES FROM, printed rather than trusted, with how many
        people stand on each rung this period — counted from the rows above, so
        the two cannot disagree. It switches with the control, because showing
        the month's rungs beside a week's pay is how somebody concludes the
        screen is broken. 760, because a worked example that wraps mid-sum is
        worse than no example.
      */}
      <ChartCard title={`Qoida · ${words.ruleTitle}`} hint={words.ruleHint}>
        <div className="max-w-[760px]">
          <DataTable<RuleRow>
            columns={RULE_COLUMNS}
            rows={rules}
            rowKey={(row) => row.label}
            status="ready"
            emptyTitle=""
            emptyBody=""
            minWidth={600}
            maxHeight="none"
          />
          <RungStrip rules={rules} counts={onRung} loading={viewStatus !== 'ready'} />
          <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {words.ruleNote}
          </p>
        </div>
      </ChartCard>

      {/*
        THE MONEY IS HANDED OUT THROUGH THE ROPs, so it is added up that way
        too — grouped in the browser from the rows the table above prints, so
        it cannot drift from it.
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
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// The two sections' words
// ---------------------------------------------------------------------------

type PayrollView = 'week' | 'month'
type Scheme = PayrollDto['scheme']

interface SchemeWords {
  readonly section: string
  readonly fund: string
  /** The rate, as the hero's figure names it. */
  readonly rate: string
  /** What the fixed part is called in the client's document. */
  readonly fixed: string
  readonly tableHint: string
  readonly ruleTitle: string
  readonly ruleHint: string
  readonly ruleNote: string
}

const WORDS: Record<Scheme, SchemeWords> = {
  week: {
    section: 'Haftalik daromad',
    fund: 'Hafta uchun jami toʻlov',
    rate: '5–12%',
    fixed: 'Haftalik oklad',
    tableHint:
      'Foiz bosqichga qarab butun FAKT 2 dan olinadi: 15 mln dan 5%, 25 mln dan 8% + 300 000, 35 mln dan 10% + 600 000, 50 mln dan 12% + 1 200 000. 15 mln gacha toʻlanmaydi.',
    ruleTitle: '1 hafta',
    ruleHint: 'Mijozning «Haftalik daromad formulasi». Hafta — dushanbadan yakshanbagacha.',
    ruleNote:
      'Oklad — oylik maosh emas, haftalik oklad. Koʻrsatkich oshgani sari foiz ham, oklad ham oshadi.',
  },
  month: {
    section: 'Oylik maosh',
    fund: 'Oy uchun jami toʻlov',
    rate: '8%',
    fixed: 'Fiksa',
    tableHint:
      '8% har doim butun FAKT 2 dan olinadi. Fiksa — sotuvchi bosib oʻtgan bosqichga qarab.',
    ruleTitle: '1 oylik',
    ruleHint: 'Mijozning «Oylik maosh tartibi», 1 oylik jadval.',
    ruleNote:
      'Hujjatda: 30 mln dan past — xodim ishdan ketadi, 30 mln da 8% faqat yangi xodimga 1 oy. Ekranda hamma uchun 8% hisoblanadi, chegara faqat maʼlumot uchun.',
  },
  half: {
    section: 'Oylik maosh',
    fund: '15 kun uchun jami toʻlov',
    rate: '8%',
    fixed: 'Fiksa',
    tableHint:
      '8% har doim butun FAKT 2 dan olinadi. Fiksa — sotuvchi bosib oʻtgan bosqichga qarab.',
    ruleTitle: '15 kunlik',
    ruleHint: 'Mijozning «Oylik maosh tartibi», 15 kunlik jadval.',
    ruleNote:
      'Hujjatda: 20 mln dan past — xodim ishdan ketadi, 15 mln da 8% faqat yangi xodimga 1 oy. Ekranda hamma uchun 8% hisoblanadi, chegara faqat maʼlumot uchun.',
  },
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
  title,
  words,
}: {
  rows: readonly PayrollSellerDto[]
  title: string
  words: SchemeWords
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  const copy = async () => {
    const header = ['Oʻrin', 'Sotuvchi', 'ROP', 'FAKT 2', 'Foiz %', 'Foiz', words.fixed, 'JAMI'].join(
      '\t',
    )
    const body = rows.map((row) =>
      [
        row.rank,
        row.fullName,
        row.rop ?? '',
        row.fakt2.amount,
        row.percentRate,
        row.percent.amount,
        row.fixed.amount,
        row.total.amount,
      ].join('\t'),
    )
    const text = [title, header, ...body].join('\n')

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
    percentRate: 0,
    percent: data.totals.percent,
    fixed: data.totals.fixed,
    total: data.totals.total,
    tierFloor: null,
    nextFloor: null,
    toNext: null,
  }
}

/**
 * The table's columns for one scheme. Only the headers move — a week's rate
 * is the tier and is printed per row, a month's is always 8%.
 */
function payrollColumns(scheme: Scheme): Column<PayrollLine>[] {
  const words = WORDS[scheme]
  return [
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
              THE RANK IS A MARK, NOT A SENTENCE. «1. Ism» run into the name
              reads as part of the name. The leader is filled; everybody else
              gets the same quiet chip, so the column still scans as a ranking
              rather than a podium.
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
      header: scheme === 'week' ? 'Foiz' : '8% — foiz',
      align: 'right',
      numeric: true,
      width: '170px',
      /*
        THE RATE SITS BESIDE THE MONEY in a week, because there it IS the tier:
        «8%» next to 2 792 000 is the whole working of that cell.
      */
      render: (line) => (
        <span className="tabular inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
          {line.kind === 'seller' && scheme === 'week' && (
            <span
              className="rounded-full px-1.5 py-px text-[10px] font-semibold"
              style={
                line.row.percentRate > 0
                  ? { background: 'var(--grid)', color: 'var(--ink-primary)' }
                  : { color: 'var(--ink-muted)' }
              }
            >
              {formatNumber(line.row.percentRate)}%
            </span>
          )}
          <span className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
            {line.kind === 'seller' && line.row.percent.amount === 0
              ? NO_VALUE
              : formatFullUzs(line.row.percent.amount)}
          </span>
        </span>
      ),
    },
    {
      key: 'fixed',
      header: `${words.fixed} · bosqich`,
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
}

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
      <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
        {formatFullUzs(row.total)}
      </span>
    ),
  },
]

// ---------------------------------------------------------------------------
// The rule, printed
// ---------------------------------------------------------------------------

interface RuleRow {
  readonly label: string
  /** The rung's floor in soʻm, 0 for "under every rung". Counts people onto it. */
  readonly floor: number
  readonly rate: string
  readonly fixed: string
  readonly example: string
}

/**
 * HAND-COPIED FROM THE DOMAIN, and that is a deliberate duplication.
 *
 * `domain/payroll/sellerPayroll` is the rule; this is a picture of it, in the
 * client's own words and units («24,9 mln»), not whatever a formatter makes of
 * minor units. The worked examples are the documents' own.
 */
const RULES: Record<Scheme, readonly RuleRow[]> = {
  week: [
    { label: '15 mln gacha', floor: 0, rate: '—', fixed: '—', example: 'toʻlanmaydi' },
    {
      label: '15 – 24,9 mln',
      floor: 15_000_000,
      rate: '5%',
      fixed: '—',
      example: '24,9 mln × 5% = 1 245 000',
    },
    {
      label: '25 – 34,9 mln',
      floor: 25_000_000,
      rate: '8%',
      fixed: '300 000',
      example: '34,9 mln × 8% + 300 000 = 3 092 000',
    },
    {
      label: '35 – 49,9 mln',
      floor: 35_000_000,
      rate: '10%',
      fixed: '600 000',
      example: '49,9 mln × 10% + 600 000 = 5 590 000',
    },
    {
      label: '50 mln +',
      floor: 50_000_000,
      rate: '12%',
      fixed: '1 200 000',
      example: '50 mln × 12% + 1 200 000 = 7 200 000',
    },
  ],
  month: [
    { label: '45 mln gacha', floor: 0, rate: '8%', fixed: '—', example: '30 mln × 8% = 2 400 000' },
    {
      label: '45 mln dan',
      floor: 45_000_000,
      rate: '8%',
      fixed: '500 000',
      example: '45 mln → 3 600 000 + 500 000 = 4 100 000',
    },
    {
      label: '60 mln dan',
      floor: 60_000_000,
      rate: '8%',
      fixed: '750 000',
      example: '60 mln → 4 800 000 + 750 000 = 5 550 000',
    },
    {
      label: '70 mln dan',
      floor: 70_000_000,
      rate: '8%',
      fixed: '1 000 000',
      example: '70 mln → 5 600 000 + 1 000 000 = 6 600 000',
    },
  ],
  half: [
    { label: '22,5 mln gacha', floor: 0, rate: '8%', fixed: '—', example: '15 mln × 8% = 1 200 000' },
    {
      label: '22,5 mln dan',
      floor: 22_500_000,
      rate: '8%',
      fixed: '500 000',
      example: '22,5 mln → 1 800 000 + 500 000 = 2 300 000',
    },
    {
      label: '30 mln dan',
      floor: 30_000_000,
      rate: '8%',
      fixed: '750 000',
      example: '30 mln → 2 400 000 + 750 000 = 3 150 000',
    },
    {
      label: '35 mln dan',
      floor: 35_000_000,
      rate: '8%',
      fixed: '1 000 000',
      example: '35 mln → 2 800 000 + 1 000 000 = 3 800 000',
    },
  ],
}

const RULE_COLUMNS: Column<RuleRow>[] = [
  { key: 'label', header: 'FAKT 2', rowHeader: true, width: '130px', render: (row) => row.label },
  {
    key: 'rate',
    header: 'Foiz',
    align: 'right',
    numeric: true,
    width: '64px',
    render: (row) => row.rate,
  },
  {
    key: 'fixed',
    header: 'Fiksa / oklad',
    align: 'right',
    numeric: true,
    width: '110px',
    render: (row) => row.fixed,
  },
  { key: 'example', header: 'Misol', render: (row) => row.example },
]

/**
 * How many sellers stand on each rung, read off the server's own `tierFloor`
 * — never re-decided here from FAKT 2, which would be a second copy of the
 * tier rule in the browser.
 */
function rungCounts(rules: readonly RuleRow[], sellers: readonly PayrollSellerDto[]): number[] {
  return rules.map(
    (rule) => sellers.filter((row) => (row.tierFloor?.amount ?? 0) === rule.floor).length,
  )
}

/** The sequential ramp, lightest first. Ordinal use starts no lighter than 250. */
const RUNG_SHADES = [
  'var(--seq-250)',
  'var(--seq-350)',
  'var(--seq-450)',
  'var(--seq-550)',
  'var(--seq-650)',
]

/**
 * The rungs as one bar: each segment's width is its share of the sellers.
 *
 * One sequential ramp, darker as the rung rises, so the strip reads as "how
 * far up the ladder the team stands" without a legend to decode. The top rung
 * always takes the darkest step, whatever the table's length.
 */
function RungStrip({
  rules,
  counts,
  loading,
}: {
  rules: readonly RuleRow[]
  counts: readonly number[]
  loading: boolean
}) {
  const total = counts.reduce((acc, n) => acc + n, 0)
  if (loading || total === 0) return null
  const shadeOf = (index: number) =>
    RUNG_SHADES[Math.min(RUNG_SHADES.length - 1, index + RUNG_SHADES.length - rules.length)]!

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        Shu davrda bosqichlar boʻyicha
      </p>
      <div
        className="mt-2 flex h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--grid)' }}
        role="img"
        aria-label={rules.map((rule, i) => `${rule.label}: ${counts[i]} kishi`).join(', ')}
      >
        {rules.map((rule, i) =>
          counts[i]! > 0 ? (
            <div
              key={rule.label}
              style={{ width: `${(counts[i]! / total) * 100}%`, background: shadeOf(i) }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {rules.map((rule, i) => (
          <li
            key={rule.label}
            className="flex items-center gap-1.5 text-[11px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: shadeOf(i) }}
            />
            {rule.label}
            <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {formatNumber(counts[i]!)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

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

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/**
 * This week's Monday, `YYYY-MM-DD`, as Tashkent names today — for the reason
 * `currentMonth` gives. Weekday arithmetic runs on a UTC date built from
 * Tashkent's calendar day, so the browser's own zone never enters it.
 */
function currentMonday(): string {
  // Parts, not `.format()`: the en-CA pattern has changed between ICU versions.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string, fallback: string) =>
    parts.find((p) => p.type === type)?.value ?? fallback
  const date = isoToUtc(`${part('year', '1970')}-${part('month', '01')}-${part('day', '01')}`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return utcToIso(date)
}

function shiftWeek(monday: string, by: number): string {
  const date = isoToUtc(monday)
  date.setUTCDate(date.getUTCDate() + by * 7)
  return utcToIso(date)
}

/** «28-sentabr – 4-oktabr 2026», the year once, at the end. */
function weekLabel(monday: string): string {
  const start = isoToUtc(monday)
  const end = isoToUtc(monday)
  end.setUTCDate(end.getUTCDate() + 6)
  const name = (date: Date) => MONTH_NAMES[date.getUTCMonth()]!.toLowerCase()
  return `${start.getUTCDate()}-${name(start)} – ${end.getUTCDate()}-${name(end)} ${end.getUTCFullYear()}`
}

function isoToUtc(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
}

function utcToIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}
