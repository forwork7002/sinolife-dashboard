'use client'

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SearchInput, SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import {
  type DeltaDto,
  type PayrollBranchDto,
  type PayrollDto,
  type PayrollSellerDto,
  type PayrollTeamDto,
  type PeriodDto,
  apiGet,
} from '@/lib/api'
import {
  NO_VALUE,
  formatDateShort,
  formatFullUzs,
  formatNumber,
} from '@/lib/format'

import { PayrollGridScreen, emptyBody } from './PayrollGrid'
import { PayrollSheet, ropFormula, sellerFormula } from './PayrollSheet'
import { NO_ROP, PayrollMovers, RopCompareChart } from './PayrollTeams'
import { PayrollFilters, usePayrollParams, usePayrollPicked, useRowPick } from './payrollFilters'

/**
 * «Sotuvchilar oyligi» — what the office owes each seller over the dashboard's
 * window, by one of THREE TABLES the window's length picks.
 *
 * They were three tabs — «Haftalik», «15 kunlik», «Oylik» (2026-10-03 /
 * 10-05) — until 2026-10-17, when the client asked for the window of every
 * other screen («huddi savdo dinamikasidek»): up to 7 days pays by the week's
 * table, up to 16 by the fortnight's, longer by the month's (`payrollSchemeOf`,
 * «Shu oy» counted as the whole month). They are the client's two Word files
 * on one screen: the weekly income — a rate that rises with the tier (5 / 8 /
 * 10 / 12%) plus a weekly oklad, and nothing under 15 mln — and the monthly
 * payroll — 8% from the first soʻm plus a fixed part per tier, for the whole
 * month or one half of it. Both pay on FAKT 2 and nothing else.
 *
 * THE WORKING, NOT THE ANSWER. Rate, fixed part and total are their own
 * columns, and the rate is printed on every row of a week, because there it
 * IS the tier and a seller checks their pay by redoing one multiplication.
 *
 * FAKT 2, NEVER FAKT 1. «sotuvchilar oyligi fakt 2 ga qarab olinadi» — and
 * since 2026-10-17 Savdo dinamikasi's FAKT 2 to the soʻm (the client:
 * «savdo dinamikasidagi to'g'ri malumot ekan»): the queue cohort, orders that
 * arrived in the window and are delivered now.
 *
 * THIS IS THE ONE SCREEN WHERE A NUMBER IS SOMEBODY'S MONEY: ONE hero figure —
 * the fund actually paid out — with the three inputs beside it and a rail
 * showing what the fund is made of; a search box, because the office looks up
 * one person by name out of a hundred; a bar in the fixed-part column for «who
 * is close to the next rung»; the rule itself, with how many people stand on
 * each rung; and a copy button, because the last step of a payroll is pasting
 * it to somebody.
 *
 * BY ROP, WITH GROWTH (2026-10-05, «ROP larga ajratilsin … kim qanchaga
 * oʻsganligi … grafiklar bilan»). The money is handed out through the team
 * leaders; every figure is set against the like period before
 * (`meta.comparisonPeriod`, the dashboard's `previousEquivalent`); a bar per
 * ROP and the five biggest movers each way sit under the sheet. See
 * `PayrollTeams`.
 *
 * ONE SHEET, «HUDDI RNP JADVALI KABI» (2026-10-20). The ROP cards became one
 * table in blocks — Toshkent · Navoiy · Baza · Zextra — each team with its
 * sellers, its ROP's row and its total, with «ROP otchet»'s Lid soni ·
 * Tranzaksiya · Konversiya · Buyurtma soni beside the pay (`PayrollSheet`).
 * БАЗА is paid by its own table and one person by a flat rate; the rule card
 * prints both.
 *
 * THE PERIOD IS THE DASHBOARD'S: PageShell's Bugun · Kecha · Shu oy · Sana,
 * in the URL, resolved on the server by `periodFrom` like every screen's.
 *
 * NOBODY IS MISSING. Every seller with delivered money in the period is on the
 * table — in a week under 15 mln with a zero and the distance to 15 mln, in a
 * month with their 8% (the client: «ishdan ketmaydi… uni ham hisoblayver»).
 */
/*
  TWO TABS, as «KPI rejalari» and «RNP jadvali» have (the client, 2026-10-23:
  «sotuvchilar oyligi boʻlimini ham … huddi shunday jadval usulida»).
  «Maosh jadvali» — the page as one sheet with a column per day — opens
  first; «Batafsil» keeps the page as it was: the hero, the sheet in its card,
  the growth charts and the rule. Both read the same window and the same
  payload; only the open tab draws.
*/
type Tab = 'sheet' | 'details'

export function PayrollPage() {
  const [tab, setTab] = useState<Tab>('sheet')
  const tabs = (
    <SegmentedControl<Tab>
      ariaLabel="Qaysi koʻrinish"
      value={tab}
      onChange={setTab}
      options={[
        { value: 'sheet', label: 'Maosh jadvali' },
        { value: 'details', label: 'Batafsil' },
      ]}
    />
  )
  return tab === 'sheet' ? <PayrollGridScreen tabs={tabs} /> : <PayrollDetails tabs={tabs} />
}

function PayrollDetails({ tabs }: { readonly tabs: ReactNode }) {
  /*
    THE DASHBOARD'S OWN WINDOW (2026-10-17, the client: «huddi savdo
    dinamikasidek»). The Haftalik / 15 kunlik / Oylik tabs went: PageShell
    draws Bugun · Kecha · Shu oy · Sana, the window rides the URL like every
    other screen's, and the server picks the table by its length
    (`payrollSchemeOf`). The window is sent, and since 2026-10-24 the
    toolbar's «Boʻlim» / «ROP» pick of teams — never a brand: a payroll is
    every team's, or the picked teams' whole (`payrollFilters`).
  */
  const { params } = usePayrollParams()
  const picked = usePayrollPicked()
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: ['payroll', params],
    queryFn: ({ signal }) => apiGet<PayrollDto>('/payroll/sellers', params, signal),
  })

  const viewStatus = statusOf(query)
  const errorMessage = (query.error as Error | null)?.message
  const retry = () => void query.refetch()

  /*
    NEVER A PREVIOUS WINDOW'S FIGURES UNDER THIS ONE'S HEADING.
    `placeholderData` keeps the last answer while a new window loads; here it
    reads as loading instead. The headings keep the last table meanwhile.
  */
  const data = query.isPlaceholderData ? undefined : query.data?.data
  const scheme: Scheme = query.data?.data.scheme ?? 'month'
  const words = WORDS[scheme]
  const period = data ? query.data?.meta.period : undefined
  const periodText = period ? windowText(period) : ''

  const heroStatus = viewStatus === 'ready' && !data ? 'loading' : viewStatus
  const totals = data?.totals
  const comparison = data ? query.data?.meta.comparisonPeriod : undefined
  const comparisonLabel = comparison ? windowText(comparison) : null
  /* A delta over an empty comparison window (a period not started) says nothing. */
  const compared = Boolean(comparison && comparison.start !== comparison.end)
  const pick = useRowPick(compared)
  /*
    Memoised because the groupings below depend on it: `data?.sellers ?? []`
    mints a fresh empty array on every render while the request is in flight.
  */
  const sellers = useMemo(() => data?.sellers ?? EMPTY_SELLERS, [data])

  const teams = data?.teams ?? EMPTY_TEAMS
  /*
    THE SEARCH NARROWS THE SHEET AND NOTHING ELSE. The hero keeps stating the
    whole period. Matching runs over the name AND the team, because «Sevinch»
    is how a floor manager asks for eleven people at once.
  */

  const rules = RULES[scheme]
  const bazaRules = BAZA_RULES[scheme]
  /* Each table counts its own people: a БАЗА seller is not on the standard ladder. */
  const onRung = useMemo(() => rungCounts(rules, sellers.filter((row) => row.table === 'standard')), [rules, sellers])
  const onBazaRung = useMemo(() => rungCounts(bazaRules, sellers.filter((row) => row.table === 'baza')), [bazaRules, sellers])
  /*
    ONE RATE IN THE HERO ONLY WHEN THERE IS ONE. БАЗА pays 8–15% with an oklad
    and a flat-rate seller their own, so «Foiz · 8%» over the company's sum
    would name a rate a fifth of the fund was not paid at.
  */
  const oneTable = sellers.every((row) => row.table === 'standard')
  const rateTerm = oneTable ? `Foiz · ${words.rate}` : 'Foiz'
  const fixedTerm = oneTable ? words.fixed : `${words.fixed} / oklad`
  const paid = sellers.filter((row) => row.percent.amount > 0).length

  return (
    <PageShell
      title="Sotuvchilar oyligi"
      description="FAKT 2 — Savdo dinamikasidagi bilan bir xil. Jadval davr uzunligiga qarab: 7 kungacha haftalik, 16 kungacha 15 kunlik, undan uzun — oylik."
      accent="var(--series-3)"
      periodMaxDays={PAYROLL_MAX_DAYS}
      actions={tabs}
      toolbar={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki ROP…" />
          <PayrollFilters choices={query.data?.data.choices} compared={compared} />
          <CopyButton
            rows={sellers}
            teams={teams}
            branches={data?.branches ?? EMPTY_BRANCHES}
            title={`${words.section} · ${periodText}`}
            words={words}
          />
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

        {/*
          LOADING, FAILURE AND A GENUINE NULL ARE THREE RENDERINGS. The hero
          printed «— soʻm» while the request was in flight AND after a 500, so
          a failed payroll read as a period with no pay — and the retry was
          three cards further down.
        */}
        {heroStatus === 'error' ? (
          <ErrorState message={errorMessage} onRetry={retry} />
        ) : (
          <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start">
            <div>
              {heroStatus === 'loading' ? (
                // Sized to the figure below, so the number never reflows the band.
                <div className="skeleton h-[clamp(21px,8px_+_3.6vw,40px)] w-2/3 max-w-[340px]" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ) : (
                <p
                  className="figure-hero figure-hero-sum figure-wrap"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {totals ? formatFullUzs(totals.total.amount) : NO_VALUE}
                  <span className="ml-1.5 text-[13px] font-normal tracking-normal" style={{ color: 'var(--ink-muted)' }}>
                    soʻm
                  </span>
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                {picked ? 'Tanlangan boʻlim / ROP uchun jami toʻlov' : 'Davr uchun jami toʻlov'}
                {data && compared && (
                  <>
                    <TrendIndicator delta={data.deltas.total} />
                    <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {comparisonLabel} bilan · oldin {formatFullUzs(data.previous.total.amount)} soʻm
                    </span>
                  </>
                )}
              </p>

              {data && data.ropTotals.total.amount > 0 && (
                <p className="tabular mt-1 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                  + ROP lar {formatFullUzs(data.ropTotals.total.amount)} ={' '}
                  <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {formatFullUzs(data.fund.amount)} soʻm
                  </span>{' '}
                  hammasi boʻlib
                </p>
              )}

              {totals && totals.total.amount > 0 && (
                <div className="mt-4 max-w-[380px]">
                  <div
                    className="flex h-[7px] w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--grid)' }}
                    role="img"
                    aria-label={`Foiz ${sharePercent(totals.percent.amount, totals.total.amount)}%, ${fixedTerm.toLowerCase()} ${sharePercent(totals.fixed.amount, totals.total.amount)}%`}
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
                    {fixedTerm.toLowerCase()}.
                  </p>
                </div>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-2 lg:pt-1 xl:grid-cols-4">
              <Figure
                term="FAKT 2 · Успешно"
                loading={heroStatus === 'loading'}
                value={totals ? formatFullUzs(totals.fakt2.amount) : NO_VALUE}
                note={totals ? `${formatNumber(totals.sellers)} ta sotuvchi` : undefined}
                delta={compared ? data?.deltas.fakt2 : undefined}
              />
              <Figure
                term={rateTerm}
                loading={heroStatus === 'loading'}
                value={totals ? formatFullUzs(totals.percent.amount) : NO_VALUE}
                note={totals ? `${formatNumber(paid)} kishiga` : undefined}
                swatch="var(--series-3)"
                delta={compared ? data?.deltas.percent : undefined}
              />
              <Figure
                term={fixedTerm}
                loading={heroStatus === 'loading'}
                value={totals ? formatFullUzs(totals.fixed.amount) : NO_VALUE}
                note={totals ? `${formatNumber(sellers.filter((s) => s.fixed.amount > 0).length)} kishiga` : undefined}
                swatch="var(--series-4)"
                delta={compared ? data?.deltas.fixed : undefined}
              />
              <Figure
                term="ROP lar maoshi"
                loading={heroStatus === 'loading'}
                value={data ? formatFullUzs(data.ropTotals.total.amount) : NO_VALUE}
                note={data ? `${formatNumber(data.ropTotals.rops)} ta ROP` : undefined}
              />
            </dl>
          </div>
        )}

        {data?.open && (
          /*
            A period that has not finished is a partial payroll, and it looks
            exactly like a final one; this line is the only thing between a
            mid-period figure and somebody paying it.
          */
          <p className="mt-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Davr hali tugamagan — raqamlar oʻsib boradi: bu davrda kelgan buyurtmalar yetkazilgani
            sari FAKT 2 ga qoʻshiladi.
          </p>
        )}
      </section>

      {/*
        THE SHEET — the whole payroll as one table, «huddi RNP jadvali kabi»
        (2026-10-20): Toshkent · Navoiy · Baza · Zextra, each ROP team with its
        sellers, its ROP's row and its total. Loading, error and an empty
        period keep their own states in the same card.
      */}
      <ChartCard title="Hisob-kitob · boʻlimlar boʻyicha" hint={words.tableHint}>
        {heroStatus === 'loading' ? (
          <LoadingSkeleton rows={8} />
        ) : heroStatus === 'error' ? (
          <ErrorState message={errorMessage} onRetry={retry} />
        ) : data && sellers.length > 0 ? (
          <PayrollSheet data={data} search={search} compared={compared} pick={pick} />
        ) : (
          <EmptyState title="Maʼlumot yoʻq" body={emptyBody(picked)} />
        )}
      </ChartCard>

      {/*
        THE TWO PICTURES OF «WHO GREW», under the sheet they summarise: per ROP,
        then per person. Drawn only once there is a payload — a bar chart of
        nothing is not a loading state.
      */}
      {data && teams.length > 0 && (
        /*
          STACKED, NOT SIDE BY SIDE: the movers are two lists of names, and at
          half a laptop's width each list had ~200px — every name truncated.
        */
        <div className="flex flex-col gap-4">
          <ChartCard
            title="ROP lar taqqoslash"
            hint={
              compared
                ? 'Har bir ROP jamoasi: shu davr va oʻtgan davr, bitta shkalada.'
                : 'Har bir ROP jamoasining shu davrdagi toʻlovi.'
            }
          >
            <RopCompareChart teams={teams} comparisonLabel={compared ? comparisonLabel : null} />
          </ChartCard>
          {compared && (
            <ChartCard
              title="Kim qanchaga oʻsdi"
              hint={`FAKT 2 ning oʻzgarishi, soʻmda — ${comparisonLabel} bilan solishtirilgan.`}
            >
              <PayrollMovers sellers={sellers} gone={data.previous.gone} />
            </ChartCard>
          )}
        </div>
      )}

      {/*
        THE RULE THE PAY COMES FROM, printed rather than trusted, with how many
        people stand on each rung this period — counted from the rows above, so
        the two cannot disagree. It switches with the control, because showing
        the month's rungs beside a week's pay is how somebody concludes the
        screen is broken. 760, because a worked example that wraps mid-sum is
        worse than no example.
      */}
      <ChartCard title={`Qoida · ${words.ruleTitle}`} hint={words.ruleHint}>
        <div className="flex max-w-[760px] flex-col gap-6">
          <section aria-label="Oddiy sotuvchilar">
            <h3 className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              Oddiy jadval — Toshkent, Navoiy, Zextra va ROP siz sotuvchilar
            </h3>
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
            <RungStrip rules={rules} counts={onRung} loading={heroStatus !== 'ready'} />
            <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {words.ruleNote}
            </p>
          </section>
          <section aria-label="Baza">
            <h3 className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              Baza — Farrux va Malika jamoalari
            </h3>
            <DataTable<RuleRow>
              columns={RULE_COLUMNS}
              rows={bazaRules}
              rowKey={(row) => row.label}
              status="ready"
              emptyTitle=""
              emptyBody=""
              minWidth={600}
              maxHeight="none"
            />
            <RungStrip rules={bazaRules} counts={onBazaRung} loading={heroStatus !== 'ready'} />
            <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Foiz butun FAKT 2 dan olinadi; oklad har bosqichda, eng pastkisida ham beriladi. 15 kunlik va haftalikda
              chegaralar ham, oklad ham oylikdan boʻlib olingan.
            </p>
          </section>
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {data && data.flatRates.length > 0 && (
              <>
                <span className="font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                  Shaxsiy foiz:
                </span>{' '}
                {data.flatRates.map((rate) => `${rate.fullName} — ${formatNumber(rate.percentRate)}%`).join(', ')} — oʻzi
                sotgan FAKT 2 dan, jadvalsiz, fiksa ham oklad ham yoʻq.{' '}
              </>
            )}
            ROP lar: jamoa FAKT 2 dan 2%
            {scheme === 'month' ? ' + 2 000 000 oklad.' : ' (2 000 000 oklad faqat oylik jadvalda).'}
          </p>
        </div>
      </ChartCard>

    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// The two sections' words
// ---------------------------------------------------------------------------

/** Which of the client's three tables the window's length picked. */
type Scheme = PayrollDto['scheme']

interface SchemeWords {
  readonly section: string
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
    rate: '5–12%',
    fixed: 'Haftalik oklad',
    tableHint:
      'Foiz bosqichga qarab butun FAKT 2 dan olinadi: 15 mln dan 5%, 25 mln dan 8% + 300 000, 35 mln dan 10% + 600 000, 50 mln dan 12% + 1 200 000. 15 mln gacha toʻlanmaydi. Baza: 8 / 10 / 12 / 15% + 125 000 oklad (5 / 6,25 / 8,75 mln dan).',
    ruleTitle: '1 hafta',
    ruleHint: 'Mijozning «Haftalik daromad formulasi». Hafta — dushanbadan yakshanbagacha.',
    ruleNote:
      'Oklad — oylik maosh emas, haftalik oklad. Koʻrsatkich oshgani sari foiz ham, oklad ham oshadi.',
  },
  month: {
    section: 'Oylik maosh',
    rate: '8%',
    fixed: 'Fiksa',
    tableHint:
      '8% har doim butun FAKT 2 dan olinadi. Fiksa — sotuvchi bosib oʻtgan bosqichga qarab. Baza: 8 / 10 / 12 / 15% + 500 000 oklad (20 / 25 / 35 mln dan).',
    ruleTitle: '1 oylik',
    ruleHint: 'Mijozning «Oylik maosh tartibi», 1 oylik jadval.',
    ruleNote:
      'Hujjatda: 30 mln dan past — xodim ishdan ketadi, 30 mln da 8% faqat yangi xodimga 1 oy. Ekranda hamma uchun 8% hisoblanadi, chegara faqat maʼlumot uchun.',
  },
  half: {
    section: '15 kunlik maosh',
    rate: '8%',
    fixed: 'Fiksa',
    tableHint:
      '8% har doim butun FAKT 2 dan olinadi. Fiksa — sotuvchi bosib oʻtgan bosqichga qarab. Baza: 8 / 10 / 12 / 15% + 250 000 oklad (10 / 12,5 / 17,5 mln dan).',
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
  delta,
  loading = false,
}: {
  term: string
  value: string
  /** While the period is being read: a placeholder, never the em dash a real null prints. */
  loading?: boolean
  note?: string
  /** Ties the figure to its segment in the rail. Only the two that have one. */
  swatch?: string
  /** Against the comparison window. Absent when there is none. */
  delta?: DeltaDto
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
      {loading ? (
        <dd className="skeleton mt-1 h-[18px] w-24" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </dd>
      ) : (
        <dd
          className="tabular mt-0.5 text-[15px] leading-tight font-semibold"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {value}
        </dd>
      )}
      {delta && (
        <dd className="mt-1">
          <TrendIndicator delta={delta} />
        </dd>
      )}
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
  teams,
  branches,
  title,
  words,
}: {
  rows: readonly PayrollSellerDto[]
  teams: readonly PayrollTeamDto[]
  branches: readonly PayrollBranchDto[]
  title: string
  words: SchemeWords
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  const copy = async () => {
    const header = [
      'Boʻlim',
      'ROP',
      'Oʻrin',
      'Sotuvchi',
      'Lid soni',
      'Tranzaksiya',
      'Konversiya %',
      'Buyurtma soni',
      'FAKT 2',
      'Foiz %',
      'Foiz',
      words.fixed,
      'Hisob',
      'JAMI',
      'Oʻtgan davr FAKT 2',
      'Oʻtgan davr JAMI',
    ].join('\t')
    /*
      IN THE SHEET'S ORDER — block by block, ROP by ROP, the company rank
      inside each — because the money is handed out team by team and the
      sheet is read that way.
    */
    const labelOf = new Map(branches.map((branch) => [branch.branch, branch.label]))
    const order = new Map(branches.flatMap((branch) => branch.teams).map((rop, index) => [rop, index]))
    const grouped = [...rows].sort(
      (a, b) => (order.get(a.rop) ?? teams.length) - (order.get(b.rop) ?? teams.length) || a.rank - b.rank,
    )
    const body = grouped.map((row) =>
      [
        tsvCell(labelOf.get(row.branch) ?? ''),
        tsvCell(row.rop ?? NO_ROP),
        row.rank,
        tsvCell(row.fullName),
        row.leads ?? '',
        row.fakt1Orders,
        row.conversion === null ? '' : row.conversion.toFixed(1),
        row.fakt2Orders,
        row.fakt2.amount,
        row.percentRate,
        row.percent.amount,
        row.fixed.amount,
        tsvCell(sellerFormula(row)),
        row.total.amount,
        row.previous?.fakt2.amount ?? '',
        row.previous?.total.amount ?? '',
      ].join('\t'),
    )
    const rops = teams
      .filter((team) => team.ropPay)
      .sort((a, b) => (order.get(a.rop) ?? teams.length) - (order.get(b.rop) ?? teams.length))
    const ropBlock = rops.length
      ? [
          '',
          ['Boʻlim', 'ROP', 'Jamoa', 'Jamoa FAKT 2', '2%', 'Oklad', 'Hisob', 'JAMI'].join('\t'),
          ...rops.map((team) =>
            [
              tsvCell(labelOf.get(team.branch) ?? ''),
              tsvCell(team.ropPay!.head ?? team.rop ?? NO_ROP),
              tsvCell(team.rop ?? NO_ROP),
              team.ropPay!.basis.amount,
              team.ropPay!.percent.amount,
              team.ropPay!.fixed.amount,
              tsvCell(ropFormula(team)),
              team.ropPay!.total.amount,
            ].join('\t'),
          ),
        ]
      : []
    const text = [tsvCell(title), header, ...body, ...ropBlock].join('\n')

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

/**
 * A text cell a spreadsheet will take as TEXT. Names come from Bitrix24, and a
 * name that opens with = + - @ is run as a formula by Excel and Sheets on
 * paste; a tab or a line break inside one shifts every column after it. A
 * leading apostrophe is the spreadsheets' own «this is text» mark.
 */
function tsvCell(value: string): string {
  const flat = value.replace(/[\t\r\n]+/g, ' ')
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** One identity for "no rows yet", so a pending render is not a new array. */
const EMPTY_SELLERS: readonly PayrollSellerDto[] = []
const EMPTY_TEAMS: readonly PayrollTeamDto[] = []
const EMPTY_BRANCHES: readonly PayrollBranchDto[] = []

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

/**
 * БАЗА's tables, the same picture of `BAZA_*_TIERS` (2026-10-20): 10 / 12 /
 * 15% from 20 / 25 / 35 mln, 8% below, an oklad on every rung; 15 days and a
 * week divide the month, oklad included.
 */
const BAZA_RULES: Record<Scheme, readonly RuleRow[]> = {
  month: [
    { label: '20 mln gacha', floor: 0, rate: '8%', fixed: '500 000', example: '15 mln × 8% + 500 000 = 1 700 000' },
    { label: '20 mln dan', floor: 20_000_000, rate: '10%', fixed: '500 000', example: '20 mln × 10% + 500 000 = 2 500 000' },
    { label: '25 mln dan', floor: 25_000_000, rate: '12%', fixed: '500 000', example: '28 mln × 12% + 500 000 = 3 860 000' },
    { label: '35 mln dan', floor: 35_000_000, rate: '15%', fixed: '500 000', example: '35 mln × 15% + 500 000 = 5 750 000' },
  ],
  half: [
    { label: '10 mln gacha', floor: 0, rate: '8%', fixed: '250 000', example: '8 mln × 8% + 250 000 = 890 000' },
    { label: '10 mln dan', floor: 10_000_000, rate: '10%', fixed: '250 000', example: '10 mln × 10% + 250 000 = 1 250 000' },
    { label: '12,5 mln dan', floor: 12_500_000, rate: '12%', fixed: '250 000', example: '12,5 mln × 12% + 250 000 = 1 750 000' },
    { label: '17,5 mln dan', floor: 17_500_000, rate: '15%', fixed: '250 000', example: '17,5 mln × 15% + 250 000 = 2 875 000' },
  ],
  week: [
    { label: '5 mln gacha', floor: 0, rate: '8%', fixed: '125 000', example: '4 mln × 8% + 125 000 = 445 000' },
    { label: '5 mln dan', floor: 5_000_000, rate: '10%', fixed: '125 000', example: '5 mln × 10% + 125 000 = 625 000' },
    { label: '6,25 mln dan', floor: 6_250_000, rate: '12%', fixed: '125 000', example: '6,25 mln × 12% + 125 000 = 875 000' },
    { label: '8,75 mln dan', floor: 8_750_000, rate: '15%', fixed: '125 000', example: '8,75 mln × 15% + 125 000 = 1 437 500' },
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
// The window in words
// ---------------------------------------------------------------------------

/**
 * The longest window the server answers — `PAYROLL_MAX_DAYS` in queryParams,
 * restated: the client may not import server code.
 */
const PAYROLL_MAX_DAYS = 31

/**
 * The window in words — «01.10 – 17.10», one day once. The end is exclusive,
 * so the last day named is the one before it.
 */
function windowText(window: PeriodDto): string {
  const lastDay = new Date(new Date(window.end).getTime() - 1).toISOString()
  const first = formatDateShort(window.start)
  const last = formatDateShort(lastDay)
  return first === last ? first : `${first} – ${last}`
}
