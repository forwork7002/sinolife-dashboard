/**
 * Bitrix24 field mapping — CONFIRMED against the live portal.
 *
 * Every value below was read from obey.bitrix24.kz by the discovery scripts,
 * not guessed. See docs/BITRIX24-IMPORT-PLAN.md for the evidence behind each
 * decision.
 */

import type { DealStatusValue, StageCategoryValue } from '@/server/domain/types'

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

/**
 * Which Bitrix24 pipelines contribute revenue.
 *
 * Доставка (#6) holds 16 283 deals, 99.8% carrying an amount, and is where the
 * money actually lands. Ecommerce (#14) is a genuinely separate channel — only
 * 20% contact overlap with Доставка and a distinct team.
 *
 * База (#10) is deliberately ABSENT. It duplicates Доставка: 97% of its order
 * codes and amounts reappear there, created a median of 10 days later, and
 * always later (290 of 292). Importing it would roughly double reported
 * revenue with nothing visibly broken.
 *
 * The remaining pipelines carry no money at all: Регистрация is registration
 * (99.9% zero), Первичный отдел is lead qualification with zero won deals
 * ever, ИИ обработка has no amounts, HR is recruitment.
 */
export const REVENUE_PIPELINES = [6, 14] as const

export const PIPELINE_NAMES: Readonly<Record<number, string>> = Object.freeze({
  0: 'Регистрация',
  4: 'Тасдиклаш',
  6: 'Доставка',
  8: 'HR',
  10: 'База',
  12: 'Первичный отдел',
  14: 'Ecommerce',
  18: 'Бахолаш ва таклифлар',
  20: 'ИИ обработка',
})

// ---------------------------------------------------------------------------
// Revenue recognition — PROVISIONAL
// ---------------------------------------------------------------------------

/**
 * When a deal becomes revenue.
 *
 * NOT FINAL — pending confirmation from finance. For Доставка this means the
 * `Доставлено` stage, which is defensible for a delivery business and matches
 * the data, but accounting may recognise revenue at payment instead. Payment
 * is not recorded in Bitrix24 at all (see below), so that variant cannot be
 * implemented from this source.
 *
 * Kept as configuration so changing it is an edit plus a re-sync, never a code
 * change in the analytics layer.
 */
export const REVENUE_RULE = {
  recognizeOn: 'WON' as const,
  dateField: 'CLOSEDATE' as const,
} as const

// ---------------------------------------------------------------------------
// Stage semantics
// ---------------------------------------------------------------------------

/**
 * Bitrix24 classifies every stage itself via `STAGE_SEMANTIC_ID`.
 *
 * Using it instead of hand-mapping 100+ stage IDs means a stage nobody
 * remembered to mention still lands in the right bucket.
 */
export function statusFromSemantic(semantic: string | undefined): DealStatusValue {
  switch (semantic) {
    case 'S':
      return 'WON'
    case 'F':
      return 'LOST'
    default:
      return 'OPEN'
  }
}

/**
 * Classify a stage.
 *
 * `crm.dealcategory.stage.list` was expected to return `SEMANTICS` per stage.
 * On this portal it does not — every stage came back undefined, which put
 * "Доставлено" and "Отказ" both in IN_PROGRESS and left the funnel chart
 * showing nothing as ever finishing.
 *
 * So the STATUS_ID suffix is the primary source instead. Bitrix24 guarantees
 * the terminal stages of every pipeline are named `WON`, `LOSE` and
 * `APOLOGY`, prefixed by the pipeline (`C6:WON`, `C14:LOSE`). Semantics is
 * still preferred when present, since a portal may define extra terminal
 * stages the naming convention does not cover.
 */
export function categoryFromSemantic(
  semantic: string | undefined,
  isFirst: boolean,
  statusId?: string,
): StageCategoryValue {
  if (semantic === 'S') return 'WON'
  if (semantic === 'F') return 'LOST'

  const suffix = (statusId ?? '').split(':').pop()?.toUpperCase() ?? ''
  if (suffix === 'WON') return 'WON'
  if (suffix === 'LOSE' || suffix === 'LOST' || suffix === 'APOLOGY') return 'LOST'

  return isFirst ? 'NEW' : 'IN_PROGRESS'
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Bitrix24 returns amounts as decimal strings like "1600000.00000000".
 *
 * Parsed textually into minor units — never through `Number`, which would
 * reintroduce exactly the floating-point error the money domain exists to
 * prevent. UZS uses 2 minor digits.
 */
export function toMinorUnits(value: unknown, exponent = 2): bigint {
  if (value === null || value === undefined || value === '') return 0n

  const text = String(value).trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0n

  const negative = text.startsWith('-')
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')

  const padded = (fraction + '0'.repeat(exponent)).slice(0, exponent)
  const rounded = fraction.length > exponent && Number(fraction[exponent]) >= 5 ? 1n : 0n

  const result = BigInt(whole || '0') * BigInt(10 ** exponent) + BigInt(padded || '0') + rounded
  return negative ? -result : result
}

/** Bitrix24 dates arrive as ISO strings with a portal offset. */
export function toDate(value: unknown): Date | undefined {
  if (!value) return undefined
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * Deal titles are order codes like `bx05267`.
 *
 * This is the key that proved База duplicates Доставка — amounts could not,
 * since 84% of deals sit on just eight price points. Stored so the link
 * survives for later analysis.
 */
export function extractOrderCode(title: unknown): string | undefined {
  const text = String(title ?? '').trim()
  return /^bx\d+$/i.test(text) ? text.toLowerCase() : undefined
}

// ---------------------------------------------------------------------------
// Capability notes
// ---------------------------------------------------------------------------

/**
 * PAYMENTS ARE NOT AVAILABLE — verified, not assumed.
 *
 * Deals expose only OPPORTUNITY, TAX_VALUE and PROBABILITY. `crm.invoice.list`
 * returns 0. `crm.type.list` reports no smart processes. None of the 55 custom
 * fields holds a payment sum. Payment appears only as stage NAMES
 * ("Оплаченно с click", "Оплата при получении") — a state, not an amount.
 *
 * So the finance page reports "not connected" rather than 0 so'm outstanding,
 * which would be false.
 */
export const PAYMENTS_AVAILABLE = false

/** Mapping is confirmed; the old gap-checking helpers no longer apply. */
export function findMappingGaps(): readonly { entity: string; missing: readonly string[] }[] {
  return []
}

export function assertMappingComplete(): void {
  // Confirmed against the live portal — nothing to assert.
}

export class MappingIncompleteError extends Error {
  constructor(public readonly gaps: readonly { entity: string; missing: readonly string[] }[]) {
    super('Bitrix24 mapping incomplete')
    this.name = 'MappingIncompleteError'
  }
}
