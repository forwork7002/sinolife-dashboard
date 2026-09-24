/**
 * «Lid kogortasi» — how long a lead waits between arriving and being handed
 * to a seller, as a cohort table.
 *
 * Asked for on 2026-09-24 («24-sentabrda 100 ta lid tushdi → shundan 60 tasi
 * o'sha kuni, 20 tasi ertasi kuni tarqatildi → jami 80 ta (80%) o'tdi»). A ROW
 * is the Tashkent day a lead arrived («Лид тушган сана»); a COLUMN is how many
 * days later it was distributed («Лид таркатилган сана»): D+0 … D+6, and D+7+
 * for everything later. New and repeat leads are two separate tables.
 *
 * ONE LEAD, UP TO THREE DEALS. The portal stamps these fields on the
 * Первичный отдел deal and copies them when the order moves on to Тасдиклаш
 * and Доставка, so one phone number can be three rows. They are folded on
 * (customer, arrival instant) — the client's own key — and the EARLIEST
 * distribution day of the copies is the lead's. A deal with no contact is its
 * own lead: guessing a customer would merge strangers.
 *
 * THE DAY IS TASHKENT'S. The portal sends datetimes at +03:00; the instant is
 * kept as sent and the calendar day is taken here, in `timeZone`, so a lead
 * that arrived at 23:30 Tashkent (21:30 Moscow) is on the day it arrived and
 * not the one before. The distribution day is a DATE on the portal and is
 * never moved through a zone at all.
 *
 * Pure: no database, no clock. The service hands in rows, the window and
 * today.
 */

import { zonedDateKey } from '@/server/domain/period/period'

/** The portal started filling «Лид тушган сана» on 2026-09-14. Nothing earlier is a cohort. */
export const LEAD_COHORT_START = '2026-09-14'

/** The three pipelines a routed lead lives in, as portal CATEGORY_IDs. */
export const LEAD_PIPELINES = [12, 4, 6] as const
export type LeadPipeline = (typeof LEAD_PIPELINES)[number]

/** D+0 … D+6, then one bucket for a week or more. */
export const LAG_BUCKETS = 8

export type RepeatKind = 'BOUGHT' | 'PROCESSING' | 'OTHER'
export type LeadKind = 'new' | 'repeat'

/** One deal as the repository reads it. */
export interface LeadDealRow {
  readonly dealId: string
  readonly customerId: string | null
  readonly pipeline: number
  readonly arrivedAt: Date | null
  /** `YYYY-MM-DD`. */
  readonly distributedOn: string | null
  readonly aiQualifiedAt: Date | null
  readonly ropEmployeeId: string | null
  readonly repeat: RepeatKind | null
  /** The deal's creation day, Tashkent — only read for deals with no arrival. */
  readonly createdDay: string
}

/** One lead, folded from its copies. */
export interface Lead {
  readonly arrivedDay: string
  readonly distributedOn: string | null
  readonly aiQualified: boolean
  readonly ropEmployeeId: string | null
  readonly repeat: RepeatKind | null
}

// ---------------------------------------------------------------------------
// DTO — mirrored in `src/features/reklama/leadCohortApi.ts`
// ---------------------------------------------------------------------------

export interface LeadCohortRowDto {
  /** `YYYY-MM-DD`; the empty string on the total row. */
  readonly day: string
  readonly arrived: number
  /** Distributed D+0 … D+6, D+7+ — `LAG_BUCKETS` long. */
  readonly byLag: readonly number[]
  readonly distributed: number
  readonly undistributed: number
}

export interface LeadCohortTableDto {
  readonly rows: readonly LeadCohortRowDto[]
  readonly total: LeadCohortRowDto
}

export interface LeadRopDto {
  /** Null: the deal names no ROP, or one the roster does not know. */
  readonly employeeId: string | null
  readonly name: string | null
  /** Leads distributed to this ROP in the window, whatever day they arrived. */
  readonly total: number
  readonly new: number
  readonly repeat: number
  /** …of which distributed on the day they arrived. */
  readonly sameDay: number
}

export interface LeadCohortOverviewDto {
  /** The window as asked; `cohortFrom` is where the tables actually start. */
  readonly from: string
  readonly to: string
  readonly cohortFrom: string
  readonly today: string
  readonly cohortStart: string
  readonly kpi: {
    /** Leads that arrived in the window. */
    readonly arrived: number
    readonly arrivedToday: number
    /** Leads distributed today, whatever day they arrived. */
    readonly distributedToday: number
    /** Leads of the window the AI qualified («ИИ квал сана» set). */
    readonly aiQualified: number
    /** Leads of the window not yet distributed. */
    readonly undistributed: number
    readonly repeat: { readonly total: number; readonly bought: number; readonly processing: number; readonly other: number }
    /** Deals created in the window with no «Лид тушган сана» — outside every table. */
    readonly missingArrival: number
    /** Leads distributed in the window that arrived before `cohortStart` — outside every table. */
    readonly arrivedBeforeStart: number
    /** Leads whose distribution day is BEFORE their arrival day — counted at D+0. */
    readonly distributedBeforeArrival: number
  }
  readonly cohorts: { readonly new: LeadCohortTableDto; readonly repeat: LeadCohortTableDto }
  readonly rops: readonly LeadRopDto[]
  /** Every ROP the window names, for the filter — not narrowed by it. */
  readonly ropOptions: readonly { readonly employeeId: string; readonly name: string }[]
}

// ---------------------------------------------------------------------------

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Every day from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

const REPEAT_RANK: Record<RepeatKind, number> = { BOUGHT: 3, PROCESSING: 2, OTHER: 1 }

/**
 * Fold deals into leads on (customer, arrival instant). Deals with no arrival
 * are not leads and are skipped here; the overview counts them apart.
 *
 * The lead takes the EARLIEST distribution day of its copies and that copy's
 * ROP (the ROP of any copy when none is distributed), the AI flag if any copy
 * carries it, and the strongest repeat mark — a copy that lost the field
 * does not turn a repeat customer into a new one.
 */
export function foldLeads(rows: readonly LeadDealRow[], timeZone: string): Lead[] {
  interface Acc {
    arrivedDay: string
    distributedOn: string | null
    aiQualified: boolean
    ropEmployeeId: string | null
    repeat: RepeatKind | null
  }
  const leads = new Map<string, Acc>()
  for (const r of rows) {
    if (r.arrivedAt === null) continue
    const key = `${r.customerId ?? `deal:${r.dealId}`}|${r.arrivedAt.getTime()}`
    const acc = leads.get(key)
    if (!acc) {
      leads.set(key, {
        arrivedDay: zonedDateKey(r.arrivedAt, timeZone),
        distributedOn: r.distributedOn,
        aiQualified: r.aiQualifiedAt !== null,
        ropEmployeeId: r.ropEmployeeId,
        repeat: r.repeat,
      })
      continue
    }
    if (r.distributedOn !== null && (acc.distributedOn === null || r.distributedOn < acc.distributedOn)) {
      acc.distributedOn = r.distributedOn
      if (r.ropEmployeeId !== null) acc.ropEmployeeId = r.ropEmployeeId
    } else if (acc.ropEmployeeId === null) {
      acc.ropEmployeeId = r.ropEmployeeId
    }
    if (r.aiQualifiedAt !== null) acc.aiQualified = true
    if (r.repeat !== null && (acc.repeat === null || REPEAT_RANK[r.repeat] > REPEAT_RANK[acc.repeat])) {
      acc.repeat = r.repeat
    }
  }
  return [...leads.values()]
}

/** The column a lead lands in; a distribution before arrival is D+0. */
export function lagBucket(arrivedDay: string, distributedOn: string): number {
  return Math.min(Math.max(dayDiff(arrivedDay, distributedOn), 0), LAG_BUCKETS - 1)
}

function emptyRow(day: string): { day: string; arrived: number; byLag: number[]; distributed: number; undistributed: number } {
  return { day, arrived: 0, byLag: Array.from({ length: LAG_BUCKETS }, () => 0), distributed: 0, undistributed: 0 }
}

/** One table: a row per day of `days`, every day drawn even when empty. */
export function cohortTable(leads: readonly Lead[], days: readonly string[]): LeadCohortTableDto {
  const byDay = new Map(days.map((d) => [d, emptyRow(d)]))
  const total = emptyRow('')
  for (const lead of leads) {
    const row = byDay.get(lead.arrivedDay)
    if (!row) continue
    for (const r of [row, total]) {
      r.arrived++
      if (lead.distributedOn === null) {
        r.undistributed++
      } else {
        r.distributed++
        r.byLag[lagBucket(lead.arrivedDay, lead.distributedOn)]!++
      }
    }
  }
  return { rows: days.map((d) => byDay.get(d)!), total }
}

export const kindOf = (lead: Pick<Lead, 'repeat'>): LeadKind => (lead.repeat === null ? 'new' : 'repeat')

/**
 * The whole screen from its rows.
 *
 * FILTERS: `pipelines` narrows the DEALS before they fold (a lead is in if any
 * of its copies is in a chosen pipeline); `rop` narrows the LEADS after, and
 * applies to the tiles and the tables — never to the ROP breakdown, which is
 * the comparison the filter picks from.
 */
export function leadCohortOverview(input: {
  rows: readonly LeadDealRow[]
  from: string
  to: string
  today: string
  timeZone: string
  pipelines: readonly number[]
  rop: string | null
  names: ReadonlyMap<string, string>
}): LeadCohortOverviewDto {
  const cohortFrom = input.from < LEAD_COHORT_START ? LEAD_COHORT_START : input.from
  const inPipelines = new Set(input.pipelines)
  const rows = input.rows.filter((r) => inPipelines.has(r.pipeline))

  const leads = foldLeads(rows, input.timeZone)
  const matchesRop = (l: Lead) => input.rop === null || l.ropEmployeeId === input.rop
  const inWindow = (l: Lead) => l.arrivedDay >= cohortFrom && l.arrivedDay <= input.to

  const windowLeads = leads.filter((l) => inWindow(l) && matchesRop(l))
  const days = cohortFrom <= input.to ? daysBetween(cohortFrom, input.to) : []

  const repeat = { total: 0, bought: 0, processing: 0, other: 0 }
  let aiQualified = 0
  let undistributed = 0
  let arrivedToday = 0
  let distributedBeforeArrival = 0
  for (const l of windowLeads) {
    if (l.aiQualified) aiQualified++
    if (l.distributedOn === null) undistributed++
    else if (l.distributedOn < l.arrivedDay) distributedBeforeArrival++
    if (l.arrivedDay === input.today) arrivedToday++
    if (l.repeat !== null) {
      repeat.total++
      if (l.repeat === 'BOUGHT') repeat.bought++
      else if (l.repeat === 'PROCESSING') repeat.processing++
      else repeat.other++
    }
  }

  const distributedToday = leads.filter((l) => l.distributedOn === input.today && matchesRop(l)).length
  const distributedInWindow = leads.filter(
    (l) => l.distributedOn !== null && l.distributedOn >= input.from && l.distributedOn <= input.to,
  )
  const arrivedBeforeStart = distributedInWindow.filter(
    (l) => l.arrivedDay < LEAD_COHORT_START && matchesRop(l),
  ).length

  // Deals with no arrival: one per customer, created in the window.
  const missing = new Set<string>()
  for (const r of rows) {
    if (r.arrivedAt !== null || r.createdDay < input.from || r.createdDay > input.to) continue
    if (input.rop !== null && r.ropEmployeeId !== input.rop) continue
    missing.add(r.customerId ?? `deal:${r.dealId}`)
  }

  const ropAcc = new Map<string | null, { total: number; new: number; repeat: number; sameDay: number }>()
  for (const l of distributedInWindow) {
    const acc = ropAcc.get(l.ropEmployeeId) ?? { total: 0, new: 0, repeat: 0, sameDay: 0 }
    ropAcc.set(l.ropEmployeeId, acc)
    acc.total++
    acc[kindOf(l)]++
    if (l.distributedOn! <= l.arrivedDay) acc.sameDay++
  }
  const nameOf = (id: string | null) => (id === null ? null : (input.names.get(id) ?? null))
  const rops: LeadRopDto[] = [...ropAcc.entries()]
    .map(([employeeId, a]) => ({ employeeId, name: nameOf(employeeId), ...a }))
    .sort((a, b) => b.total - a.total || (a.name ?? '').localeCompare(b.name ?? '', 'ru'))

  const optionIds = new Set<string>()
  for (const l of [...leads.filter(inWindow), ...distributedInWindow]) {
    if (l.ropEmployeeId !== null) optionIds.add(l.ropEmployeeId)
  }
  const ropOptions = [...optionIds]
    .map((id) => ({ employeeId: id, name: input.names.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return {
    from: input.from,
    to: input.to,
    cohortFrom,
    today: input.today,
    cohortStart: LEAD_COHORT_START,
    kpi: {
      arrived: windowLeads.length,
      arrivedToday,
      distributedToday,
      aiQualified,
      undistributed,
      repeat,
      missingArrival: missing.size,
      arrivedBeforeStart,
      distributedBeforeArrival,
    },
    cohorts: {
      new: cohortTable(windowLeads.filter((l) => l.repeat === null), days),
      repeat: cohortTable(windowLeads.filter((l) => l.repeat !== null), days),
    },
    rops,
    ropOptions,
  }
}
