/**
 * Liveness and readiness for the platform's health check.
 *
 * WHY NOT /login
 * The check used to point at the login page, which Next serves from the build
 * output. That answers 200 with the database gone, the sync stopped and every
 * page in the app failing — a green light over an application that cannot
 * serve a single number. A health check that cannot fail is not a health
 * check.
 *
 * This touches the database, because that is the dependency whose absence
 * makes the app useless. It deliberately does NOT report sync freshness: a
 * stale sync is a problem for a human to look at, not a reason for the
 * platform to restart a web server that is working correctly.
 *
 * UNAUTHENTICATED, on purpose — the platform's prober carries no session — so
 * it says whether the app is up and nothing else. No version, no counts, no
 * error text.
 */

import { NextResponse } from 'next/server'

import { prisma } from '@/server/db/prisma'
import { logger } from '@/server/logging/logger'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    logger.error({ err: error }, 'Health check failed: database unreachable')
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
