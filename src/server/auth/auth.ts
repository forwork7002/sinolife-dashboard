/**
 * Authentication.
 *
 * better-auth over the Prisma adapter, using the `user` / `session` / `account`
 * / `verification` models already in the schema — those four were designed to
 * better-auth's shape from the start, so no adapter-side mapping is needed.
 *
 * Email + password only. No social providers: this is an internal tool where
 * accounts are created by an administrator, and self-service sign-up is
 * explicitly disabled below.
 */

import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'

import { env } from '@/server/config/env'
import { prisma } from '@/server/db/prisma'
import { AUTH_COOKIE_PREFIX } from './cookiePrefix'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
} from '@/lib/passwordPolicy'
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

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: TRUSTED_ORIGINS,

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

  /**
   * Password rules, applied before better-auth hashes anything.
   *
   * `before` on the change-password and set-password endpoints is the only
   * point every password-setting path shares. Identity-based rules (do not
   * reuse your email or name) need the account, which is why this lives in a
   * hook rather than in a Zod schema on one route.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const path = ctx.path
      if (path !== '/change-password' && path !== '/reset-password' && path !== '/sign-up/email') {
        return
      }

      const body = (ctx.body ?? {}) as Record<string, unknown>
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
  },

  /**
   * Rate limiting.
   *
   * On by default in production; declared here so it is on wherever this
   * runs, and so sign-in gets a rule of its own. The general budget is
   * generous — one open dashboard refetching every minute makes a lot of
   * legitimate requests — while the password endpoint gets ten attempts a
   * minute, which no human types and no guesser can work with.
   *
   * Memory storage, because the spec runs exactly one web instance. A second
   * instance would need `storage: 'database'` to share the counters, or each
   * would enforce the limit on its own and the effective ceiling would double.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 200,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/forget-password': { window: 60, max: 5 },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
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
   * posting a JSON body is the failure mode this prevents.
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
