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
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Conservative for a single-instance internal tool. Raise only with
    // evidence: Postgres' own default limit is 100 connections in total.
    max: 10,
    idleTimeoutMillis: 30_000,
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
