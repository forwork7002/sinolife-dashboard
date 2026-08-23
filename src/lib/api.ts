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
export async function apiGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<ApiSuccess<T>> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
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
  readonly value: number | null
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
