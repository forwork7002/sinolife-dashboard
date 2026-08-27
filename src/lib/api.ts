/**
 * Typed API client.
 *
 * The only way the UI reaches data. Client code never imports from
 * `@/server/*` — enforced by lint — so this module is the whole boundary.
 */

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

export interface LeaderboardRowDto {
  readonly rank: number
  readonly tied: boolean
  readonly employeeId: string
  readonly fullName: string
  readonly departmentName: string | null
  readonly revenue: MoneyDto
  readonly dealsWon: number
  readonly conversionPercent: number | null
  readonly kpiAchievementPercent: number | null
  readonly delta: DeltaDto
  readonly value: number | null
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
  readonly deliveryRate: number
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
    readonly deliveryRate: number
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
  readonly confirmRate: number
  /** Share of this operator's orders that went through the confirmation stage. */
  readonly coverage: number
  /** How many confirmed orders actually reached the customer. */
  readonly stickRate: number
  readonly deliveredAfterConfirm: number
  readonly refusedAfterConfirm: number
  readonly delivered: number
  readonly failed: number
  /** Delivered as a share of this operator's resolved orders. */
  readonly deliveryRate: number
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
  readonly conversion: number
  readonly averageCheque: MoneyDto
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
  readonly revenue: MoneyDto
  readonly deliveryRate: number
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
  readonly cycle: PulseCycleDto
  readonly winRate: PulseWinRateDto
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
