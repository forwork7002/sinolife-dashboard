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
import { firstWarmPending } from '@/server/services/rnpWarmer'

/*
  A NEW SERVER IS NOT READY UNTIL «RNP JADVALI» AND «LIDLAR» ARE WARM — for at most this
  long after it starts (see `rnpWarmer.ts`). The platform probes 30 s after
  start, then every 30 s, and restarts after 3 failures in a row: «warming»
  can fail the 30 s and 60 s probes at most, and the 90 s probe is past the
  grace whatever the build is doing, so a deploy is delayed, never failed.
*/
const WARMING_GRACE_S = 75

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`
    if (firstWarmPending() && process.uptime() < WARMING_GRACE_S) {
      return NextResponse.json({ status: 'warming' }, { status: 503, headers: { 'cache-control': 'no-store' } })
    }
    return NextResponse.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    logger.error({ err: error }, 'Health check failed: database unreachable')
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
