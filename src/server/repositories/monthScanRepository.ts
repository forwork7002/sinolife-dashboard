/**
 * Roistat's closed months as the sync worker stored them — `month_scan`
 * (2026-10-28).
 *
 * The worker reads each closed month's scans (`monthScanRefresh.ts`) and
 * writes the repositories' own rows here; `RoistatService` adds them to the
 * month it reads live. A row is the repository's answer as JSON, BigInt
 * money encoded as «Mijoz qaytishi»'s store encodes it, so a stored month is
 * folded exactly as a live one.
 */

import type { PrismaClient } from '@/generated/prisma/client'

import { decodeCohortPayload, encodeCohortPayload } from './cohortSnapshotRepository'

/** One stored month question, as written. */
export interface StoredMonthScan<T> {
  readonly rows: T
  readonly builtAt: Date
}

/** What the screens read — a seam the service's tests fake. */
export interface MonthScanReader {
  read<T>(key: string): Promise<StoredMonthScan<T> | null>
}

export class MonthScanRepository implements MonthScanReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read<T>(key: string): Promise<StoredMonthScan<T> | null> {
    const row = await this.prisma.monthScan.findUnique({ where: { key }, select: { payload: true, builtAt: true } })
    return row === null ? null : { rows: decodeCohortPayload<T>(row.payload), builtAt: row.builtAt }
  }

  /** When each stored question was last built. */
  async builtAt(): Promise<Map<string, Date>> {
    const rows = await this.prisma.monthScan.findMany({ select: { key: true, builtAt: true } })
    return new Map(rows.map((row) => [row.key, row.builtAt]))
  }

  /** One upsert per question — the row is the whole answer, replaced each time. */
  async write(key: string, value: unknown, builtAt: Date, ms: number): Promise<void> {
    const payload = encodeCohortPayload(value) as object
    await this.prisma.monthScan.upsert({
      where: { key },
      create: { key, payload, builtAt, ms },
      update: { payload, builtAt, ms },
    })
  }
}
