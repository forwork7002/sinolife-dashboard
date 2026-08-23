/**
 * API error taxonomy.
 *
 * Pure and dependency-free so it can be unit tested directly.
 *
 * THE RULE ABOUT ERROR MESSAGES
 * Two audiences, two messages. `message` is safe to show a user and is written
 * for one. The underlying cause — the stack, the SQL, the provider response —
 * is kept in `cause` and goes to the log only, paired with a correlation id.
 * A stack trace in an HTTP response tells an attacker the ORM, the schema and
 * the file layout; it tells the user nothing they can act on.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'DATA_SOURCE_UNAVAILABLE',
  'INTEGRATION_PENDING',
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DATA_SOURCE_UNAVAILABLE: 503,
  // Not an error in the usual sense: the feature exists but its data source is
  // not connected yet. 501 keeps it distinguishable from a genuine failure.
  INTEGRATION_PENDING: 501,
  INTERNAL_ERROR: 500,
})

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code]
}

export interface ErrorDetail {
  readonly path: string
  readonly message: string
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: readonly ErrorDetail[]
  /** Internal-only context. Logged, never serialised to the client. */
  readonly cause?: unknown

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: readonly ErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = statusForCode(code)
    this.details = options.details ?? []
    this.cause = options.cause
  }

  static validation(message: string, details: readonly ErrorDetail[] = []): ApiError {
    return new ApiError('VALIDATION_ERROR', message, { details })
  }

  static unauthenticated(message = 'Tizimga kirish talab qilinadi.'): ApiError {
    return new ApiError('UNAUTHENTICATED', message)
  }

  static forbidden(message = 'Bu amalni bajarishga ruxsatingiz yoʻq.'): ApiError {
    return new ApiError('FORBIDDEN', message)
  }

  static notFound(what = 'Soʻralgan maʼlumot topilmadi.'): ApiError {
    return new ApiError('NOT_FOUND', what)
  }

  /**
   * The feature is built but its data source is not connected yet.
   * Used for anything gated on BITRIX24_INTEGRATION_PENDING, so the UI can say
   * "not connected" instead of rendering a confident zero.
   */
  static integrationPending(what: string): ApiError {
    return new ApiError(
      'INTEGRATION_PENDING',
      `${what} hali ulanmagan (BITRIX24_INTEGRATION_PENDING).`,
    )
  }

  static internal(cause: unknown): ApiError {
    return new ApiError(
      'INTERNAL_ERROR',
      'Kutilmagan xatolik yuz berdi. Iltimos, keyinroq urinib koʻring.',
      { cause },
    )
  }
}

/**
 * Normalise anything thrown into an ApiError.
 *
 * An unrecognised throw becomes a generic INTERNAL_ERROR with the original
 * preserved as `cause` for the logs — never surfaced to the caller.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return ApiError.internal(error)
}
