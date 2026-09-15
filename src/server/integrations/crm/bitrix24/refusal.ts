/**
 * What kind of «no» the portal just said.
 *
 * Bitrix24 refuses in four shapes that need four different reactions, and until
 * this module existed they were byte-for-byte identical everywhere downstream:
 * the same HTTP 401, the same `retryable = false`, the same line in `sync_log`.
 * On 2026-09-15 that cost the dashboard five hours — the portal's overload block
 * cleared and was replaced by a DELETED webhook, and nothing in the system could
 * tell «wait, it lifts by itself» from «a person must issue a new credential».
 *
 * The distinction is the whole point:
 *
 * - `THROTTLE`   the portal is refusing everyone for load. It lifts on the
 *                portal's clock, so the only correct response is to stop asking.
 * - `CREDENTIAL` the webhook is gone or wrong. It will NEVER clear on its own;
 *                a human has to act, so the sooner one is told the better.
 * - `METHOD`     one method spent its operating budget. Every OTHER method is
 *                still answerable, so blocking the whole portal would be wrong.
 * - `TRANSIENT`  a socket, a timeout, a 502. Retrying is exactly right.
 *
 * `null` is the important fifth answer: a per-record fact such as
 * `ERROR_ACCESS_DENIED` or `INVALID_ARG_VALUE` is NOT a portal refusal and must
 * never trip a circuit breaker. `batchWalk` relies on `INVALID_ARG_VALUE` as its
 * ordinary end-of-data sentinel, so classifying it as a refusal would open the
 * gate on every completed walk.
 *
 * Pure: no I/O, no clock, no dependency on the provider. That is what lets the
 * worker, the provider and the alerts service share one vocabulary.
 */

export type RefusalClass = 'THROTTLE' | 'CREDENTIAL' | 'METHOD' | 'TRANSIENT'

/**
 * Codes the portal answers with, grouped by what they oblige us to do.
 *
 * Matched on the CODE only — never on `error_description`, which arrives in the
 * portal's own interface language and would break the moment an administrator
 * switches `obey.bitrix24.kz` from Russian to Uzbek.
 */
const THROTTLE_CODES = new Set(['OVERLOAD_LIMIT', 'QUERY_LIMIT_EXCEEDED'])

const CREDENTIAL_CODES = new Set([
  'INVALID_CREDENTIALS',
  'NO_AUTH_FOUND',
  'WRONG_AUTH_TYPE',
  'EXPIRED_TOKEN',
  'INVALID_TOKEN',
  'AUTHORIZATION_ERROR',
  'ACCESS_DENIED',
  'INVALID_GRANT',
  'INVALID_CLIENT',
])

const METHOD_CODES = new Set(['OPERATION_TIME_LIMIT'])

/**
 * Codes that name one record or one argument, not the portal's willingness to
 * talk to us. Listed explicitly so that a future code is treated as unknown
 * rather than silently swept into `CREDENTIAL` by the 401 fallback below.
 */
const NOT_A_REFUSAL = new Set([
  'ERROR_ACCESS_DENIED',
  'INVALID_ARG_VALUE',
  'ERROR_BATCH_LENGTH_EXCEEDED',
  'ERROR_METHOD_NOT_FOUND',
  'ERROR_MANIFEST_IS_NOT_AVAILABLE',
])

/** The uppercase token the portal uses as its error code, if the error carries one. */
export function refusalCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code.toUpperCase()
  }

  const message = errorMessage(error)
  if (!message) return null

  /*
    The same screen `syncErrorCode` uses in alertsService, and for the same
    reason: only an uppercase-or-underscore token is taken, so nothing from a
    portal response body can reach a decision as arbitrary text. REST and API
    are excluded because «REST API is blocked due to overload» would otherwise
    yield «REST» as the code.
  */
  const named = /\b([A-Z][A-Z_]{4,39})\b/.exec(message)
  if (named?.[1] && named[1] !== 'REST' && named[1] !== 'API') return named[1]

  /*
    OAuth's own codes arrive lowercase — `expired_token`, `invalid_token` — and
    the uppercase screen above cannot see them. They are matched by name rather
    than by a second loose pattern, because a lowercase-word regex over a
    sentence would take «blocked» or «overload» for a code.
  */
  const lower = /\b(expired_token|invalid_token|invalid_grant|invalid_client)\b/.exec(message)
  if (lower?.[1]) return lower[1].toUpperCase()

  return null
}

/** The HTTP status the error carries, if any. */
function refusalStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  const message = errorMessage(error)
  const matched = message ? /responded (\d{3})/.exec(message) : null
  return matched?.[1] ? Number(matched[1]) : null
}

function errorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return null
}

/**
 * Which of the four refusals this is, or `null` when it is not a refusal.
 *
 * Order matters. The code is asked first because it is the portal's own word;
 * the status is only a fallback for the case the body could not be parsed. A
 * bare 401 with no recoverable code is read as `CREDENTIAL` deliberately: the
 * two shapes that produce it are a revoked webhook and an overload block, and
 * of those only the first is made worse by waiting. Paging a human for a block
 * that would have cleared itself costs one notification; staying silent over a
 * dead credential cost five hours on 2026-09-15.
 */
export function classifyRefusal(error: unknown): RefusalClass | null {
  const code = refusalCode(error)

  if (code) {
    if (NOT_A_REFUSAL.has(code)) return null
    if (THROTTLE_CODES.has(code)) return 'THROTTLE'
    if (CREDENTIAL_CODES.has(code)) return 'CREDENTIAL'
    if (METHOD_CODES.has(code)) return 'METHOD'
  }

  const status = refusalStatus(error)
  if (status === 401 || status === 403) return 'CREDENTIAL'
  if (status === 429) return 'METHOD'
  if (status !== null && status >= 500) return 'TRANSIENT'

  // An abort, a DNS failure, a reset socket: no status, no code, and retrying
  // is the right answer. A code we have never seen before lands here too, which
  // is the conservative place for it — TRANSIENT retries rather than blocking.
  if (code === null && status === null) return 'TRANSIENT'

  return null
}
