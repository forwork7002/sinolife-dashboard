/**
 * «RNP jadvali» as the client's sheet — every row of «СентябрРНП 26» in its
 * order (`RNP_SHEET_LAYOUT`), each filled from the Bitrix24 row that names it.
 *
 * THE CLIENT'S DECISIONS OF 2026-09-30. The page is the sheet and nothing
 * else («faqat jadval … to'liqligicha»). A row Bitrix24 cannot supply —
 * followers, HR, the typed P&L cost lines, a group's «без квал» — keeps its
 * place with empty cells (`key: null`); nothing is typed in by hand.
 *
 * NOTHING IS LOST. A team the sheet has no block for (a new ROP, «Kompaniya»,
 * «(ROP yoʻq)») still sold, and the company totals count it — so its block is
 * added after the sheet's own teams, its logistics after the sheet's
 * logistics and its «Свод» lines after the sheet's, each marked as an
 * addition. The same goes for kval the sheet's registration rows cannot hold:
 * registrars in no «guruh» (after the groups) and a Zextra registrar beyond
 * the sheet's two (after them) — or the group rows stop adding up to row 48. The dashboard's own extra rows (duplicates, AI triage, the
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

/** The last sheet row of each section extra rows are appended after. */
const GROUPS_END = 67
const REGISTRARS_END = 73
const TEAMS_END = 246
const LOGISTICS_END = 334
const SVOD_FAKT1_END = 362
const SVOD_FAKT2_END = 374

const ADDED_TEAM_NOTE = 'jadvalda yoʻq jamoa'

/** The team a row's key names: `team:<rop>:…`, `lg:<rop>:…`, `sv:fakt1:<rop>`, `sv:fakt2:<rop>`. Exported for its test. */
export function teamOfKey(key: string | null): string | null {
  if (key === null) return null
  const block = /^(?:team|lg):(.+):[^:]+$/.exec(key)
  if (block) return block[1]!
  const svod = /^sv:fakt[12]:(.+)$/.exec(key)
  return svod ? svod[1]! : null
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
  const registration = blocks.find((b) => b.kind === 'registration')?.rows ?? []
  const addedRegistration = (prefix: string) =>
    registration.filter((r) => r.key.startsWith(prefix) && r.sheet === null).map(valueLine)
  const svod = blocks.find((b) => b.kind === 'summary')?.rows ?? []
  const addedSvod = (prefix: string) =>
    svod.filter((r) => r.key.startsWith(prefix) && r.sheet === null).map(valueLine)

  // Inserted from the bottom up, so each index still points where it did.
  insertAfter(lines, SVOD_FAKT2_END, addedSvod('sv:fakt2:'))
  insertAfter(lines, SVOD_FAKT1_END, addedSvod('sv:fakt1:'))
  insertAfter(lines, LOGISTICS_END, addedLogistics)
  insertAfter(lines, TEAMS_END, addedTeams)
  insertAfter(lines, REGISTRARS_END, addedRegistration('reg:registrar:'))
  insertAfter(lines, GROUPS_END, addedRegistration('reg:group:none'))
  return lines
}

/** After the last line whose sheet row is at or before `row`. */
function insertAfter(lines: RnpLine[], row: number, extra: readonly RnpLine[]): void {
  if (extra.length === 0) return
  let at = -1
  lines.forEach((line, i) => {
    if (line.row !== null && line.row <= row) at = i
  })
  lines.splice(at + 1, 0, ...extra)
}
