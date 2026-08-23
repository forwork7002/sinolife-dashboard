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

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

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

    DATA_SOURCE: z
      .enum([DataSource.Demo, DataSource.Bitrix24])
      .default(DataSource.Demo),

    /**
     * Seed for the deterministic demo generator. Integer so the PRNG is
     * reproducible across machines and platforms.
     */
    DEMO_SEED: z.coerce.number().int().default(20260101),

    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    NEXT_PUBLIC_APP_URL: z.url(),

    /**
     * IANA timezone for every period boundary in the application.
     * Validated against the host's timezone database rather than a hardcoded
     * list, so any valid zone works.
     */
    APP_TIMEZONE: z
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

    APP_DEFAULT_LOCALE: z.enum(['uz', 'ru', 'en']).default('uz'),
    APP_DEFAULT_CURRENCY: z
      .string()
      .length(3, 'APP_DEFAULT_CURRENCY must be a 3-letter ISO 4217 code')
      .default('UZS'),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),

    // --- Bitrix24: BITRIX24_INTEGRATION_PENDING -----------------------------
    // Optional while DATA_SOURCE=demo. Required the moment it is bitrix24;
    // see the superRefine below.
    BITRIX24_WEBHOOK_URL: z
      .string()
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    BITRIX24_RATE_LIMIT_RPS: z.coerce.number().positive().default(2),
    BITRIX24_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    BITRIX24_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
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

function load(): Env {
  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    // Print variable NAMES and messages only. Values are never echoed —
    // a malformed DATABASE_URL would otherwise leak the password to the log.
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'Compare your .env against .env.example.',
    )
  }

  return Object.freeze(parsed.data)
}

export const env: Env = load()

/** True when the app is serving generated demo data rather than live CRM data. */
export const isDemoMode = env.DATA_SOURCE === DataSource.Demo
