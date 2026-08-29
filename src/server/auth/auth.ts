/**
 * Authentication.
 *
 * better-auth over the Prisma adapter, using the `user` / `session` / `account`
 * / `verification` models already in the schema — those four were designed to
 * better-auth's shape from the start, so no adapter-side mapping is needed.
 * The `twoFactor` and `signInLockout` models below join them.
 *
 * Email + password only. No social providers: this is an internal tool where
 * accounts are created by an administrator, and self-service sign-up is
 * explicitly disabled below.
 *
 * WHAT A STOLEN PASSWORD BUYS AN ATTACKER HERE.
 * On its own, before any of this: everything. One password, one POST, and the
 * whole commercial position of the company — every deal, every customer's
 * phone number, a year of revenue — is readable. Three things stand in the way
 * now, and they are deliberately different in kind:
 *
 *  1. TOTP, so the password is not sufficient (`twoFactor`, opt-in).
 *  2. A breach check, so a password already published in a dump cannot be set
 *     in the first place (`haveIBeenPwned`, wrapped to fail open).
 *  3. A lockout, so a patient guesser cannot use the login form as an oracle
 *     (`lockout.ts`, counted in Postgres).
 */

import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { username } from 'better-auth/plugins/username'

import { env } from '@/server/config/env'
import { prisma } from '@/server/db/prisma'
import { AUTH_COOKIE_PREFIX } from './cookiePrefix'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
} from '@/lib/passwordPolicy'
import {
  checkSignInLockout,
  clearSignInFailures,
  lockoutMessage,
  recordFailedSignIn,
} from './lockout'
import { resolveTrustedOrigins } from './trustedOrigins'
import { resolveTrustedProxies } from './trustedProxies'

/**
 * Origins allowed to post to the auth endpoints.
 *
 * See `trustedOrigins.ts` for why the configured URL alone is not enough — the
 * short version is that the same server reached at 127.0.0.1 or by LAN address
 * answered 403 and looked exactly like a wrong password.
 */
export const TRUSTED_ORIGINS = resolveTrustedOrigins(
  env.BETTER_AUTH_URL,
  process.env.APP_TRUSTED_ORIGINS,
)

/**
 * The proxies whose forwarded client IP may be believed. See
 * `trustedProxies.ts` — without this, anyone can pick their own rate-limit
 * bucket by writing an X-Forwarded-For header.
 */
export const TRUSTED_PROXIES = resolveTrustedProxies(process.env.APP_TRUSTED_PROXIES)

/** Session lifetime, in seconds. Referenced twice, so it is named once. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

/**
 * What the authenticator app will show next to the code.
 *
 * Worth getting right: this string is what tells the owner, six months from
 * now, which of the entries in their app belongs to this dashboard. "Better
 * Auth" — the library default — would not.
 */
const TOTP_ISSUER = 'SinoLife'

// ---------------------------------------------------------------------------
// Breach check
// ---------------------------------------------------------------------------

/**
 * Refuse passwords that already appear in a public breach corpus.
 *
 * WHAT LEAVES THE SERVER. Not the password. The plugin takes SHA-1 of the
 * candidate, sends the FIRST FIVE HEX CHARACTERS of that hash to
 * api.pwnedpasswords.com, and gets back every suffix sharing that prefix —
 * some tens of thousands of them — then does the comparison locally. This is
 * k-anonymity: the service learns that somebody, somewhere, has a password
 * whose hash starts with those five characters, which is true of roughly one
 * password in a million and identifies nothing. It is worth saying plainly,
 * because "we check your password against a website" is what a reader assumes
 * this does, and that assumption would be a good reason to delete the feature.
 *
 * WHY IT MUST FAIL OPEN — and why the stock plugin does not.
 * The plugin turns a network failure into a 500, which means: HIBP is down (or
 * DNS is, or the outbound firewall changed) and the owner can no longer change
 * their password. That is exactly backwards. The reason someone changes a
 * password in a hurry is that they think it is compromised; a third party
 * being unreachable must never be what stops them. So the wrapper below keeps
 * the refusal and discards everything else:
 *
 *   - `PASSWORD_COMPROMISED` → rethrown; the password is refused.
 *   - anything else — timeout, DNS, 503, a plugin change we did not foresee —
 *     → fall through to the normal hash, unchecked.
 *
 * There is a second, quieter reason this wrapper has to exist. The plugin
 * hooks `password.hash` and asks for the current ENDPOINT context to decide
 * whether the path is one it guards. `provisioning.ts` hashes passwords
 * outside any endpoint (that is how `db:seed:users` creates accounts), where
 * that lookup throws "No auth context found". Unwrapped, this plugin would
 * break user provisioning entirely. Falling through on a non-breach error
 * fixes that case too.
 *
 * WHY THERE IS A TIMEOUT. The plugin's fetch has none, so a black-holed
 * connection would hang the change-password request until the platform's proxy
 * gave up — a minute of a spinner, then a generic error. Four seconds is many
 * times the API's normal response and short enough that a failure still reads
 * as "that was slow", not "the app is broken".
 */
const BREACH_CHECK_TIMEOUT_MS = 4_000

/** Uzbek, because this reaches the owner as-is on the account page. */
const BREACH_MESSAGE =
  'Bu parol sizib chiqqan parollar roʻyxatida topildi. Boshqa parol tanlang.'

/**
 * The paths the check guards.
 *
 * Listed explicitly rather than left to the plugin's defaults so it cannot
 * silently start or stop covering a route on a library upgrade. These are the
 * same three the house password policy hooks below — the two rules should
 * always apply to the same set, or a password could pass one and skip the
 * other. `/set-password` is absent because better-auth marks it server-only:
 * it has no HTTP route to guard.
 */
const PASSWORD_SETTING_PATHS = ['/sign-up/email', '/change-password', '/reset-password']

const pwnedCheck = haveIBeenPwned({
  customPasswordCompromisedMessage: BREACH_MESSAGE,
  paths: PASSWORD_SETTING_PATHS,
})

/** Did this error come from the corpus lookup saying "yes, it is in there"? */
function isCompromisedPassword(error: unknown): boolean {
  return isAPIError(error) && error.body?.code === 'PASSWORD_COMPROMISED'
}

const breachCheck: typeof pwnedCheck = {
  ...pwnedCheck,
  init(ctx) {
    const checkedHash = pwnedCheck.init(ctx).context.password.hash
    const plainHash = ctx.password.hash

    return {
      context: {
        password: {
          // Spread first: `runPluginInit` does `Object.assign(context, ...)`,
          // so whatever is returned here REPLACES `context.password` wholesale.
          // Dropping `verify` or `checkPassword` would break sign-in.
          ...ctx.password,
          async hash(password: string) {
            let timer: ReturnType<typeof setTimeout> | undefined

            try {
              const outcome = await Promise.race([
                // Both branches are settled into a value, never a rejection:
                // a rejection racing a timeout is an unhandled rejection when
                // the timeout wins.
                checkedHash(password).then(
                  (hash) => ({ kind: 'hashed' as const, hash }),
                  (error: unknown) => ({ kind: 'failed' as const, error }),
                ),
                new Promise<{ kind: 'timeout' }>((resolve) => {
                  timer = setTimeout(() => resolve({ kind: 'timeout' }), BREACH_CHECK_TIMEOUT_MS)
                }),
              ])

              if (outcome.kind === 'hashed') return outcome.hash
              if (outcome.kind === 'failed' && isCompromisedPassword(outcome.error)) {
                throw outcome.error
              }
              // Fail open. The password is still subject to the house policy,
              // which ran before this and does not need the network.
              return plainHash(password)
            } finally {
              clearTimeout(timer)
            }
          },
        },
      },
    }
  },
}

/**
 * The single key both credential paths lock on.
 *
 * WHY IT HAS TO BE SHARED. The lockout used to be wired to `/sign-in/email`
 * alone. When sign-in by login name arrived, an account locked out on one path
 * could still be signed into through the other — verified against a running
 * build: five wrong passwords on the email path armed the lock and returned
 * 429 to the correct password, and twelve seconds later that same correct
 * password succeeded on the username path. The lock was decorative.
 *
 * A login name resolves to the account's REAL email so both paths land in the
 * same bucket. An unknown login has no account to resolve, and falls back to a
 * deterministic stand-in rather than skipping the lockout: an identifier that
 * cannot be locked is an identifier an attacker can guess against for free,
 * and one that locks only when it EXISTS is an oracle telling them which
 * logins are real.
 */
async function lockoutIdentifier(
  path: string,
  body: Record<string, unknown>,
): Promise<string | null> {
  if (path === '/sign-in/email') {
    const email = body.email
    return typeof email === 'string' && email.trim() !== '' ? email : null
  }

  const raw = body.username
  if (typeof raw !== 'string' || raw.trim() === '') return null

  const login = raw.trim().toLowerCase()
  const owner = await prisma.user.findUnique({
    where: { username: login },
    select: { email: true },
  })

  return owner?.email ?? `${login}@unknown.invalid`
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: TRUSTED_ORIGINS,

  /**
   * TWO-FACTOR AUTHENTICATION.
   *
   * TOTP only — an authenticator app, no email or SMS codes. Email codes would
   * make the second factor only as strong as the mailbox, and this account's
   * mailbox is on the same laptop as the browser; SMS needs a provider that
   * does not exist in this deployment.
   *
   * IT IS OPT-IN, AND MUST STAY THAT WAY. `user.twoFactorEnabled` defaults to
   * false, so every account that exists today signs in exactly as it did
   * before this plugin was added. Nothing about the deploy can lock anyone
   * out; the owner arms it when they are standing in front of the setup screen
   * with their phone in hand.
   *
   * ARMING IS TWO STEPS, ON PURPOSE. `/two-factor/enable` returns the TOTP URI
   * and the backup codes but changes nothing about how sign-in works;
   * `twoFactorEnabled` only flips when a real code is posted to
   * `/two-factor/verify-totp`. So the codes are always in the user's hands
   * BEFORE the lock is on, and an abandoned setup leaves the account exactly
   * as it was. `skipVerificationOnEnable` would collapse those two steps into
   * one and arm 2FA for a secret nobody has proved they can generate — which
   * is how people lock themselves out of their own systems. It stays false.
   *
   * ================= IF THE PHONE AND THE CODES ARE BOTH GONE ==============
   * There is no self-service recovery, and pretending otherwise would be the
   * dishonest thing to do here. There is one user and no administrator behind
   * them: any "email me a reset link" path would just be a second, weaker way
   * in — one that lives in the same mailbox, on the same laptop.
   *
   * The real answer is a database edit, by whoever holds the DATABASE_URL:
   *
   *   UPDATE "user" SET "twoFactorEnabled" = false WHERE email = '<address>';
   *   DELETE FROM "two_factor" WHERE "userId" = (
   *     SELECT id FROM "user" WHERE email = '<address>'
   *   );
   *
   * After that the account signs in with the password alone and can enrol
   * again. Saying so in a comment beats a recovery flow that is really just a
   * bypass — and it is the reason the setup screen must show the ten backup
   * codes and make the user confirm they have stored them somewhere that is
   * not this laptop.
   * =========================================================================
   */
  plugins: [
    /**
     * SIGN IN BY LOGIN NAME, not by email address.
     *
     * This is an internal dashboard for a call centre: operators are given a
     * login by their administrator, and most of them have no work mailbox at
     * all. Asking them for an email address is asking for something that does
     * not exist.
     *
     * Email sign-in is deliberately LEFT ENABLED alongside it. The founding
     * administrator account was created with a real address before this
     * existed, and removing that path would have locked the only account that
     * can create the others out of the product.
     */
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      // Letters, digits, dot, dash and underscore. Deliberately no spaces and
      // no '@': a login containing '@' would be indistinguishable from an
      // email address on the sign-in form, which accepts either.
      usernameValidator: (value) => /^[a-zA-Z0-9._-]+$/.test(value),
    }),
    twoFactor({
      issuer: TOTP_ISSUER,
      // Two steps to arm. See the block above; this is the load-bearing line.
      skipVerificationOnEnable: false,

      totpOptions: {
        // Six digits over a thirty-second window: what every authenticator app
        // shows by default. Eight digits would be marginally stronger and
        // would also be the first thing to go wrong in a hurry.
        digits: 6,
        period: 30,
      },

      /**
       * TEN backup codes, encrypted at rest.
       *
       * They are the ONLY recovery path (see above), so the count is generous
       * on purpose: with a handful, a person who loses their phone and burns a
       * few codes getting back in is one bad week from the database edit. Ten
       * five-plus-five character codes are also short enough to be written on
       * paper, which is where they belong — a copy in the password manager on
       * the same laptop as the browser is not a backup.
       *
       * `encrypted` means AES under BETTER_AUTH_SECRET, so a database dump
       * does not hand over the recovery codes. Each code works once: verifying
       * one rewrites the column without it.
       */
      backupCodeOptions: {
        amount: 10,
        length: 10,
        storeBackupCodes: 'encrypted',
      },

      /**
       * The plugin's own lockout, for the SECOND factor.
       *
       * Separate from the password lockout in `lockout.ts` and deliberately
       * looser. A six-digit code is one guess in a million, the plugin already
       * caps a single challenge at five attempts, and backup codes share this
       * budget — locking the recovery path after five typos is the dangerous
       * direction to be wrong in when there is nobody to call. Ten failures,
       * fifteen minutes.
       *
       * Written out rather than left to the defaults so an upgrade cannot
       * change the numbers without this file changing too.
       */
      accountLockout: {
        enabled: true,
        maxFailedAttempts: 10,
        durationSeconds: 900,
      },

      /**
       * "Trust this device" lasts exactly as long as a session.
       *
       * The library's default is thirty days, which would mean the WEAKER
       * factor outliving the stronger one: the password is asked for again
       * every seven days when the session expires, while the second factor
       * stays skipped for a month. Matching the two means 2FA is asked for
       * exactly as often as the password, and a stolen laptop stops being
       * useful on the same day either way.
       */
      trustDeviceMaxAge: SESSION_TTL_SECONDS,
    }),

    breachCheck,
  ],

  emailAndPassword: {
    enabled: true,
    // Accounts are provisioned by an admin. A public sign-up endpoint on an
    // internal sales dashboard would let anyone who finds the URL create
    // themselves an account.
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,

    /**
     * Changing a password signs every OTHER device out.
     *
     * The reason someone changes a password is usually that they think
     * somebody else has it. Leaving the other sessions alive would mean the
     * change accomplished nothing: the intruder's cookie keeps working for the
     * rest of the week. The device doing the change keeps its session, so the
     * person is not thrown out of the screen they are standing on.
     */
    revokeSessionsOnPasswordReset: true,
  },

  hooks: {
    /**
     * Two rules, both applied before better-auth does any work.
     *
     * `before` on the sign-in and password-setting endpoints is the only point
     * every such path shares. Identity-based password rules (do not reuse your
     * email or name) need the account, which is why they live in a hook rather
     * than in a Zod schema on one route; the lockout lives here because it has
     * to answer BEFORE the password is verified, or a locked account still
     * costs a hash comparison per guess.
     */
    before: createAuthMiddleware(async (ctx) => {
      const path = ctx.path
      const body = (ctx.body ?? {}) as Record<string, unknown>

      /*
        The username plugin mounts this, and nothing in the product calls it.

        It answers "does this login exist?" to anyone who can reach the
        deployment — unauthenticated, no Origin required, and on its own
        rate-limit budget because the path does not start with /sign-in. On a
        call centre whose logins are first names that is the staff roster, and
        the sign-in endpoints are deliberately silent about which half of a
        credential was wrong precisely so it cannot be asked.
      */
      if (path === '/is-username-available') {
        throw new APIError('NOT_FOUND')
      }

      if (path === '/sign-in/email' || path === '/sign-in/username') {
        const identifier = await lockoutIdentifier(path, body)
        if (identifier === null) return

        const remainingMs = await checkSignInLockout(identifier)
        if (remainingMs > 0) {
          /**
           * 429, not 401.
           *
           * The message says nothing about whether the address exists — an
           * unknown address locks on the same schedule as the owner's, so the
           * refusal is not an oracle (see `lockout.ts`). The distinct status
           * and code exist so the login page can render "wait N minutes"
           * instead of "wrong password", which is the difference between the
           * owner waiting and the owner retyping a correct password forty
           * times convinced something is broken.
           */
          throw new APIError('TOO_MANY_REQUESTS', {
            code: 'ACCOUNT_LOCKED_OUT',
            message: lockoutMessage(remainingMs),
          })
        }
        return
      }

      if (path !== '/change-password' && path !== '/reset-password' && path !== '/sign-up/email') {
        return
      }

      const candidate = body.newPassword ?? body.password
      if (typeof candidate !== 'string') return

      const session = ctx.context.session?.user as
        | { email?: string | null; name?: string | null }
        | undefined

      const { ok, problems } = checkPassword(candidate, {
        email: session?.email ?? (typeof body.email === 'string' ? body.email : null),
        name: session?.name ?? null,
      })

      if (!ok) {
        throw new APIError('BAD_REQUEST', {
          code: 'WEAK_PASSWORD',
          message: problems.join(' '),
        })
      }
    }),

    /**
     * Count the sign-in attempt.
     *
     * This has to be an AFTER hook because the outcome is the input: nothing
     * before the handler knows whether the password was right.
     *
     * `ctx.context.returned` is the response the endpoint produced — an
     * `APIError` when it refused, the sign-in payload when it did not. Only a
     * 401 counts as a failure: that is what better-auth throws for a wrong
     * password, an unknown address and an account with no credential, and it
     * is the only status an attacker can produce by guessing. A 403 (wrong
     * origin) or a 500 (database down) is the deployment misbehaving, and
     * charging the owner's lockout budget for it would turn an outage into a
     * lockout.
     *
     * ORDER MATTERS, AND IT IS GUARANTEED. better-auth runs the config's after
     * hook before any plugin's (`getHooks` in api/dispatch.mjs pushes it
     * first), so what is read here is the credential outcome — not what the
     * two-factor plugin rewrites it into a moment later when it swaps a
     * successful sign-in for a pending challenge. A correct password followed
     * by a failed TOTP code therefore clears this counter, which is right:
     * they are separate factors with separate budgets.
     */
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email' && ctx.path !== '/sign-in/username') return

      const identifier = await lockoutIdentifier(
        ctx.path,
        (ctx.body ?? {}) as Record<string, unknown>,
      )
      if (identifier === null) return

      const returned: unknown = ctx.context.returned

      if (isAPIError(returned)) {
        if (returned.statusCode === 401) await recordFailedSignIn(identifier)
        return
      }

      await clearSignInFailures(identifier)
    }),
  },

  /**
   * Rate limiting.
   *
   * On by default in production; declared here so it is on wherever this
   * runs, and so sign-in gets a rule of its own. The general budget is
   * generous — one open dashboard refetching every minute makes a lot of
   * legitimate requests — while the password endpoint gets five attempts a
   * minute.
   *
   * FIVE, DOWN FROM TEN. Ten was already far beyond human typing, and the
   * lower number is now doing something specific: it means the per-IP throttle
   * and the per-account lockout hit at the same scale, so an attacker on one
   * address exhausts the account's five-failure budget in the same minute the
   * throttle starts refusing them anyway. The owner does not notice — five
   * wrong passwords in sixty seconds is not something a person who knows their
   * password does.
   *
   * Memory storage, because the spec runs exactly one web instance. A second
   * instance would need `storage: 'database'` to share the counters, or each
   * would enforce the limit on its own and the effective ceiling would double.
   * This is also precisely why the LOCKOUT counter is not kept here: memory
   * counters die with the process, and a deploy would hand a guesser a fresh
   * budget. See `lockout.ts`.
   *
   * The two-factor plugin adds its own rule for `/two-factor/*` (three
   * requests per ten seconds). It is left alone: enrolment is two requests
   * minutes apart, and a sign-in challenge is one code at a time.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 200,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      // The path every login-name account uses. Without its own rule it fell
      // under the general 200-per-minute budget.
      '/sign-in/username': { window: 60, max: 5 },
      '/forget-password': { window: 60, max: 5 },
    },
  },

  /**
   * Sessions last a week.
   *
   * KEPT AT SEVEN DAYS DELIBERATELY, now that a second factor exists. The
   * argument for a shorter session is that a stolen cookie stays valid for
   * less time; the argument against is that this is one person on one laptop
   * who signs in to look at their own company, and a dashboard that logs them
   * out every day is a dashboard that trains them to type their password more
   * often — in more places, more hurriedly, with the 2FA code right behind it.
   * More authentications is not more security when there is one user; it is
   * more chances to be phished.
   *
   * What actually bounds the damage from a stolen cookie is not the clock: a
   * password change revokes every other session immediately
   * (`revokeSessionsOnPasswordReset`), and that is the lever a person reaches
   * for when they think something is wrong.
   *
   * `updateAge` rolls the expiry once a day, so an active week never ends
   * mid-afternoon. `cookieCache` answers session lookups from a signed cookie
   * for five minutes to keep the database out of every navigation.
   */
  session: {
    expiresIn: SESSION_TTL_SECONDS,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },

  advanced: {
    // Prisma generates cuids for every other model; keep ids consistent.
    database: { generateId: false },
    cookiePrefix: AUTH_COOKIE_PREFIX,

    /**
     * Secure cookies follow the URL SCHEME, not NODE_ENV.
     *
     * Keying this off NODE_ENV looks right and breaks in a specific way:
     * `next start` on http://localhost sets NODE_ENV=production, so the cookie
     * is issued with `Secure`, the browser refuses to send it back over plain
     * http, and every request is silently unauthenticated — while sign-in
     * itself still returns 200. The symptom is a dashboard that redirects to
     * login forever with no error anywhere.
     *
     * Deriving it from BETTER_AUTH_URL is self-correcting: an https deployment
     * gets Secure cookies automatically, and a local http server works without
     * anyone having to remember a flag.
     */
    useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://'),

    ipAddress: {
      trustedProxies: TRUSTED_PROXIES,
    },
  },

  /**
   * Application fields exposed on the session user.
   *
   * `input: false` means a client can never set them — role escalation by
   * posting a JSON body is the failure mode this prevents. `twoFactorEnabled`
   * is not listed here: the two-factor plugin contributes it to the user
   * schema itself, with the same protection.
   */
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'SALES',
        input: false,
      },
      isActive: {
        type: 'boolean',
        required: false,
        defaultValue: true,
        input: false,
      },
      employeeId: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
})

export type Auth = typeof auth
