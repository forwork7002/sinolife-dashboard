/**
 * Connection settings for a `pg` Pool.
 *
 * WHY THIS EXISTS
 * Managed Postgres — DigitalOcean, Neon, Supabase, RDS — hands out a URL
 * ending in `?sslmode=require`. libpq reads that as "encrypt, do not verify".
 * `pg` reads it as "encrypt AND verify against the system trust store", which
 * is libpq's `verify-full`. DigitalOcean signs its clusters with its own CA,
 * so every connection is rejected with `self-signed certificate in certificate
 * chain` and the app never reaches the database at all.
 *
 * That difference is deliberate on `pg`'s side and it is the safer default,
 * but it means the URL the platform generates cannot be used as given. The
 * choice is between silently disabling verification and doing it properly:
 *
 *   - `DATABASE_CA_CERT` set  →  verify against that CA. This is the real
 *     thing: an interceptor without the CA's key cannot pass. DigitalOcean
 *     offers the certificate for download on the database page.
 *   - not set                 →  encrypt without verifying, which is exactly
 *     what `sslmode=require` promises and no less than libpq would do.
 *
 * `sslmode=verify-full` in the URL is left completely alone — someone who
 * typed that meant it, and the system trust store is the right place to look.
 */

import type { PoolConfig } from 'pg'

/** SSL modes where `pg` verifies but libpq would not. The gap this closes. */
const UNVERIFIED_MODES = new Set(['require', 'prefer', 'allow', 'verify-ca'])

function sslMode(connectionString: string): string | undefined {
  try {
    const value = new URL(connectionString).searchParams.get('sslmode')
    return value ? value.toLowerCase() : undefined
  } catch {
    // Not parseable as a URL. Leave it to `pg`, which reports it better.
    return undefined
  }
}

export interface PoolConfigOptions {
  /**
   * PEM-encoded CA certificate, from `DATABASE_CA_CERT`. Newlines may be
   * literal `\n` — a hosting dashboard's single-line variable field cannot
   * hold real ones.
   */
  readonly caCert?: string
  readonly max?: number
  readonly idleTimeoutMillis?: number
  readonly connectionTimeoutMillis?: number
  /**
   * Server-side cap on a single query, in milliseconds.
   *
   * The dashboard's heaviest analytics queries run in a couple of seconds. A
   * query still going after twenty is a mistake — a missing predicate, a
   * period nobody meant to ask for — and left alone it holds a connection and
   * a share of a 1 GB database's memory until it finishes. Postgres cancelling
   * it turns that into one failed request.
   */
  readonly statementTimeoutMs?: number
}

export function poolConfig(
  connectionString: string,
  options: PoolConfigOptions = {},
): PoolConfig {
  const { caCert, statementTimeoutMs, ...pool } = options
  const mode = sslMode(connectionString)

  const config: PoolConfig = {
    connectionString,
    ...pool,
    ...(statementTimeoutMs ? { statement_timeout: statementTimeoutMs } : {}),
  }

  if (mode === undefined || mode === 'disable' || mode === 'no-verify') {
    return config
  }

  const ca = caCert?.trim().replace(/\\n/g, '\n')

  if (ca) {
    // Verify for real, against the CA that actually signed the cluster.
    return { ...config, ssl: { ca, rejectUnauthorized: true } }
  }

  if (UNVERIFIED_MODES.has(mode)) {
    return { ...config, ssl: { rejectUnauthorized: false } }
  }

  // verify-full, or something unrecognised. `pg` handles it.
  return config
}

/**
 * The CA certificate from the environment, if one was supplied.
 *
 * The cast is Next's doing: `next typegen` narrows `ProcessEnv` to the keys it
 * finds in the local .env files, so a variable that only ever exists in
 * production is not on the type.
 */
export function caCertFromEnv(
  source: { DATABASE_CA_CERT?: string } = process.env as { DATABASE_CA_CERT?: string },
): string | undefined {
  const value = source.DATABASE_CA_CERT?.trim()
  return value ? value : undefined
}
