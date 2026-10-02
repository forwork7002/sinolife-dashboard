/**
 * «Lidlar qanday boʻlinadi» on «Lidlar» (the «Registratsiya» section until
 * 2026-10-02) — how one day's handed-out leads are shared among the ROPs: the
 * administrator's split against what each ROP actually got.
 *
 * THE CLIENT'S DECISIONS OF 2026-10-01. One split for the whole company, set
 * every day, in percent or in leads. «Jami» is the day's HANDED-OUT leads —
 * Bitrix24 deals whose «Лид таркатилган сана» is that day — not the
 * registration desk's intake (29.09: 1 082 registered, 306 kval, 289 handed
 * out). The split is of the NEW leads: «Jami» less the day's duplicates.
 *
 * WHAT A DUPLICATE IS HERE. The handed-out leads carry no duplicate stage (on
 * 29.09 not one of the 289 sat in one — duplicates are caught at
 * registration), so a duplicate is the same contact handed out a second time
 * the same day: two deals, one person. The repository marks every deal after
 * a contact's first that day.
 *
 * A ROP'S LEADS are the client's portal filter, as on «RNP jadvali»: «Лид
 * таркатилган сана» that day and «РОП (Первичка)» naming the team's head (or
 * a member). A lead whose ROP field is empty or names nobody's team — user
 * 10, the registration desk's head — has `rop: null`, «hech kimga
 * berilmagan».
 *
 * The plan divides the NEW leads (`fresh`); «Haqiqatda olgan» is the portal's
 * count, duplicates included.
 *
 * Pure: rows in, a DTO out.
 */

import { apportion } from '@/lib/apportion'

import { TEAM_ALIASES } from '../rnp/rnpSheet'

/** The teams the client splits leads among (2026-10-01: their six plus Shohjaxon, Asliddin, Sadriddin). */
export const SPLIT_ROPS: readonly string[] = Object.freeze([
  'Sevinch',
  'Gulzora',
  'Saidaziz',
  'Azizbek',
  'Maftuna',
  'Lola',
  'Shohjaxon',
  'Asliddin',
  'Sadriddin',
])

/** A share is in basis points: 15 % = 1 500; a day's split sums to this. */
export const SHARE_TOTAL_BP = 10_000

export const WEEK_DAYS = 7

export interface DistributedDayRow {
  readonly day: string
  /** The ROP team by `ropNameSql`, or null when the lead went to nobody's team. */
  readonly rop: string | null
  readonly leads: number
  readonly duplicates: number
}

export interface SplitShare {
  readonly rop: string
  readonly shareBp: number
}

export interface SavedSplit {
  readonly rows: readonly SplitShare[]
  readonly updatedAt: string
}

export interface LeadSplitRopDto {
  readonly rop: string
  /** The administrator's share for the day; null when the day has no split or this team is not in it. */
  readonly shareBp: number | null
  /** The share as leads, apportioned so the column sums to `fresh` exactly. */
  readonly planLeads: number | null
  /** Leads the team actually got that day — the portal's count. */
  readonly received: number
  /** Leads the team got on each of `week.days`. */
  readonly week: readonly number[]
}

export interface LeadSplitDto {
  readonly day: string
  readonly total: number
  /** `total` less the day's duplicates: what the split divides. */
  readonly fresh: number
  /** Leads handed out to nobody's team (empty ROP field, or a person who heads none). */
  readonly unassigned: number
  readonly rops: readonly LeadSplitRopDto[]
  readonly week: { readonly days: readonly string[]; readonly unassigned: readonly number[] }
  /** Null: nobody has set this day's split yet. */
  readonly split: { readonly updatedAt: string } | null
  /** The latest earlier day with a split — what «Kechagi taqsimotni olish» copies. */
  readonly previous: { readonly day: string; readonly rows: readonly SplitShare[] } | null
  readonly canEdit: boolean
}

/** `YYYY-MM-DD` shifted by whole days, on the calendar (no time zone involved). */
export function addDays(day: string, delta: number): string {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + delta)
  return t.toISOString().slice(0, 10)
}

/** Old department names folded into today's team — «RNP jadvali»'s own fold, so the two screens agree. */
export function canonicalRop(rop: string): string {
  return TEAM_ALIASES[rop] ?? rop
}

export function buildLeadSplit(input: {
  day: string
  rows: readonly DistributedDayRow[]
  split: SavedSplit | null
  previous: { day: string; rows: readonly SplitShare[] } | null
  canEdit: boolean
}): LeadSplitDto {
  const days = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(input.day, i - (WEEK_DAYS - 1)))
  const at = new Map(days.map((d, i) => [d, i]))

  const byRop = new Map<string, number[]>()
  const unassignedWeek = days.map(() => 0)
  let total = 0
  let duplicates = 0
  for (const r of input.rows) {
    const i = at.get(r.day)
    if (i === undefined) continue
    if (r.day === input.day) {
      total += r.leads
      duplicates += r.duplicates
    }
    if (r.rop === null) {
      unassignedWeek[i]! += r.leads
      continue
    }
    const rop = canonicalRop(r.rop)
    const counts = byRop.get(rop) ?? days.map(() => 0)
    counts[i]! += r.leads
    byRop.set(rop, counts)
  }
  const fresh = Math.max(0, total - duplicates)

  const shares = new Map((input.split?.rows ?? []).map((s) => [canonicalRop(s.rop), s.shareBp]))
  const previous = input.previous ? { day: input.previous.day, rows: input.previous.rows.map((s) => ({ rop: canonicalRop(s.rop), shareBp: s.shareBp })) } : null
  // The client's nine first, in their order; then any other team either split names or that got leads this week.
  const extra = [...new Set([...shares.keys(), ...(previous?.rows.map((s) => s.rop) ?? []), ...byRop.keys()])]
    .filter((rop) => !SPLIT_ROPS.includes(rop))
    .sort((a, b) => a.localeCompare(b, 'ru'))
  const names = [...SPLIT_ROPS, ...extra]

  const plan = input.split ? apportion(fresh, names.map((rop) => shares.get(rop) ?? 0)) : null
  const last = WEEK_DAYS - 1

  return {
    day: input.day,
    total,
    fresh,
    unassigned: unassignedWeek[last]!,
    rops: names.map((rop, i) => {
      const week = byRop.get(rop) ?? days.map(() => 0)
      const shareBp = input.split ? (shares.get(rop) ?? 0) : null
      return { rop, shareBp, planLeads: plan ? plan[i]! : null, received: week[last]!, week }
    }),
    week: { days, unassigned: unassignedWeek },
    split: input.split ? { updatedAt: input.split.updatedAt } : null,
    previous,
    canEdit: input.canEdit,
  }
}

/** Why a split cannot be saved, or null. Shares are whole basis points, one per team, summing to 100 %. */
export function splitProblem(rows: readonly SplitShare[]): string | null {
  if (rows.length === 0) return 'Taqsimot boʻsh.'
  const seen = new Set<string>()
  for (const r of rows) {
    const rop = canonicalRop(r.rop)
    if (seen.has(rop)) return `«${rop}» ikki marta berilgan.`
    seen.add(rop)
  }
  const sum = rows.reduce((a, r) => a + r.shareBp, 0)
  if (sum !== SHARE_TOTAL_BP) return `Ulushlar jami 100% boʻlishi kerak (hozir ${(sum / 100).toFixed(2)}%).`
  return null
}
