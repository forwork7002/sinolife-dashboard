/**
 * Typed API client.
 *
 * The only way the UI reaches data. Client code never imports from
 * `@/server/*` — enforced by lint — so this module is the whole boundary.
 */

import type { DataScopeValue } from './dataScope'
import type { LogisticsBucketKey, UNMAPPED_BUCKET } from './logisticsBuckets'

export interface MoneyDto {
  readonly amountMinor: string
  readonly currency: string
  readonly amount: number
}

export type DeltaDto =
  | { readonly kind: 'change'; readonly percent: number; readonly direction: 'up' | 'down' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'no_baseline' }
  /** Baseline too thin to divide by; both sides travel so the UI states the pair. */
  | { readonly kind: 'small_base'; readonly current: number; readonly previous: number }
  | { readonly kind: 'no_data' }

export interface PeriodDto {
  readonly preset: string
  readonly start: string
  readonly end: string
  readonly timeZone: string
  readonly days: number
}

export interface ResponseMeta {
  readonly dataSource: 'DEMO' | 'BITRIX24' | 'MANUAL'
  readonly generatedAt: string
  readonly period?: PeriodDto
  readonly comparisonPeriod?: PeriodDto
  readonly comparisonTruncated?: boolean
  readonly correlationId?: string
  readonly unavailable?: readonly string[]
}

export interface ApiSuccess<T> {
  readonly data: T
  readonly meta: ResponseMeta
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly correlationId?: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

/**
 * Fetch and unwrap the envelope.
 *
 * An error envelope becomes a typed throw carrying the correlation id, so the
 * UI can show the user something quotable without ever seeing a stack trace.
 */
/**
 * Static demo mode.
 *
 * When `NEXT_PUBLIC_STATIC_DEMO` is set, the build has no server and no
 * database: responses are read from JSON frozen at build time by
 * `npm run demo:snapshot`. Everything above this function — pages, charts,
 * filters, tables — is unchanged, which is the point: it is the real frontend,
 * not a mock-up of it.
 *
 * Only the parameters that were snapshotted vary. Anything else falls back to
 * the unfiltered response for that period rather than showing an error, since
 * a demo that breaks when you touch a filter is worse than one that ignores it.
 */
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === '1'

/** Must match `snapshotKey` in scripts/snapshotApi.ts. */
const SNAPSHOT_PARAMS = new Set(['preset', 'metric', 'page', 'pageSize'])

function snapshotKey(path: string, params: Record<string, string>): string {
  const ordered = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return path.replace(/^\//, '').replace(/\//g, '_') + (ordered ? `__${ordered}` : '') + '.json'
}

/** Where the static files live — respects a subpath deploy. */
function demoBase(): string {
  const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  return `${prefix}/demo-api`
}

async function staticGet<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<ApiSuccess<T>> {
  const kept: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (SNAPSHOT_PARAMS.has(k)) kept[k] = v
  }

  const attempts = [snapshotKey(path, kept)]

  // Deals were snapshotted on page 1 only; other pages reuse it so paging
  // still renders instead of failing.
  if (kept.page && kept.page !== '1') {
    attempts.push(snapshotKey(path, { ...kept, page: '1' }))
  }

  for (const key of attempts) {
    const res = await fetch(`${demoBase()}/${key}`, { signal })
    if (!res.ok) continue

    const body = (await res.json()) as
      | ApiSuccess<T>
      | { error: { code: string; message: string }; meta: ResponseMeta }

    if ('error' in body) {
      throw new ApiClientError(body.error.code, body.error.message, 501, body.meta.correlationId)
    }
    return body
  }

  throw new ApiClientError(
    'NOT_FOUND',
    'Bu koʻrinish demo nusxada saqlanmagan.',
    404,
  )
}

export async function apiGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<ApiSuccess<T>> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }

  if (STATIC_DEMO) {
    return staticGet<T>(path, Object.fromEntries(search.entries()), signal)
  }

  const query = search.toString()
  const response = await fetch(`/api/v1${path}${query ? `?${query}` : ''}`, {
    signal,
    headers: { accept: 'application/json' },
  })

  const body = (await response.json()) as
    | ApiSuccess<T>
    | { error: { code: string; message: string }; meta: ResponseMeta }

  if (!response.ok || 'error' in body) {
    const error = 'error' in body ? body.error : { code: 'UNKNOWN', message: 'Unknown error' }
    throw new ApiClientError(
      error.code,
      error.message,
      response.status,
      'meta' in body ? body.meta.correlationId : undefined,
    )
  }

  return body
}

/**
 * A write.
 *
 * Sends the Origin the browser attaches by default — `mutationHandler` refuses
 * a write without one, and refuses one it does not recognise. Nothing extra is
 * needed here: a same-origin fetch already carries it, and a hand-rolled CSRF
 * token would be a second mechanism guarding the same door.
 */
export async function apiWrite<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiSuccess<T>> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = (await response.json()) as
    | ApiSuccess<T>
    | {
        error: {
          code: string
          message: string
          details?: readonly { path: string; message: string }[]
        }
        meta: ResponseMeta
      }

  if (!response.ok || 'error' in payload) {
    const error =
      'error' in payload ? payload.error : { code: 'UNKNOWN', message: 'Unknown error' }
    /*
      Field detail is folded into the message on purpose.

      A validation failure here is almost always one rule on one field — a
      password too short, an email already taken — and a caller that has to
      walk a details array to surface it will show "Soʻrov maydonlari
      notoʻgʻri" instead, which tells the person nothing about what to fix.
    */
    const detail =
      'error' in payload && payload.error.details?.length
        ? payload.error.details.map((d) => d.message).join(' ')
        : ''

    throw new ApiClientError(
      error.code,
      detail ? `${error.message} ${detail}` : error.message,
      response.status,
      'meta' in payload ? payload.meta.correlationId : undefined,
    )
  }

  return payload
}

/** One account, as the administration screen renders it. */
export interface UserRowDto {
  readonly id: string
  readonly name: string
  /** What this person types to sign in. Null on the founding email account. */
  readonly username: string | null
  readonly email: string
  readonly role: 'ADMIN' | 'MANAGER' | 'SALES'
  readonly isActive: boolean
  /**
   * The sections STORED on the account, which is not the same as the sections
   * it can open: an empty list means "not configured" and the account follows
   * its role. The screen has to show that difference, so it gets the raw value.
   */
  readonly sections: readonly string[]
  /** How much of each granted section this account reads. */
  readonly dataScope: DataScopeValue
  readonly employeeId: string | null
  readonly employeeName: string | null
  readonly twoFactorEnabled: boolean
  readonly createdAt: string
}

/** The header's two facts: how fresh the numbers are, and what is waiting. */
export interface AlertsDto {
  readonly syncedAt: string | null
  readonly syncAgeMinutes: number | null
  readonly queue: { readonly pending: number; readonly overdue: number } | null
}

/** One row in the global search, already told where it goes. */
export interface SearchHitDto {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly href: string
  readonly amount?: MoneyDto
}

export interface SearchGroupDto {
  readonly key: 'deals' | 'customers' | 'employees' | 'products' | 'sources'
  readonly label: string
  readonly items: readonly SearchHitDto[]
}

export interface SearchDto {
  readonly query: string
  readonly groups: readonly SearchGroupDto[]
  /** The term was too short to look anything up. */
  readonly tooShort: boolean
}

/**
 * One unit a department head runs.
 *
 * Mirrors `DepartmentHeadUnit` in `userAdminService` — client code may not
 * import from `@/server/*`, so the shape is restated here and nothing checks
 * the mirror. Edit both sides.
 */
export interface DepartmentHeadUnitDto {
  readonly id: string
  readonly name: string
  /** The portal's «…(ROP)» convention: this unit is a sales team. */
  readonly isSalesTeam: boolean
  /**
   * Units beneath this one, to any depth.
   *
   * On the screen because the scope descends from headship: heading a branch
   * hands over every team under it, heading a team hands over the team. Two
   * very different grants behind two names that look alike in a list.
   */
  readonly descendants: number
  /**
   * The TOP of the tree, which makes this grant the whole company.
   *
   * Headship descends to any depth, so «Faqat oʻz boʻlimi» over the root
   * resolves to every employee on the portal — the same reach as «Butun
   * kompaniya» under a label that says the opposite. The screen has to say so
   * before the account is saved.
   */
  readonly isRoot: boolean
}

/** A unit the portal names but nobody heads. */
export interface HeadlessUnitDto {
  readonly id: string
  readonly name: string
}

/** The login already linked to a head, when there is one. */
export interface DepartmentHeadAccountDto {
  readonly id: string
  readonly username: string | null
  readonly isActive: boolean
  readonly dataScope: DataScopeValue
  readonly sections: readonly string[]
}

/**
 * A person a «Faqat oʻz boʻlimi» account can be anchored to.
 *
 * Not the roster: a TEAM scope grows from the department tree, so only someone
 * the tree knows about can carry one. See `listDepartmentHeads`.
 */
export interface DepartmentHeadDto {
  readonly employeeId: string
  readonly fullName: string
  readonly isActive: boolean
  readonly homeDepartmentName: string | null
  readonly heads: readonly DepartmentHeadUnitDto[]
  /**
   * How many employees the scope actually resolves to for this person.
   *
   * Asked of the same resolver the request path uses, so the number the
   * administrator reads before saving is the number the account then gets.
   * Inactive employees are counted, because the scope counts them.
   */
  readonly teamSize: number
  readonly account: DepartmentHeadAccountDto | null
}

export interface UsersPageDto {
  readonly items: readonly UserRowDto[]
  /**
   * Present only when the request asked for it (`?include=heads`).
   *
   * Absent and empty mean different things: absent is "not requested", empty
   * is "this portal names no department heads", and the head picker has to be
   * able to tell them apart to know whether to show a spinner or an empty
   * state.
   */
  readonly heads?: readonly DepartmentHeadDto[]
  /**
   * Units nobody heads, present alongside `heads`.
   *
   * A department with no head cannot be on the list — there is nobody to
   * anchor an account to — and this portal really has them: «Тошкент онлайн»
   * carries nine sales teams and names no head. Without this the
   * administrator hunts a list for a name that cannot be there and reports the
   * screen as broken, when the field to fill is in Bitrix24.
   */
  readonly headlessUnits?: readonly HeadlessUnitDto[]
}

// ---------------------------------------------------------------------------
// Endpoint payload shapes
// ---------------------------------------------------------------------------

export interface PaginationDto {
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
  readonly hasNextPage: boolean
  readonly hasPreviousPage: boolean
}

// ---------------------------------------------------------------------------
// Superdashboard modules
//
// Mirrors the DTOs in `src/server/services/insightsService.ts`. Declared here
// rather than imported so the client bundle never reaches into `@/server/*` —
// the boundary that keeps database types and secrets out of the browser.
// ---------------------------------------------------------------------------

export interface CohortDto {
  readonly cohort: string
  readonly size: number
  /** Percentage of the cohort still buying, by month offset. Null = not yet reachable. */
  readonly retention: readonly (number | null)[]
  readonly revenue: readonly MoneyDto[]
  readonly maxOffset: number
}

export interface CohortSummaryDto {
  readonly rows: readonly CohortDto[]
  readonly stages: readonly { readonly stage: string; readonly customers: number }[]
  /** Distinct customers on an open retention deal. Never the sum of `stages`. */
  readonly workedCustomers: number
  /**
   * Repeat money as a share of all money, 0-100. NULL when nothing was measured.
   *
   * Not a zero. `total === 0n` holds when no revenue-bearing win is linked to a
   * customer at all — the failure this screen's own empty state anticipates
   * («Yetkazilgan buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin») — and it
   * also holds when every cell's revenue is 0n. A 0% ring under «Takroriy
   * tushum ulushi» claims "nobody buys twice"; the truth there is "nothing was
   * measured", and the matrix directly below already says so. Same rule as
   * `rateBp` and `deliveryRateBp`, pinned in tests/domain/rateHonesty.test.ts.
   */
  readonly repeatRevenueShare: number | null
  readonly repeatCustomers: number
  readonly totalCustomers: number
}

/**
 * One logistics role inside a column of the client's sheet.
 *
 * «Отказ» is ONE column on screen and two numbers underneath it, and the two
 * are never added together on the server — see `LogisticsBucketDto.parts` and
 * `returnedOrders`. Mirrored by hand from `LogisticsPartDto` in
 * `@/server/services/insightsService`; nothing checks the mirror.
 */
export interface LogisticsPartDto {
  readonly role: string
  readonly orders: number
  readonly amount: MoneyDto
}

/**
 * One column of the client's own logistics sheet.
 *
 * `key` and `label` come from `@/lib/logisticsBuckets`, which BOTH sides read
 * — the server builds its SQL from the same table. That is the one shape on
 * this screen that is not a hand-mirror, and it is deliberate: a six-way
 * partition the client approved stage by stage must not have two definitions.
 */
export interface LogisticsBucketDto {
  readonly key: LogisticsBucketKey | typeof UNMAPPED_BUCKET
  /** The client's own header, verbatim: ТАСТИКЛАНГАН, не собран, В пути… */
  readonly label: string
  readonly orders: number
  readonly amount: MoneyDto
  /** Share of ЗАКАЗ's MONEY — the basis the client's %покрытия is on. */
  readonly sharePercent: number | null
  /** Share of ЗАКАЗ's ORDER COUNT. */
  readonly shareOfOrdersPercent: number | null
  /** The column opened out by STAGE. Not the right split for «Отказ». */
  readonly parts: readonly LogisticsPartDto[]
  /**
   * «Отказ» opened out by JOURNEY — travelled and came back, against killed
   * before dispatch. This is the split that means something: the portal has
   * written every refusal to one stage since June, so the stage name no
   * longer carries the distinction and only the history does. Zero on every
   * column but «Отказ».
   */
  readonly returnedOrders: number
  readonly returnedAmount: MoneyDto
  readonly cancelledOrders: number
  readonly cancelledAmount: MoneyDto
}

/** One Asia/Tashkent day of the sheet. The six columns sum to `amount`. */
export interface LogisticsDayDto {
  /** YYYY-MM-DD in Asia/Tashkent — the day the order reached Тасдиклаш. */
  readonly date: string
  readonly orders: number
  readonly amount: MoneyDto
  readonly coveragePercent: number | null
  readonly buckets: readonly LogisticsBucketDto[]
}

/**
 * A post office or a region, with what it delivered.
 *
 * `deliveryRate` divides by RESOLVED orders — delivered plus refused plus
 * cancelled — not by everything in the window: half of any current month is
 * still moving, and dividing by the whole month reported 42% for an operation
 * that delivers 93% of what it dispatches. `inFlight` is reported beside it
 * rather than counted against it. Null while nothing has resolved.
 *
 * `medianDays` is from the arrival in Тасдиклаш to «Доставлено» — on the
 * post-office table that is NOT dwell time at that post office. There is no
 * honest in-network clock on this portal.
 */
export interface LogisticsPointDto {
  readonly label: string
  readonly orders: number
  readonly amount: MoneyDto
  readonly delivered: number
  readonly deliveredAmount: MoneyDto
  readonly refused: number
  readonly cancelledEarly: number
  readonly inFlight: number
  readonly deliveryRate: number | null
  readonly medianDays: number | null
  /**
   * How long a parcel WAITS at this post office — the leg a floor manager
   * can shorten. Not `medianDays`, which is the order's whole journey; the
   * two must never be added or compared. `waitedOrders` is the denominator,
   * and it is smaller than `orders` because passes whose two stamps were
   * written at closeout carry no elapsed time and are excluded.
   */
  readonly medianWaitDays: number | null
  readonly waitedOrders: number
  /** Standing there right now; `aged*` is the part past seven days. */
  readonly waitingOrders: number
  readonly waitingAmount: MoneyDto
  readonly agedOrders: number
  readonly agedAmount: MoneyDto
  readonly medianWaitingDays: number | null
}

/**
 * One parcel standing at a post office for more than a week, richest first.
 *
 * THE ROW A MANAGER ACTS ON. The table above says CARAVAN holds 337 of these;
 * this says which. Sorted by money rather than by age on purpose — the oldest
 * parcels standing are three to four months old, carry no order code and are
 * plainly abandoned, while the recoverable ones are a fortnight old and carry
 * millions. `days` is printed on every row so the reader can tell the two
 * apart.
 *
 * No customer name and no phone: `bitrixId` opens the deal in the portal,
 * where both already are, and this screen has never disclosed a customer.
 */
export interface LogisticsStandingOrderDto {
  readonly bitrixId: string | null
  readonly orderCode: string | null
  readonly post: string
  readonly region: string
  readonly amount: MoneyDto
  readonly days: number
}
/**
 * One band of «how long did it wait at the post office», and whether it
 * arrived. Measured over 60 days of production: 95.1% delivered when
 * collected inside two days, 62.5% once past seven — and the gradient holds
 * inside every post office. Resolved orders only.
 */
export interface LogisticsWaitBandDto {
  readonly key: string
  readonly label: string
  readonly orders: number
  readonly delivered: number
  readonly deliveryRate: number | null
}

/**
 * One Доставка stage, named the way the portal names it.
 *
 * THE RECONCILIATION ROW — the only place a reader can check that the six
 * columns really are these eighteen stages grouped. `bucket` is decided on the
 * server so the browser never re-derives the partition.
 */
export interface LogisticsStageDto {
  readonly stage: string
  readonly bucket: LogisticsBucketKey | typeof UNMAPPED_BUCKET
  readonly orders: number
  readonly amount: MoneyDto
  /** Share of the funnel's own orders. Null when the funnel is empty. */
  readonly sharePercent: number | null
}

export interface LogisticsDto {
  readonly summary: {
    /** Every arrival in Тасдиклаш in the window — FAKT 1 and the rest. */
    readonly cohortOrders: number
    /** ЗАКАЗ = FAKT 1 — the same figure `/analytics/sellers` reports as `ordered`. */
    readonly orderedOrders: number
    readonly ordered: MoneyDto
    /** FAKT 2 = Доставланди — the same figure that endpoint reports as `won`. */
    readonly wonOrders: number
    readonly won: MoneyDto
    /**
     * %покрытия — FAKT 2 over FAKT 1, on money.
     *
     * MAY EXCEED 100 AND IS NOT CLAMPED: FAKT 2 is not a subset of FAKT 1. An
     * order refused in the queue and revived afterwards is delivered money
     * that never counted as confirmed, which is why the screen prints the
     * basis note beside it rather than hiding the case.
     */
    readonly coveragePercent: number | null
    /** The six, zero-filled, in the client's own order. They sum to ЗАКАЗ. */
    readonly buckets: readonly LogisticsBucketDto[]
    /** FAKT 1 orders whose current stage is outside Доставка. Expected 0, printed anyway. */
    readonly unbucketedOrders: number
    /** FAKT 1 orders that never reached a hub or a carrier. */
    readonly unroutedOrders: number
    /** Expected 0. Non-zero is a `countsAsRevenue` double-count announcing itself. */
    readonly offRevenueOrders: number
    /** Refused, then delivered anyway — how much «Отказ» overstates the loss. */
    readonly revivedOrders: number
    readonly revived: MoneyDto
    readonly medianDays: number | null
  }
  /** How long orders waited at a post office, against whether they arrived. */
  readonly waits: readonly LogisticsWaitBandDto[]
  /**
   * What is standing at a post office right now, two ways.
   *
   * `cohort` is the selected window — it reconciles with the rest of the
   * page and cannot see a parcel ordered earlier and stuck ever since.
   * `all` is every parcel standing at a post office whatever month it was
   * ordered in, which is the list somebody works through. The screen
   * switches between them because neither is the honest answer alone.
   */
  readonly standing: {
    readonly cohort: readonly LogisticsPointDto[]
    readonly all: readonly LogisticsPointDto[]
    /** The richest of them, so the block ends in something to do. */
    readonly orders: readonly LogisticsStandingOrderDto[]
  }
  readonly days: readonly LogisticsDayDto[]
  /** The eight hub and carrier stages, empty ones included. */
  readonly posts: readonly LogisticsPointDto[]
  readonly regions: readonly LogisticsPointDto[]
  /** All eighteen Доставка stages, in the portal's Russian and the portal's order. */
  readonly reconciliation: readonly LogisticsStageDto[]
}

/**
 * Where an order stands in the Тасдиклаш queue.
 *
 * The keys mirror the status keys the Telegram bot and the РОП dashboards
 * already use, so all three screens name one process the same way. Mirrors
 * `CONFIRMATION_OUTCOMES` in `@/server/domain/types`.
 */
export const CONFIRMATION_OUTCOMES = [
  'CONFIRM_NEW',
  'CONFIRMED',
  'NO_ANSWER',
  'REJECTED',
  'UNCONFIRMED_SHIPPED',
] as const
export type ConfirmationOutcome = (typeof CONFIRMATION_OUTCOMES)[number]

/**
 * One visit to Тасдиклаш on an order's row: when it arrived, how it ended.
 *
 * Mirrored by hand from `ConfirmationVisitDto` in
 * `@/server/services/insightsService`; nothing checks the mirror.
 */
export interface ConfirmationVisitDto {
  /** 1 for the first arrival in the order's life, counting up. */
  readonly no: number
  readonly queuedAt: string
  readonly outcome: ConfirmationOutcome
  /** When the visit ended. Null while the order is still in the queue. */
  readonly decidedAt: string | null
}

export interface ConfirmationOrderDto {
  readonly dealId: string
  /** РОП — the sales group, as the floor names it: "Sevinch", "Lola", "Baza". */
  readonly rop: string | null
  /** № — the order's place in ITS ROP's queue day, restarting each morning. */
  readonly dailyNo: number
  /** Id сделки — the Bitrix24 deal id. */
  readonly bitrixId: string | null
  /** `bx…` order code parsed from the title, when the title carries one. */
  readonly orderCode: string | null
  readonly title: string
  readonly customerName: string | null
  /** Every number on the contact. Empty when the portal holds none. */
  readonly customerPhones: readonly string[]
  readonly employeeName: string
  /** Продукт — one entry per line item, already formatted "name - N ta". */
  readonly products: readonly string[]
  readonly region: string | null
  readonly deliveryAddress: string | null
  /** Источник — the acquisition channel the order came in through. */
  readonly sourceName: string | null
  readonly amount: MoneyDto
  /** The stage the deal sits in now — the evidence behind the outcome. */
  readonly stageName: string
  readonly outcome: ConfirmationOutcome
  /** Дата создания — when the order was placed. Shown in САНА's tooltip. */
  readonly createdAt: string
  /** The order's last confirmation move, which is where its status comes from. */
  readonly movedAt: string
  /**
   * When it entered `C4:NEW`. What САНА shows, what the window selects on,
   * and the day № restarts on. Null only in principle — an order with no
   * arrival is not on the board.
   */
  readonly queuedAt: string | null
  /** When it left the queue. Null while it is still in one. */
  readonly decidedAt: string | null
  readonly hoursToDecide: number | null
  /**
   * How many times the order has reached Тасдиклаш, over its whole life.
   *
   * Reported by the tooltip, and NOT what draws «🔁 ҚАЙТА ТУШДИ» — see
   * `queueReturns`. Mirrored by hand from `ConfirmationOrderDto` in
   * `@/server/services/insightsService`; nothing checks the mirror.
   */
  readonly queueEntries: number
  /**
   * How many of those were real returns — six hours or more apart, the bot's
   * own rule. More than zero draws the mark.
   */
  readonly queueReturns: number
  /** When the order was last in the queue before it came back. */
  readonly previousQueuedAt: string | null
  /**
   * Every visit the order has made to Тасдиклаш, NEWEST FIRST.
   *
   * The board keeps ONE ROW PER ORDER and dates it by the last arrival, so an
   * order confirmed on the 29th and pulled back on the 31st is on the 31st.
   * This is what the СТАТУС column draws the chain from, and `[0]` is always
   * `outcome` — the state the tiles, the ROP panel and the state filter count
   * it under. The rest are history and are counted nowhere.
   */
  readonly queueHistory: readonly ConfirmationVisitDto[]
}

export interface ConfirmationQueueDto {
  readonly items: readonly ConfirmationOrderDto[]
  readonly pagination: PaginationDto
  /** Every ROP group with orders in the window — the filter's options. */
  readonly rops: readonly string[]
  /** The Статистика panel: one row per ROP group, with what each state is worth. */
  readonly byRop: readonly {
    readonly rop: string
    readonly orders: number
    readonly confirmed: number
    readonly noAnswer: number
    readonly rejected: number
    readonly pending: number
    readonly unconfirmedShipped: number
    /**
     * Per state, keyed as the tiles are, so the panel can index it by the
     * same `spec.key` it already reads counts with.
     *
     * Mirrored BY HAND from `ConfirmationRopPanelRow` in
     * `@/server/services/insightsService`, because this module is the whole
     * client/server boundary and may not import from `@/server/*`. NOTHING
     * CHECKS THE MIRROR — edit both sides.
     */
    readonly amounts: Readonly<Record<ConfirmationOutcome, MoneyDto>>
    /** ЖАМИ for this group — `amounts` added up, never a sixth reading. */
    readonly amountTotal: MoneyDto
  }[]
  readonly totals: {
    readonly orders: number
    readonly byOutcome: Readonly<Record<ConfirmationOutcome, number>>
    /**
     * What the window is worth, and what each state in it is worth — the
     * figure under every tile in the band.
     *
     * `amount` is `byOutcomeAmount` added up, so the total always equals its
     * parts. One currency (the app default): the rows carry their own, a sum
     * cannot. See `ConfirmationQueueDto` in `insightsService`.
     */
    readonly amount: MoneyDto
    readonly byOutcomeAmount: Readonly<Record<ConfirmationOutcome, MoneyDto>>
    /** `Тасдиқланиш %` — confirmed over everything that entered the queue. */
    readonly confirmedRate: number | null
  }
}

/**
 * The РЕГИОН column filter's options — `/insights/confirmations/regions`.
 *
 * Its own request, fetched when the popover first opens rather than with the
 * board: the board reloads every two minutes and this answer changes about as
 * often as the portal grows a region. `(Region yoʻq)` is a real option and a
 * real filter value, not a placeholder — see `NO_REGION` in the repository.
 */
export interface ConfirmationRegionOptionsDto {
  readonly regions: readonly { readonly region: string; readonly orders: number }[]
}

export interface MarginRowDto {
  readonly productId: string
  readonly productName: string
  readonly units: number
  readonly revenue: MoneyDto
  /** Given away — sold below list. Never negative. */
  readonly discount: MoneyDto
  /** Sold above list. Never negative. Kept apart so neither cancels the other. */
  readonly overList: MoneyDto
  readonly cost: MoneyDto | null
  readonly gross: MoneyDto | null
  /** Null only when no purchase price is recorded. -100 = given away. */
  readonly margin: number | null
}

export interface MarginDto {
  readonly rows: readonly MarginRowDto[]
  readonly revenue: MoneyDto
  /** Revenue from products whose purchase price is known — the margin's base. */
  readonly costedRevenue: MoneyDto
  readonly gross: MoneyDto
  readonly discount: MoneyDto
  readonly overList: MoneyDto
  readonly margin: number
  /** Percentage of revenue whose product has a known purchase price. */
  readonly coverage: number
}

export interface DispatchDto {
  readonly point: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  /** Counted against the delivery rate; shown so the fraction is checkable. */
  readonly cancelledEarly: number
  readonly revenue: MoneyDto
  readonly deliveryRate: number | null
}

/**
 * The unit's head, as the card prints them.
 *
 * NULL when the unit has no head AND when the portal's head is not one of its
 * members — Bitrix24's own screen draws no head row in either case. See the
 * server-side twin in `insightsService.ts`.
 */
export interface StructureHeadDto {
  readonly id: string
  readonly name: string
  readonly position: string | null
  /** Active people in this unit's whole subtree, minus this head. DISTINCT. */
  readonly managesCount: number
}

export interface StructureDto {
  readonly id: string
  readonly name: string
  readonly depth: number
  readonly headName: string | null
  /** The head as the CARD needs them — null where the portal shows no head row. */
  readonly head: StructureHeadDto | null
  /** People whose PRIMARY unit is this one. */
  readonly ownHeadcount: number
  /** This unit plus everything beneath it. Both headcounts roll up together. */
  readonly headcount: number
  /** Of those, marked active in Bitrix24. */
  readonly activeHeadcount: number
  /**
   * Active people the PORTAL lists here, minus the head when the head is one of
   * them — «Подчинённые: N сотрудников» on the source screen.
   *
   * Not `activeHeadcount`: membership is many-to-many in Bitrix24, so the two
   * differ wherever somebody's second unit is this one. That one counts who
   * this dashboard CREDITS to the unit; this counts who the portal LISTS here.
   */
  readonly subordinateCount: number
  /** Active members including the head. `subordinateCount` plus 0 or 1. */
  readonly memberCount: number
  /**
   * Their names, so the chart's search box can find a person and not only a
   * unit. Active only. See the CTE that builds it for why it rides the tree.
   */
  readonly memberNames: readonly string[]
  /** Direct child units. */
  readonly childCount: number
  /** The portal's own left-to-right order among siblings. */
  readonly sortOrder: number
  /** Does the reader's own account sit here? Drives the «Siz» badge. */
  readonly isViewerDepartment: boolean
  /**
   * The reader's PRIMARY unit — the one this dashboard credits them to.
   *
   * At most one node carries it. The «SIZ» badge still reads
   * `isViewerDepartment` and lands on both units of a person listed twice;
   * the chain line, «Rahbaringiz» and «Meni topish» read this one, because
   * each names a single unit and must not name an arbitrary one.
   */
  readonly isViewerPrimaryDepartment: boolean
  /**
   * Is this unit inside the active filial?
   *
   * The org chart keeps every unit even when the rest of the dashboard shows
   * one branch — a map with half the country cut off is not a map — so this is
   * how the page marks which subtree the other screens are counting. True
   * everywhere when `filial=all`.
   */
  readonly inScope: boolean
  readonly children: readonly StructureDto[]
}

/** One person on a unit's roster — `/insights/structure/roster`. */
export interface DepartmentMemberDto {
  readonly id: string
  readonly fullName: string
  readonly position: string | null
  readonly isActive: boolean
  /**
   * False when this unit is the person's SECOND one.
   *
   * Bitrix24 lists a person in every unit of their `UF_DEPARTMENT`; this
   * dashboard credits them to the first. The tag exists so a reader can tell a
   * borrowed operator from an owned one, which is the difference between the
   * card's «xodim» count and this unit's own roster.
   */
  readonly isPrimary: boolean
  readonly isHead: boolean
}

// ---------------------------------------------------------------------------
// Sotuvchilar reytingi — the sellers' board, on the order-intake clock
// ---------------------------------------------------------------------------

/**
 * The client's own bonus ladder, as it stands for one seller.
 *
 * Quoted from their published sellers dashboard rather than invented here:
 * 45 mln so'm of won intake earns 1 mln, 60 mln earns 1.5 mln, 70 mln earns
 * 2 mln. `toNext` is the only actionable number on the row.
 */
export interface SellerBonusDto {
  readonly earned: MoneyDto
  readonly nextFloor: MoneyDto | null
  readonly nextBonus: MoneyDto | null
  readonly toNext: MoneyDto | null
  readonly toNextPercent: number | null
  /**
   * Whether the client's ladder pays this operator at all — their
   * `idInRange()`, the 107-147 floor-number band. Outside it every field
   * above is empty; see `domain/analytics/sellerBonus`.
   */
  readonly eligible: boolean
}

/**
 * «Plan bajarish», and which question it answers.
 *
 * The client's board switches silently between two: FAKT 2 against a target
 * where one exists, FAKT 2 against FAKT 1 where none does. We carry both and
 * say which is on the row.
 */
export interface SellerPlanDto {
  /** The target from `kpi`, when set. Null on the delivery reading. */
  readonly amount: MoneyDto | null
  /** 0-100+, uncapped: 112% reads as 112%. */
  readonly percent: number | null
  /** 'target' | 'delivery' | null — nothing to divide by. */
  readonly basis: 'target' | 'delivery' | null
}

export interface SellerBoardRowDto {
  readonly rank: number
  readonly employeeId: string
  readonly fullName: string
  /** The ROP's own name — the team. Null when the seller is off every team. */
  readonly rop: string | null
  /** Orders taken in the period, cancellations excluded. */
  readonly orders: number
  /** Their value. */
  readonly ordered: MoneyDto
  /** Of those, the ones won — what rank and bonus read. */
  readonly won: MoneyDto
  readonly wonOrders: number
  /** Still open, already inside `ordered`. */
  readonly open: MoneyDto
  readonly openOrders: number
  /** Refused in the queue PLUS confirmed-then-cancelled. Both are resolved. */
  readonly lostOrders: number
  /** Of those, the ones already confirmed when the order died. */
  readonly lostAfterConfirmOrders: number
  /**
   * What those orders were worth.
   *
   * Carried rather than derived, because `ordered − won − open` is NOT this
   * figure: `won` is not a subset of `ordered` on the queue basis, so the
   * subtraction borrows the money of every order that was refused, revived
   * and then delivered.
   */
  readonly lostAfterConfirm: MoneyDto
  /**
   * Every order of theirs in the window — the count the confirmation queue
   * shows. Bigger than `orders`, which counts only the confirmed ones.
   */
  readonly cohortOrders: number
  /** Won over RESOLVED orders, 0-100. Open orders are not counted against. */
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
  /** Their `plan` / `plandone`. Empty until targets are set in `kpi`. */
  readonly plan: SellerPlanDto
  /**
   * Their `Lid` column — ALWAYS NULL today, and carried on purpose.
   *
   * Nothing in this database holds a lead: no model, no sync entity, no
   * provider call. The column stays on screen saying so, because "no source
   * connected" is a question somebody can answer and a zero is not.
   */
  readonly leads: number | null
  /**
   * Their `conv` — orders over LEADS. Not `conversionPercent` beside it,
   * which is won over RESOLVED orders. Two questions, two denominators; both
   * are carried so neither has to borrow the other's number.
   */
  readonly leadConversionPercent: number | null
  /** Their `fot`. ALWAYS NULL — nothing in this database holds pay. */
  readonly fot: MoneyDto | null
  readonly bonus: SellerBonusDto
}

export interface SellerTeamRowDto {
  readonly rank: number
  readonly rop: string
  readonly sellers: number
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
  /** Members' targets summed — only the members who have one. */
  readonly plan: SellerPlanDto
  /** See `SellerBoardRowDto.leads`. Always null, for the same reason. */
  readonly leads: number | null
  /** See `SellerBoardRowDto.leadConversionPercent`. Null with `leads`. */
  readonly leadConversionPercent: number | null
}

export interface SellerBoardTotalsDto {
  readonly sellers: number
  readonly teams: number
  /** Sellers with no ROP, so on no team row. The team shares exclude them. */
  readonly teamlessSellers: number
  readonly orders: number
  /** Every order in the cohort — what the confirmation queue counts. */
  readonly cohortOrders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  /** Orders inside `open` — «yoʻlda» money needs its count beside it. */
  readonly openOrders: number
  /** Refused in the queue PLUS confirmed-then-cancelled — the rate's loss pool. */
  readonly lostOrders: number
  /** Of those, the ones already confirmed when they died, and their money. */
  readonly lostAfterConfirmOrders: number
  readonly lostAfterConfirm: MoneyDto
  readonly conversionPercent: number | null
  readonly wonDelta: DeltaDto
  readonly bonusPayable: MoneyDto
  readonly sellersInBonus: number
  /** Sellers the ladder can pay at all — the 107-147 band. */
  readonly sellersEligibleForBonus: number
  /** Every target on the board summed, and won intake against them. */
  readonly plan: SellerPlanDto
  readonly sellersWithPlan: number
  /** See `SellerBoardRowDto.leads`. Always null, for the same reason. */
  readonly leads: number | null
  /** See `SellerBoardRowDto.leadConversionPercent`. Null with `leads`. */
  readonly leadConversionPercent: number | null
}

export interface SellerBoardForecastDto {
  readonly elapsedPercent: number
  readonly projected: MoneyDto | null
}

export interface SellerBoardDto {
  readonly rows: readonly SellerBoardRowDto[]
  readonly teams: readonly SellerTeamRowDto[]
  readonly totals: SellerBoardTotalsDto
  readonly forecast: SellerBoardForecastDto
  /**
   * 'confirmation_queue' — FAKT 1 / FAKT 2 on the arrival in C4:NEW.
   * 'created_in_period' — the original reading, bucketed by the day the
   * ORDER WAS TAKEN. See `?basis=` on `/analytics/sellers`.
   */
  readonly basis: 'confirmation_queue' | 'created_in_period'
  /**
   * The span the targets were set for, when the board found any and they all
   * share one. A target is a contract for a stated period, not a rate to be
   * sliced to the reader's window — so the screen prints the span it is
   * scoring against. Null when no target covers the window.
   */
  readonly planWindow: { readonly start: string; readonly end: string } | null
}

/**
 * One month's champion on the sellers' television — the record wall.
 *
 * Mirrors `sellerBoardService.SellerRecordsDto`, like every other type in this
 * file; nothing checks the mirror, so edit both sides.
 */
export interface SellerRecordDto {
  /** First day of the month, `YYYY-MM-DD`, in the reporting timezone. */
  readonly month: string
  /** True while the month is still running — a lead, not yet a record. */
  readonly running: boolean
  readonly employeeId: string
  readonly fullName: string
  /** The ROP's own name. Null when the seller is off every team. */
  readonly rop: string | null
  /**
   * WHICH FIGURE EARNED THE PLACE, because the wall switches between two.
   *
   * The podium's rule: FAKT 2 decides, and FAKT 1 decides the months nobody
   * has delivered in yet — which is every month still in progress, since
   * delivery lags confirmation by about two days. `amount` and `orders` are
   * whichever of the pairs below this names, so the screen prints one figure
   * and can say what it is rather than leaving the reader to guess why a
   * running month looks bigger than a closed one.
   */
  readonly basis: 'delivered' | 'confirmed'
  readonly amount: MoneyDto
  readonly orders: number
  /** Both figures travel anyway, so the wall can show the other one. */
  readonly confirmed: MoneyDto
  readonly confirmedOrders: number
  readonly delivered: MoneyDto
  readonly deliveredOrders: number
}

export interface SellerRecordsDto {
  /** Newest month first. */
  readonly months: readonly SellerRecordDto[]
  /**
   * The first instant the wall covers. Not «all time»: before the portal began
   * naming the seller on the deal, orders were credited to whoever held the
   * row, which put the head of Операцион at the top of two months with figures
   * no seller can beat. See `RECORDS_FROM`.
   */
  readonly from: string
}

/** One day of one seller's intake. */
export interface SellerDayDto {
  readonly date: string
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  /** See `SellerBoardRowDto.leads`. Always null, for the same reason. */
  readonly leads: number | null
}

/**
 * One point of the FAKT 1 / FAKT 2 line on Savdo dinamikasi's hero chart.
 *
 * Mirrors `sellerBoardService.FaktTrendPointDto`, like every other type in
 * this file; nothing checks the mirror, so edit both sides.
 *
 * MONEY AS A PLAIN NUMBER IN SOʻM, not a `MoneyDto`. It shared an axis with
 * `TrendPointDto.revenue` until 2026-09-10 — which `/analytics/sales` has
 * always serialised the same lossy way — and the shape stayed after the
 * revenue area came off `FaktTrendChart`, because these two now own that axis
 * alone and a `MoneyDto` would buy the chart nothing it plots. `date` is the
 * BUCKET START as an ISO instant, from the same `enumerateBuckets` every other
 * trend on the dashboard uses.
 */
export interface FaktTrendPointDto {
  readonly date: string
  /** Тасдиқланди + Тасдиқланмай чиқди — what left the queue as an order. */
  readonly fakt1: number
  /** Доставланди — what a courier actually delivered. */
  readonly fakt2: number
  readonly orders: number
}

// ---------------------------------------------------------------------------
// The Доставка kanban — `/insights/delivery`.
// Mirrors the DTOs in `src/server/services/pulseService.ts`.
// ---------------------------------------------------------------------------

/**
 * One column of the portal's Доставка board.
 *
 * `stageName` ARRIVES IN THE PORTAL'S OWN WORDS and is rendered as it arrives.
 * «В пути», «TOSHKENT-1», «Отказ предварительно» — the client asked for these
 * exact strings on 2026-09-10 because the floor reconciles this block against
 * the Bitrix24 screen it was copied from. Nothing on the client may translate,
 * shorten or title-case them.
 */
export interface DeliveryStageDto {
  readonly stageId: string
  /** Already stripped of its «Доставка · » prefix by the service. */
  readonly stageName: string
  readonly category: string
  readonly sortOrder: number
  /**
   * Orders standing in this column RIGHT NOW. There is no reporting window on
   * this figure — an order that arrived in June and has not moved is counted
   * here today, exactly as the portal counts it.
   */
  readonly openCount: number
  readonly openValue: MoneyDto
}

export interface DeliveryBoardDto {
  /**
   * The funnel's own name from the portal, or null when this database holds no
   * Доставка pipeline — which is the demo seed, whose nine generic stages are
   * not a delivery ladder. A screen uses it to tell "nothing is standing in
   * the funnel" apart from "this funnel is not here".
   */
  readonly pipelineName: string | null
  readonly stages: readonly DeliveryStageDto[]
  readonly totals: {
    readonly openCount: number
    readonly openValue: MoneyDto
  }
}

// ---------------------------------------------------------------------------
// Concentration — `/insights/concentration`.
// Mirrors the DTOs in `src/server/services/concentrationService.ts`.
// ---------------------------------------------------------------------------

export interface ConcentrationParetoDto {
  /** Share of period revenue held by the 5 / 10 largest customers, 0-100. */
  readonly top5SharePercent: number | null
  readonly top10SharePercent: number | null
  /** How few customers cover 80% of the period's revenue. */
  readonly customersFor80Percent: number | null
  /** Customers with a won revenue deal in the period. */
  readonly totalCustomers: number
  /**
   * Share of period revenue booked with NO customer attached. The shares
   * above cover identified customers only — this is the disclosed blind spot.
   */
  readonly nullCustomerSharePercent: number | null
}

export type HhiBand = 'concentrated' | 'moderate' | 'diversified'

export interface HhiCutDto {
  /** Herfindahl–Hirschman index, 0-10000. Null when the cut has no revenue. */
  readonly hhi: number | null
  /** >=2500 concentrated, >=1500 moderate, else diversified. */
  readonly band: HhiBand | null
  /** Groups with revenue that entered the index. */
  readonly groups: number
  /** Revenue share of the null (unset) group, excluded from the index. */
  readonly nullSharePercent: number | null
}

export interface ConcentrationHhiDto {
  readonly bySource: HhiCutDto
  readonly byRegion: HhiCutDto
}

export interface ConcentrationRepeatDto {
  /** First → second purchase interval, days, over pairs completed in the period. */
  readonly medianDaysBetweenFirstAndSecond: number | null
  readonly p90Days: number | null
  /** How many second purchases the interval percentiles rest on. */
  readonly pairsMeasured: number
  /**
   * Of first-time buyers with a COMPLETE 90-day horizon (first purchase in
   * the period shifted back 90 days), the share who bought again in time.
   */
  readonly repurchaseWithin90Percent: number | null
  readonly cohortSize: number
  /** Share of period revenue from deals that are not the customer's first win. */
  readonly repeatRevenueSharePercent: number | null
  /**
   * The same claim from Bitrix24's own `isReturnCustomer` flag. Divergence
   * from the row above is a data-quality signal — show both, reconcile neither.
   */
  readonly bitrixFlagSharePercent: number | null
}

export interface ConcentrationDto {
  readonly pareto: ConcentrationParetoDto
  readonly hhi: ConcentrationHhiDto
  readonly repeat: ConcentrationRepeatDto
}
