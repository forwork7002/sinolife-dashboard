/**
 * Validated server environment.
 *
 * This module is the single place environment variables are read. Everything
 * else imports the frozen `env` object, so a typo in a variable name is a
 * compile error rather than a silent `undefined` at runtime.
 *
 * Validation happens once, at import time. A misconfigured deployment fails
 * immediately and loudly instead of serving a dashboard full of zeros.
 *
 * SECURITY: this file must never be reachable from a client component. It
 * carries the database URL and the Bitrix24 webhook token. The guard below is
 * the runtime backstop; `eslint no-restricted-imports` is the compile-time one.
 */

import { z } from 'zod'

if (typeof window !== 'undefined') {
  throw new Error(
    'src/server/config/env.ts was imported from client code. ' +
      'It contains secrets and must stay server-only.',
  )
}

/** The CRM the sync engine pulls from. The only switch of its kind. */
export const DataSource = {
  Demo: 'demo',
  Bitrix24: 'bitrix24',
} as const

export type DataSourceValue = (typeof DataSource)[keyof typeof DataSource]

/**
 * Treat an empty string as absent.
 *
 * Hosting dashboards (Vercel, Netlify) store a variable you left blank as `''`,
 * not as missing. Zod's `.default()` only fires on `undefined`, and
 * `z.coerce.number()` turns `''` into `0` — so a blank optional variable fails
 * validation with "expected number to be >0" instead of falling back to its
 * default. Stripping the empty string first is what makes the default mean
 * what it says.
 */
const blankAsUndefined = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner)

const schema = z
  .object({
    NODE_ENV: blankAsUndefined(
      z.enum(['development', 'test', 'production']).default('development'),
    ),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
        'DATABASE_URL must be a PostgreSQL connection string',
      )
      .refine(
        (v) => !v.includes('CHANGE_ME'),
        'DATABASE_URL still contains the placeholder password. ' +
          'Edit .env and set your real PostgreSQL password.',
      ),

    DATA_SOURCE: blankAsUndefined(
      z.enum([DataSource.Demo, DataSource.Bitrix24]).default(DataSource.Demo),
    ),

    /**
     * Seed for the deterministic demo generator. Integer so the PRNG is
     * reproducible across machines and platforms.
     */
    DEMO_SEED: blankAsUndefined(z.coerce.number().int().default(20260101)),

    /**
     * The one secret with no possible default.
     *
     * It signs session cookies, so it has to be unguessable (nothing derived
     * from public deployment data will do) and stable across instances and
     * deploys (generating one at startup would sign every visitor out on the
     * next cold start, at random). Both properties rule out inventing it here.
     */
    BETTER_AUTH_SECRET: z
      .string({
        error:
          'BETTER_AUTH_SECRET is missing. Generate one with:\n' +
          "      node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      })
      .min(
        32,
        'BETTER_AUTH_SECRET must be at least 32 characters. If it looks set, ' +
          'check it is not an empty value. Generate one with:\n' +
          "      node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      ),

    // Both are filled in from the platform's own deployment URL when blank —
    // see withPlatformDefaults below. Setting them explicitly still wins.
    BETTER_AUTH_URL: z.url(),
    NEXT_PUBLIC_APP_URL: z.url(),

    /**
     * IANA timezone for every period boundary in the application.
     * Validated against the host's timezone database rather than a hardcoded
     * list, so any valid zone works.
     */
    APP_TIMEZONE: blankAsUndefined(
      z
        .string()
        .default('Asia/Tashkent')
        .refine((tz) => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz })
            return true
          } catch {
            return false
          }
        }, 'APP_TIMEZONE is not a valid IANA timezone identifier'),
    ),

    APP_DEFAULT_LOCALE: blankAsUndefined(
      z.enum(['uz', 'ru', 'en']).default('uz'),
    ),
    APP_DEFAULT_CURRENCY: blankAsUndefined(
      z
        .string()
        .length(3, 'APP_DEFAULT_CURRENCY must be a 3-letter ISO 4217 code')
        .default('UZS'),
    ),

    LOG_LEVEL: blankAsUndefined(
      z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    ),

    // --- Bitrix24: BITRIX24_INTEGRATION_PENDING -----------------------------
    // Optional while DATA_SOURCE=demo. Required the moment it is bitrix24;
    // see the superRefine below.
    BITRIX24_WEBHOOK_URL: z
      .string()
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    BITRIX24_RATE_LIMIT_RPS: blankAsUndefined(
      z.coerce.number().positive().default(2),
    ),
    BITRIX24_REQUEST_TIMEOUT_MS: blankAsUndefined(
      z.coerce.number().int().positive().default(15_000),
    ),
    BITRIX24_MAX_RETRIES: blankAsUndefined(
      z.coerce.number().int().min(0).max(10).default(3),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.DATA_SOURCE !== DataSource.Bitrix24) return

    // A half-configured integration must fail loudly. Falling back to demo
    // data here would mean presenting generated numbers as if they were live.
    if (!value.BITRIX24_WEBHOOK_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['BITRIX24_WEBHOOK_URL'],
        message:
          'DATA_SOURCE=bitrix24 requires BITRIX24_WEBHOOK_URL. ' +
          'Refusing to start rather than silently serving demo data as live.',
      })
      return
    }

    if (!/^https:\/\//i.test(value.BITRIX24_WEBHOOK_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BITRIX24_WEBHOOK_URL'],
        message:
          'BITRIX24_WEBHOOK_URL must use https. The URL embeds an access ' +
          'token and must not travel over plaintext http.',
      })
    }
  })

export type Env = z.infer<typeof schema>

/**
 * The URL the app is reachable at, as the host platform reports it.
 *
 * Vercel and Netlify both know their own deployment URL and expose it. Asking
 * them beats making a human retype it into a text box: the value is right by
 * construction, it follows preview deployments (each of which has a different
 * host), and it cannot be the empty string that a half-filled settings page
 * produces.
 *
 * Vercel's variables carry no protocol; Netlify's do. Everything here is
 * https, which is what makes better-auth issue Secure cookies — see
 * `useSecureCookies` in auth.ts.
 *
 * Returns undefined when running anywhere else, so local development still
 * reads the value from .env.
 */
function platformUrl(source: NodeJS.ProcessEnv): string | undefined {
  // Vercel. On a preview deployment the visitor is on the deployment-specific
  // host, so the auth base URL has to be that one and not the production
  // domain — otherwise the session cookie is set for a host nobody is on.
  const vercelHost =
    source.VERCEL_ENV === 'production'
      ? (source.VERCEL_PROJECT_PRODUCTION_URL ?? source.VERCEL_URL)
      : (source.VERCEL_URL ?? source.VERCEL_PROJECT_PRODUCTION_URL)

  if (vercelHost) return `https://${vercelHost}`

  // Netlify. DEPLOY_PRIME_URL is the branch/preview address; URL is the
  // production one. Both already include the scheme.
  const netlifyUrl =
    source.CONTEXT === 'production'
      ? (source.URL ?? source.DEPLOY_PRIME_URL)
      : (source.DEPLOY_PRIME_URL ?? source.URL)

  if (netlifyUrl) return netlifyUrl

  return undefined
}

/**
 * Fill in what the platform already knows before validating.
 *
 * Only ever fills a *blank* variable: an explicitly configured URL always
 * wins, so a custom domain set in the dashboard is never overridden by the
 * generated `*.vercel.app` one.
 */
function withPlatformDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const url = platformUrl(source)
  if (!url) return source

  const filled: NodeJS.ProcessEnv = { ...source }

  for (const key of ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'] as const) {
    if (!filled[key]) filled[key] = url
  }

  return filled
}

function load(): Env {
  const source = withPlatformDefaults(process.env)
  const parsed = schema.safeParse(source)

  if (!parsed.success) {
    // Print variable NAMES and messages only. Values are never echoed —
    // a malformed DATABASE_URL would otherwise leak the password to the log.
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    // On a hosting platform there is no .env to compare against, and the
    // usual cause is a variable added by name with the value left empty —
    // point at the settings page rather than at a file that isn't there.
    const where =
      platformUrl(source) !== undefined
        ? 'Set these in your hosting dashboard under Environment Variables. ' +
          'A variable added with an empty value counts as set, and fails here ' +
          'exactly like this — delete it instead of leaving it blank.'
        : 'Compare your .env against .env.example.'

    throw new Error(`Invalid environment configuration:\n${problems}\n\n${where}`)
  }

  return Object.freeze(parsed.data)
}

export const env: Env = load()

/** True when the app is serving generated demo data rather than live CRM data. */
export const isDemoMode = env.DATA_SOURCE === DataSource.Demo
