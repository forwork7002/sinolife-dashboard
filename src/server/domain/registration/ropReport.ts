/**
 * «ROP otchet» on «Lidlar» («Registratsiya» until 2026-10-02) — the client's group sheet for one day:
 * every ROP team, seller by seller, «Лид сони · План · Факт-1 ПР ·
 * Отклонение · Транз-1 · Конверсия · Факт-2 ПР · Транз-2 · Дозвон ·
 * Длительность» and the team's «ОБЩИЙ». Asked for on 2026-10-01 in place of
 * the split table, without the sheet's «Лид руч» column; the plan rule and
 * the two call columns on 2026-10-02.
 *
 * WHERE EACH NUMBER COMES FROM.
 *   Лид сони — the day's handed-out leads (`RegistrationRepository.sellerLeadsSql`):
 *     the rows «Olgan lid» counts, by the person the deal is with.
 *   Факт-1 / Транз-1, Факт-2 / Транз-2 — the sellers board's cohort on its
 *     queue day (`InsightsRepository.sellerFaktDaysSql`), the team as /rnp
 *     reads it.
 *   План — 500 000 soʻm per lead: `PLAN_PER_LEAD` × Лид сони. It replaced the
 *     day plan typed per seller (2026-10-01) on 2026-10-02.
 *   Отклонение — План − Факт-1, the client's sign: above zero the row is
 *     short of plan. Конверсия — Транз-1 ÷ Лид сони, the sheet's own formula
 *     with «Лид руч» gone from it.
 *   Дозвон / Длительность — the day's connected calls and their talk time
 *     (`RegistrationRepository.sellerCallsSql`), the «Ulangan» and «Suhbat
 *     vaqti» of «Qoʻngʻiroqlar» for the same person and day. Null before
 *     `CALL_DATA_FLOOR`, whose calls carry truncated durations.
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

/** «план = 500.000 * лид сони», in minor units. */
export const PLAN_PER_LEAD_MINOR = 500_000n * 100n

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

export interface SellerCallRow {
  readonly employeeId: string
  readonly connected: number
  readonly talkSec: number
}

export interface RopReportCellsDto {
  readonly leads: number
  /** `PLAN_PER_LEAD_MINOR` × leads. */
  readonly plan: MoneyDto
  readonly fakt1: MoneyDto
  /** План − Факт-1: above zero, short of plan. */
  readonly deviation: MoneyDto
  readonly fakt1Orders: number
  /** Транз-1 ÷ Лид сони × 100; null with no lead. */
  readonly conversionPercent: number | null
  readonly fakt2: MoneyDto
  readonly fakt2Orders: number
  /** Дозвон — connected calls; null when the day's calls cannot be trusted. */
  readonly connectedCalls: number | null
  /** Длительность — their talk time, seconds; null with `connectedCalls`. */
  readonly talkSec: number | null
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
  readonly groups: readonly RopReportGroupDto[]
  readonly total: RopReportCellsDto
}

interface Acc {
  leads: number
  fakt1: bigint
  fakt1Orders: number
  fakt2: bigint
  fakt2Orders: number
  connected: number
  talkSec: number
}

const zero = (): Acc => ({ leads: 0, fakt1: 0n, fakt1Orders: 0, fakt2: 0n, fakt2Orders: 0, connected: 0, talkSec: 0 })

function add(into: Acc, from: Acc): void {
  into.leads += from.leads
  into.fakt1 += from.fakt1
  into.fakt1Orders += from.fakt1Orders
  into.fakt2 += from.fakt2
  into.fakt2Orders += from.fakt2Orders
  into.connected += from.connected
  into.talkSec += from.talkSec
}

const uzs = (minor: bigint): MoneyDto => toMoneyDto(money(minor, CURRENCY))

function cells(a: Acc, callsKnown: boolean): RopReportCellsDto {
  const plan = PLAN_PER_LEAD_MINOR * BigInt(a.leads)
  return {
    leads: a.leads,
    plan: uzs(plan),
    fakt1: uzs(a.fakt1),
    deviation: uzs(plan - a.fakt1),
    fakt1Orders: a.fakt1Orders,
    conversionPercent: a.leads > 0 ? (a.fakt1Orders / a.leads) * 100 : null,
    fakt2: uzs(a.fakt2),
    fakt2Orders: a.fakt2Orders,
    connectedCalls: callsKnown ? a.connected : null,
    talkSec: callsKnown ? a.talkSec : null,
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

/** Off the roster, a row is drawn only when the day credited them with something. */
const credited = (a: Acc): boolean => a.leads > 0 || a.fakt1Orders > 0 || a.fakt2Orders > 0

export function buildRopReport(input: {
  day: string
  leads: readonly SellerLeadRow[]
  fakt: readonly SellerFaktRow[]
  roster: readonly RosterMember[]
  /** Names for people on no roster. */
  names: ReadonlyMap<string, string>
  /** Null: the day is before `CALL_DATA_FLOOR`, the call columns print a dash. */
  calls: readonly SellerCallRow[] | null
  /**
   * The brand switch: which groups the sheet keeps, by their team. Applied to
   * the FINISHED groups, so every call is first placed on the person's one row
   * across the whole sheet — narrowing the inputs first would let a seller's
   * calls land on a row in two slices. The total sums the kept groups.
   */
  keepsGroup?: (rop: string | null) => boolean
}): RopReportDto {
  const callsKnown = input.calls !== null
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
    ONE ROW CARRIES A PERSON'S CALLS. A call names no team, and a seller can
    be a row in two groups — a lead that names no team, an order sold under
    another team — so crediting the calls to both would count them twice in
    every total. They sit on the roster row; off every roster, on the group
    where the person earned the most. Calls of somebody who is no row today
    (the registration desk, a quiet day off the roster) are not drawn and not
    counted. The plan needs no such rule: it follows the row's own leads.
  */
  for (const c of input.calls ?? []) {
    const member = rosterOf.get(c.employeeId)
    let home: Acc | undefined = member ? grid.get(member.rop)?.get(c.employeeId) : undefined
    if (!home) {
      for (const people of grid.values()) {
        const a = people.get(c.employeeId)
        if (a && credited(a) && (!home || a.fakt1 > home.fakt1 || (a.fakt1 === home.fakt1 && a.leads > home.leads))) home = a
      }
    }
    if (home) {
      home.connected += c.connected
      home.talkSec += c.talkSec
    }
  }

  const total = zero()
  const keepsGroup = input.keepsGroup ?? (() => true)
  const groups: RopReportGroupDto[] = [...grid.entries()]
    .filter(([rop]) => keepsGroup(rop))
    .map(([rop, people]) => {
      const groupTotal = zero()
      const sellers = [...people.entries()]
        .map(([id, a]) => {
          const member = rosterOf.get(id)
          const onRoster = member !== undefined && member.rop === rop
          return { id, a, onRoster, isHead: onRoster && member.isHead }
        })
        .filter((s) => s.onRoster || credited(s.a))
        .map((s): RopReportSellerDto => {
          add(groupTotal, s.a)
          return {
            employeeId: s.id,
            fullName:
              s.id === NOBODY ? 'Hech kimga biriktirilmagan' : (rosterOf.get(s.id)?.fullName ?? input.names.get(s.id) ?? s.id),
            isHead: s.isHead,
            onRoster: s.onRoster,
            ...cells(s.a, callsKnown),
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
      return { rop, sellers, total: cells(groupTotal, callsKnown) }
    })
    .filter((g) => g.sellers.length > 0)
    .sort((a, b) => groupOrder(a.rop, b.rop))

  return { day: input.day, groups, total: cells(total, callsKnown) }
}
