/**
 * TimePay (timepay24.uz) — the company's FaceID attendance. Its INTERNAL,
 * unannounced API (`TIMEPAY_API_SPEC.md` in «Otsenka ROP app», whose client
 * this restates): fields can change without notice, so callers read every
 * one defensively.
 *
 * AUTH NEVER NEEDS A HUMAN. `TIMEPAY_LOGIN` / `TIMEPAY_PASSWORD` log in for an
 * access token (~3 days) and a refresh token (~14 days); an access token
 * within a minute of its `exp` is refreshed, a failed refresh logs in again.
 * Tokens live in memory only and are never logged.
 *
 * Only the sync worker calls this — never a request handler.
 */

const BASE = 'https://api.app.time-pay.uz'
const PAGE = 100
/** TimePay's limits are unknown: four calls a second at most. */
const MIN_INTERVAL_MS = 250
const MAX_RETRIES = 3
/** One HTTP call, body included — a silent server must not hold the pass. */
const REQUEST_TIMEOUT_MS = 30_000

export class TimepayError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`TimePay ${path}: HTTP ${status}${detail ? ` — ${detail}` : ''}`)
  }
}

/** One row of `employee-daily-stats` — every field optional (an undocumented API). */
export interface TimepayDailyRow {
  readonly id: number
  readonly full_name?: string
  readonly department?: { readonly name?: string } | string | null
  readonly position?: { readonly name?: string } | string | null
  readonly stats?: {
    readonly is_holiday?: boolean
    readonly on_leave?: boolean
    readonly first_check_in?: string | null
    readonly late?: boolean
    readonly late_minutes?: number
    readonly [k: string]: unknown
  }
  readonly [k: string]: unknown
}

type LoginField = 'username' | 'phone_number'

interface Page<T> {
  readonly count?: number
  readonly next?: string | null
  readonly results?: T[]
}

/** `exp` (unix seconds) of a JWT, unverified. 0 when unreadable — refreshed at once. */
function jwtExp(token: string): number {
  try {
    const part = token.split('.')[1] ?? ''
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as {
      exp?: number
    }
    return typeof json.exp === 'number' ? json.exp : 0
  } catch {
    return 0
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function detail(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 200)
  } catch {
    return ''
  }
}

export class TimepayClient {
  private access: string | null = null
  private refreshToken: string | null = null
  private accessExp = 0
  private loginField: LoginField | null = null
  private lastCallAt = 0

  constructor(
    private readonly login: string,
    private readonly password: string,
  ) {
    if (!login || !password) throw new Error('TimePay: TIMEPAY_LOGIN va TIMEPAY_PASSWORD kerak')
  }

  /** The login field is not documented: `username`, then `phone_number`, remembering whichever worked. */
  private async doLogin(): Promise<void> {
    const fields: LoginField[] = this.loginField ? [this.loginField] : ['username', 'phone_number']
    let last: TimepayError | null = null
    for (const field of fields) {
      const r = await fetch(`${BASE}/api/v1/user/employee/password-login/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ [field]: this.login, password: this.password }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (r.ok) {
        const j = (await r.json()) as { access?: string; refresh?: string }
        if (!j.access) throw new TimepayError(r.status, 'login', 'javobda access token yoʻq')
        this.setTokens(j.access, j.refresh ?? null)
        this.loginField = field
        return
      }
      last = new TimepayError(r.status, 'login', await detail(r))
      if (r.status !== 400 && r.status !== 401) break
    }
    throw last ?? new TimepayError(0, 'login', 'nomaʼlum xato')
  }

  private async doRefresh(): Promise<void> {
    if (!this.refreshToken) return this.doLogin()
    const r = await fetch(`${BASE}/api/v1/user/token/refresh/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refresh: this.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!r.ok) return this.doLogin()
    const j = (await r.json()) as { access?: string; refresh?: string }
    if (!j.access) return this.doLogin()
    this.setTokens(j.access, j.refresh ?? this.refreshToken)
  }

  private setTokens(access: string, refresh: string | null): void {
    this.access = access
    this.refreshToken = refresh
    this.accessExp = jwtExp(access)
  }

  private async ensureAuth(force = false): Promise<void> {
    const fresh = this.access !== null && Date.now() / 1000 < this.accessExp - 60
    if (fresh && !force) return
    await (this.access ? this.doRefresh() : this.doLogin())
  }

  private async request<T>(method: 'GET' | 'POST', path: string, query: Record<string, string | number>, body?: unknown): Promise<T> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))
    const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`
    let reauthed = false
    for (let attempt = 1; ; attempt++) {
      await this.ensureAuth()
      const wait = this.lastCallAt + MIN_INTERVAL_MS - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastCallAt = Date.now()
      let r: Response
      let data: T | undefined
      try {
        r = await fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${this.access}`,
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        // The timeout covers the body too, so it is read inside the retried block.
        if (r.ok) data = (await r.json()) as T
      } catch (error) {
        if (attempt <= MAX_RETRIES) {
          await sleep(1000 * 2 ** (attempt - 1))
          continue
        }
        throw error
      }
      if (r.ok) return data as T
      // A token revoked or expired early: authenticate once more, then retry.
      if (r.status === 401 && !reauthed) {
        reauthed = true
        await this.ensureAuth(true)
        continue
      }
      if ((r.status === 429 || r.status >= 500) && attempt <= MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      throw new TimepayError(r.status, path, await detail(r))
    }
  }

  /** Every page of an offset/limit list. */
  private async all<T>(method: 'GET' | 'POST', path: string, query: Record<string, string | number>, body?: unknown): Promise<T[]> {
    const out: T[] = []
    for (let offset = 0; offset < 20_000; offset += PAGE) {
      const page = await this.request<Page<T> | T[]>(method, path, { ...query, offset, limit: PAGE }, body)
      if (Array.isArray(page)) {
        out.push(...page)
        break
      }
      const rows = page.results ?? []
      out.push(...rows)
      if (!page.next || rows.length === 0 || (typeof page.count === 'number' && out.length >= page.count)) break
    }
    return out
  }

  /** Who came when on one day, for every employee (`employee-daily-stats`). */
  dailyAttendance(day: string): Promise<TimepayDailyRow[]> {
    return this.all<TimepayDailyRow>('POST', '/api/v1/user/employee-daily-stats/', {}, { date: day })
  }
}
