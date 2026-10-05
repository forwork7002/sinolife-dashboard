/**
 * «Kiruvchi qoʻngʻiroqlar» — who rang us, and who they were to us when they did.
 *
 * A NUMBER IS THE UNIT, NOT A CALL. The same person ringing four times in an
 * afternoon is one caller, so every figure past «Qoʻngʻiroq» counts distinct
 * numbers, compared on their last nine digits: `+998 93 322 10 28`,
 * `998933221028` and `933221028` are one number, as the client's own sheet
 * treats them.
 *
 * A number is grouped by the moment of its FIRST call in the window — the
 * day's first call for a day row, the period's first call for the total — and
 * by the CRM as it stands NOW, only filtered to deals that already existed at
 * that moment. A deal deleted since, or moved to another contact, moves the
 * number with it; that is a property of the source, not a bug here.
 *
 * The order of the tests is the definition, and it matters: a contact with a
 * Доставка deal AND a stuck Регистрация deal is a buyer, not «not reached».
 */

export const INBOUND_GROUPS = ['fresh', 'notReached', 'talkedNoBuy', 'buyer', 'noDeal'] as const
export type InboundGroup = (typeof INBOUND_GROUPS)[number]

/** Bitrix24 CATEGORY_IDs, as `pipeline.externalId` stores them. */
const BUYER_PIPELINES = new Set(['6', '10']) // Доставка, База
const SALES_PIPELINES = new Set(['12', '4']) // Первичный отдел, Тасдиклаш
const REGISTRATION_PIPELINE = '0'
const REGISTRATION_WON = 'WON'

/**
 * «Соф янги» tolerance. The portal creates the contact a moment AFTER the call
 * starts (the call is what creates it), and a manager typing the card in a
 * minute earlier is still the same arrival.
 */
const FRESH_TOLERANCE_MS = 5 * 60_000

export interface InboundCall {
  readonly phone: string | null
  readonly startedAt: Date
  readonly durationSec: number
  readonly customerId: string | null
  /** Tashkent date key of `startedAt`, `YYYY-MM-DD`. */
  readonly day: string
}

export interface ContactDeal {
  readonly pipeline: string | null
  readonly stage: string | null
  readonly createdAt: Date
}

export interface ContactHistory {
  /** DATE_CREATE in the portal. Null on a row no sync has re-read since the column landed. */
  readonly createdAt: Date | null
  readonly deals: readonly ContactDeal[]
}

export type GroupCounts = Record<InboundGroup, number>

export interface InboundDay {
  readonly day: string
  readonly calls: number
  readonly numbers: number
  readonly talked: number
  readonly outbound: number
  readonly groups: GroupCounts
}

export interface InboundTotal {
  readonly calls: number
  readonly numbers: number
  readonly talked: number
  readonly outbound: number
  readonly groups: GroupCounts
  /** Per group: numbers that never got a single second of conversation in the window. */
  readonly unreached: GroupCounts
}

/** The last nine digits, or null for a number with fewer (an internal extension). */
export function phoneKey(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : digits || null
}

export function inboundGroup(firstCallAt: Date, contact: ContactHistory | undefined): InboundGroup {
  /*
    No contact at all. Every inbound call on this portal is bound to one — the
    PBX creates it — so this is a call the sync could not link yet, and the
    honest reading of «we have no card for this number» is a new one.
  */
  if (!contact) return 'fresh'
  // A null creation time is a contact older than the column: never fresh.
  if (contact.createdAt && contact.createdAt.getTime() >= firstCallAt.getTime() - FRESH_TOLERANCE_MS) {
    return 'fresh'
  }

  const before = contact.deals.filter((d) => d.createdAt.getTime() < firstCallAt.getTime())
  if (before.length === 0) return 'noDeal'
  if (before.some((d) => d.pipeline !== null && BUYER_PIPELINES.has(d.pipeline))) return 'buyer'
  if (
    before.some(
      (d) =>
        (d.pipeline !== null && SALES_PIPELINES.has(d.pipeline)) ||
        (d.pipeline === REGISTRATION_PIPELINE && d.stage === REGISTRATION_WON),
    )
  ) {
    return 'talkedNoBuy'
  }
  return 'notReached'
}

function zeroGroups(): GroupCounts {
  return { fresh: 0, notReached: 0, talkedNoBuy: 0, buyer: 0, noDeal: 0 }
}

interface Callers {
  readonly calls: number
  readonly groups: GroupCounts
  readonly unreached: GroupCounts
  readonly talked: number
  readonly numbers: number
}

/** `calls` must be in start order: the first one seen per number is its first call. */
function callers(calls: readonly InboundCall[], contacts: ReadonlyMap<string, ContactHistory>): Callers {
  const first = new Map<string, InboundCall>()
  const talked = new Set<string>()
  calls.forEach((call, index) => {
    // A call with no usable number is its own caller rather than everybody's.
    const key = phoneKey(call.phone) ?? `#${index}`
    if (!first.has(key)) first.set(key, call)
    if (call.durationSec > 0) talked.add(key)
  })

  const groups = zeroGroups()
  const unreached = zeroGroups()
  for (const [key, call] of first) {
    const group = inboundGroup(call.startedAt, call.customerId ? contacts.get(call.customerId) : undefined)
    groups[group] += 1
    if (!talked.has(key)) unreached[group] += 1
  }
  return { calls: calls.length, groups, unreached, talked: talked.size, numbers: first.size }
}

export function inboundReport(
  calls: readonly InboundCall[],
  contacts: ReadonlyMap<string, ContactHistory>,
  outboundByDay: ReadonlyMap<string, number>,
  /** Every day of the window, in order, so a silent day still gets its row. */
  days: readonly string[],
): { days: InboundDay[]; total: InboundTotal } {
  const ordered = [...calls].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const byDay = new Map<string, InboundCall[]>()
  for (const call of ordered) {
    const list = byDay.get(call.day)
    if (list) list.push(call)
    else byDay.set(call.day, [call])
  }

  const dayRows = days.map((day): InboundDay => {
    const c = callers(byDay.get(day) ?? [], contacts)
    return {
      day,
      calls: c.calls,
      numbers: c.numbers,
      talked: c.talked,
      outbound: outboundByDay.get(day) ?? 0,
      groups: c.groups,
    }
  })

  const all = callers(ordered, contacts)
  return {
    days: dayRows,
    total: {
      calls: all.calls,
      numbers: all.numbers,
      talked: all.talked,
      outbound: dayRows.reduce((sum, d) => sum + d.outbound, 0),
      groups: all.groups,
      unreached: all.unreached,
    },
  }
}
