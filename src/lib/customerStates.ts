/**
 * When a customer counts as active, at risk, or lost — and what the portal
 * says about the same person.
 *
 * TWO VERDICTS, DELIBERATELY NOT RECONCILED. One is what the customers did
 * (their last order date); the other is what the retention desk believes
 * (their open stage in the База funnel). Measured on production 2026-09-15
 * they disagree hard — the portal calls 7 609 customers active where the
 * order dates say 4 753, and calls 3 452 dead where the order dates say
 * 6 062. Roughly 2 900 people sit in an active-looking stage having not
 * ordered in five months. Printing both side by side is the whole point of
 * the block; averaging them would destroy exactly the signal being shown.
 *
 * THE THRESHOLDS ARE MEASURED, NOT CHOSEN. Over 2 346 inter-purchase gaps
 * the median is 37.5 days, p75 is 73.9 and p90 is 141.1. So 60 days is
 * inside the normal cycle, and past 150 days a customer returns with under
 * one chance in ten. Changing them is one edit here and nothing else.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it: the repository builds its
 * bucket CASE from `RETENTION_STATE_STAGES`, and the screen draws its labels
 * and colours from `CUSTOMER_STATES`. A business definition must not have two
 * homes — the arrangement `logisticsBuckets.ts` already uses, for the same
 * reason. `src/lib` is client-safe (no server imports).
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

/**
 * The fourth row, which has no counterpart on our side.
 *
 * Every customer with no OPEN База deal at all. Without it the two columns
 * have different denominators and invite a reconciliation that cannot come
 * out — measured today it is 4 453 of 15 867 people.
 */
export const PORTAL_ABSENT = {
  key: 'ABSENT',
  label: 'Базада yoʻq',
  colour: '--axis',
} as const

/**
 * Stage names are stored PREFIXED with their funnel — stage ids repeat across
 * pipelines, so a bare «Недозвоны» is ambiguous. Russian and verbatim: this
 * block's value is that it reconciles against obey.bitrix24.kz.
 *
 * Verified on 2026-09-15 to be every open RETENTION stage there is. It will
 * not stay that way — the portal adds stages — which is what `UNBUCKETED`
 * below is for.
 */
export const RETENTION_STATE_STAGES = [
  {
    state: 'ACTIVE',
    stages: [
      'База · Новый база',
      'База · Актив',
      'База · Активный клиент',
      'База · 1 кун',
      'База · 3 кун',
      'База · 10 кун',
      'База · 20 кун',
      'База · 30 кун',
      'База · Успешно раздача',
    ],
  },
  { state: 'AT_RISK', stages: ['База · Пропущенный', 'База · Перерыв успешно'] },
  {
    state: 'LOST',
    stages: ['База · Недозвоны', 'База · Неактивные', 'База · Не активный клиент'],
  },
] as const satisfies readonly { state: CustomerStateKey; stages: readonly string[] }[]

/**
 * The integers the SQL CASE emits, and their ORDER IS LOAD-BEARING.
 *
 * A customer can sit on two open База deals at once. They are counted ONCE,
 * in their BEST bucket, and the repository does that with `min(bucket)` —
 * which is only correct while ACTIVE < AT_RISK < LOST. Summing the ladder
 * instead double-counts, the error `retentionStages` already documents.
 */
export const STATE_BUCKET: Record<CustomerStateKey, number> = {
  ACTIVE: 1,
  AT_RISK: 2,
  LOST: 3,
}

/**
 * A RETENTION stage this table does not name.
 *
 * Above every real bucket so `min()` never picks it for a customer who also
 * stands somewhere known, and reported by name rather than swept into a
 * partition that claims to be exhaustive — the tripwire `logisticsBuckets`
 * taught. It counts as «Xavf ostida» in the totals: an unknown stage is not
 * evidence the customer is fine.
 */
export const UNBUCKETED_BUCKET = 9

/** No open База deal at all. Below every bucket; never produced by the CASE. */
export const ABSENT_BUCKET = 0
