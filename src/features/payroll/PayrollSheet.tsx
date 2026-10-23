'use client'

import { type ReactNode, useMemo } from 'react'

import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import type {
  DeltaDto,
  MoneyDto,
  PayrollBranch,
  PayrollBranchDto,
  PayrollDto,
  PayrollSellerDto,
  PayrollTeamDto,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import { NO_ROP, NewChip } from './PayrollTeams'

/**
 * «Hisob-kitob» — the whole payroll as ONE sheet, «huddi RNP jadvali kabi»
 * (the client, 2026-10-20): Toshkent · Navoiy · Baza · Zextra blocks, each
 * ROP team inside with its sellers, its ROP's own row and its total, a total
 * per block and the company's at the foot.
 *
 * Every figure is the SERVER's — rows, team sums, block sums, totals — so the
 * sheet adds up to the hero to the soʻm; nothing here sums money.
 *
 * THE COLUMNS «ROP otchet» PRINTS COME FIRST: Lid soni, Tranzaksiya (Транз-1),
 * Konversiya, Buyurtma soni (Транз-2) — the client asked for them beside the
 * pay — then FAKT 2 and the working: rate, oklad / fiksa, the sum written
 * out, JAMI.
 *
 * THE NAME COLUMN IS PINNED, as on /rnp, so a phone scrolls the figures under
 * it and the header row stays while the sheet scrolls down.
 */
export function PayrollSheet({
  data,
  search,
  compared,
}: {
  data: PayrollDto
  search: string
  /** Whether a comparison window exists; without one the growth column is dropped. */
  compared: boolean
}) {
  const needle = search.trim().toLowerCase()
  const blocks = useMemo(() => layout(data, needle), [data, needle])
  const columns = compared ? COLUMNS : COLUMNS.filter((c) => c.key !== 'growth')
  const span = columns.length
  const restPx = columns.slice(1).reduce((acc, c) => acc + c.width, 0)

  return (
    <div
      role="region"
      aria-label="Maosh jadvali"
      // A scroll box a keyboard can reach and scroll with the arrow keys.
      tabIndex={0}
      className="focusable relative max-h-[min(80dvh,1200px)] overflow-auto overscroll-contain rounded-[var(--radius-panel-sm)] border border-[var(--border)] [--pay-name:140px] sm:[--pay-name:232px]"
    >
      <table
        className="table-fixed border-separate border-spacing-0 text-sm"
        // Kartaning butun kengligini egallaydi (keng ekranda oʻngda boʻsh joy qolmaydi);
        // `minWidth` — ustunlar oʻqilmaydigan darajada siqilmasligi uchun eng kichik chegara.
        // `table-fixed` boʻlgani uchun ortiqcha joy ustunlarga proporsional taqsimlanadi.
        style={{ width: '100%', minWidth: `calc(var(--pay-name) + ${restPx}px)` }}
      >
        <caption className="sr-only">Sotuvchilar maoshi — boʻlim, jamoa va sotuvchi boʻyicha</caption>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: c.key === 'seller' ? 'var(--pay-name)' : `${c.width}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ color: 'var(--ink-secondary)' }}>
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                title={c.hint}
                className={`thead-sticky ${i === 0 ? 'tcol-sticky pl-4 text-left sm:pl-5' : 'text-right'} ${c.key === 'total' ? PIN_RIGHT : ''} ${RULE} h-11 px-3 py-2 text-[11.5px] leading-tight font-semibold`}
                style={
                  i === 0
                    ? { left: 0, background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }
                    : c.key === 'total'
                      ? { zIndex: 2, color: 'var(--ink-primary)' }
                      : undefined
                }
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.length === 0 ? (
            <tr>
              <td colSpan={span} className="px-5 py-8 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                «{search.trim()}» boʻyicha hech kim topilmadi.
              </td>
            </tr>
          ) : (
            blocks.map((block) => (
              <BranchRows key={block.branch.branch} block={block} span={span} compared={compared} searching={needle !== ''} />
            ))
          )}
          {needle === '' && blocks.length > 0 && <GrandRows data={data} span={span} compared={compared} />}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Which rows, in which order
// ---------------------------------------------------------------------------

export interface TeamBlock {
  readonly team: PayrollTeamDto
  readonly rows: readonly PayrollSellerDto[]
}

export interface Block {
  readonly branch: PayrollBranchDto
  readonly teams: readonly TeamBlock[]
  /** The block's teams the sheet draws with no search on — not a team paid only last period. */
  readonly teamCount: number
}

/**
 * The server's blocks and teams, in the server's order, each team's sellers by
 * company rank. A SEARCH NARROWS: a team whose name matches keeps everybody,
 * otherwise only the sellers whose name matches; a team or block left empty is
 * not drawn. A team the period paid nobody in (a label only a moved seller sold
 * under) still draws when its ROP is paid.
 */
export function layout(data: PayrollDto, needle: string): Block[] {
  const byRop = new Map<string | null, PayrollSellerDto[]>()
  for (const row of data.sellers) byRop.set(row.rop, [...(byRop.get(row.rop) ?? []), row])
  const teamOf = new Map(data.teams.map((team) => [team.rop, team]))

  const drawn = (team: PayrollTeamDto) => team.sellers > 0 || team.ropPay !== null
  return data.branches.flatMap((branch) => {
    const own = branch.teams.flatMap((rop) => teamOf.get(rop) ?? [])
    const teams = own.flatMap((team): TeamBlock[] => {
      const all = byRop.get(team.rop) ?? []
      const name = (team.rop ?? NO_ROP).toLowerCase()
      const rows = needle === '' || name.includes(needle) ? all : all.filter((row) => row.fullName.toLowerCase().includes(needle))
      if (rows.length === 0 && (needle !== '' || !drawn(team))) return []
      return [{ team, rows }]
    })
    return teams.length > 0 ? [{ branch, teams, teamCount: own.filter(drawn).length }] : []
  })
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

type ColumnKey =
  | 'seller'
  | 'leads'
  | 'fakt1Orders'
  | 'conversion'
  | 'fakt2Orders'
  | 'fakt2'
  | 'percent'
  | 'fixed'
  | 'formula'
  | 'total'
  | 'growth'

/**
 * JAMI LAST AND PINNED to the right edge from `sm` up (`PIN_RIGHT`): the sheet
 * is wider than a laptop's card, and the figure the page exists for may not
 * be the one that scrolls out of view. «Oʻsish» sits beside the FAKT 2 it
 * measures. On a phone only the name pins — two pinned columns would leave
 * the figures a sliver.
 */
const COLUMNS: readonly { key: ColumnKey; header: string; hint?: string; width: number }[] = [
  { key: 'seller', header: 'Sotuvchi', width: 232 },
  {
    key: 'leads',
    header: 'Lid soni',
    hint: '«ROP otchet»dagi kabi: shu kunlarda shu odamga tarqatilgan lidlar («Лид таркатилган сана»). Jami qatorlarda — faqat jadvaldagi (FAKT 2 bor) sotuvchilarniki',
    width: 72,
  },
  { key: 'fakt1Orders', header: 'Tranzaksiya', hint: 'Транз-1 — FAKT 1 buyurtmalar soni', width: 90 },
  {
    key: 'conversion',
    header: 'Konversiya',
    hint: 'Tranzaksiya ÷ Lid soni. Jami qatorlarda — faqat lid olgan sotuvchilar boʻyicha (Bazaga lid berilmaydi)',
    width: 86,
  },
  { key: 'fakt2Orders', header: 'Buyurtma soni', hint: 'Транз-2 — yetkazilgan (FAKT 2) buyurtmalar soni', width: 84 },
  { key: 'fakt2', header: 'FAKT 2 · Успешно', hint: 'Yetkazilgan pul — maosh shundan hisoblanadi', width: 124 },
  { key: 'growth', header: 'Oʻsish', hint: 'FAKT 2 — oʻtgan shunday davr bilan', width: 108 },
  { key: 'percent', header: 'Foiz', hint: 'Bosqich foizi butun FAKT 2 dan', width: 132 },
  { key: 'fixed', header: 'Fiksa / oklad', hint: 'Bosqichga qarab; Bazada har bosqichda oklad bor', width: 156 },
  { key: 'formula', header: 'Hisob', width: 250 },
  { key: 'total', header: 'JAMI', width: 126 },
]

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function BranchRows({
  block,
  span,
  compared,
  searching,
}: {
  block: Block
  span: number
  compared: boolean
  searching: boolean
}) {
  const { branch } = block
  const hue = BRANCH_HUE[branch.branch]
  return (
    <>
      <tr data-line="branch" data-branch={branch.branch}>
        <th
          scope="rowgroup"
          className={`tcol-sticky ${RULE} py-2.5 pr-3 pl-4 text-left sm:pl-5`}
          style={{ left: 0, background: mix(hue, 20, 'var(--surface-raised)'), color: inkOf(hue) }}
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px]" style={{ background: hue }} />
          <span className="block text-[13px] font-bold tracking-wide uppercase">{branch.label}</span>
          <span className="block text-[10.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {formatNumber(block.teamCount)} jamoa · {formatNumber(branch.sellers)} sotuvchi
          </span>
        </th>
        <td colSpan={span - 1} className={RULE} style={{ background: mix(hue, 10) }} />
      </tr>
      {block.teams.map(({ team, rows }) => (
        <TeamRows key={team.rop ?? NO_ROP} team={team} rows={rows} span={span} compared={compared} hue={hue} searching={searching} />
      ))}
      {!searching && (
        <FigureRow
          kind="branch"
          hue={hue}
          label={`${branch.label} jami`}
          sub={branch.rops > 0 ? `+ ${formatNumber(branch.rops)} ta ROP: ${formatFullUzs(branch.ropTotal.amount)}` : undefined}
          leads={branch.leads}
          fakt1Orders={branch.fakt1Orders}
          conversion={branch.conversion}
          fakt2Orders={branch.fakt2Orders}
          fakt2={branch.fakt2}
          percent={branch.percent}
          fixed={branch.fixed}
          formula={`${formatFullUzs(branch.percent.amount)} + ${formatFullUzs(branch.fixed.amount)} =`}
          total={branch.total}
          growth={compared ? <Muted /> : null}
        />
      )}
    </>
  )
}

function TeamRows({
  team,
  rows,
  span,
  compared,
  hue,
  searching,
}: {
  team: PayrollTeamDto
  rows: readonly PayrollSellerDto[]
  span: number
  compared: boolean
  hue: string
  searching: boolean
}) {
  const name = team.rop ?? NO_ROP
  return (
    <>
      <tr data-line="team">
        <th scope="rowgroup" className={`tcol-sticky ${RULE} py-1.5 pr-3 pl-4 text-left sm:pl-5`} style={{ left: 0, background: mix(hue, 8, 'var(--surface-raised)') }}>
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px]" style={{ background: mix(hue, 60) }} />
          <span className="block truncate text-[12.5px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {team.rop === null ? NO_ROP : `${name} jamoasi`}
          </span>
          {team.ropPay?.head && (
            <span className="block truncate text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
              ROP: {team.ropPay.head}
            </span>
          )}
        </th>
        <td colSpan={span - 1} className={RULE} style={{ background: mix(hue, 4) }} />
      </tr>
      {rows.map((row) => (
        <SellerRow key={row.employeeId} row={row} compared={compared} />
      ))}
      {!searching && team.ropPay && (
        <FigureRow
          kind="rop"
          hue={hue}
          label={`ROP · ${team.ropPay.head ?? name}`}
          sub="jamoa FAKT 2 dan 2%"
          leads={undefined}
          fakt1Orders={undefined}
          conversion={undefined}
          fakt2Orders={undefined}
          fakt2={team.ropPay.basis}
          percent={team.ropPay.percent}
          rate={2}
          fixed={team.ropPay.fixed}
          formula={ropFormula(team)}
          total={team.ropPay.total}
          growth={compared ? <Muted /> : null}
        />
      )}
      {!searching && team.sellers > 0 && (
        <FigureRow
          kind="team"
          hue={hue}
          label="Jamoa jami"
          sub={`${formatNumber(team.sellers)} ta sotuvchi`}
          leads={team.leads}
          fakt1Orders={team.fakt1Orders}
          conversion={team.conversion}
          fakt2Orders={team.fakt2Orders}
          fakt2={team.fakt2}
          percent={team.percent}
          fixed={team.fixed}
          formula={`${formatFullUzs(team.percent.amount)} + ${formatFullUzs(team.fixed.amount)} =`}
          total={team.total}
          growth={compared ? <Growth delta={team.fakt2Delta} previous={team.previous?.fakt2 ?? null} team /> : null}
        />
      )}
    </>
  )
}

function SellerRow({ row, compared }: { row: PayrollSellerDto; compared: boolean }) {
  return (
    <tr data-line="seller" className="transition-colors hover:bg-[var(--surface-sunken)]">
      <th scope="row" className={`tcol-sticky ${RULE} py-1.5 pr-3 pl-4 text-left font-normal sm:pl-5`} style={{ left: 0 }}>
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
            <Tooltip content={`Shaxsiy foiz: oʻzi sotgan FAKT 2 dan ${formatNumber(row.percentRate)}%, jadvalsiz — fiksa ham, oklad ham yoʻq`}>
              <span
                className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
                style={{ background: mix('var(--series-7)', 16), color: inkOf('var(--series-7)') }}
              >
                {formatNumber(row.percentRate)}%<span className="hidden sm:inline"> shaxsiy</span>
              </span>
            </Tooltip>
          )}
        </span>
      </th>
      <Num>{row.leads === null ? <Muted /> : formatNumber(row.leads)}</Num>
      <Num>{formatNumber(row.fakt1Orders)}</Num>
      <Num>{row.conversion === null ? <Muted /> : formatPercent(row.conversion)}</Num>
      <Num>{formatNumber(row.fakt2Orders)}</Num>
      <Num strong>{formatFullUzs(row.fakt2.amount)}</Num>
      {compared && (
        <Num>
          <Growth delta={row.fakt2Delta} previous={row.previous?.fakt2 ?? null} />
        </Num>
      )}
      <Num>
        <span className="inline-flex items-baseline justify-end gap-1.5">
          <RatePill rate={row.percentRate} />
          <span style={{ color: 'var(--ink-secondary)' }}>{row.percent.amount === 0 ? NO_VALUE : formatFullUzs(row.percent.amount)}</span>
        </span>
      </Num>
      <Num>
        <FixedCell row={row} />
      </Num>
      <Num>
        <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          {sellerFormula(row)}
        </span>
      </Num>
      <Num pinRight>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {formatFullUzs(row.total.amount)}
        </span>
      </Num>
    </tr>
  )
}

/**
 * A row of sums — a ROP's pay, a team's, a block's, the company's — in the
 * columns a seller's figures sit in. `undefined` in a count column is «not
 * this row's kind of figure» (a dash), `null` is «not read» (a dash too).
 */
function FigureRow({
  kind,
  hue,
  label,
  sub,
  leads,
  fakt1Orders,
  conversion,
  fakt2Orders,
  fakt2,
  percent,
  rate,
  fixed,
  formula,
  total,
  growth,
}: {
  kind: 'rop' | 'team' | 'branch' | 'grand'
  hue: string
  label: string
  sub?: string
  leads: number | null | undefined
  fakt1Orders: number | undefined
  conversion: number | null | undefined
  fakt2Orders: number | undefined
  fakt2: MoneyDto | null
  percent: MoneyDto
  rate?: number
  fixed: MoneyDto
  formula: string
  total: MoneyDto
  growth: ReactNode
}) {
  const strong = kind !== 'rop'
  const band = kind === 'branch' ? mix(hue, 12) : kind === 'grand' ? mix('var(--ink-primary)', 6) : kind === 'team' ? mix(hue, 5) : undefined
  const ground = kind === 'branch' ? mix(hue, 18, 'var(--surface-raised)') : kind === 'grand' ? mix('var(--ink-primary)', 9, 'var(--surface-raised)') : kind === 'team' ? mix(hue, 8, 'var(--surface-raised)') : undefined
  const count = (value: number | null | undefined, format: (n: number) => string) =>
    value === undefined || value === null ? <Muted /> : format(value)
  return (
    <tr data-line={LINE_OF[kind]} className={strong ? 'font-semibold' : ''} style={band ? { backgroundImage: layers(band) } : undefined}>
      <th
        scope="row"
        className={`tcol-sticky ${kind === 'branch' || kind === 'grand' ? RULE_STRONG : RULE} py-1.5 pr-3 pl-4 text-left sm:pl-5`}
        style={{ left: 0, ...(ground ? { background: ground } : {}) }}
      >
        <span
          className={`block truncate ${kind === 'branch' || kind === 'grand' ? 'text-[12px] tracking-wide uppercase' : 'text-[12px]'}`}
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
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>{count(leads, formatNumber)}</Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>{count(fakt1Orders, formatNumber)}</Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>{count(conversion, (n) => formatPercent(n))}</Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>{count(fakt2Orders, formatNumber)}</Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'} strong={strong}>
        {fakt2 === null ? <Muted /> : formatFullUzs(fakt2.amount)}
      </Num>
      {growth !== null && <Num ruleStrong={kind === 'branch' || kind === 'grand'}>{growth}</Num>}
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>
        <span className="inline-flex items-baseline justify-end gap-1.5">
          {rate !== undefined && <RatePill rate={rate} />}
          <span style={{ color: 'var(--ink-secondary)' }}>{formatFullUzs(percent.amount)}</span>
        </span>
      </Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>
        <span style={{ color: 'var(--ink-secondary)' }}>{fixed.amount > 0 ? formatFullUzs(fixed.amount) : NO_VALUE}</span>
      </Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'}>
        <span className="text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
          {formula}
        </span>
      </Num>
      <Num ruleStrong={kind === 'branch' || kind === 'grand'} pinRight band={band}>
        <span className="text-[13px]" style={{ color: 'var(--ink-primary)' }}>
          {formatFullUzs(total.amount)}
        </span>
      </Num>
    </tr>
  )
}

/** The rows' `data-line`, apart from the team and block heading rows («team», «branch»). */
const LINE_OF = { rop: 'rop', team: 'team-total', branch: 'branch-total', grand: 'grand' } as const

/** The company's foot: the sellers' fund, the ROPs' pay apart, and the two together. */
function GrandRows({ data, span, compared }: { data: PayrollDto; span: number; compared: boolean }) {
  const hue = 'var(--ink-primary)'
  const { totals, ropTotals } = data
  return (
    <>
      <tr aria-hidden="true">
        <td colSpan={span} className="h-3 p-0" />
      </tr>
      <FigureRow
        kind="grand"
        hue={hue}
        label="Sotuvchilar jami"
        sub={`${formatNumber(totals.sellers)} ta sotuvchi`}
        leads={totals.leads}
        fakt1Orders={totals.fakt1Orders}
        conversion={totals.conversion}
        fakt2Orders={totals.fakt2Orders}
        fakt2={totals.fakt2}
        percent={totals.percent}
        fixed={totals.fixed}
        formula={`${formatFullUzs(totals.percent.amount)} + ${formatFullUzs(totals.fixed.amount)} =`}
        total={totals.total}
        growth={compared ? <Growth delta={data.deltas.fakt2} previous={data.previous.fakt2} team /> : null}
      />
      {ropTotals.rops > 0 && (
        <FigureRow
          kind="rop"
          hue={hue}
          label="ROP lar jami"
          sub={`${formatNumber(ropTotals.rops)} ta ROP`}
          leads={undefined}
          fakt1Orders={undefined}
          conversion={undefined}
          fakt2Orders={undefined}
          fakt2={null}
          percent={ropTotals.percent}
          fixed={ropTotals.fixed}
          formula={`${formatFullUzs(ropTotals.percent.amount)} + ${formatFullUzs(ropTotals.fixed.amount)} =`}
          total={ropTotals.total}
          growth={compared ? <Muted /> : null}
        />
      )}
      <tr data-line="all" className="font-semibold">
        <th scope="row" className={`tcol-sticky ${RULE_STRONG} py-2 pr-3 pl-4 text-left sm:pl-5`} style={{ left: 0, background: mix('var(--accent)', 14, 'var(--surface-raised)') }}>
          <span className="block text-[12.5px] tracking-wide uppercase" style={{ color: 'var(--ink-primary)' }}>
            Hammasi boʻlib
          </span>
          <span className="block text-[10.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
            sotuvchilar + ROP lar
          </span>
        </th>
        <td colSpan={span - 2} className={`${RULE_STRONG} px-3 py-2 text-right`} style={{ background: mix('var(--accent)', 8) }}>
          <span className="tabular text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
            {formatFullUzs(totals.total.amount)} + {formatFullUzs(ropTotals.total.amount)} =
          </span>
        </td>
        <td
          className={`tabular ${RULE_STRONG} ${PIN_RIGHT} px-3 py-2 text-right whitespace-nowrap`}
          style={{ background: mix('var(--accent)', 14, 'var(--surface-raised)') }}
        >
          <span className="text-[14px]" style={{ color: 'var(--ink-primary)' }}>
            {formatFullUzs(data.fund.amount)}
          </span>
        </td>
      </tr>
    </>
  )
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function Num({
  children,
  strong = false,
  ruleStrong = false,
  pinRight = false,
  band,
}: {
  children: ReactNode
  strong?: boolean
  ruleStrong?: boolean
  /** JAMI: pinned to the right edge from `sm`, so it is opaque — the row's band painted over the card. */
  pinRight?: boolean
  band?: string
}) {
  return (
    <td
      className={`tabular ${ruleStrong ? RULE_STRONG : RULE} ${pinRight ? PIN_RIGHT : ''} px-3 py-1.5 text-right text-[12.5px] whitespace-nowrap`}
      style={{
        color: strong ? 'var(--ink-primary)' : 'var(--ink-secondary)',
        ...(pinRight ? { backgroundColor: 'var(--surface-raised)', backgroundImage: band ? layers(band) : undefined } : {}),
      }}
    >
      {children}
    </td>
  )
}

function Muted() {
  return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
}

/** The rate beside its money: on a week, on БАЗА and on a flat rate it IS the tier, so it is printed. */
export function RatePill({ rate }: { rate: number }) {
  return (
    <span
      className="rounded-full px-1.5 py-px text-[10px] font-semibold"
      style={rate > 0 ? { background: 'var(--grid)', color: 'var(--ink-primary)' } : { color: 'var(--ink-muted)' }}
    >
      {formatNumber(rate)}%
    </span>
  )
}

/**
 * The fixed part and, under it, how far the next rung is — a rail with the gap
 * in compact soʻm beside it, never a percentage. A flat rate has no rung.
 */
function FixedCell({ row }: { row: PayrollSellerDto }) {
  return (
    <span className="block">
      <span className="block" style={{ color: 'var(--ink-secondary)' }}>
        {row.fixed.amount > 0 ? formatFullUzs(row.fixed.amount) : NO_VALUE}
      </span>
      {row.nextFloor && row.toNext ? (
        <span className="mt-1 flex items-center justify-end gap-2">
          <span
            className="h-1.5 w-[48px] shrink-0 overflow-hidden rounded-full"
            style={{ background: 'var(--track)' }}
            role="img"
            aria-label={`${formatCompactUzs(row.nextFloor.amount)} gacha ${formatCompactUzs(row.toNext.amount)}`}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${tierProgress(row)}%`,
                background: 'var(--seq-450)',
                transition: 'width var(--duration-enter) var(--ease-out)',
              }}
            />
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            {formatCompactUzs(row.nextFloor.amount)} gacha {formatCompactUzs(row.toNext.amount)}
          </span>
        </span>
      ) : row.table !== 'flat' ? (
        <span className="block text-[10px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
          eng yuqori bosqich
        </span>
      ) : null}
    </span>
  )
}

/** The change and what it is off; nobody in the comparison window reads «yangi», never «+∞%». */
export function Growth({ delta, previous, team = false }: { delta: DeltaDto; previous: MoneyDto | null; team?: boolean }) {
  if (previous === null) return <NewChip team={team} />
  return (
    <span className="flex flex-col items-end gap-0.5">
      <TrendIndicator delta={delta} />
      <span className="text-[10px] font-normal" style={{ color: 'var(--ink-muted)' }}>
        oldin {formatCompactUzs(previous.amount)}
      </span>
    </span>
  )
}

/**
 * How far along the current rung a seller stands, 0–100 — measured from the
 * rung already cleared, so the bars do not all read nine-tenths full.
 */
export function tierProgress(row: PayrollSellerDto): number {
  const floor = row.tierFloor?.amount ?? 0
  const next = row.nextFloor?.amount ?? 0
  if (next <= floor) return 0
  return Math.max(0, Math.min(100, ((row.fakt2.amount - floor) / (next - floor)) * 100))
}

// ---------------------------------------------------------------------------
// The working in words — shared with the copy button
// ---------------------------------------------------------------------------

/**
 * «52 340 000 × 8% + 500 000 =» — one seller's pay as the documents write it.
 * Read off the server's own rate and fixed part, never re-decided here.
 */
export function sellerFormula(row: PayrollSellerDto): string {
  if (row.table === 'standard' && row.percentRate === 0) {
    return `${formatFullUzs(row.fakt2.amount)} — 15 mln gacha, toʻlanmaydi =`
  }
  const base = `${formatFullUzs(row.fakt2.amount)} × ${formatNumber(row.percentRate)}%`
  return row.fixed.amount > 0 ? `${base} + ${formatFullUzs(row.fixed.amount)} =` : `${base} =`
}

/** «120 000 000 × 2% + 2 000 000 =» — a ROP's pay, the same way. */
export function ropFormula(team: PayrollTeamDto): string {
  const pay = team.ropPay
  if (!pay) return ''
  const base = `${formatFullUzs(pay.basis.amount)} × 2%`
  return pay.fixed.amount > 0 ? `${base} + ${formatFullUzs(pay.fixed.amount)} =` : `${base} =`
}

// ---------------------------------------------------------------------------
// Colour — tokens only, mixed, so light and dark both carry it (as on /rnp)
// ---------------------------------------------------------------------------

/** Each block's hue. Not teal or amber: on this page those are «foiz» and «fiksa». */
export const BRANCH_HUE: Readonly<Record<PayrollBranch, string>> = {
  toshkent: 'var(--series-1)',
  navoiy: 'var(--series-2)',
  baza: 'var(--series-6)',
  zextra: 'var(--series-7)',
  other: 'var(--ink-muted)',
}

function mix(color: string, pct: number, base = 'transparent'): string {
  return `color-mix(in oklab, ${color} ${pct}%, ${base})`
}

/** Colours stacked as background layers — over a pinned cell's own card colour, and under a row's hover. */
function layers(...colors: string[]): string {
  return colors.map((c) => `linear-gradient(${c}, ${c})`).join(', ')
}

/** Text in a hue, pulled towards the ink so it reads on its own tint in either theme. */
function inkOf(hue: string): string {
  return mix(hue, 68, 'var(--ink-primary)')
}

/** Separate borders travel with a sticky cell; collapsed ones do not. */
const RULE = 'border-b border-[var(--border)]'
/** The JAMI column, pinned right from `sm`, with its divider as a shadow (a border would not travel). */
const PIN_RIGHT = 'sm:sticky sm:right-0 sm:shadow-[inset_1px_0_0_var(--border-strong)]'
const RULE_STRONG = 'border-b border-[var(--border-strong)]'
