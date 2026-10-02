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
 *     leads handed to a ROP («Лид таркатилган сана», «РОП (Первичка)» a ROP
 *     team), each to the group its registrar sits in that month.
 *   Конвер — квал ÷ безквал.
 *
 * A group no registrar is assigned to has no known kval — «—», not 0
 * («bilmagan joyni boʻsh qoldir»). Kval of registrars in none of these
 * groups is shown apart and stays out of «Общий», as in the client's report.
 *
 * Pure: rows in, a DTO out.
 */

/** The client's rows, in the client's order. Values match `rnp_registrar_group.group`. */
export const INTAKE_GROUPS = ['Aziz', 'Gulzora', 'Lola', 'Saidaziz', 'Sevinch', 'Maftuna', 'Marjona'] as const
export type IntakeGroup = (typeof INTAKE_GROUPS)[number]

/** `RnpRepository.RnpLeadDayRow` without its day: the domain may not import a repository. */
export interface HandedOutRow {
  /** Null: not handed to a ROP team — not kval. */
  readonly rop: string | null
  readonly registrar: string | null
  readonly leads: number
}

export interface IntakeRow {
  readonly group: string
  readonly leads: number
}

export interface GroupIntakeRowDto {
  readonly group: IntakeGroup
  /** The month's registrars of the group; empty: nobody assigned. */
  readonly registrars: readonly string[]
  /** Null: nobody typed it. */
  readonly intake: number | null
  /** Null: no registrar in the group, so not known. */
  readonly qualified: number | null
  readonly conversionPercent: number | null
}

export interface GroupIntakeDto {
  readonly day: string
  readonly groups: readonly GroupIntakeRowDto[]
  readonly total: { readonly intake: number; readonly qualified: number; readonly conversionPercent: number | null }
  /** Kval whose registrar is in none of the groups (or is blank). */
  readonly ungroupedQualified: number
  readonly canEdit: boolean
}

const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null)

export function buildGroupIntake(input: {
  day: string
  handedOut: readonly HandedOutRow[]
  registrarGroups: readonly { readonly registrar: string; readonly group: string }[]
  intake: readonly IntakeRow[]
  canEdit: boolean
}): GroupIntakeDto {
  const groupOf = new Map(input.registrarGroups.map((g) => [g.registrar, g.group]))
  const kval = new Map<string, number>()
  let ungroupedQualified = 0
  for (const r of input.handedOut) {
    if (r.rop === null) continue
    const g = r.registrar === null ? undefined : groupOf.get(r.registrar)
    if (g !== undefined && (INTAKE_GROUPS as readonly string[]).includes(g)) kval.set(g, (kval.get(g) ?? 0) + r.leads)
    else ungroupedQualified += r.leads
  }
  const typed = new Map(input.intake.map((r) => [r.group, r.leads]))

  const groups = INTAKE_GROUPS.map((group): GroupIntakeRowDto => {
    const registrars = input.registrarGroups.filter((g) => g.group === group).map((g) => g.registrar)
    const intake = typed.get(group) ?? null
    const qualified = registrars.length > 0 ? (kval.get(group) ?? 0) : null
    return {
      group,
      registrars,
      intake,
      qualified,
      conversionPercent: intake !== null && qualified !== null ? percent(qualified, intake) : null,
    }
  })

  // «Общий» conversion pairs like with like: only the groups that have both numbers, so a group nobody typed does not inflate it.
  const both = groups.filter((g) => g.intake !== null && g.qualified !== null)
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
