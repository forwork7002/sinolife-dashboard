/**
 * «RNP jadvali» for a TEAM account that holds it as «Oʻz boʻlimi»
 * (2026-10-24, the user, for Malika: «faqat … oʻzini ichidagi xodimlari
 * chiqsin»).
 *
 * THE SMALLEST CUT IS A TEAM. The sheet has no seller rows: a team's block and
 * its logistics are the team's money, every other line (Маркетинг,
 * Регистрация, the P&L, the warehouse, the company logistics) is the
 * company's. So a narrowed reader is handed their own teams' lines and the
 * blocks those lines read, and nothing else — the same cut «ROP» makes on the
 * page, done here so no other team's figure leaves the server.
 *
 * Applied to the FINISHED sheet, after the month's memo: the memo stays one
 * company-wide answer and no key needs the scope.
 *
 * Pure: a sheet and a team set in, the sheet out.
 */

import type { RnpOverviewDto } from './rnpSheet'

export function narrowRnpSheet(sheet: RnpOverviewDto, teams: ReadonlySet<string>): RnpOverviewDto {
  const mine = (team: string | null) => team !== null && teams.has(team)
  const blocks = sheet.blocks.filter((b) => mine(b.team))
  const kept = new Set(blocks.flatMap((b) => b.rows.map((r) => r.key)))
  return {
    ...sheet,
    teams: sheet.teams.filter((t) => mine(t.rop)),
    blocks,
    // A line of the team that reads another block's row would carry that row's figures: dropped.
    lines: sheet.lines.filter((l) => mine(l.team) && (l.kind === 'title' || l.key === null || kept.has(l.key))),
    narrowedTo: [...teams].sort(),
  }
}
