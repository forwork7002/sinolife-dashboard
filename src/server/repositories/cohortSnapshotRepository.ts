/**
 * «Mijoz qaytishi»'s stored answers — `cohort_snapshot` (2026-10-24).
 *
 * The sync worker builds the page's standing questions and writes them here
 * (`cohortSnapshotRefresh.ts`); `InsightsService.cohorts` reads them instead
 * of running the whole-history statement in front of the reader. A row is
 * the repository's own answer (`InsightsRepository.cohorts` /
 * `retentionStages`), stored as JSON, so the screen folds a stored answer
 * exactly as it folds a live one.
 */

import type { PrismaClient } from '@/generated/prisma/client'

/** One stored answer, as written. */
export interface StoredCohortAnswer {
  readonly payload: unknown
  readonly builtAt: Date
  readonly ms: number
}

/** What the screen reads — a seam the service's tests fake. */
export interface CohortSnapshotReader {
  read(key: string): Promise<StoredCohortAnswer | null>
}

/*
  BIGINT IN JSON. The matrix carries money as BigInt minor units, and
  `JSON.stringify` throws on a BigInt; writing it as a number would lose the
  digits past 2^53 that the money contract exists to keep. So a BigInt is
  stored as `{"$bigint":"<decimal>"}` and read back as one — a shape no other
  value in these answers has.
*/
const BIGINT = '$bigint'

/** A payload ready for a JSONB column: every BigInt written as `{"$bigint": "…"}`. */
export function encodeCohortPayload(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? { [BIGINT]: v.toString() } : v)))
}

/** The payload as it was before `encodeCohortPayload` — BigInt money back as BigInt. */
export function decodeCohortPayload<T>(value: unknown): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v)
      if (entries.length === 1 && entries[0]![0] === BIGINT && typeof entries[0]![1] === 'string') {
        return BigInt(entries[0]![1])
      }
      return Object.fromEntries(entries.map(([k, inner]) => [k, walk(inner)]))
    }
    return v
  }
  return walk(value) as T
}

export class CohortSnapshotRepository implements CohortSnapshotReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(key: string): Promise<StoredCohortAnswer | null> {
    return this.prisma.cohortSnapshot.findUnique({
      where: { key },
      select: { payload: true, builtAt: true, ms: true },
    })
  }

  /** When each stored question was last built. */
  async builtAt(): Promise<Map<string, Date>> {
    const rows = await this.prisma.cohortSnapshot.findMany({ select: { key: true, builtAt: true } })
    return new Map(rows.map((row) => [row.key, row.builtAt]))
  }

  /** One upsert per question — the row is the whole answer, replaced each time. */
  async write(key: string, value: unknown, builtAt: Date, ms: number): Promise<void> {
    const payload = encodeCohortPayload(value) as object
    await this.prisma.cohortSnapshot.upsert({
      where: { key },
      create: { key, payload, builtAt, ms },
      update: { payload, builtAt, ms },
    })
  }
}
