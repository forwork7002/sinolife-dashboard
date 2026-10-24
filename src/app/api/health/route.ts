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

import { authPoolStats, authPrisma, poolStats } from '@/server/db/prisma'
import { SLOW_REQUEST_MS, readSafely } from '@/server/http/slowRequest'
import { logger } from '@/server/logging/logger'
import { firstWarmPending } from '@/server/services/rnpWarmer'

/*
  A NEW SERVER IS NOT READY UNTIL «RNP JADVALI» AND «LIDLAR» ARE WARM — for at most this
  long after it starts (see `rnpWarmer.ts`). The platform probes 30 s after
  start, then every 30 s, and restarts after 3 failures in a row: «warming»
  can fail the 30 s and 60 s probes at most, and the 90 s probe is past the
  grace whatever the build is doing, so a deploy is delayed, never failed.
  «Lidlar»'s first build starts only after RNP's (38.7 s on production) and
  goes two scans at a time, so it may still be running when the grace ends:
  readers then share it (`LeadSourcesService`, «THE PRICE, ONCE PER DEPLOY»).
*/
const WARMING_GRACE_S = 75

export const dynamic = 'force-dynamic'

/*
  TIMED SINCE 2026-10-14 — the slow-request line's rule (`slowRequest.ts`).
  The platform's probe gives up at 10 s and three misses restart the
  container, which a reader sees as one more freeze; a probe that waited
  eight seconds for a connection and then passed used to leave no trace.
  NOTHING HERE CAN THROW (`readSafely`, the catch below): a diagnostic that
  failed this probe would restart a healthy container.
*/
function noteIfSlow(started: number, poolAtStart: ReturnType<typeof poolStats>): void {
  const ms = performance.now() - started
  if (ms < SLOW_REQUEST_MS) return
  try {
    logger.warn(
      { ms: Math.round(ms), poolAtStart, pool: readSafely(() => poolStats()), authPool: readSafely(() => authPoolStats()) },
      'slow health check',
    )
  } catch {
    // One lost line, never a failed probe.
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const started = performance.now()
    const poolAtStart = readSafely(() => poolStats())
    /*
      ON THE AUTH LANE (2026-10-24): the probe asks whether the database
      answers, and a pool full of reports is not a database that is down —
      at 17:36 that day the probe waited 16 s behind them against the
      platform's 10 s, and three misses restart a container that was serving.
    */
    await authPrisma.$queryRaw`SELECT 1`
    noteIfSlow(started, poolAtStart)
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
