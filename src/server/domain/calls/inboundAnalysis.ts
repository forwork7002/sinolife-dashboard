/**
 * «Kiruvchi tahlil» — the client's «Кирувчи қўнғироқлар таҳлили» (CLAUDE.md of
 * 2026-10-22, «huddi shu CLAUDE.md da yozilganidek … alohida yangi boʻlim»):
 * of the numbers that rang us, two kinds told apart and followed to the end.
 *
 *   СОФ ЯНГИ       the number was not in Bitrix24 at all when it rang — the
 *                  contact was created by that call (±5 min). The SAME rule as
 *                  «Qoʻngʻiroqlar»'s «Соф янги» tile (`inboundGroup` 'fresh'),
 *                  so the two screens cannot print two different counts.
 *   ҚАЙТА МУРОЖАТ  not fresh; no Доставка / База deal created before the call;
 *                  a real conversation (a call of more than 0 s, either way)
 *                  before it; and more than 14 days since the last one.
 *
 * The two never overlap: a fresh number has no past. A number is judged at its
 * FIRST call — the period's for the totals and the lists, the day's for a day
 * row — as «Qoʻngʻiroqlar» judges its groups, so day rows need not add up to
 * the total (a number that rang on three days is three day rows, one total).
 *
 * THE END OF THE STORY reaches past the window to now: «talked» is any second
 * of conversation with the number from its first call on — its own call, a
 * later one, or our callback; «called back» is an outbound call that got
 * through. A number that never got one is lost.
 *
 * HISTORY STARTS AT `CALL_DATA_FLOOR` (15.09.2026): before it the stored
 * durations are truncated, so no earlier call can say «they talked». A last
 * conversation before that reads as none, so «Қайта мурожат» is a minimum — the
 * CLAUDE.md's own first limitation, with a later start. The analysis itself
 * starts on 01.10.2026 (the client: «oktyabrda boshlab olasan»), which leaves
 * every analysed call at least 16 days of history to look back over.
 *
 * Pure: no Prisma, no framework.
 */

import { type ContactHistory, type InboundCall, inboundGroup, phoneKey } from './inboundCalls'

/** 01.10.2026 00:00 in Tashkent — where the analysis starts, whatever window is asked for. */
export const INBOUND_ANALYSIS_FLOOR = new Date('2026-09-30T19:00:00.000Z')

/** «14 кундан ортиқ»: strictly more than this many days since the last conversation. */
export const RETURN_SILENCE_DAYS = 14

const DAY_MS = 86_400_000

/** Bitrix24 CATEGORY_IDs of the «база» funnels: Доставка, База. */
const BASE_PIPELINES = new Set(['6', '10'])

export const ANALYSIS_GROUPS = ['fresh', 'returning'] as const
export type AnalysisGroup = (typeof ANALYSIS_GROUPS)[number]

/** A call to or from a number, either way, `phoneKey`ed. */
export interface HistoryCall {
  readonly key: string
  readonly startedAt: Date
  readonly durationSec: number
  readonly outbound: boolean
}

/** One number judged at one first call. */
export interface NumberVerdict {
  readonly key: string
  readonly phone: string | null
  readonly customerId: string | null
  readonly firstCallAt: Date
  /** Inbound calls of the number in the slice judged (the period, or the day). */
  readonly calls: number
  readonly group: AnalysisGroup | null
  /** One of those inbound calls got a second of conversation. */
  readonly answered: boolean
  /** An outbound call to the number from its first call on got through. */
  readonly calledBack: boolean
  /** Any conversation from the first call on, to now. */
  readonly talked: boolean
  /** Days from the last conversation before the first call; null with none in the history. */
  readonly silenceDays: number | null
}

export interface GroupOutcome {
  readonly numbers: number
  readonly answered: number
  readonly calledBack: number
  readonly talked: number
  readonly lost: number
}

export interface AnalysisDay {
  readonly day: string
  readonly calls: number
  readonly numbers: number
  readonly fresh: GroupOutcome
  readonly returning: GroupOutcome
}

/** «жим турган вақт кесими»: 14–30 days, 1–3 months, 3–6 months, 6+ months. */
export const SILENCE_BUCKETS = ['d14_30', 'm1_3', 'm3_6', 'm6'] as const
export type SilenceBucket = (typeof SILENCE_BUCKETS)[number]

export function silenceBucket(days: number): SilenceBucket {
  if (days <= 30) return 'd14_30'
  if (days <= 90) return 'm1_3'
  if (days <= 180) return 'm3_6'
  return 'm6'
}

export interface ReturningDetail {
  readonly buckets: Readonly<Record<SilenceBucket, number>>
  /** Whole days; null with no returning number. */
  readonly medianDays: number | null
  readonly longestDays: number | null
}

/**
 * Which group a number falls in at its first call `at` — null for neither.
 * `history` is every call to or from the number the store holds, either way.
 */
export function analysisGroup(
  at: Date,
  contact: ContactHistory | undefined,
  history: readonly HistoryCall[],
): { group: AnalysisGroup | null; silenceDays: number | null } {
  const before = history.filter((c) => c.durationSec > 0 && c.startedAt.getTime() < at.getTime())
  const last = before.reduce<number | null>((max, c) => (max === null || c.startedAt.getTime() > max ? c.startedAt.getTime() : max), null)
  const silenceDays = last === null ? null : (at.getTime() - last) / DAY_MS

  if (inboundGroup(at, contact) === 'fresh') return { group: 'fresh', silenceDays }
  const inBase = (contact?.deals ?? []).some(
    (d) => d.createdAt.getTime() < at.getTime() && d.pipeline !== null && BASE_PIPELINES.has(d.pipeline),
  )
  const returning = !inBase && silenceDays !== null && silenceDays > RETURN_SILENCE_DAYS
  return { group: returning ? 'returning' : null, silenceDays }
}

/** `calls` in start order; every number of them judged at its first call. */
export function judgeNumbers(
  calls: readonly InboundCall[],
  contacts: ReadonlyMap<string, ContactHistory>,
  history: ReadonlyMap<string, readonly HistoryCall[]>,
): NumberVerdict[] {
  const numbers = new Map<string, { first: InboundCall; calls: number; answered: boolean; customerId: string | null }>()
  calls.forEach((call, index) => {
    // A call with no usable number is its own caller, as on «Qoʻngʻiroqlar».
    const key = phoneKey(call.phone) ?? `#${index}`
    const n = numbers.get(key)
    if (!n) {
      numbers.set(key, { first: call, calls: 1, answered: call.durationSec > 0, customerId: call.customerId })
      return
    }
    n.calls += 1
    if (call.durationSec > 0) n.answered = true
    // The first contact any call names: an unlinked first call must not make a known buyer fresh.
    if (!n.customerId && call.customerId) n.customerId = call.customerId
  })

  const out: NumberVerdict[] = []
  for (const [key, n] of numbers) {
    const at = n.first.startedAt
    const past = history.get(key) ?? []
    const contact = n.customerId ? contacts.get(n.customerId) : undefined
    const { group, silenceDays } = analysisGroup(at, contact, past)
    const from = past.filter((c) => c.durationSec > 0 && c.startedAt.getTime() >= at.getTime())
    const calledBack = from.some((c) => c.outbound)
    out.push({
      key,
      phone: n.first.phone,
      customerId: n.customerId,
      firstCallAt: at,
      calls: n.calls,
      group,
      answered: n.answered,
      calledBack,
      talked: n.answered || from.length > 0,
      silenceDays,
    })
  }
  return out
}

export function groupOutcome(verdicts: readonly NumberVerdict[], group: AnalysisGroup): GroupOutcome {
  const of = verdicts.filter((v) => v.group === group)
  const talked = of.filter((v) => v.talked).length
  return {
    numbers: of.length,
    answered: of.filter((v) => v.answered).length,
    calledBack: of.filter((v) => v.calledBack).length,
    talked,
    lost: of.length - talked,
  }
}

export function returningDetail(verdicts: readonly NumberVerdict[]): ReturningDetail {
  const days = verdicts
    .filter((v) => v.group === 'returning' && v.silenceDays !== null)
    .map((v) => v.silenceDays!)
    .sort((a, b) => a - b)
  const buckets: Record<SilenceBucket, number> = { d14_30: 0, m1_3: 0, m3_6: 0, m6: 0 }
  for (const d of days) buckets[silenceBucket(d)] += 1
  const mid = days.length / 2
  const median =
    days.length === 0 ? null : days.length % 2 ? days[Math.floor(mid)]! : (days[mid - 1]! + days[mid]!) / 2
  return {
    buckets,
    medianDays: median === null ? null : Math.round(median),
    longestDays: days.length ? Math.floor(days[days.length - 1]!) : null,
  }
}

/**
 * The report: a row per day of the window (each number judged at the day's
 * first call), the period's verdicts (each number judged at its first call in
 * the window) and their two groups' outcomes.
 */
export function inboundAnalysis(
  calls: readonly InboundCall[],
  contacts: ReadonlyMap<string, ContactHistory>,
  history: ReadonlyMap<string, readonly HistoryCall[]>,
  days: readonly string[],
): { days: AnalysisDay[]; verdicts: NumberVerdict[] } {
  const ordered = [...calls].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const byDay = new Map<string, InboundCall[]>()
  for (const call of ordered) {
    const list = byDay.get(call.day)
    if (list) list.push(call)
    else byDay.set(call.day, [call])
  }
  const dayRows = days.map((day): AnalysisDay => {
    const dayCalls = byDay.get(day) ?? []
    const verdicts = judgeNumbers(dayCalls, contacts, history)
    return {
      day,
      calls: dayCalls.length,
      numbers: verdicts.length,
      fresh: groupOutcome(verdicts, 'fresh'),
      returning: groupOutcome(verdicts, 'returning'),
    }
  })
  return { days: dayRows, verdicts: judgeNumbers(ordered, contacts, history) }
}
