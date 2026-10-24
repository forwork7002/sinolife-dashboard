/**
 * The slow-request log — what a request cost, written only when it cost a lot.
 *
 * ADDED 2026-10-14, when the client reported the deployed dashboard «qotadi»
 * between pages while the same screens ran smoothly locally. Nothing on the
 * server recorded how long a request took, so the only evidence was two
 * statement timeouts in the log and the time of day they landed. A request
 * that takes `SLOW_REQUEST_MS` or longer now leaves one line: the path, the
 * status, the whole time and the part of it spent resolving the caller, and
 * the pool read twice — when the request ARRIVED and when it ended.
 *
 * WHAT THE POOL READINGS CAN AND CANNOT SAY. `poolAtStart.waiting > 0` (or no
 * idle connection) means the request arrived at a full pool and queued for one
 * of the six connections. `authMs` is no longer that queue: since 2026-10-24
 * the caller is resolved on the auth lane's own two (`db/prisma.ts`). The end
 * reading is the pool as the answer left. Neither proves a slow QUERY: a
 * screen can also wait for connections after the caller is resolved, when it
 * runs more statements at once than the pool holds. Read the lines of one
 * minute together, beside the warmers' and the sync worker's lines.
 *
 * THE QUERY STRING IS NOT LOGGED, ONLY THE KEYS THAT SHAPE THE ANSWER. `q` is
 * what somebody typed into ⌘K (a customer's name, a phone), and id lists name
 * people; the window and the `include` are what makes one call of an endpoint
 * cost more than another, and they are all the log needs. The path is cut
 * short for the same reason a value is: a dynamic segment is whatever the
 * caller sent.
 */

export const SLOW_REQUEST_MS = 1_000

const PATH_MAX = 160
const VALUE_MAX = 40

const SHAPE_PARAMS = [
  'preset',
  'from',
  'to',
  'include',
  'month',
  'half',
  'week',
  'day',
  'brand',
  'queue',
  'basis',
  'months',
  'page',
] as const

/**
 * Read a diagnostic without letting it throw — the request, the page and the
 * health probe must never pay for their own log line. Pass a closure: a
 * missing export (a test's partial module mock) throws when the binding is
 * READ, which a closure moves inside the try.
 */
export function readSafely<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

export interface PoolReading {
  readonly total: number
  readonly idle: number
  readonly waiting: number
}

export interface SlowRequestEntry {
  readonly path: string
  readonly params: Readonly<Record<string, string>>
  readonly status: number
  readonly ms: number
  readonly authMs: number | null
  readonly poolAtStart: PoolReading | null
  readonly pool: PoolReading | null
}

/**
 * The line to write for this request, or null when it was quick.
 *
 * `authMs` is null when the request never got past the caller (a refusal
 * before or during `authorise`).
 */
export function slowRequestEntry(
  url: URL,
  status: number,
  ms: number,
  authMs: number | null,
  poolAtStart: PoolReading | null,
  pool: PoolReading | null,
): SlowRequestEntry | null {
  if (ms < SLOW_REQUEST_MS) return null

  const params: Record<string, string> = {}
  for (const key of SHAPE_PARAMS) {
    const value = url.searchParams.get(key)
    if (value !== null) params[key] = value.slice(0, VALUE_MAX)
  }

  return {
    path: url.pathname.slice(0, PATH_MAX),
    params,
    status,
    ms: Math.round(ms),
    authMs: authMs === null ? null : Math.round(authMs),
    poolAtStart,
    pool,
  }
}
