'use client'

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, memo, useCallback, useMemo, useRef, useState } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SearchInput } from '@/components/ui/Controls'
import { ChevronGlyph } from '@/components/ui/Icons'
import { Tooltip } from '@/components/ui/Tooltip'
import { muted } from '@/features/reklama/reklamaUi'
import { dayMonthYear } from '@/features/rnp/rnpDerive'
import { rnpNumber, rnpPercent, rnpUzs } from '@/features/rnp/rnpFigures'
import { scrollToToday } from '@/features/rnp/RnpSheetTable'
import { useDragScroll } from '@/features/rnp/useDragScroll'
import { PageShell } from '@/features/shared/PageShell'
import {
  DayHead,
  RULE,
  RULE_STRONG,
  SUMMARY_CELL,
  SUMMARY_HEAD,
  VRULE,
  crosshairHandlers,
  dayCellStyle,
  downloadCsv,
  inkOf,
  layers,
  markScrolledX,
  mix,
  usePinnedColumns,
} from '@/features/shared/sheetGrid'
import { type MoneyDto, type PayrollDto, type PayrollSellerDto, type PayrollTeamDto, type PeriodDto, apiGet } from '@/lib/api'
import { formatDateShort } from '@/lib/format'

import { BRANCH_HUE, type Block, Growth, RatePill, layout, nobodyText, ropFormula, sellerFormula, tierProgress } from './PayrollSheet'
import { NO_ROP } from './PayrollTeams'
import { PayrollFilters, type RowPick, shownTotal, usePayrollParams, usePayrollPicked, useRowPick } from './payrollFilters'

/** Mirrors `PayrollDaysDto` in `src/server/services/payrollService.ts` — nothing checks the mirror. */
export interface PayrollDaysDto {
  readonly days: readonly string[]
  readonly today: string
  readonly sellers: Readonly<Record<string, readonly number[]>>
  readonly rops: Readonly<Record<string, readonly number[]>>
}

/** The longest window the server answers — `PAYROLL_MAX_DAYS` in queryParams, restated. */
const PAYROLL_MAX_DAYS = 31
const STYLE_ID = 'pay-sheet-x'

const SCHEME_NAME: Record<PayrollDto['scheme'], string> = {
  week: 'haftalik jadval',
  half: '15 kunlik jadval',
  month: 'oylik jadval',
}

/**
 * «Maosh jadvali» — «Sotuvchilar oyligi» as ONE sheet in «KPI jadvali»'s
 * frame (the client, 2026-10-23: «sotuvchilar oyligi boʻlimini ham visualini
 * huddi shunday jadval usulida eng qulay versiyasida»): the page is the grid,
 * the header frozen on top, the name and JAMI frozen on the left, and after
 * the pay's working — Hisob, FAKT 2, Foiz, Fiksa, Oʻsish, the «ROP otchet»
 * counts — a column per day of the window with that day's FAKT 2.
 *
 * NOTHING HERE DECIDES PAY. Every row, team, block and total is
 * `/payroll/sellers`' — the «Batafsil» tab's very payload — and the day
 * columns are FAKT 2 only (`/payroll/days`): a seller's days add up to the
 * FAKT 2 beside their name, a ROP's to their 2% basis. Pay is not split by
 * day; a tier is reached over the period.
 *
 * THE WINDOW IS THE DASHBOARD'S, as on «Batafsil»: Bugun · Kecha · Shu oy ·
 * Sana, the table picked by its length. Blocks fold; a block's heading
 * sticks under the header while its rows scroll; the column under the
 * pointer lights up; «Excel» downloads the sheet as a CSV.
 *
 * THE TOP PANEL FILTERS (2026-10-24): «Boʻlim» · «ROP» pick teams on the
 * server, «Bosqich» · «Oʻsish» pick people here — see `payrollFilters`.
 */
export function PayrollGridScreen({ tabs }: { readonly tabs: ReactNode }) {
  const { params, window: windowParams } = usePayrollParams()
  const picked = usePayrollPicked()
  const [search, setSearch] = useState('')
  const scopeRef = useRef<HTMLDivElement>(null)

  const query = useQuery({
    queryKey: ['payroll', params],
    queryFn: ({ signal }) => apiGet<PayrollDto>('/payroll/sellers', params, signal),
  })
  const daysQuery = useQuery({
    queryKey: ['payroll-days', windowParams],
    queryFn: ({ signal }) => apiGet<PayrollDaysDto>('/payroll/days', windowParams, signal),
  })
  // Never a previous window's figures under this one's heading — «Batafsil»'s rule.
  const data = query.isPlaceholderData ? undefined : query.data?.data
  const days = daysQuery.isPlaceholderData ? undefined : daysQuery.data?.data
  const status = statusOf(query)
  const period = data ? query.data?.meta.period : undefined
  const comparison = data ? query.data?.meta.comparisonPeriod : undefined
  const compared = Boolean(comparison && comparison.start !== comparison.end)
  const pick = useRowPick(compared)
  const needle = search.trim().toLowerCase()
  /* What «Bosqich» / «Oʻsish» or the search leave drawn — counted beside the toolbar, since the sums leave the sheet. */
  const shown = useMemo(
    () => (data && (pick !== null || needle !== '') ? shownTotal(layout(data, needle, pick).flatMap((b) => b.teams.flatMap((t) => t.rows))) : null),
    [data, pick, needle],
  )

  return (
    <PageShell
      title="Sotuvchilar oyligi"
      description="FAKT 2 — Savdo dinamikasidagi bilan bir xil · kunlar — buyurtma Tasdiqlashga tushgan kun (Toshkent), oʻsha kungi buyurtmalardan yetkazilgani"
      accent="var(--series-3)"
      meta={query.data?.meta}
      periodMaxDays={PAYROLL_MAX_DAYS}
      fill
      actions={tabs}
      toolbar={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki ROP…" />
          <PayrollFilters choices={query.data?.data.choices} compared={compared} />
          {data && period && <Facts data={data} period={period} days={days} picked={picked} shown={shown} onToday={() => {
            const box = scopeRef.current?.querySelector<HTMLElement>('[data-rnp-grid]')
            if (box) scrollToToday(box)
          }} />}
          {data && (
            <Button
              variant="secondary"
              size="sm"
              className="h-11 sm:h-8"
              aria-label="Jadvalni Excel ochadigan CSV fayl qilib yuklab olish"
              onClick={() => downloadCsv(`maosh-jadvali-${period ? windowSlug(period) : 'davr'}.csv`, payrollCsv(data, days ?? null, compared))}
            >
              Excel
            </Button>
          )}
        </>
      }
    >
      <div ref={scopeRef} className="flex h-full min-h-0 flex-col">
        {status === 'error' && !data ? (
          <Card className="p-5">
            <ErrorState message={(query.error as Error | null)?.message} onRetry={() => void query.refetch()} />
          </Card>
        ) : !data ? (
          <Card className="p-5">
            <LoadingSkeleton rows={10} />
          </Card>
        ) : data.sellers.length === 0 ? (
          <Card className="p-5">
            <EmptyState title="Maʼlumot yoʻq" body={emptyBody(picked)} />
          </Card>
        ) : (
          <Card as="div" className="min-h-[320px] min-w-0 flex-1 overflow-hidden p-0 max-sm:min-h-[calc(100dvh-5rem)]">
            <PayrollGrid data={data} days={days ?? null} search={search} compared={compared} pick={pick} picked={picked} />
          </Card>
        )}
      </div>
    </PageShell>
  )
}

/** The empty sheet's line — a pick that leaves nobody is not a period with no deliveries. */
export function emptyBody(picked: boolean): string {
  return picked
    ? 'Tanlangan boʻlim / ROP boʻyicha bu davrda yetkazilgan buyurtma yoʻq.'
    : 'Bu davrda kelgan buyurtmalardan hali yetkazilgani yoʻq.'
}

/**
 * The window's verdict beside its controls: which table, what it pays, and
 * today. With «Boʻlim» / «ROP» on, the sums are the picked teams' — the
 * server's — and say so; with a row filter, what is drawn is counted too.
 */
function Facts({
  data,
  period,
  days,
  picked,
  shown,
  onToday,
}: {
  data: PayrollDto
  period: PeriodDto
  days: PayrollDaysDto | undefined
  picked: boolean
  shown: { readonly people: number; readonly total: number } | null
  onToday: () => void
}) {
  return (
    <dl className="flex flex-wrap items-center gap-2 text-xs">
      <Fact term={SCHEME_NAME[data.scheme]}>{windowText(period)}{data.open ? ' · davom etmoqda' : ''}</Fact>
      <Fact term={picked ? 'Tanlangan sotuvchilar' : 'Sotuvchilar'}>{rnpUzs(data.totals.total.amount)}</Fact>
      {data.ropTotals.total.amount > 0 && <Fact term={picked ? 'Tanlangan ROP lar' : 'ROP lar'}>{rnpUzs(data.ropTotals.total.amount)}</Fact>}
      <Fact term={picked ? 'Tanlanganlar hammasi' : 'Hammasi'}>{rnpUzs(data.fund.amount)} soʻm</Fact>
      {shown && (
        <Fact term="Koʻrsatilgan">
          {rnpNumber(shown.people)} kishi · {rnpUzs(shown.total)}
        </Fact>
      )}
      {days && days.days.includes(days.today) && (
        <div>
          <dt className="sr-only">Bugun</dt>
          <dd>
            <button type="button" onClick={onToday} title="Bugungi kunga oʻtish" className={`focusable cursor-pointer ${FACT_CHIP}`} style={FACT_STYLE}>
              <span style={muted}>Bugun:</span>
              <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {dayMonthYear(days.today)}
              </span>
            </button>
          </dd>
        </div>
      )}
    </dl>
  )
}

const FACT_CHIP = 'flex h-8 items-center gap-1.5 rounded-[var(--radius-panel-sm)] border px-2.5'
const FACT_STYLE = { borderColor: 'var(--border)', background: 'var(--surface-raised)' } as const

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={FACT_CHIP} style={FACT_STYLE}>
      <dt style={muted}>{term}:</dt>
      <dd className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
        {children}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

type Col = 'formula' | 'fakt2' | 'percent' | 'fixed' | 'growth' | 'fakt2Orders' | 'fakt1Orders' | 'leads' | 'conversion'

/** The columns after the pinned name and JAMI: the working first, then «ROP otchet»'s counts. */
const COLS: readonly { key: Col; header: string; hint: string; min: string }[] = [
  { key: 'formula', header: 'Hisob', hint: 'JAMI qanday chiqqani: FAKT 2 × foiz + fiksa', min: 'min-w-[228px]' },
  { key: 'fakt2', header: 'FAKT 2 · Успешно', hint: 'Yetkazilgan pul — maosh shundan hisoblanadi', min: 'min-w-[128px]' },
  { key: 'percent', header: 'Foiz', hint: 'Bosqich foizi butun FAKT 2 dan', min: 'min-w-[132px]' },
  { key: 'fixed', header: 'Fiksa / oklad', hint: 'Bosqichga qarab; ostida — keyingi bosqichgacha qancha qoldi', min: 'min-w-[150px]' },
  { key: 'growth', header: 'Oʻsish', hint: 'FAKT 2 — oʻtgan shunday davr bilan', min: 'min-w-[104px]' },
  { key: 'fakt2Orders', header: 'Buyurtma soni', hint: 'Транз-2 — yetkazilgan (FAKT 2) buyurtmalar', min: 'min-w-[88px]' },
  { key: 'fakt1Orders', header: 'Tranzaksiya', hint: 'Транз-1 — FAKT 1 buyurtmalar', min: 'min-w-[88px]' },
  { key: 'leads', header: 'Lid soni', hint: '«ROP otchet»dagi kabi: shu kunlarda tarqatilgan lidlar', min: 'min-w-[72px]' },
  { key: 'conversion', header: 'Konversiya', hint: 'Tranzaksiya ÷ Lid soni', min: 'min-w-[86px]' },
]

const NAME_WIDTH = 'w-[176px] min-w-[176px] max-w-[176px] sm:w-[268px] sm:min-w-[268px] sm:max-w-[268px]'
const TOTAL_PIN = 'tcol-sticky rnp-pin rnp-edge left-[var(--sheet-left-1)]'
const STICK = { top: 'var(--sheet-head-h)' } as const

/** What a figure row shows in each column; `undefined` is «not this row's kind of figure». */
interface Figures {
  readonly total: MoneyDto
  readonly formula: string
  readonly fakt2: MoneyDto | null
  readonly rate?: number
  readonly percent: MoneyDto
  readonly fixed: MoneyDto
  readonly growth: ReactNode
  readonly fakt2Orders: number | undefined
  readonly fakt1Orders: number | undefined
  readonly leads: number | null | undefined
  readonly conversion: number | null | undefined
  /** FAKT 2 per day; null — this row has no day figures. */
  readonly days: readonly number[] | null
}

export function PayrollGrid({
  data,
  days,
  search,
  compared,
  pick = null,
  picked = false,
}: {
  data: PayrollDto
  days: PayrollDaysDto | null
  search: string
  compared: boolean
  /** «Bosqich» / «Oʻsish» — narrows the rows as the search does, and takes the sums off with it. */
  pick?: RowPick | null
  /** «Boʻlim» / «ROP» narrowed the payload: the foot is the picked teams', and says so. */
  picked?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const dragScroll = useDragScroll<HTMLDivElement>()
  const crosshair = useMemo(() => crosshairHandlers(STYLE_ID), [])
  usePinnedColumns(box, 2)
  const needle = search.trim().toLowerCase()
  const narrowed = needle !== '' || pick !== null
  const blocks = useMemo(() => layout(data, needle, pick), [data, needle, pick])
  const cols = compared ? COLS : COLS.filter((c) => c.key !== 'growth')
  const dayList = days?.days ?? []
  const today = days?.today ?? ''
  const span = 1 + cols.length + dayList.length
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback(
    (key: string) =>
      setFolded((now) => {
        const next = new Set(now)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    [],
  )
  const ctx: RowCtx = { cols, dayList, today }

  return (
    <div
      ref={box}
      id={`${STYLE_ID}-box`}
      data-rnp-grid=""
      role="region"
      aria-label="Maosh jadvali"
      tabIndex={0}
      className="focusable relative h-full min-h-0 cursor-grab overflow-auto overscroll-contain data-[panning]:cursor-grabbing data-[panning]:select-none data-[panning]:[&_td]:cursor-grabbing"
      {...dragScroll}
      {...crosshair}
      onScroll={markScrolledX}
    >
      <style id={STYLE_ID} />
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Sotuvchilar maoshi — boʻlim, jamoa va sotuvchi boʻyicha, har kungi FAKT 2 bilan</caption>
        <thead>
          <tr style={{ color: 'var(--ink-secondary)' }}>
            <th
              scope="col"
              className={`thead-sticky tcol-sticky rnp-label ${NAME_WIDTH} ${RULE} h-12 py-2 pr-3 pl-4 text-left text-[12px] leading-tight font-bold sm:pl-5`}
              style={{ left: 0, background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}
            >
              Sotuvchi
            </th>
            <th
              scope="col"
              title="Sotuvchi oladigan soʻm: foiz + fiksa"
              className={`thead-sticky ${TOTAL_PIN} ${RULE} min-w-[124px] px-3 py-2 text-right text-[12px] font-bold whitespace-nowrap`}
              style={{ background: SUMMARY_HEAD, color: 'var(--ink-primary)' }}
            >
              JAMI maosh
            </th>
            {cols.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                title={c.hint}
                className={`thead-sticky ${RULE} ${c.min} px-3 py-2 text-right text-[11.5px] leading-tight font-semibold ${i === cols.length - 1 ? 'shadow-[inset_-1px_0_0_var(--border-strong)]' : ''}`}
              >
                {c.header}
              </th>
            ))}
            {dayList.map((d, i) => (
              <DayHead key={d} day={d} today={today} column={i} last={i === dayList.length - 1} />
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.length === 0 ? (
            <tr>
              <td colSpan={span + 1} className="px-5 py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {nobodyText(search)}
              </td>
            </tr>
          ) : (
            blocks.map((block, n) => (
              <BranchRows
                key={block.branch.branch}
                block={block}
                first={n === 0}
                ctx={ctx}
                days={days}
                span={span}
                compared={compared}
                searching={narrowed}
                folded={folded}
                onToggle={toggle}
              />
            ))
          )}
          {!narrowed && blocks.length > 0 && <GrandRows data={data} days={days} ctx={ctx} span={span} compared={compared} picked={picked} />}
        </tbody>
      </table>
    </div>
  )
}

interface RowCtx {
  readonly cols: typeof COLS
  readonly dayList: readonly string[]
  readonly today: string
}

/** The day figures of a set of sellers, summed — a team's, a block's, the company's. */
function sumDays(days: PayrollDaysDto | null, sellers: readonly PayrollSellerDto[]): number[] | null {
  if (!days) return null
  const out = days.days.map(() => 0)
  for (const s of sellers) (days.sellers[s.employeeId] ?? []).forEach((v, i) => (out[i] = (out[i] ?? 0) + v))
  return out
}

function BranchRows({
  block,
  first,
  ctx,
  days,
  span,
  compared,
  searching,
  folded,
  onToggle,
}: {
  block: Block
  first: boolean
  ctx: RowCtx
  days: PayrollDaysDto | null
  span: number
  compared: boolean
  searching: boolean
  folded: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const { branch } = block
  const hue = BRANCH_HUE[branch.branch]
  const key = `branch:${branch.branch}`
  const open = !folded.has(key)
  const branchDays = useMemo(() => sumDays(days, block.teams.flatMap((t) => t.rows)), [days, block])
  return (
    <>
      {!first && (
        <tr aria-hidden="true">
          <td colSpan={span + 1} className="h-6 border-y border-[var(--border-strong)] p-0" style={{ background: 'var(--surface-sunken)' }} />
        </tr>
      )}
      <tr data-line="branch">
        <th
          scope="rowgroup"
          className={`tcol-sticky rnp-label ${NAME_WIDTH} ${RULE} p-0 text-left`}
          style={{ ...STICK, left: 0, zIndex: 2, background: mix(hue, 20, 'var(--surface-raised)'), color: inkOf(hue) }}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px]" style={{ background: hue }} />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(key)}
            title={open ? 'Blokni yigʻish' : 'Blokni ochish'}
            className="focusable flex w-full items-center gap-1.5 py-2 pr-3 pl-4 text-left sm:pl-5"
          >
            <ChevronGlyph direction={open ? 'down' : 'right'} size={12} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold tracking-wide uppercase">{branch.label}</span>
              <span className="block text-[10.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                {rnpNumber(block.teamCount)} jamoa · {rnpNumber(branch.sellers)} sotuvchi
              </span>
            </span>
          </button>
        </th>
        <td className={`${TOTAL_PIN} tabular ${RULE} px-3 text-right text-[13px] font-bold whitespace-nowrap`} style={{ ...STICK, zIndex: 2, backgroundColor: mix(hue, 12, 'var(--surface-raised)'), color: inkOf(hue) }}>
          {rnpUzs(branch.total.amount)}
        </td>
        <td colSpan={span - 1} className={`sticky ${RULE}`} style={{ ...STICK, zIndex: 1, background: mix(hue, 10, 'var(--surface-raised)') }} />
      </tr>
      {open &&
        block.teams.map(({ team, rows }) => (
          <TeamRows
            key={team.rop ?? NO_ROP}
            team={team}
            rows={rows}
            ctx={ctx}
            days={days}
            span={span}
            compared={compared}
            hue={hue}
            searching={searching}
            open={!folded.has(`team:${team.rop ?? ''}`)}
            onToggle={onToggle}
          />
        ))}
      {open && !searching && (
        <FigureRow
          kind="branch"
          hue={hue}
          ctx={ctx}
          label={`${branch.label} jami`}
          sub={branch.rops > 0 ? `+ ${rnpNumber(branch.rops)} ta ROP: ${rnpUzs(branch.ropTotal.amount)}` : undefined}
          figures={{
            total: branch.total,
            formula: `${rnpUzs(branch.percent.amount)} + ${rnpUzs(branch.fixed.amount)} =`,
            fakt2: branch.fakt2,
            percent: branch.percent,
            fixed: branch.fixed,
            growth: compared ? <Muted /> : null,
            fakt2Orders: branch.fakt2Orders,
            fakt1Orders: branch.fakt1Orders,
            leads: branch.leads,
            conversion: branch.conversion,
            days: branchDays,
          }}
        />
      )}
    </>
  )
}

function TeamRows({
  team,
  rows,
  ctx,
  days,
  span,
  compared,
  hue,
  searching,
  open,
  onToggle,
}: {
  team: PayrollTeamDto
  rows: readonly PayrollSellerDto[]
  ctx: RowCtx
  days: PayrollDaysDto | null
  span: number
  compared: boolean
  hue: string
  searching: boolean
  open: boolean
  onToggle: (key: string) => void
}) {
  const name = team.rop ?? NO_ROP
  const teamDays = useMemo(() => sumDays(days, rows), [days, rows])
  const ropDays = days ? (days.rops[team.rop ?? ''] ?? days.days.map(() => 0)) : null
  return (
    <>
      <tr data-line="team">
        <th scope="rowgroup" className={`tcol-sticky rnp-label ${NAME_WIDTH} ${RULE} p-0 text-left`} style={{ left: 0, background: mix(hue, 8, 'var(--surface-raised)') }}>
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px]" style={{ background: mix(hue, 60) }} />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(`team:${team.rop ?? ''}`)}
            title={open ? 'Jamoani yigʻish' : 'Jamoani ochish'}
            className="focusable flex w-full items-center gap-1.5 py-1.5 pr-3 pl-4 text-left sm:pl-5"
          >
            <span className="inline-flex shrink-0" style={{ color: 'var(--ink-muted)' }}><ChevronGlyph direction={open ? 'down' : 'right'} size={11} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {team.rop === null ? NO_ROP : `${name} jamoasi`}
              </span>
              {team.ropPay?.head && (
                <span className="block truncate text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                  ROP: {team.ropPay.head}
                </span>
              )}
            </span>
          </button>
        </th>
        <td className={`${TOTAL_PIN} tabular ${RULE} px-3 text-right text-[12.5px] font-semibold whitespace-nowrap`} style={{ backgroundColor: mix(hue, 5, 'var(--surface-raised)'), color: 'var(--ink-primary)' }}>
          {open ? null : rnpUzs(team.total.amount)}
        </td>
        <td colSpan={span - 1} className={RULE} style={{ background: mix(hue, 4) }} />
      </tr>
      {open && rows.map((row) => <SellerRow key={row.employeeId} row={row} ctx={ctx} days={days?.sellers[row.employeeId] ?? (days ? days.days.map(() => 0) : null)} compared={compared} />)}
      {open && !searching && team.ropPay && (
        <FigureRow
          kind="rop"
          hue={hue}
          ctx={ctx}
          label={`ROP · ${team.ropPay.head ?? name}`}
          sub="jamoa FAKT 2 dan 2%"
          figures={{
            total: team.ropPay.total,
            formula: ropFormula(team),
            fakt2: team.ropPay.basis,
            rate: 2,
            percent: team.ropPay.percent,
            fixed: team.ropPay.fixed,
            growth: compared ? <Muted /> : null,
            fakt2Orders: undefined,
            fakt1Orders: undefined,
            leads: undefined,
            conversion: undefined,
            days: ropDays,
          }}
        />
      )}
      {open && !searching && team.sellers > 0 && (
        <FigureRow
          kind="team"
          hue={hue}
          ctx={ctx}
          label="Jamoa jami"
          sub={`${rnpNumber(team.sellers)} ta sotuvchi`}
          figures={{
            total: team.total,
            formula: `${rnpUzs(team.percent.amount)} + ${rnpUzs(team.fixed.amount)} =`,
            fakt2: team.fakt2,
            percent: team.percent,
            fixed: team.fixed,
            growth: compared ? <Growth delta={team.fakt2Delta} previous={team.previous?.fakt2 ?? null} team /> : null,
            fakt2Orders: team.fakt2Orders,
            fakt1Orders: team.fakt1Orders,
            leads: team.leads,
            conversion: team.conversion,
            days: teamDays,
          }}
        />
      )}
    </>
  )
}

const SellerRow = memo(function SellerRow({
  row,
  ctx,
  days,
  compared,
}: {
  row: PayrollSellerDto
  ctx: RowCtx
  days: readonly number[] | null
  compared: boolean
}) {
  return (
    <tr data-line="seller" className="transition-colors hover:bg-[var(--surface-sunken)]">
      <th scope="row" className={`tcol-sticky rnp-label ${NAME_WIDTH} ${RULE} py-1.5 pr-3 pl-4 text-left font-normal sm:pl-5`} style={{ left: 0 }}>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="tabular hidden size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold sm:inline-flex"
            style={{ background: 'var(--grid)', color: row.rank === 1 ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
            title={`Kompaniyada ${row.rank}-oʻrin`}
          >
            {row.rank}
          </span>
          <span className="block min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-primary)' }} title={row.fullName}>
            {row.fullName}
          </span>
          {row.table === 'flat' && (
            <Tooltip content={`Shaxsiy foiz: oʻzi sotgan FAKT 2 dan ${rnpNumber(row.percentRate)}%, jadvalsiz — fiksa ham, oklad ham yoʻq`}>
              <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: mix('var(--series-7)', 16), color: inkOf('var(--series-7)') }}>
                {rnpNumber(row.percentRate)}%
              </span>
            </Tooltip>
          )}
        </span>
      </th>
      <td className={`${TOTAL_PIN} tabular ${RULE} h-10 px-3 py-1.5 text-right text-[13px] font-bold whitespace-nowrap`} style={{ color: 'var(--ink-primary)', backgroundImage: layers(SUMMARY_CELL) }}>
        {rnpUzs(row.total.amount)}
      </td>
      {ctx.cols.map((c, i) => (
        <Cell key={c.key} last={i === ctx.cols.length - 1}>
          {sellerCell(c.key, row, compared)}
        </Cell>
      ))}
      <DayCells days={days} ctx={ctx} />
    </tr>
  )
})

function sellerCell(key: Col, row: PayrollSellerDto, compared: boolean): ReactNode {
  switch (key) {
    case 'formula':
      return (
        <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          {rnpFormula(sellerFormula(row))}
        </span>
      )
    case 'fakt2':
      return <span style={{ color: 'var(--ink-primary)' }}>{rnpUzs(row.fakt2.amount)}</span>
    case 'percent':
      return (
        <span className="inline-flex items-baseline justify-end gap-1.5">
          <RatePill rate={row.percentRate} />
          <span>{row.percent.amount === 0 ? '—' : rnpUzs(row.percent.amount)}</span>
        </span>
      )
    case 'fixed':
      return <FixedCell row={row} />
    case 'growth':
      return compared ? <Growth delta={row.fakt2Delta} previous={row.previous?.fakt2 ?? null} /> : null
    case 'fakt2Orders':
      return rnpNumber(row.fakt2Orders)
    case 'fakt1Orders':
      return rnpNumber(row.fakt1Orders)
    case 'leads':
      return row.leads === null ? <Muted /> : rnpNumber(row.leads)
    case 'conversion':
      return row.conversion === null ? <Muted /> : rnpPercent(row.conversion)
  }
}

/** The fixed part and, under it, how far the next rung is. A flat rate has no rung. */
function FixedCell({ row }: { row: PayrollSellerDto }) {
  return (
    <span className="block">
      <span className="block">{row.fixed.amount > 0 ? rnpUzs(row.fixed.amount) : '—'}</span>
      {row.nextFloor && row.toNext && (
        <span className="mt-0.5 flex items-center justify-end gap-1.5" title={`${rnpUzs(row.nextFloor.amount)} gacha ${rnpUzs(row.toNext.amount)} qoldi`}>
          <span className="h-1 w-[40px] shrink-0 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
            <span className="block h-full rounded-full" style={{ width: `${tierProgress(row)}%`, background: 'var(--seq-450)' }} />
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            yana {rnpUzs(row.toNext.amount)}
          </span>
        </span>
      )}
    </span>
  )
}

/**
 * A row of sums — a ROP's pay, a team's, a block's, the company's — in the
 * columns a seller's figures sit in.
 */
function FigureRow({
  kind,
  hue,
  ctx,
  label,
  sub,
  figures: f,
}: {
  kind: 'rop' | 'team' | 'branch' | 'grand'
  hue: string
  ctx: RowCtx
  label: string
  sub?: string
  figures: Figures
}) {
  const strong = kind !== 'rop'
  const heavy = kind === 'branch' || kind === 'grand'
  const rule = heavy ? RULE_STRONG : RULE
  const band = kind === 'branch' ? mix(hue, 12) : kind === 'grand' ? mix('var(--ink-primary)', 6) : kind === 'team' ? mix(hue, 5) : undefined
  const ground =
    kind === 'branch'
      ? mix(hue, 18, 'var(--surface-raised)')
      : kind === 'grand'
        ? mix('var(--ink-primary)', 9, 'var(--surface-raised)')
        : kind === 'team'
          ? mix(hue, 8, 'var(--surface-raised)')
          : undefined
  const count = (value: number | null | undefined, format: (n: number) => string) => (value === undefined || value === null ? <Muted /> : format(value))
  const cell = (key: Col): ReactNode => {
    switch (key) {
      case 'formula':
        return (
          <span className="text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
            {rnpFormula(f.formula)}
          </span>
        )
      case 'fakt2':
        return f.fakt2 === null ? <Muted /> : <span style={{ color: 'var(--ink-primary)' }}>{rnpUzs(f.fakt2.amount)}</span>
      case 'percent':
        return (
          <span className="inline-flex items-baseline justify-end gap-1.5">
            {f.rate !== undefined && <RatePill rate={f.rate} />}
            <span>{rnpUzs(f.percent.amount)}</span>
          </span>
        )
      case 'fixed':
        return f.fixed.amount > 0 ? rnpUzs(f.fixed.amount) : '—'
      case 'growth':
        return f.growth
      case 'fakt2Orders':
        return count(f.fakt2Orders, rnpNumber)
      case 'fakt1Orders':
        return count(f.fakt1Orders, rnpNumber)
      case 'leads':
        return count(f.leads, rnpNumber)
      case 'conversion':
        return count(f.conversion, rnpPercent)
    }
  }
  return (
    <tr data-line={kind} className={strong ? 'font-semibold' : ''} style={band ? { backgroundImage: layers(band) } : undefined}>
      <th scope="row" className={`tcol-sticky rnp-label ${NAME_WIDTH} ${rule} py-1.5 pr-3 pl-4 text-left sm:pl-5`} style={{ left: 0, ...(ground ? { background: ground } : {}) }}>
        <span
          className={`block truncate ${heavy ? 'text-[12px] tracking-wide uppercase' : 'text-[12px]'}`}
          style={{ color: kind === 'rop' ? 'var(--ink-secondary)' : kind === 'branch' ? inkOf(hue) : 'var(--ink-primary)' }}
        >
          {label}
        </span>
        {sub && (
          <span className="block truncate text-[10.5px] font-normal tracking-normal normal-case" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </span>
        )}
      </th>
      <td className={`${TOTAL_PIN} tabular ${rule} h-10 px-3 py-1.5 text-right text-[13px] whitespace-nowrap`} style={{ color: 'var(--ink-primary)', backgroundImage: layers(SUMMARY_CELL, band) }}>
        {rnpUzs(f.total.amount)}
      </td>
      {ctx.cols.map((c, i) => (
        <Cell key={c.key} rule={rule} last={i === ctx.cols.length - 1}>
          {cell(c.key)}
        </Cell>
      ))}
      <DayCells days={f.days} ctx={ctx} rule={rule} />
    </tr>
  )
}

/** The company's foot: the sellers' fund, the ROPs' pay apart, and the two together. */
function GrandRows({
  data,
  days,
  ctx,
  span,
  compared,
  picked,
}: {
  data: PayrollDto
  days: PayrollDaysDto | null
  ctx: RowCtx
  span: number
  compared: boolean
  picked: boolean
}) {
  const { totals, ropTotals } = data
  const allDays = useMemo(() => sumDays(days, data.sellers), [days, data.sellers])
  const ropDays = useMemo(() => {
    if (!days) return null
    const out = days.days.map(() => 0)
    for (const team of data.teams) {
      if (!team.ropPay) continue
      ;(days.rops[team.rop ?? ''] ?? []).forEach((v, i) => (out[i] = (out[i] ?? 0) + v))
    }
    return out
  }, [days, data.teams])
  return (
    <>
      <tr aria-hidden="true">
        <td colSpan={span + 1} className="h-6 border-y border-[var(--border-strong)] p-0" style={{ background: 'var(--surface-sunken)' }} />
      </tr>
      <FigureRow
        kind="grand"
        hue="var(--ink-primary)"
        ctx={ctx}
        label={picked ? 'Tanlangan sotuvchilar jami' : 'Sotuvchilar jami'}
        sub={`${rnpNumber(totals.sellers)} ta sotuvchi`}
        figures={{
          total: totals.total,
          formula: `${rnpUzs(totals.percent.amount)} + ${rnpUzs(totals.fixed.amount)} =`,
          fakt2: totals.fakt2,
          percent: totals.percent,
          fixed: totals.fixed,
          growth: compared ? <Growth delta={data.deltas.fakt2} previous={data.previous.fakt2} team /> : null,
          fakt2Orders: totals.fakt2Orders,
          fakt1Orders: totals.fakt1Orders,
          leads: totals.leads,
          conversion: totals.conversion,
          days: allDays,
        }}
      />
      {ropTotals.rops > 0 && (
        <FigureRow
          kind="rop"
          hue="var(--ink-primary)"
          ctx={ctx}
          label={picked ? 'Tanlangan ROP lar jami' : 'ROP lar jami'}
          sub={`${rnpNumber(ropTotals.rops)} ta ROP · kunlarda — ularning 2% asosi`}
          figures={{
            total: ropTotals.total,
            formula: `${rnpUzs(ropTotals.percent.amount)} + ${rnpUzs(ropTotals.fixed.amount)} =`,
            fakt2: null,
            percent: ropTotals.percent,
            fixed: ropTotals.fixed,
            growth: compared ? <Muted /> : null,
            fakt2Orders: undefined,
            fakt1Orders: undefined,
            leads: undefined,
            conversion: undefined,
            days: ropDays,
          }}
        />
      )}
      <tr data-line="all" className="font-semibold">
        <th scope="row" className={`tcol-sticky rnp-label ${NAME_WIDTH} ${RULE_STRONG} py-2 pr-3 pl-4 text-left sm:pl-5`} style={{ left: 0, background: mix('var(--accent)', 14, 'var(--surface-raised)') }}>
          <span className="block text-[12.5px] tracking-wide uppercase" style={{ color: 'var(--ink-primary)' }}>
            {picked ? 'Tanlanganlar hammasi' : 'Hammasi boʻlib'}
          </span>
          <span className="block text-[10.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
            sotuvchilar + ROP lar
          </span>
        </th>
        <td className={`${TOTAL_PIN} tabular ${RULE_STRONG} px-3 py-2 text-right text-[14px] whitespace-nowrap`} style={{ backgroundColor: mix('var(--accent)', 14, 'var(--surface-raised)'), color: 'var(--ink-primary)' }}>
          {rnpUzs(data.fund.amount)}
        </td>
        <td colSpan={span - 1} className={`${RULE_STRONG} px-3 py-2 text-left`} style={{ background: mix('var(--accent)', 8) }}>
          <span className="tabular text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
            = {rnpUzs(totals.total.amount)} + {rnpUzs(ropTotals.total.amount)}
          </span>
        </td>
      </tr>
    </>
  )
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function Cell({ children, rule = RULE, last = false }: { children: ReactNode; rule?: string; last?: boolean }) {
  return (
    <td
      className={`tabular ${rule} px-3 py-1.5 text-right text-[12.5px] whitespace-nowrap ${last ? 'shadow-[inset_-1px_0_0_var(--border-strong)]' : ''}`}
      style={{ color: 'var(--ink-secondary)' }}
    >
      {children}
    </td>
  )
}

/** A row's FAKT 2 per day — empty while the day figures load, or for a row that has none. */
function DayCells({ days, ctx, rule = RULE }: { days: readonly number[] | null; ctx: RowCtx; rule?: string }) {
  return (
    <>
      {ctx.dayList.map((day, i) => {
        const value = days?.[i] ?? null
        return (
          <td
            key={day}
            data-c={i}
            className={`tabular ${rule} ${VRULE} px-3 py-1.5 text-right text-[12.5px] whitespace-nowrap ${i === ctx.dayList.length - 1 ? 'pr-5' : ''}`}
            style={{ color: 'var(--ink-primary)', ...dayCellStyle(day, ctx.today) }}
          >
            {value === null ? null : value === 0 ? <span style={{ color: 'var(--ink-muted)' }}>0</span> : rnpUzs(value)}
          </td>
        )
      })}
    </>
  )
}

function Muted() {
  return <span style={{ color: 'var(--ink-muted)' }}>—</span>
}

/** The house formula («52,340,000 × 8% + 500,000 =») in the sheet's dots. */
function rnpFormula(text: string): string {
  return text.replace(/\d{1,3}(?:,\d{3})+/g, (n) => n.replaceAll(',', '.'))
}

// ---------------------------------------------------------------------------
// Excel and words
// ---------------------------------------------------------------------------

/** «01.10 – 23.10». The end is exclusive, so the last day named is the one before it. */
function windowText(window: PeriodDto): string {
  const first = formatDateShort(window.start)
  const last = formatDateShort(new Date(new Date(window.end).getTime() - 1).toISOString())
  return first === last ? first : `${first} – ${last}`
}

function windowSlug(window: PeriodDto): string {
  const day = (iso: string) => iso.slice(0, 10)
  return `${day(window.start)}_${day(new Date(new Date(window.end).getTime() - 1).toISOString())}`
}

/**
 * The sheet as Excel reads it: a row per seller under its block and team, the
 * ROP's row, each team's, block's and the company's total, then the days.
 * Plain numbers, so Excel sums them.
 */
export function payrollCsv(data: PayrollDto, days: PayrollDaysDto | null, compared: boolean): string[][] {
  const dayList = days?.days ?? []
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100).replace('.', ','))
  const head = [
    'Boʻlim',
    'Jamoa',
    'Sotuvchi',
    'JAMI maosh',
    'Hisob',
    'FAKT 2',
    'Foiz %',
    'Foiz soʻm',
    'Fiksa / oklad',
    ...(compared ? ['Oʻtgan davr FAKT 2'] : []),
    'Buyurtma soni',
    'Tranzaksiya',
    'Lid soni',
    'Konversiya %',
    ...dayList.map((d) => dayMonthYear(d)),
  ]
  const out: string[][] = [head]
  const dayCells = (values: readonly number[] | null) => dayList.map((_, i) => n(values?.[i] ?? null))
  for (const block of layout(data, '')) {
    for (const { team, rows } of block.teams) {
      const teamName = team.rop ?? NO_ROP
      for (const r of rows) {
        out.push([
          block.branch.label,
          teamName,
          r.fullName,
          n(r.total.amount),
          sellerFormula(r),
          n(r.fakt2.amount),
          n(r.percentRate),
          n(r.percent.amount),
          n(r.fixed.amount),
          ...(compared ? [n(r.previous?.fakt2.amount ?? null)] : []),
          n(r.fakt2Orders),
          n(r.fakt1Orders),
          n(r.leads),
          n(r.conversion),
          ...dayCells(days?.sellers[r.employeeId] ?? null),
        ])
      }
      if (team.ropPay) {
        out.push([
          block.branch.label,
          teamName,
          `ROP · ${team.ropPay.head ?? teamName}`,
          n(team.ropPay.total.amount),
          ropFormula(team),
          n(team.ropPay.basis.amount),
          '2',
          n(team.ropPay.percent.amount),
          n(team.ropPay.fixed.amount),
          ...(compared ? [''] : []),
          '',
          '',
          '',
          '',
          ...dayCells(days?.rops[team.rop ?? ''] ?? null),
        ])
      }
      out.push([
        block.branch.label,
        teamName,
        'Jamoa jami',
        n(team.total.amount),
        '',
        n(team.fakt2.amount),
        '',
        n(team.percent.amount),
        n(team.fixed.amount),
        ...(compared ? [n(team.previous?.fakt2.amount ?? null)] : []),
        n(team.fakt2Orders),
        n(team.fakt1Orders),
        n(team.leads),
        n(team.conversion),
        ...dayCells(sumDays(days, rows)),
      ])
    }
    const b = block.branch
    out.push([
      b.label,
      '',
      `${b.label} jami`,
      n(b.total.amount),
      '',
      n(b.fakt2.amount),
      '',
      n(b.percent.amount),
      n(b.fixed.amount),
      ...(compared ? [''] : []),
      n(b.fakt2Orders),
      n(b.fakt1Orders),
      n(b.leads),
      n(b.conversion),
      ...dayCells(sumDays(days, block.teams.flatMap((t) => t.rows))),
    ])
  }
  const t = data.totals
  out.push([
    '',
    '',
    'Sotuvchilar jami',
    n(t.total.amount),
    '',
    n(t.fakt2.amount),
    '',
    n(t.percent.amount),
    n(t.fixed.amount),
    ...(compared ? [n(data.previous.fakt2.amount)] : []),
    n(t.fakt2Orders),
    n(t.fakt1Orders),
    n(t.leads),
    n(t.conversion),
    ...dayCells(sumDays(days, data.sellers)),
  ])
  out.push(['', '', 'ROP lar jami', n(data.ropTotals.total.amount), '', '', '', n(data.ropTotals.percent.amount), n(data.ropTotals.fixed.amount)])
  out.push(['', '', 'Hammasi boʻlib', n(data.fund.amount)])
  return out
}
