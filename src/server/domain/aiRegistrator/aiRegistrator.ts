/**
 * «AI registrator» — the owner's question of 2026-10-22, in his words: is it
 * better that the AI registrator puts the client through to a seller live, or
 * that the classic registrar qualifies the lead and the specialist gets it?
 * («haqiqatdan ham AI registrator ulab berishi yaxshimi yoki mutaxassisga
 * ulagani yaxshimi»). He watches it for a day or two and decides, so every
 * number here has to be one he can check deal by deal.
 *
 * TWO COHORTS, EACH DATED BY ITS HAND-OFF — the moment the lead reached a
 * seller:
 *
 *   AI       a Регистрация deal the agent put through (`interested_transferred`),
 *            at that call's start. One deal is one lead, at its FIRST transfer
 *            in the window; the agent's test calls are never counted.
 *   KLASSIK  a Регистрация deal a human registrar qualified — WON
 *            («Сделка успешна») with «Регистрация» filled — at its `closedAt`,
 *            and never touched by the agent (any non-test call): a lead the
 *            AI talked to belongs to neither side of a fair comparison.
 *
 * WHAT HAPPENED NEXT is the contact's sales deals — Первичный отдел,
 * Тасдиклаш, Доставка — opened from `HANDOFF_SLACK_MS` before the hand-off to
 * `FOLLOW_DAYS` after it. A sale goes to the contact's LATEST hand-off at or
 * before it (`assignSales`), the same «latest lead wins» as Roistat's origin
 * lead, so one sale is never counted on two leads. Every hand-off the contact
 * ever had takes part in that choice, not just the cohorts', so a sale a later
 * lead earned is not credited to an earlier one.
 *
 *   BUYURTMA  a Тасдиклаш or Доставка deal — the order exists (Roistat's
 *             «orders»). Its sum is the Доставка deals' when there are any
 *             (the confirmed copy), else the Тасдиклаш deals'.
 *   SOTILDI   a Доставка deal WON with `countsAsRevenue` — delivered money,
 *             the only money a sale is measured by (invariants: «Delivered
 *             revenue is not a seller's close»).
 *
 * Pure: no Prisma, no framework.
 */

/** The agent's outcomes, as `ai_registrator/app/crm/deal_sync.py` names them. */
export const AI_OUTCOMES = [
  'interested_transferred',
  'transfer_failed',
  'interested_callback',
  'not_interested',
  'no_answer',
  'busy',
  'unreachable',
  'wrong_number',
  'voicemail',
  'hung_up_early',
  'error',
] as const
export type AiOutcome = (typeof AI_OUTCOMES)[number]

/**
 * Each extension tried on a transfer ends one of these ways (the agent's `call_runner.specialist_result`):
 * `busy` — the seller was on another call (their line said so, so they were not rung, or the ATS said busy
 * at once); `rejected` — it rang and the seller turned it down (the red button); `no_answer` — it rang out;
 * `caller_left` — the caller hung up while it rang; `failed` — the ATS would not put it through.
 */
export const TRANSFER_RESULTS = ['answered', 'busy', 'rejected', 'no_answer', 'caller_left', 'failed'] as const
export type TransferResult = (typeof TRANSFER_RESULTS)[number]

/** A sale may open a little BEFORE its hand-off is stamped: the seller types while the agent's call is still ending. */
export const HANDOFF_SLACK_MS = 10 * 60_000

/** How long after a hand-off its sales are followed — Roistat's `ORIGIN_LEAD_DAYS`, the same 30. */
export const FOLLOW_DAYS = 30

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export interface TransferAttempt {
  readonly ext: string
  readonly result: TransferResult
  readonly at: Date | null
  /** How long the seller's phone rang before this ended (answered, turned down or rang out); absent on older calls. */
  readonly ringSec?: number
}

/** One stored call, as the screen reads it. */
export interface AiCall {
  readonly callId: string
  readonly dealExternalId: string
  readonly phone: string
  /** Which attempt on this lead the agent counted it as, from 1; absent on a hand-built call. */
  readonly attempt?: number
  readonly startedAt: Date
  readonly answeredAt: Date | null
  readonly durationSec: number
  readonly outcome: string
  readonly transferredTo: string | null
  readonly transferAttempts: readonly TransferAttempt[]
  readonly result: Readonly<Record<string, unknown>> | null
  readonly isTest: boolean
}

/**
 * The stored `transferAttempts` JSON, read leniently: an entry that is not
 * `{ ext, result }` with a known result is dropped rather than failing the
 * screen. The ingest route validates what arrives; this guards what is stored.
 */
export function readTransferAttempts(json: unknown): TransferAttempt[] {
  if (!Array.isArray(json)) return []
  const out: TransferAttempt[] = []
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue
    const { ext, result, at, ring_sec: ring } = item as Record<string, unknown>
    if (typeof ext !== 'string' || ext.trim() === '') continue
    if (typeof result !== 'string' || !(TRANSFER_RESULTS as readonly string[]).includes(result)) continue
    const when = typeof at === 'string' ? new Date(at) : null
    out.push({
      ext: ext.trim(),
      result: result as TransferResult,
      at: when && !Number.isNaN(when.getTime()) ? when : null,
      ...(typeof ring === 'number' && Number.isFinite(ring) && ring >= 0 ? { ringSec: Math.round(ring) } : {}),
    })
  }
  return out
}

/**
 * Every extension tried — the attempts the agent listed, or, for a call that
 * listed none (an agent build before the hunt list), its one answered
 * `transferredTo`.
 */
export function attemptsOf(call: AiCall): readonly TransferAttempt[] {
  if (call.transferAttempts.length > 0) return call.transferAttempts
  if (call.transferredTo) return [{ ext: call.transferredTo, result: 'answered', at: null }]
  return []
}

/** A lead the agent put through: its deal, the call, and the extension that answered. */
export interface AiTransfer {
  readonly dealExternalId: string
  readonly call: AiCall
}

/** Each deal's FIRST transfer among `calls` (test calls never count). */
export function aiTransfers(calls: readonly AiCall[]): AiTransfer[] {
  const first = new Map<string, AiCall>()
  for (const call of calls) {
    if (call.isTest || call.outcome !== 'interested_transferred') continue
    const held = first.get(call.dealExternalId)
    if (!held || call.startedAt < held.startedAt) first.set(call.dealExternalId, call)
  }
  return [...first.entries()]
    .map(([dealExternalId, call]) => ({ dealExternalId, call }))
    .sort((a, b) => a.call.startedAt.getTime() - b.call.startedAt.getTime())
}

/** The window's AI calls by what came of them: every call, every distinct deal, every pick-up. */
export interface CallFunnel {
  readonly calls: number
  readonly deals: number
  readonly answered: number
  readonly tests: number
  readonly byOutcome: Readonly<Record<string, number>>
}

export function callFunnel(calls: readonly AiCall[]): CallFunnel {
  const real = calls.filter((c) => !c.isTest)
  const byOutcome: Record<string, number> = {}
  for (const c of real) byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1
  return {
    calls: real.length,
    deals: new Set(real.map((c) => c.dealExternalId)).size,
    answered: real.filter((c) => c.answeredAt !== null).length,
    tests: calls.length - real.length,
    byOutcome,
  }
}

/** One extension's share of the transfers: how often it was tried and how each try ended. */
export interface ExtensionAttempts {
  readonly ext: string
  readonly tried: number
  readonly answered: number
  readonly busy: number
  readonly rejected: number
  readonly noAnswer: number
  readonly failed: number
}

/**
 * Per extension, in the order of how often it was tried (then the number). Test calls never count, nor a
 * try the caller cut short by hanging up while it rang — that is not the seller's doing.
 */
export function attemptsByExtension(calls: readonly AiCall[]): ExtensionAttempts[] {
  const rows = new Map<string, { tried: number; answered: number; busy: number; rejected: number; noAnswer: number; failed: number }>()
  for (const call of calls) {
    if (call.isTest) continue
    for (const a of attemptsOf(call)) {
      if (a.result === 'caller_left') continue
      const row = rows.get(a.ext) ?? { tried: 0, answered: 0, busy: 0, rejected: 0, noAnswer: 0, failed: 0 }
      row.tried += 1
      if (a.result === 'answered') row.answered += 1
      else if (a.result === 'busy') row.busy += 1
      else if (a.result === 'rejected') row.rejected += 1
      else if (a.result === 'no_answer') row.noAnswer += 1
      else row.failed += 1
      rows.set(a.ext, row)
    }
  }
  return [...rows.entries()]
    .map(([ext, r]) => ({ ext, ...r }))
    .sort((a, b) => b.tried - a.tried || a.ext.localeCompare(b.ext, 'en', { numeric: true }))
}

/** A sales-side deal of a lead's contact: Первичный отдел, Тасдиклаш or Доставка. */
export interface SaleDeal {
  readonly externalId: string
  readonly customerId: string
  readonly role: 'QUALIFICATION' | 'CONFIRMATION' | 'REVENUE'
  readonly status: 'OPEN' | 'WON' | 'LOST'
  readonly countsAsRevenue: boolean
  readonly amountMinor: bigint
  readonly createdAt: Date
  readonly pipeline: string | null
  readonly stage: string | null
  /** The seller the portal stamped at the sale (`operatorEmployeeId`); null on a deal with none. */
  readonly operatorId: string | null
  /** The deal's owner today (`employeeId`). */
  readonly ownerId: string
}

/** The moment a lead reached a seller. `leadKey` is the Регистрация deal's portal id. */
export interface Handoff {
  readonly leadKey: string
  readonly customerId: string
  readonly at: Date
}

/**
 * Each sale to the contact's latest hand-off at or before it (with
 * `HANDOFF_SLACK_MS` of slack) and no more than `FOLLOW_DAYS` older — one
 * sale, one lead. Two hand-offs at the same instant resolve by the larger
 * lead key, so the answer is the same on every read. A sale with no such
 * hand-off goes nowhere.
 */
export function assignSales(handoffs: readonly Handoff[], sales: readonly SaleDeal[]): Map<string, SaleDeal[]> {
  const byCustomer = new Map<string, Handoff[]>()
  for (const h of handoffs) {
    const list = byCustomer.get(h.customerId)
    if (list) list.push(h)
    else byCustomer.set(h.customerId, [h])
  }
  const out = new Map<string, SaleDeal[]>()
  for (const sale of sales) {
    const t = sale.createdAt.getTime()
    let best: Handoff | null = null
    for (const h of byCustomer.get(sale.customerId) ?? []) {
      const at = h.at.getTime()
      if (at - HANDOFF_SLACK_MS > t || t >= at + FOLLOW_DAYS * DAY_MS) continue
      if (!best || at > best.at.getTime() || (at === best.at.getTime() && h.leadKey > best.leadKey)) best = h
    }
    if (!best) continue
    const list = out.get(best.leadKey)
    if (list) list.push(sale)
    else out.set(best.leadKey, [sale])
  }
  for (const list of out.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return out
}

/**
 * Where a lead stands now, best first: SOLD (delivered), ORDERED (an order
 * exists, not delivered yet or refused later), WITH_SELLER (a Первичный отдел
 * deal is open, no order yet), LOST (every sales deal lost), NO_DEAL (nothing
 * was opened after the hand-off).
 */
export const LEAD_VERDICTS = ['sold', 'ordered', 'with_seller', 'lost', 'no_deal'] as const
export type LeadVerdict = (typeof LEAD_VERDICTS)[number]

export interface LeadOutcome {
  readonly verdict: LeadVerdict
  readonly hasSalesDeal: boolean
  readonly ordered: boolean
  readonly orderMinor: bigint
  readonly sold: boolean
  readonly soldMinor: bigint
  readonly firstOrderAt: Date | null
  /** Who sold it: the first order's stamped seller, else the first sales deal's owner; null with no sales deal. */
  readonly sellerId: string | null
}

const sum = (deals: readonly SaleDeal[]) => deals.reduce((acc, d) => acc + d.amountMinor, 0n)

export function leadOutcome(sales: readonly SaleDeal[]): LeadOutcome {
  const ordered = sales.filter((d) => d.role === 'CONFIRMATION' || d.role === 'REVENUE')
  const revenue = ordered.filter((d) => d.role === 'REVENUE' && d.countsAsRevenue)
  const confirmation = ordered.filter((d) => d.role === 'CONFIRMATION')
  const delivered = revenue.filter((d) => d.status === 'WON')
  const firstOrder = ordered[0] ?? null
  const verdict: LeadVerdict =
    delivered.length > 0
      ? 'sold'
      : sales.length === 0
        ? 'no_deal'
        : sales.every((d) => d.status === 'LOST')
          ? 'lost'
          : ordered.length > 0
            ? 'ordered'
            : 'with_seller'
  return {
    verdict,
    hasSalesDeal: sales.length > 0,
    ordered: ordered.length > 0,
    orderMinor: revenue.length > 0 ? sum(revenue) : sum(confirmation),
    sold: delivered.length > 0,
    soldMinor: sum(delivered),
    firstOrderAt: firstOrder?.createdAt ?? null,
    sellerId: firstOrder?.operatorId ?? firstOrder?.ownerId ?? sales[0]?.ownerId ?? null,
  }
}

/** One cohort's totals. Rates are left to the caller (`rateBp`): a cohort of 0 has none. */
export interface GroupStats {
  readonly leads: number
  readonly withSalesDeal: number
  readonly ordered: number
  readonly orderMinor: bigint
  readonly sold: number
  readonly soldMinor: bigint
  readonly lost: number
  readonly noDeal: number
  /** Median hours from the hand-off to the first order, over the ordered leads; null with none. */
  readonly medianHoursToOrder: number | null
}

export function groupStats(rows: readonly { readonly outcome: LeadOutcome; readonly handoffAt: Date }[]): GroupStats {
  const hours = rows
    .filter((r) => r.outcome.firstOrderAt !== null)
    .map((r) => Math.max(0, (r.outcome.firstOrderAt!.getTime() - r.handoffAt.getTime()) / HOUR_MS))
    .sort((a, b) => a - b)
  return {
    leads: rows.length,
    withSalesDeal: rows.filter((r) => r.outcome.hasSalesDeal).length,
    ordered: rows.filter((r) => r.outcome.ordered).length,
    orderMinor: rows.reduce((acc, r) => acc + r.outcome.orderMinor, 0n),
    sold: rows.filter((r) => r.outcome.sold).length,
    soldMinor: rows.reduce((acc, r) => acc + r.outcome.soldMinor, 0n),
    lost: rows.filter((r) => r.outcome.verdict === 'lost').length,
    noDeal: rows.filter((r) => r.outcome.verdict === 'no_deal').length,
    medianHoursToOrder: median(hours),
  }
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Below this many leads on the AI side the screen says the comparison cannot
 * decide anything yet. Not a significance test — a floor under which one
 * order moves the rate by more than five points.
 */
export const MIN_LEADS_TO_COMPARE = 20

/**
 * WHICH CALLS A NUMBER ON THE SCREEN STANDS FOR (the owner, 2026-10-23: «AI
 * qoʻngʻiroq degan joylarda ustiga bossa qaysi nomerlar … kim ulaganini, kim
 * nima qilgani koʻrilib turilishi kerak»). Every figure on «AI registrator»
 * opens the calls behind it, picked by the very rule that counted it:
 *
 *   all       every call — «AI qoʻngʻiroqlari» (`callFunnel.calls`)
 *   unique    each deal's latest call — «Xil lid» (`callFunnel.deals`)
 *   answered  the client picked up — «Mijoz koʻtardi»
 *   outcome   one outcome — «Sotuvchiga ulandi», «Ulanmadi», each result row
 *   ext       every call that tried this extension — «Ulash urinishlari»
 *   seller    the leads put through to this seller, at their FIRST transfer
 *             (`aiTransfers`) — the «AI ulab bergan · lid» column
 *   deals     the given leads at their first transfer — «Buyurtma (AI lidlari)»
 *
 * Test calls are never listed, as they are never counted. `q` narrows to a
 * phone (by its digits) or a deal id. Newest first.
 */
export type AiCallKind = 'all' | 'unique' | 'answered' | 'outcome' | 'ext' | 'seller' | 'deals'

export interface AiCallFilter {
  readonly kind: AiCallKind
  readonly outcome?: string | null
  readonly ext?: string | null
  /** A seller's key as the screen's seller rows carry it: the employee id, or `ext:<n>` for an unnamed extension. */
  readonly seller?: string | null
  readonly deals?: ReadonlySet<string> | null
  readonly q?: string | null
}

export function selectCalls(
  calls: readonly AiCall[],
  filter: AiCallFilter,
  sellerKeyOf: (ext: string | null) => string | null,
): AiCall[] {
  const real = calls.filter((c) => !c.isTest)
  let picked: AiCall[]
  switch (filter.kind) {
    case 'all':
      picked = real
      break
    case 'unique': {
      const latest = new Map<string, AiCall>()
      for (const c of real) {
        const held = latest.get(c.dealExternalId)
        if (!held || c.startedAt > held.startedAt) latest.set(c.dealExternalId, c)
      }
      picked = [...latest.values()]
      break
    }
    case 'answered':
      picked = real.filter((c) => c.answeredAt !== null)
      break
    case 'outcome':
      picked = real.filter((c) => c.outcome === filter.outcome)
      break
    case 'ext':
      picked = real.filter((c) => attemptsOf(c).some((a) => a.ext === filter.ext))
      break
    case 'seller':
      picked = aiTransfers(real)
        .filter((t) => sellerKeyOf(t.call.transferredTo) === filter.seller)
        .map((t) => t.call)
      break
    case 'deals':
      picked = aiTransfers(real)
        .filter((t) => filter.deals?.has(t.dealExternalId) ?? false)
        .map((t) => t.call)
      break
  }
  const needle = (filter.q ?? '').trim()
  if (needle !== '') {
    const digits = needle.replace(/\D/g, '')
    picked = picked.filter((c) => c.dealExternalId === needle || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)))
  }
  return [...picked].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
}
