/**
 * «MIJOZ QAYTISHI» IS BUILT HERE, IN THE SYNC WORKER, AND STORED (2026-10-24).
 *
 * The cohort matrix walks every won revenue deal there has ever been, and on
 * the one-core, one-gigabyte database a cold build ran past the web pool's
 * 20 s statement timeout — 500 at 18:13, 18:43, 18:44 and 18:46 that day —
 * and, with the limit lifted to a minute (8b7b51b6), answered in 13 s for the
 * company, 48 s for Collagen and 16 s for Zextra, each holding one of the six
 * screen connections that long. The matrix moves once a day, so the worker
 * builds the page's standing questions (`InsightsService.standingCohortBuilds`
 * — the three matrices the page opens on and the База card) one at a time,
 * outside the web pool, and the screen reads them from `cohort_snapshot`.
 *
 * HOW OFTEN (`cohortRefreshEvery`): every half hour of the working day
 * (`WARM_HOURS`, the warmers' hours), every three hours outside it — the
 * nightly DEALS_BACKFILL is not to be shared with four whole-history scans
 * for a screen nobody reads at night. The screen serves a stored answer
 * for six hours (`COHORT_SNAPSHOT_MAX_AGE_MS`), so a night is covered.
 *
 * Started beside the Bitrix24 loop, never inside it, like Meta: a build of
 * up to a minute must not hold the portal sync.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { CohortSnapshotRepository } from '@/server/repositories/cohortSnapshotRepository'
import { InsightsRepository } from '@/server/repositories/insightsRepository'

import { InsightsService, STORED_COHORT_KEYS } from './insightsService'
import { WARM_HOURS, withinHours } from './rnpWarmer'

export const COHORT_REFRESH_MS = 30 * 60_000
export const COHORT_REFRESH_NIGHT_MS = 3 * 3_600_000
/**
 * One statement's limit here (SET LOCAL, `InsightsRepository.queryWithTimeout`).
 * The worker's pool sets none at all; this one is a bound on a statement that
 * has gone wrong, not a budget — the cold Collagen cut measured 48 s.
 */
export const COHORT_WORKER_STATEMENT_TIMEOUT_MS = 5 * 60_000

/** The interval a pass is due on at `now`. */
export function cohortRefreshEvery(now: Date, timeZone: string): number {
  return withinHours(now, timeZone, WARM_HOURS) ? COHORT_REFRESH_MS : COHORT_REFRESH_NIGHT_MS
}

/**
 * When the stored answers were last built — the OLDEST of them, or null
 * when any one is missing, so a deploy that adds a question builds at once.
 */
export async function storedCohortsBuiltAt(prisma: PrismaClient): Promise<Date | null> {
  const built = await new CohortSnapshotRepository(prisma).builtAt()
  let oldest: Date | null = null
  for (const key of STORED_COHORT_KEYS) {
    const at = built.get(key)
    if (at === undefined) return null
    if (oldest === null || at < oldest) oldest = at
  }
  return oldest
}

/** One stored question, as the pass built it. */
export interface CohortBuilt {
  readonly key: string
  readonly ms: number
}

/**
 * Builds and stores every standing question, one at a time — never side by
 * side, which is what the 20 s timeouts were made of. A question that fails
 * keeps its old row and does not stop the others; the failures come back
 * with the built ones, for the log.
 */
export async function refreshStoredCohorts(input: {
  prisma: PrismaClient
  stopping: () => boolean
  now?: () => Date
}): Promise<{ built: CohortBuilt[]; failed: { key: string; error: string }[] }> {
  const now = input.now ?? (() => new Date())
  const store = new CohortSnapshotRepository(input.prisma)
  const service = new InsightsService(new InsightsRepository(input.prisma))
  const built: CohortBuilt[] = []
  const failed: { key: string; error: string }[] = []
  for (const question of service.standingCohortBuilds(COHORT_WORKER_STATEMENT_TIMEOUT_MS)) {
    if (input.stopping()) break
    const started = now()
    try {
      const value = await question.build()
      const ms = now().getTime() - started.getTime()
      await store.write(question.key, value, started, ms)
      built.push({ key: question.key, ms })
    } catch (error) {
      failed.push({ key: question.key, error: error instanceof Error ? error.message.trim().split('\n').pop()! : String(error) })
    }
  }
  return { built, failed }
}
