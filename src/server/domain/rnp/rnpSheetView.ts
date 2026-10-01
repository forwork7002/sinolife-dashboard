/**
 * «RNP jadvali» as the client's sheet — every row of «СентябрРНП 26» in its
 * order (`RNP_SHEET_LAYOUT`), each filled from the Bitrix24 row that names it.
 *
 * THE CLIENT'S DECISIONS OF 2026-09-30. The page is the sheet and nothing
 * else («faqat jadval … to'liqligicha»). A row Bitrix24 cannot supply —
 * followers, a group's «без квал» — keeps its place with empty cells
 * (`key: null`). The one thing typed by hand is the P&L's five cost lines
 * (rows carrying `manual`), at the client's request of the same afternoon.
 *
 * NOTHING IS LOST. A team the sheet has no block for (a new ROP, «Kompaniya»,
 * «(ROP yoʻq)») still sold, and the company totals count it — so its block is
 * added after the sheet's own teams and its logistics after the sheet's
 * logistics, each marked as an addition. The same goes for the kval of registrars in no «guruh» (after the
 * groups) — or the group rows stop adding up to row 48. The dashboard's own extra rows (duplicates, AI triage, the
 * no-brand P&L …) are not the sheet and are left out.
 *
 * Pure: blocks in, lines out.
 */

import type { RnpBlockDto, RnpRowDto } from './rnpSheet'
import { type RnpFactTone, type RnpLabelTone, RNP_SHEET_LAYOUT } from './rnpSheetLayout'

export type RnpLine =
  | {
      readonly kind: 'title'
      /** The sheet row, or null for an added team's heading. */
      readonly row: number | null
      /** The ROP team the line belongs to — what «ROP» on the page filters by; null = company-wide. */
      readonly team: string | null
      readonly label: string
      readonly sub: string | null
      readonly tone: RnpLabelTone
    }
  | {
      readonly kind: 'value'
      readonly row: number | null
      readonly team: string | null
      readonly label: string
      readonly sub: string | null
      readonly tone: RnpLabelTone
      readonly fact: RnpFactTone
      readonly bold: boolean
      /** The Bitrix24 row that fills it; null = Bitrix24 cannot supply this row. */
      readonly key: string | null
    }

/*
  Where extra lines go — after the last line of a section. The client's
  layout is no longer in sheet-row order (2026-09-30: plan % leads each ROP
  block, totals above the targets …), so a section is its set of rows, not a
  range: the registration groups end at «Sadriddin ROP · квал %» (1013), the
  ROP blocks at Фаррух's last line, logistics at Мафтуна's.
*/
const inRange = (lo: number, hi: number) => (row: number) => row >= lo && row <= hi
const GROUPS = (row: number) => inRange(47, 67)(row) || inRange(1001, 1013)(row)
const TEAMS = inRange(75, 246)
const LOGISTICS = inRange(269, 334)

const ADDED_TEAM_NOTE = 'Bitrix24ʼdan · sheetda bloki yoʻq'

/** The team a row's key names: `team:<rop>:…` or `lg:<rop>:…`. Exported for its test. */
export function teamOfKey(key: string | null): string | null {
  const block = key === null ? null : /^(?:team|lg):(.+):[^:]+$/.exec(key)
  return block ? block[1]! : null
}

export function sheetLines(blocks: readonly RnpBlockDto[]): RnpLine[] {
  const byRow = new Map<number, RnpRowDto>()
  for (const block of blocks) {
    for (const row of block.rows) {
      if (row.sheet && !byRow.has(row.sheet.row)) byRow.set(row.sheet.row, row)
    }
  }

  const lines: RnpLine[] = []
  for (const [row, label, sub, kind, bold, tone, fact] of RNP_SHEET_LAYOUT) {
    if (kind === 'title') {
      lines.push({ kind: 'title', row, team: null, label, sub, tone })
      continue
    }
    const source = byRow.get(row)
    if (kind === 'helper') {
      // The sheet's unlabelled scratch rows: only the one Bitrix24 fills.
      if (source) lines.push({ kind: 'value', row, team: teamOfKey(source.key), label: source.sheet?.label ?? source.label, sub: null, tone, fact, bold, key: source.key })
      continue
    }
    const key = source?.key ?? null
    lines.push({ kind: 'value', row, team: teamOfKey(key), label, sub, tone, fact, bold, key })
  }

  const valueLine = (r: RnpRowDto): RnpLine => ({
    kind: 'value',
    row: null,
    team: teamOfKey(r.key),
    label: r.label,
    sub: null,
    tone: 'plain',
    fact: r.tone === 'total' ? 'fakt' : 'plain',
    bold: r.tone === 'total',
    key: r.key,
  })
  const addedTeams = blocks
    .filter((b) => b.kind === 'team' && b.sheet === null)
    .flatMap((b): RnpLine[] => [
      { kind: 'title', row: null, team: b.team, label: b.title, sub: ADDED_TEAM_NOTE, tone: 'team' },
      ...b.rows.map(valueLine),
    ])
  const addedLogistics = blocks
    .filter((b) => b.kind === 'logistics' && b.team !== null && b.sheet === null)
    .flatMap((b): RnpLine[] => [
      { kind: 'title', row: null, team: b.team, label: b.title, sub: ADDED_TEAM_NOTE, tone: 'section' },
      ...b.rows.map(valueLine),
    ])
  const ungrouped = (blocks.find((b) => b.kind === 'registration')?.rows ?? [])
    .filter((r) => r.key === 'reg:group:none:qualified')
    .map(valueLine)

  insertAfter(lines, LOGISTICS, addedLogistics)
  insertAfter(lines, TEAMS, addedTeams)
  insertAfter(lines, GROUPS, ungrouped)
  return lines
}

/** After the last line whose layout row belongs to the section. */
function insertAfter(lines: RnpLine[], section: (row: number) => boolean, extra: readonly RnpLine[]): void {
  if (extra.length === 0) return
  const at = lines.findLastIndex((line) => line.row !== null && section(line.row))
  lines.splice(at + 1, 0, ...extra)
}
