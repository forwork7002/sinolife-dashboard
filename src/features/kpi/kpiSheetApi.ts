/**
 * «KPI jadvali» — mirrors `KpiSheetDto` in `src/server/services/sverkaService.ts`
 * and `KpiSheetLine` in `src/server/domain/sverka/kpiSheet.ts`. Nothing checks
 * the mirror: edit both sides.
 */

export type KpiSheetScope = 'all' | 'Collagen' | 'Zextra'
export type KpiSheetSide = 'bitrix' | 'moysklad' | 'diff' | 'mismatch'
export type KpiSheetUnit = 'count' | 'uzs' | 'usd'
export type KpiSheetBasis = 'FAKT1' | 'FAKT2'

export type KpiSheetLine =
  | {
      readonly kind: 'title'
      readonly key: string
      readonly label: string
      readonly scope: KpiSheetScope
    }
  | {
      readonly kind: 'value'
      readonly key: string
      readonly label: string
      readonly side: KpiSheetSide
      readonly unit: KpiSheetUnit
      readonly scope: KpiSheetScope
      readonly basis: KpiSheetBasis
      readonly opens: boolean
      readonly total: number | null
      readonly days: readonly (number | null)[]
    }

export type KpiSheetValueLine = Extract<KpiSheetLine, { kind: 'value' }>

export interface KpiSheetDto {
  readonly month: string
  readonly days: readonly string[]
  readonly today: string
  readonly usdPerOrder: number
  readonly moysklad: { readonly since: string; readonly lastSuccessAt: string | null }
  readonly lines: readonly KpiSheetLine[]
}

/** The first month the sheet answers — MoySklad's first (`/kpi/sheet`'s floor). */
export const KPI_SHEET_FIRST_MONTH = '2026-06'

/** A `YYYY-MM` the sheet can open on, or null — the RNP month box's rule (`rnpMonthIn`) on this floor. */
export function kpiMonthIn(value: string | null, current: string): string | null {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= KPI_SHEET_FIRST_MONTH && value <= current ? value : null
}

/** The lines one brand switch keeps: «Hammasi» every block, a brand its own. */
export function scopeLines(lines: readonly KpiSheetLine[], scope: KpiSheetScope): readonly KpiSheetLine[] {
  return scope === 'all' ? lines : lines.filter((l) => l.scope === scope)
}

const SIDE_NAME: Record<KpiSheetSide, string> = {
  bitrix: 'Bitrix24',
  moysklad: 'MoySklad',
  diff: 'Farq (MoySklad − Bitrix24)',
  mismatch: '',
}

/**
 * The sheet as Excel reads it — a `;`-separated CSV with a BOM, as the
 * dashboard's other CSVs (`ReturningCallersCard`): Excel set to a comma
 * decimal opens `;` straight into columns, and the BOM keeps the Cyrillic.
 * Figures are plain numbers (no thousands mark), so Excel sums them.
 */
export function kpiSheetCsv(data: KpiSheetDto, lines: readonly KpiSheetLine[]): string {
  const cell = (text: string) => (/[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)
  const number = (value: number | null, unit: KpiSheetUnit) =>
    value === null ? '' : unit === 'count' ? String(Math.round(value)) : String(Math.round(value * 100) / 100).replace('.', ',')
  const head = ['Koʻrsatkich', 'Manba', 'Jami', ...data.days.map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`)]
  const out: string[] = [head.map(cell).join(';')]
  let label = ''
  for (const line of lines) {
    if (line.kind === 'title') {
      out.push(cell(line.label))
      continue
    }
    if (line.opens) label = line.label
    out.push(
      [label, SIDE_NAME[line.side], number(line.total, line.unit), ...line.days.map((v) => number(v, line.unit))].map(cell).join(';'),
    )
  }
  return `﻿${out.join('\r\n')}`
}

// ---------------------------------------------------------------------------
// The sheet as the screen draws it: a figure is a PAIR, not three rows
// ---------------------------------------------------------------------------

type TitleLine = Extract<KpiSheetLine, { kind: 'title' }>

/**
 * One figure on screen: its Bitrix24 row and its MoySklad row, the
 * difference read off the two (the server's «Farq» row stays in the payload
 * and in the CSV). `match` is how much of the month agrees — see `matchOf`.
 */
export interface KpiPair {
  readonly kind: 'pair'
  readonly key: string
  readonly label: string
  readonly unit: KpiSheetUnit
  readonly scope: KpiSheetScope
  readonly basis: KpiSheetBasis
  readonly bitrix: KpiSheetValueLine
  readonly moysklad: KpiSheetValueLine
  /** MoySklad − Bitrix24 per day; null where either side has no figure. */
  readonly gaps: readonly (number | null)[]
  /** The month's: the server's «Farq» total when there is one, else the two totals' gap. */
  readonly gapTotal: number | null
  readonly differs: boolean
  /** Per cent, 0–100; null when Bitrix24 holds nothing to agree with. */
  readonly match: number | null
}

export type KpiGroup =
  | { readonly kind: 'title'; readonly line: TitleLine }
  | KpiPair
  | { readonly kind: 'single'; readonly line: KpiSheetValueLine; readonly differs: boolean }

/** A gap under one whole piece or soʻm (a cent for dollars) is float or tiyin noise — the cards' rule. */
export function wholeGap(value: number, unit: KpiSheetUnit): number {
  return unit === 'usd' ? Math.round(value * 100) / 100 : Math.round(value)
}

/**
 * How much of the month the two systems agree on, per cent: one less the
 * days' absolute gaps over Bitrix24's figure on those days — so a −3 on one
 * day and a +3 on another is not «100%», as their sum would say.
 */
export function matchOf(bitrix: readonly (number | null)[], gaps: readonly (number | null)[], unit: KpiSheetUnit): number | null {
  let base = 0
  let off = 0
  gaps.forEach((gap, i) => {
    const b = bitrix[i]
    if (gap === null || b === null || b === undefined) return
    base += Math.abs(b)
    off += Math.abs(wholeGap(gap, unit))
  })
  if (base === 0) return off === 0 ? null : 0
  return Math.max(0, (1 - off / base) * 100)
}

/** The lines folded into what the screen draws: headings, pairs and the single «Farqli buyurtmalar» rows. */
export function sheetGroups(lines: readonly KpiSheetLine[]): KpiGroup[] {
  const out: KpiGroup[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.kind === 'title') {
      out.push({ kind: 'title', line })
      continue
    }
    const next = lines[i + 1]
    if (line.side === 'bitrix' && next?.kind === 'value' && next.side === 'moysklad') {
      const after = lines[i + 2]
      const diff = after?.kind === 'value' && after.side === 'diff' ? after : null
      const gaps = line.days.map((b, d) => {
        const m = next.days[d]
        return b === null || m === null || m === undefined ? null : m - b
      })
      const gapTotal = diff ? diff.total : line.total === null || next.total === null ? null : next.total - line.total
      const differs = gaps.some((g) => g !== null && wholeGap(g, line.unit) !== 0) || (gapTotal !== null && wholeGap(gapTotal, line.unit) !== 0)
      out.push({
        kind: 'pair',
        key: line.key.replace(/:bitrix$/, ''),
        label: line.label,
        unit: line.unit,
        scope: line.scope,
        basis: line.basis,
        bitrix: line,
        moysklad: next,
        gaps,
        gapTotal,
        differs,
        match: matchOf(line.days, gaps, line.unit),
      })
      i += diff ? 2 : 1
      continue
    }
    if (line.side === 'mismatch') {
      out.push({ kind: 'single', line, differs: line.days.some((v) => v !== null && v > 0) })
    }
  }
  return out
}
