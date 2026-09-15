/**
 * When a customer counts as active, at risk, or lost — on the ORDER clock.
 *
 * WHAT THIS MODULE OWNS, AND ONLY THIS. `src/lib/retentionGroups.ts` already
 * owns the four-way partition of the База funnel (Yangi / Aloqa siklida /
 * Faol mijoz / Sovigan), keyed by stage id, and it is drawn by
 * `src/features/cohort/StateBars.tsx`. That is a verdict about which stage a
 * customer sits on. This module answers a different question that no stage
 * table can: how long has this customer gone SILENT, measured against their
 * own last order. A partition of one funnel must not have two definitions —
 * this file used to be the second one, keyed by stage NAME where
 * `retentionGroups.ts` keys by id, and it lost that half on 2026-09-15. The
 * id is the stabler key anyway: a portal rename moves a name and leaves an
 * id alone.
 *
 * THE THRESHOLDS ARE MEASURED, NOT CHOSEN. Over 2 346 inter-purchase gaps
 * the median is 37.5 days, p75 is 73.9 and p90 is 141.1. So 60 days is
 * inside the normal cycle, and past 150 days a customer returns with under
 * one chance in ten. Changing them is one edit here and nothing else.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it: the repository builds its
 * CASE from the thresholds, and the screen draws its labels and colours from
 * `CUSTOMER_STATES`. A business definition must not have two homes — the
 * arrangement `logisticsBuckets.ts` already uses, for the same reason.
 * `src/lib` is client-safe (no server imports).
 */

/** Ordered ≤ first, so a customer falls into the first band that holds them. */
export const CUSTOMER_ACTIVE_DAYS = 60
export const CUSTOMER_AT_RISK_DAYS = 150

/**
 * `colour` is a CSS custom property from `globals.css`, fixed per state and
 * never reassigned by size — «colour follows the entity, never its rank»
 * (docs/DESIGN.md). `--series-8` is the palette's red, so red on this block
 * means exactly one thing: the customer stopped buying.
 */
export const CUSTOMER_STATES = [
  { key: 'ACTIVE', label: 'Faol', colour: '--series-3' },
  { key: 'AT_RISK', label: 'Xavf ostida', colour: '--series-5' },
  { key: 'LOST', label: 'Yoʻqotilgan', colour: '--series-8' },
] as const satisfies readonly { key: string; label: string; colour: string }[]

export type CustomerStateKey = (typeof CUSTOMER_STATES)[number]['key']
