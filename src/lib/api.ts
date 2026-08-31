/**
 * Typed API client.
 *
 * The only way the UI reaches data. Client code never imports from
 * `@/server/*` — enforced by lint — so this module is the whole boundary.
 */

import type { DataScopeValue } from './dataScope'

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

/**
 * Who a leaderboard response actually ranked.
 *
 * The board ranks SALESPEOPLE only — a department head carries their whole
 * team's closed deals, so leaving the managers in put the head of an operations
 * department at number one and pushed the best seller to third. The rule lives
 * server-side (`server/domain/employees/roles`); this block is how the response
 * admits what it dropped, so the page can print it rather than let the reader
 * assume the ranking covers everyone.
 */
export interface LeaderboardScopeDto {
  readonly scope: 'sellers'
  readonly sellers: number
  readonly excludedManagers: number
  readonly excludedOther: number
}

/**
 * How a response's SELLER-CLOSE figures were arrived at.
 *
 * The dashboard measures a seller two ways and they are not the same number.
 * `revenue` is DELIVERED money — `countsAsRevenue`, status WON, by `closedAt`.
 * `closedValue` / `closedCount` are what the seller actually CLOSED: entries
 * into the won stage of the sellers' own pipeline, which a robot empties within
 * seconds by moving the deal to Доставка, so the stage history is the only
 * trace left. Last August 2 798 deals passed the seller's stage and 3 729 were
 * delivered, with 1 152 in both — 1 646 sold-but-not-yet-delivered on one side,
 * 2 577 delivered-without-a-seller (repeat orders, AI triage, direct entry) on
 * the other.
 *
 * Neither is the "real" figure and neither may be substituted for the other.
 * The page shows both and this block says how the second was obtained, so a
 * disagreement between the columns reads as the fact it is rather than as a
 * bug. See `server/domain/analytics/sellerClose`.
 */
export interface SellerCloseBasisDto {
  /**
   * False when the seller pipeline's won stage could not be resolved. Every
   * `closedCount` / `closedValue` is then null: UNMEASURED, not zero. Render
   * the column as unavailable, never as a row of zeros.
   */
  readonly resolved: boolean
  /** The pipeline roles searched, e.g. `["QUALIFICATION"]`. */
  readonly pipelineRoles: readonly string[]
  /** The stages that matched. `externalId` is for display only. */
  readonly stages: readonly {
    readonly id: string
    readonly name: string
    readonly externalId: string | null
    readonly pipelineName: string | null
  }[]
  /**
   * `deal_current_amount` — the value is summed from the deal's amount TODAY,
   * because the stage history carries none. An amount edited after the sale
   * moves this figure. Worth a footnote wherever the figure is exported.
   */
  readonly amountBasis: 'deal_current_amount'
}

/**
 * One filial, as the branch switcher lists it.
 *
 * A branch is a top-level unit with sales teams under it: Навоий (6 teams, 109
 * people, 103 of them sellers) and Тошкент онлайн (9 / 116 / 100). Операцион
 * and Регистрация sit at the same level of the tree and are NOT branches —
 * they are departments, and they appear in `BranchScopeDto.excluded` instead.
 */
export interface BranchOptionDto {
  readonly id: string
  readonly name: string
  /** Sales teams — the "(ROP)" departments — beneath it. */
  readonly teamCount: number
  readonly headcount: number
  /** Of those, sellers: team members who are not the team's ROP. */
  readonly sellerCount: number
}

/**
 * Which filial produced the numbers in this response, and who that leaves out.
 *
 * Every screen states this, because the branch scope is not a small filter: on
 * last month's data, scoping to Навоий removes 59% of the company's revenue —
 * Тошкент онлайн's 46% and Операцион's 12.6%. A reader who does not know that
 * will conclude the dashboard is broken.
 *
 * `employees` plus the five `excluded` buckets sum to the whole roster, so the
 * block answers "where did the other people go" rather than merely asserting a
 * branch. It describes the BRANCH partition only: a SALES user additionally
 * sees just their own row, which is true on every screen and is not counted
 * here.
 */
export interface BranchScopeDto {
  /** The active branch, or null when the caller asked for every branch. */
  readonly branch: string | null
  /** People the branch admits. The whole roster when `branch` is null. */
  readonly employees: number
  readonly excluded: {
    /** The other filial — Тошкент онлайн when Навоий is active. */
    readonly otherBranches: number
    readonly operations: number
    readonly registration: number
    /** Filed directly in the NEWGEN root — "markaz". */
    readonly centre: number
    /** Anything the four above do not name. Zero today. */
    readonly other: number
    /** The five buckets summed. `employees + excluded.total` is the roster. */
    readonly total: number
  }
}

export interface ResponseMeta {
  readonly dataSource: 'DEMO' | 'BITRIX24' | 'MANUAL'
  readonly generatedAt: string
  readonly period?: PeriodDto
  readonly comparisonPeriod?: PeriodDto
  readonly comparisonTruncated?: boolean
  readonly correlationId?: string
  readonly unavailable?: readonly string[]
  /** Present on /analytics/leaderboard only. */
  readonly leaderboardScope?: LeaderboardScopeDto
  /** Present wherever `closedCount` / `closedValue` are. */
  readonly sellerCloseBasis?: SellerCloseBasisDto
  /** Present on every branch-scoped endpoint. Absent means nothing was scoped. */
  readonly branchScope?: BranchScopeDto
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

export interface UsersPageDto {
  readonly items: readonly UserRowDto[]
}

// ---------------------------------------------------------------------------
// Endpoint payload shapes
// ---------------------------------------------------------------------------

export interface KpiCardDto {
  readonly key: string
  /** The number to display, in the unit `unit` names. Money is in soʻm. */
  readonly value: number | null
  /** Money only. `amountMinor` is the lossless form; `amount` equals `value`. */
  readonly money?: MoneyDto
  readonly unit: 'money' | 'count' | 'percent'
  readonly delta: DeltaDto
}

export interface TrendPointDto {
  readonly date: string
  readonly revenue: number
  readonly dealsWon: number
  readonly dealsCreated: number
}

export interface OverviewDto {
  readonly cards: readonly KpiCardDto[]
  readonly trend: readonly TrendPointDto[]
  readonly kpiAchievementPercent: number | null
  readonly activeEmployees: number
  readonly lastSyncedAt: string | null
}

export interface FunnelStepDto {
  readonly stageId: string
  readonly stageName: string
  readonly sortOrder: number
  readonly category: 'NEW' | 'IN_PROGRESS' | 'WON' | 'LOST'
  readonly dealCount: number
  readonly value: { readonly amountMinor: string; readonly currency: string }
  readonly reachedPercent: number | null
}

/**
 * One ranked SELLER. Never a ROP, never an operations head — see
 * `LeaderboardScopeDto` for what the endpoint excludes and why.
 */
export interface LeaderboardRowDto {
  readonly rank: number
  readonly tied: boolean
  readonly employeeId: string
  readonly fullName: string
  readonly departmentName: string | null
  /** DELIVERED money in the period — the basis every other screen uses. */
  readonly revenue: MoneyDto
  readonly dealsWon: number
  readonly conversionPercent: number | null
  readonly kpiAchievementPercent: number | null
  /**
   * The SELLER-CLOSE basis, present on every row whatever `?metric=` ranked by,
   * so a page can show both columns side by side. Null means unmeasured — see
   * `SellerCloseBasisDto.resolved` — and must print as an em dash, never 0.
   */
  readonly closedCount: number | null
  readonly closedValue: MoneyDto | null
  /** Always the DELIVERED-revenue delta; the close basis has no comparison yet. */
  readonly delta: DeltaDto
  /** The value of the ACTIVE metric, whichever basis that came from. */
  readonly value: number | null
}

/** Every value `?metric=` accepts on /analytics/leaderboard. */
export const LEADERBOARD_METRICS = [
  'revenue',
  'deals_won',
  'conversion',
  'kpi_achievement',
  /** Seller-close basis — see `SellerCloseBasisDto`. */
  'closed_deals',
  'closed_value',
] as const

export type LeaderboardMetricValue = (typeof LEADERBOARD_METRICS)[number]

/** True for the metrics that rank the seller-close basis rather than delivery. */
export function isSellerCloseMetric(metric: string): boolean {
  return metric === 'closed_deals' || metric === 'closed_value'
}

export interface DealRowDto {
  readonly id: string
  readonly title: string
  readonly amount: MoneyDto
  readonly status: 'OPEN' | 'WON' | 'LOST'
  readonly createdAt: string
  readonly closedAt: string | null
  readonly employee: { readonly id: string; readonly fullName: string }
  readonly stage: { readonly id: string; readonly name: string; readonly category: string }
  readonly customer: { readonly id: string; readonly name: string } | null
  readonly source: { readonly id: string; readonly name: string } | null
  readonly products: readonly string[]
}

export interface PaginationDto {
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
  readonly hasNextPage: boolean
  readonly hasPreviousPage: boolean
}

export interface DealsPageDto {
  readonly items: readonly DealRowDto[]
  readonly pagination: PaginationDto
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
  readonly repeatRevenueShare: number
  readonly repeatCustomers: number
  readonly totalCustomers: number
}

export interface LogisticsRowDto {
  readonly label: string
  readonly orders: number
  readonly delivered: number
  readonly refused: number
  readonly cancelledEarly: number
  readonly inFlight: number
  readonly revenue: MoneyDto
  readonly deliveryRate: number | null
  readonly medianHours: number | null
  readonly p90Hours: number | null
}

export interface LogisticsDto {
  readonly routes: readonly LogisticsRowDto[]
  readonly regions: readonly LogisticsRowDto[]
  /**
   * Losses split by `stage`:
   *   RETURNED  — travelled to the customer and came back
   *   CANCELLED — killed in the delivery pipeline before dispatch
   *   PRE_SALE  — never became an order; lost in qualification
   *
   * `lost` is null for PRE_SALE, whose rows are excluded from revenue because
   * the same order appears in several pipelines.
   */
  readonly reasons: readonly {
    readonly stage: string
    readonly reason: string
    readonly orders: number
    readonly lost: MoneyDto | null
  }[]
  readonly totals: {
    readonly orders: number
    readonly delivered: number
    readonly refused: number
    readonly cancelledEarly: number
    /** Still moving. Excluded from the delivery rate rather than counted against it. */
    readonly inFlight: number
    readonly deliveryRate: number | null
    readonly medianHours: number | null
  }
}

export interface ConfirmationRowDto {
  readonly employeeId: string
  readonly employeeName: string
  readonly orders: number
  readonly confirmed: number
  readonly unreachable: number
  readonly undecided: number
  readonly confirmRate: number | null
  /** Share of this operator's orders that went through the confirmation stage. */
  readonly coverage: number
  /** How many confirmed orders actually reached the customer. */
  readonly stickRate: number
  readonly deliveredAfterConfirm: number
  readonly refusedAfterConfirm: number
  readonly delivered: number
  readonly failed: number
  /** Delivered as a share of this operator's resolved orders. */
  readonly deliveryRate: number | null
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

export interface ConfirmationOrderDto {
  readonly dealId: string
  /** РОП — the sales group, as the floor names it: "Sevinch", "Lola", "Baza". */
  readonly rop: string | null
  /** № — the order's place in ITS ROP's day, restarting each morning. */
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
  /** Дата создания — when the order was placed. What САНА shows. */
  readonly createdAt: string
  /** The order's last confirmation move, which is where its status comes from. */
  readonly movedAt: string
  /** When it entered the queue. Null when it was refused without ever being in one. */
  readonly queuedAt: string | null
  /** When it left the queue. Null while it is still in one. */
  readonly decidedAt: string | null
  readonly hoursToDecide: number | null
}

export interface ConfirmationQueueDto {
  readonly items: readonly ConfirmationOrderDto[]
  readonly pagination: PaginationDto
  /** Every ROP group with orders in the window — the filter's options. */
  readonly rops: readonly string[]
  /** The Статистика panel: one row per ROP group. */
  readonly byRop: readonly {
    readonly rop: string
    readonly orders: number
    readonly confirmed: number
    readonly noAnswer: number
    readonly rejected: number
    readonly pending: number
    readonly unconfirmedShipped: number
  }[]
  readonly totals: {
    readonly orders: number
    readonly byOutcome: Readonly<Record<ConfirmationOutcome, number>>
    /** `Тасдиқланиш %` — confirmed over everything that entered the queue. */
    readonly confirmedRate: number | null
  }
}

export interface ConfirmationDto {
  readonly rows: readonly ConfirmationRowDto[]
  readonly totals: {
    /** Every revenue order created in the window. */
    readonly orders: number
    /** Orders belonging to operators who appear in `rows`. */
    readonly coveredByRows: number
    /** Unconfirmed and still moving — not yet at the step, rather than skipped. */
    readonly unconfirmedOpen: number
    /** Unconfirmed and already resolved — genuinely skipped. */
    readonly unconfirmedClosed: number
    readonly confirmed: number
    readonly unreachable: number
    readonly undecided: number
    /**
     * Share of orders the confirmation step covers at all.
     *
     * The headline. It replaced a confirmed/(confirmed+unreachable) rate that
     * read 100.0% for everyone in every period, because the portal records the
     * confirmed outcome and never the unreachable one.
     */
    readonly coverage: number
    /** Of confirmed orders, how many reached the customer. */
    readonly stickRate: number
  }
}

export interface ChannelDto {
  readonly sourceId: string
  readonly sourceName: string
  readonly leads: number
  readonly deals: number
  readonly won: number
  readonly revenue: MoneyDto
  readonly spend: MoneyDto | null
  /** won / leads — of enquiries, how many paid. */
  readonly conversion: number | null
  /** won / deals — of orders that reached a money pipeline, how many closed. */
  readonly funnelRate: number | null
  readonly averageCheque: MoneyDto | null
  readonly roas: number | null
  readonly costPerOrder: MoneyDto | null
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

/**
 * Call activity, with the two directions kept apart.
 *
 * They are different questions wearing the same word. Outbound asks how often
 * a dial reaches someone; inbound asks how many customers calling this company
 * got an answer. Blended into one "connection rate" on a log that is 92%
 * inbound, the result was mostly the second reported as the first — and it hid
 * 159,722 unanswered customer calls in a month.
 */
export interface CallsDto {
  readonly rows: readonly CallActivityDto[]
  readonly outbound: CallDirectionDto
  readonly inbound: CallDirectionDto
}

/** Totals for one call direction. */
export interface CallDirectionDto {
  readonly direction: string
  readonly calls: number
  readonly connected: number
  readonly talkSeconds: number
}

export interface CallActivityDto {
  readonly employeeId: string
  readonly employeeName: string
  readonly calls: number
  readonly connected: number
  readonly talkSeconds: number
  readonly connectRateBp: number
  readonly averageTalkSeconds: number
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

export interface StructureDto {
  readonly id: string
  readonly name: string
  readonly depth: number
  readonly headName: string | null
  /** People attached directly to this unit. */
  readonly ownHeadcount: number
  /** This unit plus everything beneath it. All three roll up together. */
  readonly headcount: number
  /** Of those, marked active in Bitrix24. */
  readonly activeHeadcount: number
  /** Of the active, those who made a call or won a deal this period. */
  readonly workingHeadcount: number
  readonly deals: number
  readonly revenue: MoneyDto
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

// ---------------------------------------------------------------------------
// Pulse & flow — `/insights/pulse`, `/insights/flow`.
// Mirrors the DTOs in `src/server/services/pulseService.ts`.
// ---------------------------------------------------------------------------

export interface PulseVelocityDto {
  /** Open revenue deals right now — point-in-time, not period-bound. */
  readonly openDeals: number
  readonly openValue: MoneyDto
  /** Count-based win rate over deals closed in the period, 0-100. */
  readonly winRatePercent: number | null
  readonly avgWonAmount: MoneyDto | null
  readonly medianCycleDays: number | null
  /**
   * "Savdo tezligi", soʻm per day. Null whenever ANY component above is null
   * — render an em dash, never a zero, and the components say which leg of
   * the formula is missing.
   */
  readonly salesVelocityPerDay: MoneyDto | null
}

export interface PulseForecastDto {
  /** Revenue won so far in the period. */
  readonly periodToDate: MoneyDto
  /** How much of the FULL calendar unit has elapsed, 0-100. */
  readonly elapsedPercent: number
  /** Run-rate projection to the unit's end. Null while under 2% elapsed. */
  readonly projected: MoneyDto | null
  /** The previous FULL unit's revenue — what the projection is read against. */
  readonly previousFull: MoneyDto
  /** projected vs previousFull. */
  readonly delta: DeltaDto
}

/**
 * What the period's revenue is made of, and what it is still owed.
 *
 * Revenue is booked on the CLOSE date and the median order takes weeks to
 * close, so a month's revenue is largely earlier months' orders arriving.
 * This split says how much of it the period actually earned itself.
 */
export interface PulseCompositionDto {
  /** Closed in the period AND created in it — the period's own work. */
  readonly own: MoneyDto
  readonly ownDeals: number
  /** Closed in the period but created before it — carried in from earlier. */
  readonly carried: MoneyDto
  readonly carriedDeals: number
  /** own / (own + carried), 0-100. Null when nothing closed. */
  readonly ownSharePercent: number | null
  /** Taken in this period and still open — lands in a LATER period's revenue. */
  readonly openFromPeriod: MoneyDto
  readonly openFromPeriodDeals: number
}

export interface PulseCycleDto {
  readonly p50Days: number | null
  readonly p75Days: number | null
  readonly p90Days: number | null
  /** How many won deals the percentiles were computed from. */
  readonly wonCount: number
}

export interface PulseWinRateDto {
  /** won / (won + lost) by deal count, 0-100. Null when nothing closed. */
  readonly countPercent: number | null
  /** The same rate weighted by deal value. */
  readonly valuePercent: number | null
  readonly wonCount: number
  readonly lostCount: number
  readonly countDelta: DeltaDto
  readonly valueDelta: DeltaDto
}

export interface PulseDto {
  readonly velocity: PulseVelocityDto
  readonly forecast: PulseForecastDto
  readonly composition: PulseCompositionDto
  readonly cycle: PulseCycleDto
  readonly winRate: PulseWinRateDto
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
  readonly lostOrders: number
  /** Won over RESOLVED orders, 0-100. Open orders are not counted against. */
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
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
}

export interface SellerBoardTotalsDto {
  readonly sellers: number
  readonly teams: number
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  readonly conversionPercent: number | null
  readonly wonDelta: DeltaDto
  readonly bonusPayable: MoneyDto
  readonly sellersInBonus: number
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
  /** Every figure here is bucketed by the day the ORDER WAS TAKEN. */
  readonly basis: 'created_in_period'
}

/** One day of one seller's intake. */
export interface SellerDayDto {
  readonly date: string
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
}

export interface StageConversionRowDto {
  readonly stageId: string
  readonly stageName: string
  readonly pipelineName: string
  readonly category: string
  readonly logisticsRole: string | null
  readonly sortOrder: number
  /** Distinct cohort deals that EVER entered this stage. */
  readonly dealCount: number
  /**
   * dealCount over the pipeline's whole cohort — one shared denominator for
   * every stage. This is the reading the ladder draws: the Доставка pipeline
   * has parallel REGIONAL_HUB and CARRIER branches, so a stage-to-stage
   * conversion there compares two branches and reads past 900%.
   */
  readonly cohortSharePercent: number | null
  /** How many deals the share is OF — the denominator, stated. */
  readonly cohortDeals: number
  /** vs the previous stage of the same pipeline. Null for the first stage. */
  readonly conversionFromPreviousPercent: number | null
}

export interface FlowConversionDto {
  /**
   * The honest denominator: deals CREATED in the period, revenue pipelines.
   * Captions must say "davrda yaratilgan bitimlar boʻyicha".
   */
  readonly basis: 'created_in_period'
  readonly stages: readonly StageConversionRowDto[]
}

export interface StageAgingRowDto {
  readonly stageId: string
  readonly stageName: string
  readonly pipelineName: string
  readonly category: string
  readonly logisticsRole: string | null
  readonly sortOrder: number
  readonly openCount: number
  readonly openValue: MoneyDto
  /** Current dwell of open deals in this stage, hours. */
  readonly dwellP50Hours: number | null
  readonly dwellP90Hours: number | null
  /** All-time median over completed visits — the stuck baseline. Null = none. */
  readonly historicalP50Hours: number | null
  /** Deals dwelling longer than 2x the historical median. */
  readonly stuckCount: number
  readonly stuckValue: MoneyDto
}

export interface FlowAgingDto {
  readonly stages: readonly StageAgingRowDto[]
  readonly totals: {
    readonly openCount: number
    readonly openValue: MoneyDto
    readonly stuckCount: number
    readonly stuckValue: MoneyDto
  }
}

export interface FlowDto {
  readonly stageConversion: FlowConversionDto
  readonly aging: FlowAgingDto
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

// ---------------------------------------------------------------------------
// Response — `/insights/response`.
// Mirrors the DTOs in `src/server/services/responseService.ts`.
// ---------------------------------------------------------------------------

export interface ResponseFirstTouchDto {
  /** Creation → first outbound call, minutes, over deals that WERE called. */
  readonly p50Minutes: number | null
  readonly p90Minutes: number | null
  /** First-called within 15 / 60 minutes, as a share of ALL cohort deals. */
  readonly calledWithin15MinPercent: number | null
  readonly calledWithin60MinPercent: number | null
  /**
   * Deals with no outbound call at all. Excluded from the percentiles —
   * "never" is not a large number of minutes — and disclosed here instead.
   */
  readonly noCallSharePercent: number | null
  /** Revenue deals created in the period — the honest denominator. */
  readonly deals: number
}

export interface ResponseAttemptsDto {
  /** Dials up to and including the first connect; 1 = reached first try. */
  readonly medianAttemptsToConnect: number | null
  /** Dialling targets never connected after 5+ dials, share of all targets. */
  readonly neverConnectedAfter5Percent: number | null
  /** Dialling targets in the period: a deal, or customer+day without one. */
  readonly groups: number
}

/** Average call effort behind one closed deal, per outcome. */
export interface ResponseOutcomeDto {
  readonly deals: number
  readonly avgCalls: number | null
  /** Connected talk-seconds only — dialling is not conversation. */
  readonly avgTalkSeconds: number | null
}

export interface ResponseEmployeeDto {
  readonly employeeId: string
  readonly fullName: string
  readonly revenue: MoneyDto
  readonly talkHours: number
  readonly revenuePerTalkHour: MoneyDto
}

export interface ResponseEfficiencyDto {
  readonly won: ResponseOutcomeDto
  readonly lost: ResponseOutcomeDto
  /** Period revenue over period connected talk time. Null under one talk-hour. */
  readonly revenuePerTalkHour: MoneyDto | null
  /** Best ratios, employees over the one-talk-hour floor only. */
  readonly topEmployees: readonly ResponseEmployeeDto[]
}

export interface ResponseDto {
  readonly firstTouch: ResponseFirstTouchDto
  readonly attempts: ResponseAttemptsDto
  readonly efficiency: ResponseEfficiencyDto
}

// ---------------------------------------------------------------------------
// Boshqaruv markazi — the command centre
// ---------------------------------------------------------------------------

/**
 * A number with its own previous-period reading.
 *
 * The delta is the house `Delta`, not a hand-rolled percentage: it already
 * distinguishes "no baseline" from "unchanged" from "the baseline was too
 * small to divide by", and a second definition of growth on this page would
 * eventually disagree with the one on every other page.
 */
export interface TrendedDto {
  readonly value: number
  readonly previous: number | null
  readonly delta: DeltaDto
}

export interface UnavailableDto {
  readonly key: string
  readonly label: string
  /** What is missing, in one sentence a director can act on. */
  readonly reason: string
  readonly needed: string
}

/** One day of order intake — the same clock and filter as the intake tiles. */
export interface IntakeDayDto {
  readonly date: string
  readonly orders: number
  /** Booked value that day, in major units. Zero days are present, not absent. */
  readonly booked: number
}

/** One day of the confirmation queue, for the rejection control chart. */
export interface RejectionDayDto {
  readonly date: string
  /** Null when nothing entered the queue that day — a gap, not a zero. */
  readonly sharePercent: number | null
  readonly rejected: number
  readonly orders: number
  /** Sundays are drawn but excluded from the control band's baseline. */
  readonly sunday: boolean
}

export interface CommandCentreDto {
  readonly intake: {
    readonly orders: TrendedDto
    readonly booked: MoneyDto
    readonly bookedPrevious: MoneyDto
    readonly bookedDelta: DeltaDto
    readonly averageOrder: MoneyDto
    readonly averageOrderDelta: DeltaDto
    /** Of those orders, how many are still open. Their value is under revenue. */
    readonly open: number
    /** Orders and booked value per day, zero-filled, capped at today. */
    readonly daily: readonly IntakeDayDto[]
    /**
     * The previous window's intake as orders-per-day, for the chart's
     * reference line. Null when the previous window took nothing in — a
     * dashed line at zero would claim a baseline nobody measured.
     */
    readonly previousDailyOrders: number | null
  }
  readonly revenue: {
    readonly delivered: MoneyDto
    /**
     * Value of this window's orders that are still open.
     *
     * Carries NO period-over-period delta, and the omission is the point. An
     * older window has had longer to drain, so it always shows less still
     * open — measured here, August against July reads "+186%" purely because
     * July's orders have had an extra month to close. It is the same
     * survivorship artifact as the close lag, wearing a different hat.
     */
    readonly openPipeline: MoneyDto
    /** Median days from order created to closed. Why revenue carries no arrow. */
    readonly closeLagDays: number | null
  }
  readonly customers: {
    readonly ordering: TrendedDto
    readonly fresh: TrendedDto
    readonly returning: number
    readonly returningSharePercent: number | null
  }
  readonly confirmation: {
    readonly orders: number
    readonly confirmedRate: number | null
    /** The rate's own numerator, so the fraction can be printed beside it. */
    readonly confirmed: number
    readonly rejected: number
    /** Today's rejection share against a 2-sigma band on working days. */
    readonly rejectionToday: number | null
    readonly rejectionMean: number
    readonly rejectionLimit: number
    readonly rejectionDays: number
    /** The full daily series the band was graded on — the control chart. */
    readonly days: readonly RejectionDayDto[]
  }
  readonly logistics: {
    readonly orders: number
    readonly delivered: number
    /** delivered + refused + cancelledEarly — the delivery rate's own denominator. */
    readonly resolved: number
    readonly deliveryRate: number | null
    readonly inFlight: number
    readonly cancelledEarly: number
    readonly regions: readonly { label: string; orders: number; deliveryRate: number | null }[]
  }
  readonly funnel: readonly { key: string; orders: number; sharePercent: number }[]
  readonly team: {
    readonly employees: number
    readonly active: number
    /** Of the active, those who actually made a call or won a deal this period. */
    readonly working: number
    readonly departments: number
  }
  readonly products: {
    readonly rows: readonly { label: string; revenue: MoneyDto; sharePercent: number }[]
    /** Share of period revenue resting on the single largest product. */
    readonly topSharePercent: number | null
    /** How much of that revenue is itemised at all — the shares are of THIS. */
    readonly coveragePercent: number | null
  }
  readonly concentration: {
    /** Herfindahl index over acquisition sources, and its band. */
    readonly sourceHhi: number | null
    readonly sourceBand: string | null
    readonly repeatMedianDays: number | null
  }
  readonly unavailable: readonly UnavailableDto[]
}
