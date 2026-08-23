/**
 * PrismaClient singleton.
 *
 * Server-only. The one place a database connection is created.
 *
 * PRISMA 7 NOTES
 * The Rust query engine is gone; a driver adapter is now mandatory, so
 * `new PrismaClient()` with no arguments throws. The connection URL is read
 * from `env`, which has already validated it — including rejecting the
 * `CHANGE_ME` placeholder, so a half-configured .env fails at startup with a
 * clear message rather than as an obscure connection error later.
 *
 * HOT RELOAD
 * Next.js re-evaluates modules on every edit in development. Without the
 * global cache below, each reload would open a fresh pool and the database
 * would run out of connections after a few dozen saves.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'

if (typeof window !== 'undefined') {
  throw new Error(
    'src/server/db/prisma.ts was imported from client code. ' +
      'Database access must stay on the server.',
  )
}

function createPrismaClient(): PrismaClient {
  /**
   * Pool size depends on where this runs.
   *
   * On a single long-lived server, ten connections is comfortable. On Netlify
   * every request may land in its own function instance, each opening its own
   * pool — ten of those across a few dozen concurrent instances exhausts
   * Postgres' 100-connection limit and requests start failing with "too many
   * clients", which looks like an application bug rather than a config one.
   *
   * So serverless gets a small pool and short idle timeout, and should be
   * pointed at Neon's POOLED connection string (the host containing
   * `-pooler`), which multiplexes on the database side.
   */
  const isServerless = Boolean(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: isServerless ? 3 : 10,
    idleTimeoutMillis: isServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  })

  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  })
}

const globalForPrisma = globalThis as unknown as {
  __sinolifePrisma?: PrismaClient
}

export const prisma: PrismaClient =
  globalForPrisma.__sinolifePrisma ?? createPrismaClient()

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__sinolifePrisma = prisma
}
