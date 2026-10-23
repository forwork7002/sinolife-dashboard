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

/**
 * Whether a figure's group shows a difference anywhere in the month — the
 * mark its label carries. Read off the group's «Farq» row (a difference row
 * of its own for «Farqli buyurtmalar»); a group with neither has none.
 */
export function groupDiffers(lines: readonly KpiSheetLine[], at: number): boolean {
  for (let i = at; i < lines.length; i++) {
    const line = lines[i]!
    if (line.kind !== 'value' || (i > at && line.opens)) return false
    if (line.side === 'diff' || line.side === 'mismatch') {
      return line.days.some((v) => v !== null && Math.round(v) !== 0)
    }
  }
  return false
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
