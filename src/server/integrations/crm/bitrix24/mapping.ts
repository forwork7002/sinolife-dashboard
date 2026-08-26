/**
 * Bitrix24 field mapping — CONFIRMED against the live portal.
 *
 * Every value below was read from obey.bitrix24.kz by the discovery scripts,
 * not guessed. See docs/BITRIX24-IMPORT-PLAN.md for the evidence behind each
 * decision.
 */

import type {
  CallDirectionValue,
  ConfirmStatusValue,
  DealStatusValue,
  LogisticsRoleValue,
  PipelineRoleValue,
  StageCategoryValue,
} from '@/server/domain/types'

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

/**
 * Every pipeline on the portal is imported, but only two of them are sales.
 *
 * The role decides what each one is allowed to contribute. REVENUE feeds money
 * figures; everything else is browsable, filterable and analysable in its own
 * module while staying out of every total.
 *
 * A pipeline missing from this table imports as IGNORED — a new воронка
 * someone creates next month cannot silently start counting as revenue.
 */
export const PIPELINE_ROLE_BY_ID: Readonly<Record<number, PipelineRoleValue>> = Object.freeze({
  0: 'LEAD',           // Регистрация — 179 842 deals, 99.9% zero amount
  4: 'CONFIRMATION',   // Тасдиклаш — order confirmation calls
  6: 'REVENUE',        // Доставка — where money actually lands
  8: 'IGNORED',        // HR — recruitment candidates, not sales
  10: 'RETENTION',     // База — confirmed duplicate of Доставка's money
  12: 'QUALIFICATION', // Первичный отдел — zero won deals, ever
  14: 'REVENUE',       // Ecommerce — separate channel, own team
  18: 'IGNORED',       // Бахолаш ва таклифлар — complaints, 6 deals
  20: 'AI_TRIAGE',     // ИИ обработка — no amounts at all
})

export function pipelineRole(categoryId: number): PipelineRoleValue {
  return PIPELINE_ROLE_BY_ID[categoryId] ?? 'IGNORED'
}

/** Every pipeline on the portal, in the order the portal sorts them. */
export const ALL_PIPELINES = [0, 12, 4, 6, 10, 8, 14, 18, 20] as const

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
// The delivery ladder
// ---------------------------------------------------------------------------

/**
 * Where each Доставка stage sits in the delivery process.
 *
 * `crm.dealcategory.stage.list` returns SEMANTICS only for WON and LOSE; the
 * other sixteen stages come back null, so this classification is ours. It is
 * the entire basis of the logistics module: which parcels are at a hub, which
 * are with a carrier, how long each leg takes, and where they die.
 *
 * REFUSED and CANCELLED_EARLY are separate on purpose. `Отказ` is a parcel that
 * shipped, travelled and came back — it cost real money. `Отказ предварительно`
 * is a customer who changed their mind before dispatch and cost nothing.
 * Reporting them as one number hides the expensive half.
 */
export const DELIVERY_STAGE_ROLES: Readonly<Record<string, LogisticsRoleValue>> = Object.freeze({
  'C6:NEW': 'PREPARING',                  // Подготовка товара
  'C6:EXECUTING': 'PREPARING',            // Обработка заказов
  'C6:UC_IAU4Q5': 'WAREHOUSE',            // Заказ в мой склад
  /*
    NOT 'CONFIRMED'.

    "Успешно заказ" sounds like an operator confirming an order, and the whole
    Тасдиклаш module was built on that reading. The data says otherwise: it is
    stamped within FIVE SECONDS of Доставлено in 2,869 of the 4,335 deals that
    reach both, a median of 244 hours after the order was created, and 858 of
    896 deals carrying it are already closed. It is a settlement stamp written
    by automation after the parcel arrives.

    The consequence was that every number on the confirmation page was the
    delivery rate wearing a different label, and per-operator "confirmed"
    equalled "delivered" in 85 of 92 rows.
  */
  'C6:UC_YUKVF1': 'SETTLED',              // Успешно заказ — post-delivery
  'C6:UC_4UD7I9': 'IN_TRANSIT',           // В пути
  'C6:PREPARATION': 'REGIONAL_HUB',       // TOSHKENT-1
  'C6:UC_32AOK8': 'REGIONAL_HUB',         // NAVOIY
  'C6:UC_KW44HQ': 'REGIONAL_HUB',         // VODIY
  'C6:UC_EUPVYN': 'REGIONAL_HUB',         // QASHQADARYO
  'C6:UC_PH8HGF': 'REGIONAL_HUB',         // SURXONDARYO
  'C6:PREPAYMENT_INVOICE': 'CARRIER',     // CARAVAN
  'C6:UC_GTQXY7': 'CARRIER',              // OSON POCHTA
  'C6:UC_3OK02F': 'CARRIER',              // BEK POCHTA
  'C6:UC_06YLAO': 'CHASING',              // Юрист смс
  'C6:UC_AL40O1': 'CHASING',              // Пропущенный
  'C6:WON': 'DELIVERED',                  // Доставлено
  'C6:LOSE': 'REFUSED',                   // Отказ
  'C6:UC_3U7025': 'CANCELLED_EARLY',      // Отказ предварительно

  /*
    Тасдиклаш (C4) is the REAL confirmation ladder.

    Its stages carry no logistics role at all until now, which is why the
    module reached for C6 in the first place. Median C4:NEW → C4:WON is 85
    minutes — the shape of someone picking up a phone, against the 244 hours
    of the stage it replaces.
  */
  'C4:NEW': 'PENDING_CONFIRM',            // Заказ тасдиклаш — in the queue
  'C4:WON': 'CONFIRMED',                  // Сделка успешна — reached and confirmed
  'C4:UC_GYMGQS': 'CHASING',              // Смс коллаген тастиклаш
  'C4:PREPAYMENT_INVOICE': 'CHASING',     // Смс zextra тастиклаш
  'C4:UC_JQR9F1': 'CHASING',              // Недозвон смс — no answer, SMS sent
  'C4:FINAL_INVOICE': 'CHASING',          // Пропущенный — missed call
  'C4:LOSE': 'CANCELLED_EARLY',           // Ошибка первичный отдел
  'C4:UC_V4JJIW': 'CANCELLED_EARLY',      // UTECHKA — lost before dispatch

  // Ecommerce runs its own shorter ladder.
  'C14:NEW': 'PREPARING',                 // Новая заявка
  'C14:PREPARATION': 'PREPARING',         // В обработке
  // Paid, which is a settlement fact rather than an operator reaching anyone.
  // Grouping these under CONFIRMED put payment events into a call metric.
  'C14:PREPAYMENT_INVOIC': 'SETTLED',     // Оплаченно с click
  'C14:EXECUTING': 'SETTLED',             // Оплаченно с payme
  'C14:FINAL_INVOICE': 'SETTLED',         // Оплата при получении
  'C14:UC_T2UAZ7': 'IN_TRANSIT',          // В пути
  'C14:UC_EW3SZA': 'CHASING',             // Ожидания и нд
  'C14:UC_WFN8MP': 'DELIVERED',           // Доставлено
  'C14:WON': 'DELIVERED',                 // Сделка успешна
  'C14:LOSE': 'REFUSED',                  // Сделка провалена
  'C14:APOLOGY': 'REFUSED',               // Анализ причины провала
})

export function logisticsRole(stageId: string): LogisticsRoleValue | undefined {
  return DELIVERY_STAGE_ROLES[stageId]
}

/**
 * The hub or carrier a delivery stage represents, by its display name.
 *
 * Used to label the logistics breakdown without exposing a Bitrix24 stage id
 * to the UI. Derived from the stage name because the portal's own naming is
 * already the operational vocabulary the team uses.
 */
export const DELIVERY_ROUTE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'C6:PREPARATION': 'TOSHKENT-1',
  'C6:UC_32AOK8': 'NAVOIY',
  'C6:UC_KW44HQ': 'VODIY',
  'C6:UC_EUPVYN': 'QASHQADARYO',
  'C6:UC_PH8HGF': 'SURXONDARYO',
  'C6:PREPAYMENT_INVOICE': 'CARAVAN',
  'C6:UC_GTQXY7': 'OSON POCHTA',
  'C6:UC_3OK02F': 'BEK POCHTA',
})

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

/**
 * The user fields on a deal that analytics actually filters on.
 *
 * They are opaque timestamps because Bitrix24 names them after their creation
 * moment. The constants below are the only place those names appear; every
 * layer above reads the promoted column instead.
 *
 * All of them are enumerations whose values arrive as numeric item ids, not
 * labels. The provider resolves ids to labels from `crm.deal.fields` at import
 * time rather than from a hardcoded table, so an operator adding a new region
 * next month gets the right name without a redeploy.
 */
export const UF = Object.freeze({
  /** Регион — 14 items, Ташкент г. through Нукус. */
  REGION: 'UF_CRM_1747975214161',
  /** Warehouse / courier / marketplace that fulfils the order — 15 items. */
  FULFILMENT_POINT: 'UF_CRM_1756494336',
  /** Тастиклаш анализ — Тастикланган / Недозвон булиб чикарилган. */
  CONFIRM_STATUS: 'UF_CRM_1777879395123',
  /** Why the customer refused — 4 items. */
  REFUSAL_REASON: 'UF_CRM_1770109073790',
  /** Карта оркали / Накд оркали / Консультация. */
  PAYMENT_METHOD: 'UF_CRM_1747979729184',
  /** Collagen Marine / Zextra sure / Sinolife collagen tabletka. */
  PRODUCT_LINE: 'UF_CRM_1750413928942',
  /** A / B / C customer grade. */
  CUSTOMER_GRADE: 'UF_CRM_1747979663403',
} as const)

export const UF_FIELDS: readonly string[] = Object.freeze(Object.values(UF))

/**
 * Confirmation outcome, from the label rather than the item id.
 *
 * Item ids are portal-local and would break if the field were ever rebuilt;
 * the two labels are business vocabulary and stable. An unrecognised label
 * returns undefined — an unknown confirmation state must not be reported as
 * "unreachable", which would make an operator look worse than they are.
 */
export function confirmStatusFromLabel(label: string | undefined): ConfirmStatusValue | undefined {
  if (!label) return undefined
  const text = label.trim().toLowerCase()
  if (text.startsWith('тастикланган')) return 'CONFIRMED'
  if (text.startsWith('недозвон')) return 'UNREACHABLE'
  return undefined
}

/** voximplant.statistic.get reports the leg, not the intent. */
export function callDirection(category: string | undefined, type: string | undefined): CallDirectionValue {
  if (type === '1' || category === 'incoming') return 'INBOUND'
  if (type === '3' || category === 'callback') return 'CALLBACK'
  return 'OUTBOUND'
}

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
 * The deal's real state, correcting one stage the portal mislabels.
 *
 * `Отказ предварительно` — a customer who refused before the parcel shipped —
 * carries `STAGE_SEMANTIC_ID = P`, so Bitrix24 reports it as still in
 * progress. It is not. Of the 359 deals that have ever entered that stage, 331
 * are still sitting in it and only 21 were ever delivered: a 6% revival rate
 * over fourteen months.
 *
 * Left as OPEN it is excluded from the conversion denominator, which counts
 * won against resolved — and the dashboard then reported a 100% conversion
 * rate for a month with 803 wins and 328 cancellations. A rate that cannot go
 * below 100% is not measuring anything.
 *
 * Every other stage keeps the portal's own classification. This is a single,
 * evidenced correction, not a second opinion about the CRM.
 */
export function dealStatus(
  semantic: string | undefined,
  stageId: string | undefined,
): DealStatusValue {
  const fromSemantic = statusFromSemantic(semantic)
  if (fromSemantic !== 'OPEN') return fromSemantic

  return logisticsRole(stageId ?? '') === 'CANCELLED_EARLY' ? 'LOST' : 'OPEN'
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

  // Same correction as `dealStatus`, applied to the stage's own meaning so the
  // funnel paints a pre-dispatch cancellation as a loss rather than as a step
  // orders are still moving through.
  if (logisticsRole(statusId ?? '') === 'CANCELLED_EARLY') return 'LOST'

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
