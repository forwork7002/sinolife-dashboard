import type { PrismaClient } from '@/generated/prisma/client'
import type { DatedRate, UsdRateStore } from '@/server/integrations/cbu/cbuRates'

/** A `YYYY-MM-DD` as the UTC-midnight Date a `@db.Date` column wants. */
function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

const rateOf = (micro: bigint): number => Number(micro) / 1_000_000

/** `usd_rate` — the bank's answers, kept past the process (`CbuUsdRates`). */
export class UsdRateRepository implements UsdRateStore {
  constructor(private readonly prisma: PrismaClient) {}

  async read(days: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const rows = await this.prisma.usdRate.findMany({
      where: { day: { in: days.map(dateOf) } },
      select: { day: true, rateMicro: true },
    })
    return new Map(rows.map((r) => [dayOf(r.day), rateOf(r.rateMicro)]))
  }

  async latestOnOrBefore(day: string): Promise<DatedRate | null> {
    const row = await this.prisma.usdRate.findFirst({
      where: { day: { lte: dateOf(day) } },
      orderBy: { day: 'desc' },
      select: { day: true, rateMicro: true },
    })
    return row ? { day: dayOf(row.day), rate: rateOf(row.rateMicro) } : null
  }

  async write(day: string, rate: number): Promise<void> {
    const rateMicro = BigInt(Math.round(rate * 1_000_000))
    await this.prisma.usdRate.upsert({
      where: { day: dateOf(day) },
      create: { day: dateOf(day), rateMicro, source: 'cbu' },
      update: { rateMicro, source: 'cbu', fetchedAt: new Date() },
    })
  }
}
