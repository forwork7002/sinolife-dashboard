/**
 * The decisions behind `hooks.before` / `hooks.after` in auth.ts, kept out of
 * that module so they can be tested without a database or a validated .env:
 * auth.ts builds the better-auth instance at import time, and this file only
 * decides.
 */

import { APIError, isAPIError } from 'better-auth/api'

import {
  type LockoutStore,
  type SignInOutcome,
  lockoutMessage,
  reserveSignInAttempt,
  settleSignInAttempt,
} from './lockout'

/**
 * Endpoints better-auth mounts and nothing in the product calls, refused
 * outright (404, as if they did not exist).
 *
 * `/is-username-available` answers "does this login exist?" to anyone who can
 * reach the deployment — unauthenticated, no Origin required, and on its own
 * rate-limit budget because the path does not start with /sign-in. On a call
 * centre whose logins are first names that is the staff roster.
 *
 * `/update-user` lets ANY session — a deactivated one included, since it
 * only needs a session row — rewrite its own `name`, `username` and
 * `displayUsername` (the username plugin marks neither `input: false`). An
 * operator could rename themselves to a colleague on /users, or change their
 * own sign-in login, and none of it reached the audit log. Its
 * USERNAME_IS_ALREADY_TAKEN reply was the same existence oracle as the path
 * above. Account changes go through PATCH /api/v1/users/:id, which is
 * permissioned and audited.
 */
export const REFUSED_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/is-username-available',
  '/update-user',
])

export function refuseUnusedEndpoint(path: string): void {
  if (REFUSED_AUTH_PATHS.has(path)) throw new APIError('NOT_FOUND')
}

export const SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/sign-in/email', '/sign-in/username'])

/**
 * The domain an account's synthesised email hangs off — `<login>@sinolife.local`
 * (`SYNTHETIC_EMAIL_DOMAIN` in userAdminService.ts; restated, not imported,
 * because that module pulls in the database).
 */
export const LOGIN_EMAIL_DOMAIN = 'sinolife.local'

const loginKey = (login: string) => `${login}@${LOGIN_EMAIL_DOMAIN}`

/** What the lockout may ask about an account. */
export interface AccountLookup {
  byLogin(login: string): Promise<{ email: string } | null>
  byEmail(email: string): Promise<{ username: string | null } | null>
}

/**
 * The lockout identifiers one sign-in attempt is counted under.
 *
 * THE FIRST KEY NEVER DEPENDS ON THE DATABASE. It used to: the login path
 * keyed on the account's REAL email when the login existed and on
 * `<login>@unknown.invalid` when it did not, while the email path keyed on the
 * address as typed. So the two paths shared a bucket only when the login
 * EXISTED — five wrong passwords on /sign-in/email for `ali@sinolife.local`,
 * then one /sign-in/username for `ali`: 429 meant a real login, 401 an
 * invented one. A roster of first names, one candidate a minute per address.
 *
 * Now the login path's key is `<login>@sinolife.local` and the email path's
 * is the address as given (trimmed, lowercased) — the same string for every
 * account created on /users, whether or not it exists, so the two paths
 * share a bucket unconditionally and the refusal says nothing.
 *
 * THE SECOND KEY LINKS AN ACCOUNT WHOSE TWO NAMES DIFFER. The founding
 * administrator signs in with a genuine address; an account renamed before
 * its email followed may keep an old one. For those, the attempt is also
 * counted under the account's other identity, so a lock earned on one path
 * still holds on the other (the bypass this shared key was built to close).
 * That key is only ever ANOTHER name for the same account — learning
 * anything from it takes guessing the exact pair, never just a login.
 */
export async function signInLockoutIdentifiers(
  path: string,
  body: Record<string, unknown>,
  lookup: AccountLookup,
): Promise<string[]> {
  if (path === '/sign-in/email') {
    const raw = body.email
    if (typeof raw !== 'string' || raw.trim() === '') return []
    const email = raw.trim().toLowerCase()
    const owner = await lookup.byEmail(email)
    const login = owner?.username?.trim().toLowerCase()
    return login && loginKey(login) !== email ? [email, loginKey(login)] : [email]
  }

  if (path === '/sign-in/username') {
    const raw = body.username
    if (typeof raw !== 'string' || raw.trim() === '') return []
    const login = raw.trim().toLowerCase()
    const owner = await lookup.byLogin(login)
    const email = owner?.email.trim().toLowerCase()
    return email && email !== loginKey(login) ? [loginKey(login), email] : [loginKey(login)]
  }

  return []
}

/** Only a 401 is a guess; see `SignInOutcome`. */
export function signInOutcome(returned: unknown): SignInOutcome {
  if (isAPIError(returned)) return returned.statusCode === 401 ? 'failed' : 'void'
  return 'succeeded'
}

export interface SignInDeps {
  readonly lookup: AccountLookup
  readonly store?: LockoutStore
  readonly now?: () => Date
}

/**
 * `hooks.before` for the two sign-in paths: reserve the attempt, or refuse
 * with 429 `ACCOUNT_LOCKED_OUT`.
 *
 * 429, not 401. The message says nothing about whether the account exists —
 * an unknown login locks on the same schedule as a real one — and the
 * distinct status and code let the login page render "wait N minutes"
 * instead of "wrong password".
 */
export async function guardSignIn(
  path: string,
  body: Record<string, unknown>,
  deps: SignInDeps,
): Promise<void> {
  if (!SIGN_IN_PATHS.has(path)) return
  const identifiers = await signInLockoutIdentifiers(path, body, deps.lookup)
  if (identifiers.length === 0) return

  const remainingMs = await reserveSignInAttempt(identifiers, deps.now?.() ?? new Date(), deps.store)
  if (remainingMs > 0) {
    throw new APIError('TOO_MANY_REQUESTS', {
      code: 'ACCOUNT_LOCKED_OUT',
      message: lockoutMessage(remainingMs),
    })
  }
}

/** `hooks.after` for the two sign-in paths: settle the reservation. */
export async function settleSignIn(
  path: string,
  body: Record<string, unknown>,
  returned: unknown,
  deps: SignInDeps,
): Promise<void> {
  if (!SIGN_IN_PATHS.has(path)) return
  const identifiers = await signInLockoutIdentifiers(path, body, deps.lookup)
  if (identifiers.length === 0) return
  await settleSignInAttempt(identifiers, signInOutcome(returned), deps.store)
}
