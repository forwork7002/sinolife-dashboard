/**
 * «Sverka» — the wire shapes, restated for the client.
 *
 * Mirrors `src/server/services/sverkaService.ts` and the phase / issue unions
 * of `src/server/domain/sverka/sverka.ts`. Client code may not import from
 * `@/server/*`, so they are written out again here, the way `roistatApi.ts`
 * does. Nothing checks the mirror — edit both sides.
 */

export type SverkaPhase = 'PRE_WAREHOUSE' | 'TRANSIT' | 'DELIVERED' | 'RETURNED' | 'OUTSIDE'

export type SverkaIssue =
  | 'MISSING_IN_MS'
  | 'NOT_FAKT1'
  | 'NOT_QUEUED'
  | 'NO_DEAL'
  | 'SUM'
  | 'STATUS'
  | 'PRODUCTS'
  | 'SELLER'
  | 'DUPLICATE'

export interface SverkaSideDto {
  readonly orders: number
  readonly amount: number
}

export interface SverkaPairDto {
  readonly bitrix: SverkaSideDto
  readonly moysklad: SverkaSideDto
}

export interface SverkaItemDto {
  readonly code: string | null
  readonly name: string
  readonly quantity: number
  readonly amount: number
}

export interface SverkaLineDto {
  readonly dealId: string | null
  readonly issues: readonly SverkaIssue[]
  readonly bitrix: {
    readonly amount: number
    readonly stage: string
    readonly phase: SverkaPhase
    readonly fakt1: boolean
    readonly delivered: boolean
    readonly seller: string | null
    readonly rop: string | null
    readonly queuedAt: string | null
    readonly items: readonly SverkaItemDto[]
  } | null
  readonly moysklad: {
    readonly orderId: string
    readonly orderName: string
    readonly moment: string
    readonly state: string | null
    readonly phase: SverkaPhase
    readonly amount: number
    readonly seller: string | null
    readonly project: string | null
    readonly items: readonly SverkaItemDto[]
  } | null
  readonly moyskladOrders: number
}

export interface SverkaProductDto {
  readonly key: string
  readonly code: string | null
  readonly name: string
  readonly bitrixQuantity: number
  readonly bitrixAmount: number
  readonly moyskladQuantity: number
  readonly moyskladAmount: number
}

export interface SverkaTeamDto {
  readonly team: string
  readonly bitrix: SverkaSideDto
  readonly moysklad: SverkaSideDto
  readonly issues: number
}

export interface SverkaOverviewDto {
  readonly totals: {
    readonly fakt1: SverkaPairDto
    readonly fakt2: SverkaPairDto
    readonly transit: SverkaPairDto
    readonly returned: SverkaPairDto
    readonly pending: SverkaSideDto
    readonly clean: number
    readonly cohortOrders: number
  }
  readonly issueCounts: Readonly<Record<SverkaIssue, number>>
  readonly otherWindowOrders: number
  readonly lines: readonly SverkaLineDto[]
  readonly flaggedCount: number
  readonly linesTruncated: boolean
  readonly products: readonly SverkaProductDto[]
  readonly teams: readonly SverkaTeamDto[]
  readonly moysklad: {
    readonly orders: number
    readonly lastSuccessAt: string | null
    readonly lastError: { readonly message: string; readonly at: string } | null
  }
}

/** The order the chips and the table read in — the most serious first. */
export const SVERKA_ISSUES: readonly SverkaIssue[] = [
  'MISSING_IN_MS',
  'NOT_FAKT1',
  'NOT_QUEUED',
  'NO_DEAL',
  'SUM',
  'STATUS',
  'PRODUCTS',
  'SELLER',
  'DUPLICATE',
]

/** What each difference is called on screen, and what it means. */
export const ISSUE_TEXT: Readonly<Record<SverkaIssue, { label: string; hint: string; tone: 'critical' | 'warning' }>> = {
  MISSING_IN_MS: {
    label: 'MoySkladʼda yoʻq',
    hint: 'FAKT 1 dagi buyurtma Bitrix24 da omborchidan oʻtgan, lekin MoySkladʼda buyurtmasi yoʻq.',
    tone: 'critical',
  },
  NOT_FAKT1: {
    label: 'FAKT 1 da yoʻq',
    hint: 'MoySkladʼda buyurtma bor, lekin Bitrix24 bu bitimni FAKT 1 ga qoʻshmaydi (rad etilgan yoki hali tasdiqlanmagan).',
    tone: 'critical',
  },
  NOT_QUEUED: {
    label: 'Tasdiqlashdan oʻtmagan',
    hint: 'MoySkladʼda buyurtma bor, bitim Bitrix24 da bor, lekin hech qachon Tasdiqlash navbatiga tushmagan — FAKT 1 ga kirmaydi.',
    tone: 'critical',
  },
  NO_DEAL: {
    label: 'Bitrix24 da bitim yoʻq',
    hint: 'MoySklad buyurtmasidagi bitim ID si Bitrix24 da topilmadi (yoki ID umuman yozilmagan).',
    tone: 'critical',
  },
  SUM: { label: 'Summa farqi', hint: 'Bitim summasi va MoySklad summasi 1 soʻmdan koʻproq farq qiladi.', tone: 'critical' },
  STATUS: {
    label: 'Holat farqi',
    hint: 'Bitrix24 bosqichi va MoySklad holati boshqa-boshqa joyni koʻrsatadi (masalan: «Доставлено» — «В пути»).',
    tone: 'warning',
  },
  PRODUCTS: {
    label: 'Mahsulot farqi',
    hint: 'Mahsulotlar yoki ularning soni mos emas (kod boʻyicha solishtiriladi: Bitrix24 XML_ID = MoySklad kodi).',
    tone: 'warning',
  },
  SELLER: { label: 'Sotuvchi farqi', hint: 'Bitimdagi «Продавец» va MoySkladdagi «Продавцы (new)» boshqa odam.', tone: 'warning' },
  DUPLICATE: { label: 'MoySkladʼda 2 marta', hint: 'Bitta bitimga MoySkladʼda bir nechta buyurtma ochilgan.', tone: 'warning' },
}

export const PHASE_LABEL: Readonly<Record<SverkaPhase, string>> = {
  PRE_WAREHOUSE: 'Omborga tayyorlanmoqda',
  TRANSIT: 'Yoʻlda',
  DELIVERED: 'Yetkazildi',
  RETURNED: 'Qaytdi / rad',
  OUTSIDE: 'Yetkazishdan tashqarida',
}

export function moyskladOrderUrl(orderId: string): string {
  return `https://online.moysklad.ru/app/#customerorder/edit?id=${encodeURIComponent(orderId)}`
}
