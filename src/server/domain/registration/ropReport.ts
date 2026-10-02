/**
 * «ROP otchet» on «Lidlar» («Registratsiya» until 2026-10-02) — the client's group sheet for one day:
 * every ROP team, seller by seller, «Лид сони · План · Факт-1 ПР ·
 * Отклонение · Транз-1 · Конверсия · Факт-2 ПР · Транз-2» and the team's
 * «ОБЩИЙ». Asked for on 2026-10-01 in place of the split table, without the
 * sheet's «Лид руч» column.
 *
 * WHERE EACH NUMBER COMES FROM.
 *   Лид сони — the day's handed-out leads (`RegistrationRepository.sellerLeadsSql`):
 *     the rows «Olgan lid» counts, by the person the deal is with.
 *   Факт-1 / Транз-1, Факт-2 / Транз-2 — the sellers board's cohort on its
 *     queue day (`InsightsRepository.sellerFaktDaysSql`), the team as /rnp
 *     reads it.
 *   План — the seller's day plan for the month, typed on this screen.
 *   Отклонение — Факт-1 − План; Конверсия — Транз-1 ÷ Лид сони, the sheet's
 *     own formula with «Лид руч» gone from it.
 *
 * Who is a row: everybody on a ROP team's roster, at zero if the day passed
 * them by, plus anybody else credited with a lead or an order that day under
 * the team the lead or order names. Leads and orders that name no team form
 * a last group, so the grand total is the whole company's day.
 *
 * Pure: rows in, a DTO out.
 */

import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'

import { canonicalRop, SPLIT_ROPS } from './leadSplit'

const CURRENCY = 'UZS'

export interface SellerLeadRow {
  readonly rop: string | null
  /** Null for a handed-out deal with nobody on it. */
  readonly employeeId: string | null
  readonly leads: number
}

/** `InsightsRepository.SellerFaktDayRow` without its day: the domain may not import a repository. */
export interface SellerFaktRow {
  readonly employeeId: string
  readonly rop: string | null
  readonly fakt1Orders: number
  readonly fakt1Minor: bigint
  readonly fakt2Orders: number
  readonly fakt2Minor: bigint
}

export interface RosterMember {
  readonly employeeId: string
  readonly fullName: string
  readonly rop: string
  readonly isHead: boolean
}

export interface SellerPlanRow {
  readonly employeeId: string
  readonly amountMinor: bigint
}

export interface SellerPlanInput {
  readonly employeeId: string
  /** Null removes the plan. */
  readonly amountMinor: bigint | null
}

export interface RopReportCellsDto {
  readonly leads: number
  /** Null: no plan typed. */
  readonly plan: MoneyDto | null
  readonly fakt1: MoneyDto
  /** Факт-1 − План; null without a plan. */
  readonly deviation: MoneyDto | null
  readonly fakt1Orders: number
  /** Транз-1 ÷ Лид сони × 100; null with no lead. */
  readonly conversionPercent: number | null
  readonly fakt2: MoneyDto
  readonly fakt2Orders: number
}

export interface RopReportSellerDto extends RopReportCellsDto {
  readonly employeeId: string
  readonly fullName: string
  /** The team's ROP. */
  readonly isHead: boolean
  /** False: not on this team's roster, here because a lead or an order names the team. */
  readonly onRoster: boolean
}

export interface RopReportGroupDto {
  /** Null: the leads and orders that name no team. */
  readonly rop: string | null
  readonly sellers: readonly RopReportSellerDto[]
  readonly total: RopReportCellsDto
}

export interface RopReportDto {
  readonly day: string
  /** `YYYY-MM` — the month whose day plans the column shows. */
  readonly month: string
  readonly groups: readonly RopReportGroupDto[]
  readonly total: RopReportCellsDto
  readonly canEdit: boolean
}

interface Acc {
  leads: number
  plan: bigint
  planned: boolean
  fakt1: bigint
  fakt1Orders: number
  fakt2: bigint
  fakt2Orders: number
}

const zero = (): Acc => ({ leads: 0, plan: 0n, planned: false, fakt1: 0n, fakt1Orders: 0, fakt2: 0n, fakt2Orders: 0 })

function add(into: Acc, from: Acc): void {
  into.leads += from.leads
  into.plan += from.plan
  into.planned ||= from.planned
  into.fakt1 += from.fakt1
  into.fakt1Orders += from.fakt1Orders
  into.fakt2 += from.fakt2
  into.fakt2Orders += from.fakt2Orders
}

const uzs = (minor: bigint): MoneyDto => toMoneyDto(money(minor, CURRENCY))

function cells(a: Acc): RopReportCellsDto {
  return {
    leads: a.leads,
    plan: a.planned ? uzs(a.plan) : null,
    fakt1: uzs(a.fakt1),
    deviation: a.planned ? uzs(a.fakt1 - a.plan) : null,
    fakt1Orders: a.fakt1Orders,
    conversionPercent: a.leads > 0 ? (a.fakt1Orders / a.leads) * 100 : null,
    fakt2: uzs(a.fakt2),
    fakt2Orders: a.fakt2Orders,
  }
}

/** The split's nine teams in the client's order, then the rest by name; the no-team group last. */
function groupOrder(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const ia = SPLIT_ROPS.indexOf(a)
  const ib = SPLIT_ROPS.indexOf(b)
  if (ia !== -1 || ib !== -1) return ia === -1 ? 1 : ib === -1 ? -1 : ia - ib
  return a.localeCompare(b, 'ru')
}

const NOBODY = '∅'

export function buildRopReport(input: {
  day: string
  leads: readonly SellerLeadRow[]
  fakt: readonly SellerFaktRow[]
  roster: readonly RosterMember[]
  /** Names for people on no roster. */
  names: ReadonlyMap<string, string>
  plans: readonly SellerPlanRow[]
  canEdit: boolean
}): RopReportDto {
  const plan = new Map(input.plans.map((p) => [p.employeeId, p.amountMinor]))
  const rosterOf = new Map(input.roster.map((m) => [m.employeeId, { ...m, rop: canonicalRop(m.rop) }]))

  // team (null = none) → person → Acc
  const grid = new Map<string | null, Map<string, Acc>>()
  const acc = (rop: string | null, person: string): Acc => {
    const team = rop === null ? null : canonicalRop(rop)
    const people = grid.get(team) ?? new Map<string, Acc>()
    grid.set(team, people)
    const a = people.get(person) ?? zero()
    people.set(person, a)
    return a
  }

  for (const m of rosterOf.values()) acc(m.rop, m.employeeId)
  for (const r of input.leads) acc(r.rop, r.employeeId ?? NOBODY).leads += r.leads
  for (const r of input.fakt) {
    const a = acc(r.rop, r.employeeId)
    a.fakt1 += r.fakt1Minor
    a.fakt1Orders += r.fakt1Orders
    a.fakt2 += r.fakt2Minor
    a.fakt2Orders += r.fakt2Orders
  }

  /*
    ONE ROW CARRIES A PERSON'S PLAN. A seller can be a row in two groups — a
    lead that names no team, an order sold under another team — and crediting
    the plan to both would count it twice in every total. It sits on the
    roster row; off every roster, on the group where they earned the most.
    A plan whose person is on no row today (left the team, a quiet day off
    the roster) is not drawn and not counted.
  */
  const planHome = new Map<string, string | null>()
  for (const id of plan.keys()) {
    const member = rosterOf.get(id)
    if (member) {
      planHome.set(id, member.rop)
      continue
    }
    let best: { rop: string | null; a: Acc } | null = null
    for (const [rop, people] of grid) {
      const a = people.get(id)
      if (a && (!best || a.fakt1 > best.a.fakt1 || (a.fakt1 === best.a.fakt1 && a.leads > best.a.leads))) best = { rop, a }
    }
    if (best) planHome.set(id, best.rop)
  }

  const total = zero()
  const groups: RopReportGroupDto[] = [...grid.entries()]
    .map(([rop, people]) => {
      const groupTotal = zero()
      const sellers = [...people.entries()]
        .map(([id, a]) => {
          const member = rosterOf.get(id)
          const onRoster = member !== undefined && member.rop === rop
          const p = planHome.has(id) && planHome.get(id) === rop ? plan.get(id) : undefined
          if (p !== undefined) {
            a.plan = p
            a.planned = true
          }
          return { id, a, onRoster, isHead: onRoster && member.isHead }
        })
        // Off the roster only when the day credited them with something.
        .filter((s) => s.onRoster || s.a.leads > 0 || s.a.fakt1Orders > 0 || s.a.fakt2Orders > 0)
        .map((s): RopReportSellerDto => {
          add(groupTotal, s.a)
          return {
            employeeId: s.id,
            fullName:
              s.id === NOBODY ? 'Hech kimga biriktirilmagan' : (rosterOf.get(s.id)?.fullName ?? input.names.get(s.id) ?? s.id),
            isHead: s.isHead,
            onRoster: s.onRoster,
            ...cells(s.a),
          }
        })
        .sort(
          (a, b) =>
            Number(b.isHead) - Number(a.isHead) ||
            Number(BigInt(b.fakt1.amountMinor) - BigInt(a.fakt1.amountMinor)) ||
            b.leads - a.leads ||
            a.fullName.localeCompare(b.fullName, 'ru'),
        )
      add(total, groupTotal)
      return { rop, sellers, total: cells(groupTotal) }
    })
    .filter((g) => g.sellers.length > 0)
    .sort((a, b) => groupOrder(a.rop, b.rop))

  return { day: input.day, month: input.day.slice(0, 7), groups, total: cells(total), canEdit: input.canEdit }
}
