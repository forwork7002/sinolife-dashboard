/**
 * The per-address sign-in throttle, and why an address the office signs in
 * from gets a larger one.
 *
 * WHAT WENT WRONG (2026-10-16, the user: «5 martaga urinishi mumkin, keyin
 * 1 minut … tanish ip dagi odam kirmoqchi bo'lsa … shu qoida ishlamasligi
 * kerak, urinishlar soni ko'proq bo'ladi»). better-auth keys its rate limit on
 * the client IP, and the office reaches the internet through ONE address. Five
 * sign-ins a minute was a budget for one person, shared by the whole floor —
 * and a correct password spends it too, because the limiter counts the request
 * before the password is checked. Five colleagues signing in inside one minute
 * left the sixth refused for up to a minute, having typed nothing wrong.
 *
 * THE RULE. An address that `KNOWN_IP_MIN_USERS` DIFFERENT people signed in
 * from in the last seven days is KNOWN and gets `KNOWN_IP_SIGN_IN_MAX`
 * attempts a minute; any other address keeps `SIGN_IN_MAX`. «Signed in from»
 * is a `session` row: better-auth writes one per successful sign-in and stamps
 * it with the same `getIP` this throttle keys on, so the office's address
 * becomes known by itself. No list to keep, no table to add.
 *
 * WHAT THAT SIGNAL CANNOT DO. A session row is DELETED by «Chiqish», by a
 * password change or an administrator's revoke, and by an abandoned two-factor
 * step — so an office that signs out at the end of every shift can start the
 * morning unknown, and the first minute of the rush is the old five until
 * three colleagues are in and the memo below turns over. It falls back to the
 * old rule and nothing else; a signal that survives sign-out would be an
 * address list or a sign-in log table, and neither was asked for.
 *
 * WHY SEVERAL PEOPLE AND NOT ONE. One person's sign-in proves only that one
 * account works from there. With one, anybody holding a single account — or a
 * single stolen one — makes their own address known by signing in once, and a
 * mobile operator's shared address becomes known the first time one seller
 * signs in from a phone. Three different accounts in a week is what an office
 * looks like; it makes both of those much less likely, not impossible — three
 * sellers can share an operator's address in a week.
 *
 * WHAT IT COSTS, AND WHAT STILL GUARDS A PASSWORD. This throttle limits the
 * RATE from one address; the lockout in `lockout.ts` limits the TOTAL against
 * one login — five wrong passwords shut that account for fifteen minutes,
 * whatever address they came from. A guesser inside the office still gets five
 * tries at any one colleague, not thirty. What a known address does gain is
 * speed at trying ONE password on many accounts, which the lockout barely
 * sees: thirty a minute where it was five. That is the price of letting many
 * DIFFERENT people sign in at once, which is what an office is.
 *
 * THE ADDRESS MUST BE THE LIMITER'S. Reading X-Forwarded-For here would let a
 * client write the office's address into the header and borrow its budget, so
 * `clientIp` is wired in auth.ts to better-auth's own `getIP` over the same
 * `advanced.ipAddress` object the limiter and the session row use.
 *
 * FAILS CLOSED. No address, or a lookup that throws, is `SIGN_IN_MAX` — the
 * rule as it was. A database outage must not hand every caller thirty.
 *
 * ONE LOOKUP PER ADDRESS A MINUTE, BOTH WAYS. The rule runs on every request
 * to the sign-in path, before the limiter counts it, so without a memo a flood
 * from one address would be a database query per request on the one vCPU that
 * answers every screen. The memo holds the PROMISE, so a burst of parallel
 * requests from a new address shares one query rather than racing to fill the
 * memo, and a negative or failed answer is kept as well. The cost is that a
 * new office address waits up to a minute after it qualifies.
 */

/** The window both budgets are counted over, in seconds. */
export const SIGN_IN_WINDOW_SECONDS = 60

/** Attempts a minute from an address that is not known. */
export const SIGN_IN_MAX = 5

/** Attempts a minute from a known address. */
export const KNOWN_IP_SIGN_IN_MAX = 30

/** Different people who must have signed in from an address for it to be known. */
export const KNOWN_IP_MIN_USERS = 3

/** How recent those sign-ins must be. */
export const KNOWN_IP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

/** How long one address's answer is reused. See the header. */
export const KNOWN_IP_MEMO_MS = 60_000

/** Addresses remembered at once; the oldest answer goes first. */
export const KNOWN_IP_MEMO_LIMIT = 1_000

/** A better-auth rate-limit rule: `max` requests per `window` seconds. */
export interface SignInRule {
  readonly window: number
  readonly max: number
}

export interface SignInThrottleDeps {
  /** The address the limiter keys this request on, or null when it has none. */
  clientIp(request: Request): string | null
  /**
   * How many DIFFERENT users signed in successfully from `ip` at or after
   * `since` — counting may stop at `enough`, which is all the rule needs.
   */
  usersSignedInFrom(ip: string, since: Date, enough: number): Promise<number>
  /** Told when the lookup throws; the address is then treated as unknown. */
  onLookupError?(error: unknown): void
  /** The clock, in epoch milliseconds — a seam for the tests. */
  now?(): number
}

/** The rule for `/sign-in/username`. */
export function signInThrottle(deps: SignInThrottleDeps): (request: Request) => Promise<SignInRule> {
  const now = deps.now ?? Date.now
  const memo = new Map<string, { readonly known: Promise<boolean>; readonly at: number }>()

  async function lookup(ip: string, at: number): Promise<boolean> {
    try {
      const since = new Date(at - KNOWN_IP_LOOKBACK_MS)
      return (await deps.usersSignedInFrom(ip, since, KNOWN_IP_MIN_USERS)) >= KNOWN_IP_MIN_USERS
    } catch (error) {
      deps.onLookupError?.(error)
      return false
    }
  }

  function isKnown(ip: string): Promise<boolean> {
    const at = now()
    const hit = memo.get(ip)
    if (hit && at - hit.at < KNOWN_IP_MEMO_MS) return hit.known

    const known = lookup(ip, at)
    // Re-inserted so insertion order stays the age order the eviction reads.
    memo.delete(ip)
    memo.set(ip, { known, at })
    if (memo.size > KNOWN_IP_MEMO_LIMIT) {
      const oldest = memo.keys().next().value
      if (oldest !== undefined) memo.delete(oldest)
    }
    return known
  }

  return async (request) => {
    const ip = deps.clientIp(request)
    const known = ip ? await isKnown(ip) : false
    return { window: SIGN_IN_WINDOW_SECONDS, max: known ? KNOWN_IP_SIGN_IN_MAX : SIGN_IN_MAX }
  }
}
