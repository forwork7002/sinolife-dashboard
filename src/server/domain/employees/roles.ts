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
export const SALES_TEAM_SUFFIX = '(ROP)'

/** Is this department one of the sales teams? */
export function isSalesTeamName(departmentName: string | null | undefined): boolean {
  if (!departmentName) return false
  return departmentName.trim().toLowerCase().endsWith(SALES_TEAM_SUFFIX.toLowerCase())
}

/**
 * Teams counted by WHO SITS IN THEM, never by the label on the deal.
 *
 * Every other team is the deal's «Организация сотрудника» snapshot, then the
 * seller's unit (`InsightsRepository.teamSql`). On 2026-10-19 the client
 * asked that «Malika» be exactly her people everywhere — the RNP sheet, the
 * queue's РОП column, Logistika, the sellers' team table — «shu xodimlar
 * bilan», whatever the deal says. Her unit was «Charos(ROP)» until the
 * portal renamed it, so her people's orders carried «Charos(ROP)»,
 * «Malika(ROP)» and, sold through other teams, «Asliddin(ROP)» and others.
 *
 * `unitExternalId` is the portal unit; its members are the people filed there
 * first, less anyone who heads a unit elsewhere (the Zextra department's head
 * is filed there) — the rule `ScopeRepository.teamEmployeeIds` uses for her
 * account. `labels` are every name this team has worn: a deal carrying one
 * of them sold by somebody else goes to that seller's own team, not here.
 */
export const ROSTER_TEAMS: readonly {
  readonly unitExternalId: string
  readonly label: string
  readonly labels: readonly string[]
}[] = [{ unitExternalId: '94', label: 'Malika', labels: ['Malika', 'Charos'] }]

/**
 * Teams the owner MERGED into another, FROM A DAY ON: from `from` (a Tashkent
 * day) the left name reads as `into` on every screen; what was done before it
 * stays the old team's.
 *
 * 2026-11-04, the owner: «shohjahon degan narsa yoʻq endilikda … rnp rop
 * otchet boshqa joylarda endilikda azizbek va shohjahon bitta boʻldi», then,
 * the same evening, «bugungi kunda qoʻshgan vaqtingdan boshlab azizbekni
 * hisoblaysan eski shohjahonni natijalarini qoʻshma» — the first version
 * (89bc926) folded every month and put Shohjaxon's October on Azizbek. The
 * portal was NOT changed: that day unit 76 «Shohjaxon(ROP)» still had its 12
 * people under its own head (portal user 68210), and deals were still
 * stamped «Shohjaxon(ROP)» (38 created 20.10–04.11, against 358 for
 * «Azizbek(ROP)»).
 *
 * WHAT DATES A ROW is the thing the screen counts: a deal by its sale
 * (`createdAtSource`, when the portal stamps the team), a handed-out lead by
 * «Лид таркатилган сана», a kirim by its arrival, a call by its start
 * (`InsightsRepository.ropNameSql`'s `asOf`). Who is in a team NOW (the ROP
 * otchet roster of a window reaching the day, the joined team's head's TEAM
 * scope) reads the merge; the heads and ancestors of units keep each unit's
 * own name, so an old month's «Shohjaxon» still has its head.
 *
 * Keys and `into` are department names without «(ROP)», as `ropNameSql`
 * prints them; letters only — they are spliced into SQL.
 */
export interface TeamMerge {
  readonly into: string
  /** The first Tashkent day of the merge, `YYYY-MM-DD`. */
  readonly from: string
}

export const MERGED_TEAMS: Readonly<Record<string, TeamMerge>> = Object.freeze({
  Shohjaxon: Object.freeze({ into: 'Azizbek', from: '2026-11-04' }),
})

/** The instant a merge takes effect: its first day's Tashkent midnight (UTC+5; Uzbekistan keeps no DST). */
export function mergeStartsAt(merge: TeamMerge): Date {
  return new Date(`${merge.from}T00:00:00+05:00`)
}

/**
 * A team as the screens name it for `at` — a Tashkent day `YYYY-MM-DD` or an
 * instant; omitted, today. A merged team on or after its day is the one it
 * joined; before, itself. Case-insensitive, like `ropNameSql`'s strip.
 */
export function mergedTeam(team: string, at?: string | Date): string {
  const key = team.trim().toLowerCase()
  for (const [from, merge] of Object.entries(MERGED_TEAMS)) {
    if (from.toLowerCase() !== key) continue
    const on = at === undefined || (typeof at === 'string' ? at.slice(0, 10) >= merge.from : at.getTime() >= mergeStartsAt(merge).getTime())
    return on ? merge.into : team
  }
  return team
}
