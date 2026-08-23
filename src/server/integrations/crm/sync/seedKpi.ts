/**
 * KPI target generation.
 *
 * KPI targets are OUR data, not the CRM's. They are goals the business sets,
 * so they are not imported through a provider — they are created here for the
 * demo, and will be managed through the admin UI for real use.
 *
 * Deterministic, from the same seed as the demo dataset, so targets stay
 * consistent with the deals they are measured against.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { calendarMonth } from '@/server/domain/period/period'
import { Rng } from '@/server/integrations/crm/demo/rng'

/** Months of KPI history to generate, ending with the current month. */
const MONTHS = 6

/**
 * Create monthly revenue and deals-won targets for every active employee.
 *
 * Targets are derived from what the employee actually achieved in the matching
 * period, scaled by a per-employee ambition factor. That produces a realistic
 * spread — some people comfortably ahead, some behind — rather than everyone
 * landing on a suspiciously identical percentage.
 *
 * @returns the number of KPI rows written.
 */
export async function seedKpiTargets(
  prisma: PrismaClient,
  seed: number,
  timeZone: string,
): Promise<number> {
  const rng = new Rng(seed ^ 0x5f3759df)

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  if (employees.length === 0) return 0

  const now = new Date()
  let written = 0

  /**
   * Window boundaries are part of the KPI's natural key, so changing how they
   * are computed orphans every previously generated row rather than updating
   * it — they simply stop matching the upsert key and accumulate alongside the
   * new ones. That happened once already, when these windows moved from UTC to
   * the app timezone: target count silently doubled from 156 to 312, and the
   * containment lookup then matched both the stale and the fresh window.
   *
   * So the seed takes ownership of the span it generates: anything inside it
   * that is not one of this run's windows is removed first. Scoped to the
   * generated span only, and only ever reached from the demo seed — real KPI
   * targets are set by the business through the admin UI, not by this script.
   */
  const ownedWindows = Array.from({ length: MONTHS }, (_, i) =>
    calendarMonth(now, timeZone, -(MONTHS - 1 - i)),
  )
  const spanStart = ownedWindows[0]!.start
  const spanEnd = ownedWindows.at(-1)!.end

  await prisma.kpi.deleteMany({
    where: {
      periodStart: { gte: spanStart, lt: spanEnd },
      NOT: ownedWindows.map((w) => ({
        periodStart: w.start,
        periodEnd: w.end,
      })),
    },
  })

  for (let monthsAgo = MONTHS - 1; monthsAgo >= 0; monthsAgo--) {
    // Built in the app timezone, so a KPI month lines up exactly with a
    // reporting month. Using Date.UTC here shifts the window five hours and
    // makes it overlap the neighbouring month.
    const { start: periodStart, end: periodEnd } = calendarMonth(now, timeZone, -monthsAgo)

    for (const employee of employees) {
      // Base the target on real achievement in the window, so it is neither
      // trivially met nor impossible.
      const achieved = await prisma.deal.aggregate({
        where: {
          employeeId: employee.id,
          status: 'WON',
          closedAt: { gte: periodStart, lt: periodEnd },
        },
        _sum: { amountMinor: true },
        _count: { _all: true },
      })

      const actualRevenue = achieved._sum.amountMinor ?? 0n
      const actualDeals = achieved._count._all

      // Ambition between 85% and 130% of what actually happened.
      const ambitionBp = BigInt(rng.int(8_500, 13_000))

      const revenueTarget =
        actualRevenue > 0n
          ? (actualRevenue * ambitionBp) / 10_000n
          : // Fallback for a quiet month, so the target is still meaningful.
            BigInt(rng.int(40, 120)) * 1_000_000_00n

      const dealsTarget = Math.max(1, Math.round((actualDeals || 3) * (Number(ambitionBp) / 10_000)))

      const common = {
        employeeId: employee.id,
        period: 'MONTH' as const,
        periodStart,
        periodEnd,
        isActive: true,
      }

      // Upsert on the same natural key the schema enforces, so re-seeding
      // updates rather than duplicating.
      await prisma.kpi.upsert({
        where: {
          employeeId_metric_periodStart_periodEnd: {
            employeeId: employee.id,
            metric: 'REVENUE',
            periodStart,
            periodEnd,
          },
        },
        create: { ...common, metric: 'REVENUE', targetValue: revenueTarget },
        update: { targetValue: revenueTarget },
      })

      await prisma.kpi.upsert({
        where: {
          employeeId_metric_periodStart_periodEnd: {
            employeeId: employee.id,
            metric: 'DEALS_WON',
            periodStart,
            periodEnd,
          },
        },
        create: { ...common, metric: 'DEALS_WON', targetValue: BigInt(dealsTarget) },
        update: { targetValue: BigInt(dealsTarget) },
      })

      written += 2
    }
  }

  return written
}
