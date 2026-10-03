/**
 * «Guruhlar · безквал / квал» on «Lidlar» — the client's daily group report
 * (2026-10-02): «Азиз гр - 144 (безквал) = 27 квал … Общий 538 = 150,
 * Конвер 27,8%».
 *
 * WHERE EACH NUMBER COMES FROM.
 *   Безквал — the leads the group took in that day, TYPED on the card: the
 *     portal writes a lead's «Регистрация» label only at «Сделка успешна»
 *     (28.09: none of 920 unqualified deals carried one), so no Bitrix24
 *     field knows a group's intake.
 *   Квал — what /rnp's «guruh — квал» rows count (`rnpSheet.ts`): the day's
 *     leads handed («Лид таркатилган сана», «РОП (Первичка)») to the ROP team
 *     the group is named after (`GROUP_TEAM`; the client's decision of
 *     2026-10-02 — it was the group of each lead's registrar, a map nothing
 *     could edit any more). 0 is a measurement. Like /rnp it counts only FRESH
 *     hand-outs (`leadDaysSql`: created ≤ 30 days before), so on a re-stamp
 *     day the groups + «Boshqa» can read below «Lid manbalari»'s unbounded
 *     split «Jami».
 *   Конвер — квал ÷ безквал.
 *
 * Leads handed to any other ROP team are shown apart and stay out of
 * «Общий», as in the client's report.
 *
 * Pure: rows in, a DTO out.
 */

import { GROUP_TEAM as RNP_GROUP_TEAM, sheetTeamLabel, TEAM_ALIASES } from '@/server/domain/rnp/rnpSheet'

/** The client's rows, in the client's order. */
export const INTAKE_GROUPS = ['Aziz', 'Gulzora', 'Lola', 'Saidaziz', 'Sevinch', 'Maftuna', 'Marjona'] as const
export type IntakeGroup = (typeof INTAKE_GROUPS)[number]

/**
 * Each group's ROP team — /rnp's own map («Aziz» is Azizbek's team), so the
 * two screens cannot drift. «Marjona» has no /rnp group row (there her leads
 * are in «Boshqa jamoalar»); here she is her own team, Marjona, which the
 * portal's «РОП (Первичка)» rarely names — her kval reads near 0.
 */
export const GROUP_TEAM: Readonly<Record<IntakeGroup, string>> = Object.freeze({
  Aziz: RNP_GROUP_TEAM.Aziz,
  Gulzora: RNP_GROUP_TEAM.Gulzora,
  Lola: RNP_GROUP_TEAM.Lola,
  Saidaziz: RNP_GROUP_TEAM.Saidaziz,
  Sevinch: RNP_GROUP_TEAM.Sevinch,
  Maftuna: RNP_GROUP_TEAM.Maftuna,
  Marjona: 'Marjona',
})

/** `RnpRepository.RnpLeadDayRow` without its day: the domain may not import a repository. */
export interface HandedOutRow {
  /** Null: not handed to a ROP team — not kval. */
  readonly rop: string | null
  readonly leads: number
}

export interface IntakeRow {
  readonly group: string
  readonly leads: number
}

export interface GroupIntakeRowDto {
  readonly group: IntakeGroup
  /** The ROP team whose handed-out leads are the group's kval, as /rnp names it («Азизбек РОП»). */
  readonly team: string
  /** Null: nobody typed it. */
  readonly intake: number | null
  readonly qualified: number
  readonly conversionPercent: number | null
}

export interface GroupIntakeDto {
  readonly day: string
  readonly groups: readonly GroupIntakeRowDto[]
  readonly total: { readonly intake: number; readonly qualified: number; readonly conversionPercent: number | null }
  /** Leads handed to a ROP team none of the groups is named after. */
  readonly ungroupedQualified: number
  readonly canEdit: boolean
}

const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null)

export function buildGroupIntake(input: {
  day: string
  handedOut: readonly HandedOutRow[]
  intake: readonly IntakeRow[]
  canEdit: boolean
}): GroupIntakeDto {
  const groupOf = new Map<string, IntakeGroup>(INTAKE_GROUPS.map((g) => [GROUP_TEAM[g], g]))
  const kval = new Map<IntakeGroup, number>()
  let ungroupedQualified = 0
  for (const r of input.handedOut) {
    if (r.rop === null) continue
    const g = groupOf.get(TEAM_ALIASES[r.rop] ?? r.rop)
    if (g !== undefined) kval.set(g, (kval.get(g) ?? 0) + r.leads)
    else ungroupedQualified += r.leads
  }
  const typed = new Map(input.intake.map((r) => [r.group, r.leads]))

  const groups = INTAKE_GROUPS.map((group): GroupIntakeRowDto => {
    const intake = typed.get(group) ?? null
    const qualified = kval.get(group) ?? 0
    return {
      group,
      team: sheetTeamLabel(GROUP_TEAM[group]),
      intake,
      qualified,
      conversionPercent: intake !== null ? percent(qualified, intake) : null,
    }
  })

  // «Общий» conversion pairs like with like: only the groups somebody typed, so a group with no intake does not inflate it.
  const both = groups.filter((g) => g.intake !== null)
  const sum = (xs: readonly (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0)
  return {
    day: input.day,
    groups,
    total: {
      intake: sum(groups.map((g) => g.intake)),
      qualified: sum(groups.map((g) => g.qualified)),
      conversionPercent: percent(sum(both.map((g) => g.qualified)), sum(both.map((g) => g.intake))),
    },
    ungroupedQualified,
    canEdit: input.canEdit,
  }
}
