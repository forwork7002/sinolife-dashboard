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
import { prismaAdapter } from 'better-auth/adapters/prisma'

import { env } from '@/server/config/env'
import { prisma } from '@/server/db/prisma'
import { AUTH_COOKIE_PREFIX } from './cookiePrefix'
import { resolveTrustedOrigins } from './trustedOrigins'

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
    minPasswordLength: 8,
    maxPasswordLength: 128,
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
