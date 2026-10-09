/**
 * «RNP jadvali» as the client's sheet — every row of «СентябрРНП 26» in its
 * order (`RNP_SHEET_LAYOUT`), each filled from the Bitrix24 row that names it.
 *
 * THE CLIENT'S DECISIONS OF 2026-09-30. The page is the sheet and nothing
 * else («faqat jadval … to'liqligicha»). A row Bitrix24 cannot supply —
 * followers — keeps its place with empty cells
 * (`key: null`). Typed by hand (rows carrying `manual`): the P&L's five cost
 * lines (2026-09-30) and each ROP's «Ходим сони» (2026-10-01); column-C plans
 * are typed in their own cells (`planInput`).
 *
 * NOTHING IS LOST. A team the sheet has no block for (a new ROP, «Kompaniya»,
 * «(ROP yoʻq)») still sold, and the company totals count it — so its block is
 * added after the sheet's own teams and its logistics after the sheet's
 * logistics, drawn on the sheet's own template and marked as an addition. The
 * same goes for the leads handed to teams no «guruh» row is named after
 * (after the groups) — or the group rows stop adding up to the leads handed
 * to the ROPs. The dashboard's own extra rows (duplicates, AI triage, the
 * no-brand P&L …) are not the sheet and are left out.
 *
 * Pure: blocks in, lines out.
 */

import type { RnpBlockDto, RnpRowDto } from './rnpSheet'
import { type RnpFactTone, type RnpLabelTone, RNP_SHEET_LAYOUT } from './rnpSheetLayout'

/** A line's brand on the switch; `both` = a heading each brand keeps over its own rows. */
export type RnpLineBrand = 'Collagen' | 'Zextra' | 'none' | 'both'

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
      /** The first line of a team the sheet has no block for — the page marks it so. */
      readonly added?: true
      /** The Collagen / Zextra switch's brand (`lineBrand` in rnpSheet.ts); absent = company-wide. */
      readonly brand?: RnpLineBrand
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
      /** The first line of a team the sheet has no block for — the page marks it so. */
      readonly added?: true
      /** The Collagen / Zextra switch's brand (`lineBrand` in rnpSheet.ts); absent = company-wide. */
      readonly brand?: RnpLineBrand
      /** Drawn under its `brand` only, never on «Hammasi» (a brand's cut of a company-wide row). */
      readonly brandOnly?: true
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

/*
  The sheet's B346 is the month's name, typed — and «ИЮЛЬ» ever since July,
  in August, September and October alike. The page prints the month it
  shows, in the sheet's spelling, as its June and July tabs did.
*/
const MONTH_NAME_ROW = 346
const MONTH_NAMES = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'] as const

/** The team a row's key names: `team:<rop>:…` or `lg:<rop>:…`. Exported for its test. */
export function teamOfKey(key: string | null): string | null {
  const block = key === null ? null : /^(?:team|lg):(.+):[^:]+$/.exec(key)
  return block ? block[1]! : null
}

/** What a team row's key measures, whoever's it is: `team:Sevinch:conv1` → `conv1`. */
const metricOfKey = (key: string) => key.slice(key.lastIndexOf(':') + 1)

/**
 * `month` (`YYYY-MM`) names the page's month on row 346; `teamName` is the
 * one name a team goes by (`labelOf` in `rnpSheet.ts`), printed beside an
 * added block's first line.
 */
export function sheetLines(blocks: readonly RnpBlockDto[], options: { month: string; teamName: (rop: string) => string }): RnpLine[] {
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
    const named = row === MONTH_NAME_ROW ? (MONTH_NAMES[Number(options.month.slice(5, 7)) - 1] ?? sub) : sub
    lines.push({ kind: 'value', row, team: teamOfKey(key), label, sub: named, tone, fact, bold, key })
  }

  const valueLine = (r: RnpRowDto): Extract<RnpLine, { kind: 'value' }> => ({
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
  /*
    AN ADDED TEAM IS DRAWN ON THE SHEET'S OWN TEMPLATE (2026-10-02): the lines
    of the first sheet block of its shape — a lead team's, a БАЗА team's, a
    logistics block's — with their labels, bold and tones, in their order,
    filled from the added team's rows, its name on the first line where a
    sheet block names its ROP. A row the template does not draw stays in the
    payload, off the page («Жараёнда, %»). Before, an added block read the
    server's labels in the server's order under a heading band: Шохжахон's
    «План бажарилиши» came sixth and his leads read «РОП олган лид».
  */
  const added = (kind: RnpBlockDto['kind'], prefix: 'team' | 'lg', tone: RnpLabelTone): RnpLine[] =>
    blocks
      .filter((b) => b.kind === kind && b.team !== null && b.sheet === null)
      .flatMap((b): RnpLine[] => {
        const team = b.team!
        const has = new Set(b.rows.map((r) => metricOfKey(r.key)))
        const template = blocks
          .filter((t) => t.kind === kind && t.team !== null && t.sheet !== null)
          .map((t) => lines.filter((l) => l.kind === 'value' && l.key !== null && l.key.startsWith(`${prefix}:${t.team}:`)))
          .find((own) => own.length > 0 && own.every((l) => l.kind === 'value' && has.has(metricOfKey(l.key!))))
        // No sheet block of its shape to copy: its own rows under a marked heading, rather than lose them.
        if (!template) return [{ kind: 'title', row: null, team, label: b.title, sub: null, tone, added: true }, ...b.rows.map(valueLine)]
        return template.flatMap((l, i): RnpLine[] =>
          l.kind !== 'value'
            ? []
            : [{ ...l, row: null, team, sub: i === 0 ? options.teamName(team) : l.sub, key: `${prefix}:${team}:${metricOfKey(l.key!)}`, ...(i === 0 ? { added: true as const } : {}) }],
        )
      })
  const addedTeams = added('team', 'team', 'team')
  const addedLogistics = added('logistics', 'lg', 'section')
  // The leads handed to teams no «guruh» row is named after («Boshqa jamoalar — квал»), and its cut per brand.
  const registrationRows = blocks.find((b) => b.kind === 'registration')?.rows ?? []
  const otherTeams = [
    ...registrationRows.filter((r) => r.key === 'reg:group:none:qualified').map(valueLine),
    ...(['Collagen', 'Zextra', 'none'] as const).flatMap((b) =>
      registrationRows
        .filter((r) => r.key === `reg:group:none:qualified:${b}`)
        .map((r): RnpLine => ({ ...valueLine(r), brand: b, brandOnly: true })),
    ),
  ]

  /*
    «Brendsiz проект» — the P&L of what neither brand claims, drawn like the
    two brands' («Коллаген / Зехтра проект»: the project's name on its first
    line, the metric beside it), under the «Brendsiz» slice only. The sheet
    has no such block, so «Hammasi» never shows it.
  */
  const brandlessProject = (blocks.find((b) => b.id === 'project:none')?.rows ?? []).map(
    (r, i): RnpLine => ({
      ...valueLine(r),
      label: i === 0 ? 'Brendsiz проект' : r.label,
      sub: i === 0 ? r.label : null,
      tone: i === 0 ? 'section' : 'brand',
      bold: i === 0,
      brand: 'none',
      brandOnly: true,
    }),
  )
  lines.push(...brandlessProject)

  insertAfter(lines, LOGISTICS, addedLogistics)
  insertAfter(lines, TEAMS, addedTeams)
  insertAfter(lines, GROUPS, otherTeams)
  return lines
}

/** After the last line whose layout row belongs to the section. */
function insertAfter(lines: RnpLine[], section: (row: number) => boolean, extra: readonly RnpLine[]): void {
  if (extra.length === 0) return
  const at = lines.findLastIndex((line) => line.row !== null && section(line.row))
  lines.splice(at + 1, 0, ...extra)
}
