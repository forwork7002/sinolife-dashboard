/**
 * «AI registrator → Boshqaruv» (2026-10-30) — the owner's control panel over
 * the voice agent: which sellers' extensions it puts an interested caller
 * through to, how many calls it makes at a time, and how a sale is handed to
 * the ATS. The owner: «qaysi SIP'larga ulash kerakligini, xohlagan SIP'larimni
 * qo'sha olishim kerak … to'liqligicha boshqaruv».
 *
 * THE AGENT PULLS, ISH NEVER PUSHES. The Eskiz server's ports are closed to
 * the outside, so the agent reads `GET /api/ai-registrator/config` itself,
 * applies a new `version` without a restart, and reports what it runs every
 * 30 s to `POST /api/ai-registrator/status`. The panel shows both: what was
 * saved, and what the agent says it applied («AI qabul qildi: vN»).
 *
 * THE RULES BELOW ARE THE AGENT'S OWN (`ai_registrator/app/control.py`
 * `check_config`), checked here first so the owner is told at «Saqlash», not
 * thirty seconds later in red. The agent checks again and keeps its last good
 * settings on a refusal — two checks, one vocabulary.
 */

/** A seller's extension as the ATS numbers them: digits only, 2–6 of them. */
export const EXTENSION_PATTERN = /^\d{2,6}$/

/**
 * The agent's own lines (178, 290–297) and the owner's MicroSIP (294, inside
 * that range). Putting a caller through to one of them rings the agent itself,
 * so neither side accepts them as a seller.
 */
export const AI_OWN_LINES: readonly string[] = ['178', '290', '291', '292', '293', '294', '295', '296', '297']

/** The agent's line count: more at a time would also take the ATS past what it carried. */
export const MAX_CALLS_LIMIT = 8
/** The agent refuses a longer list (`MAX_SELLERS`). */
export const MAX_SELLERS = 60

export const SALE_HANDOFFS = ['refer', 'bridge'] as const
export type SaleHandoff = (typeof SALE_HANDOFFS)[number]

export interface ControlSettings {
  /** The extensions the agent puts callers through to, in the order it rings them. */
  readonly sellers: readonly string[]
  /**
   * Extensions kept on the panel but switched off — ISH's own, never sent to
   * the agent, so «yoqish / oʻchirish» is one press and not a retyped number.
   */
  readonly parked: readonly string[]
  readonly maxCalls: number
  readonly maxNew: number
  readonly maxRetry: number
  readonly saleHandoff: SaleHandoff
}

/** The extensions in order of first appearance, trimmed, each once. */
export function normaliseSellers(sellers: readonly string[]): string[] {
  return [...new Set(sellers.map((s) => s.trim()).filter((s) => s !== ''))]
}

/**
 * Why these settings would be refused, in the owner's words — empty when they
 * are fine. Every problem is named, not just the first, so one «Saqlash»
 * tells the owner everything to fix.
 */
export function controlProblems(settings: ControlSettings): string[] {
  const problems: string[] = []
  const sellers = settings.sellers

  if (sellers.length === 0) problems.push('Sotuvchilar roʻyxati boʻsh — kamida bitta ichki raqam kerak.')
  if (sellers.length > MAX_SELLERS) problems.push(`Sotuvchi ${MAX_SELLERS} tadan koʻp boʻlmasin.`)

  const malformed = sellers.filter((s) => !EXTENSION_PATTERN.test(s))
  if (malformed.length > 0) problems.push(`Ichki raqam 2–6 ta raqamdan iborat boʻlsin: ${malformed.slice(0, 5).join(', ')}.`)

  const own = sellers.filter((s) => AI_OWN_LINES.includes(s))
  if (own.length > 0) problems.push(`AI liniyasi sotuvchi boʻla olmaydi: ${own.join(', ')}.`)

  const repeated = sellers.filter((s, i) => sellers.indexOf(s) !== i)
  if (repeated.length > 0) problems.push(`Ichki raqam takrorlangan: ${[...new Set(repeated)].join(', ')}.`)

  const parked = settings.parked
  if (parked.length > MAX_SELLERS) problems.push(`Oʻchirilgan ichki raqam ${MAX_SELLERS} tadan koʻp boʻlmasin.`)
  const parkedBad = parked.filter((s) => !EXTENSION_PATTERN.test(s) || AI_OWN_LINES.includes(s))
  if (parkedBad.length > 0) problems.push(`Notoʻgʻri ichki raqam: ${parkedBad.slice(0, 5).join(', ')}.`)
  const both = parked.filter((s) => sellers.includes(s))
  if (both.length > 0) problems.push(`Ichki raqam ham yoqiq, ham oʻchiq boʻla olmaydi: ${[...new Set(both)].join(', ')}.`)

  const { maxCalls, maxNew, maxRetry } = settings
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > MAX_CALLS_LIMIT) {
    problems.push(`Bir vaqtdagi qoʻngʻiroq 1 dan ${MAX_CALLS_LIMIT} gacha boʻlsin.`)
  }
  if (!Number.isInteger(maxNew) || maxNew < 0 || maxNew > maxCalls) {
    problems.push('Yangi lidlarga qoʻngʻiroq 0 dan bir vaqtdagi qoʻngʻiroqlar sonigacha boʻlsin.')
  }
  if (!Number.isInteger(maxRetry) || maxRetry < 0 || maxRetry > maxCalls) {
    problems.push('Nedozvon qoʻngʻiroqlari 0 dan bir vaqtdagi qoʻngʻiroqlar sonigacha boʻlsin.')
  }
  if (!SALE_HANDOFFS.includes(settings.saleHandoff)) problems.push('Sotuvni topshirish usuli refer yoki bridge boʻlsin.')

  return problems
}

export interface ControlChange {
  readonly field: keyof ControlSettings
  readonly before: unknown
  readonly after: unknown
}

/**
 * What one save changed, field by field, for the audit. The seller list is
 * compared as a list — order included, because the agent rings it in order —
 * and its additions and removals are spelled out beside it.
 */
export function controlChanges(before: ControlSettings | null, after: ControlSettings): ControlChange[] {
  const out: ControlChange[] = []
  const was = before ?? null
  for (const field of ['sellers', 'parked'] as const) {
    const listBefore = was?.[field] ?? []
    if (was === null || listBefore.join(',') !== after[field].join(',')) {
      out.push({ field, before: was === null ? null : [...listBefore], after: [...after[field]] })
    }
  }
  for (const field of ['maxCalls', 'maxNew', 'maxRetry', 'saleHandoff'] as const) {
    if (was === null || was[field] !== after[field]) out.push({ field, before: was === null ? null : was[field], after: after[field] })
  }
  return out
}

/** The extensions a save added and took away — what the audit line prints. */
export function sellersDelta(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  return {
    added: after.filter((s) => !before.includes(s)),
    removed: before.filter((s) => !after.includes(s)),
  }
}

/**
 * The agent reports every 30 s; a report older than this means it has stopped
 * (or cannot reach us), and the panel says «AI'dan xabar yoʻq» rather than
 * show the last picture as if it were live.
 */
export const STATUS_STALE_MS = 2 * 60_000

export function statusIsStale(receivedAt: Date | null, now: Date): boolean {
  return receivedAt === null || now.getTime() - receivedAt.getTime() > STATUS_STALE_MS
}
