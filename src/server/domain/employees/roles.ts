/**
 * Which departments are SALES TEAMS.
 *
 * WHY NOT `Employee.position`
 * Because it is NULL for all 288 employees on this portal. Bitrix24 never
 * filled the job-title field, so classifying by title would classify nobody.
 * The department tree is the only place the portal actually records who does
 * what — so that is what this reads.
 *
 * THE RULE
 * A sales team is a department whose name ends with "(ROP)", the portal's own
 * naming convention for one, typed by hand fifteen times (Lola(ROP),
 * Azizbek(ROP), Baza(ROP), …). `departmentHeads.ts` reads it to put the sales
 * teams first in the ROP picker on `/users`.
 *
 * The file is named for what it used to do as well: classify every employee as
 * SELLER, MANAGER or OTHER so the leaderboard ranked sellers only (c0f53fe),
 * with the same rule restated in SQL by `dealRepository.findLeaderboardRoster`.
 * That query went in b5b2ad2, and the classifier, with no caller left, on
 * 2026-10-06.
 */

/**
 * The suffix that marks a department as a sales team.
 *
 * "ROP" is руководитель отдела продаж — head of sales department. The portal
 * names each sales team after its ROP and tags it with this suffix; there is no
 * flag, no type column and no other marker. Comparison is case-insensitive and
 * ignores surrounding whitespace because these names are typed by hand, and
 * "Charos(ROP) " with a trailing space is a data-entry slip, not a different
 * kind of department.
 */
const SALES_TEAM_SUFFIX = '(ROP)'

/** Is this department one of the sales teams? */
export function isSalesTeamName(departmentName: string | null | undefined): boolean {
  if (!departmentName) return false
  return departmentName.trim().toLowerCase().endsWith(SALES_TEAM_SUFFIX.toLowerCase())
}
