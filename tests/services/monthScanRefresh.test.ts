import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { dueMonthQuestions, monthScanEvery, refreshMonthScans, storedMonthQuestions, MONTH_SCAN_PER_PASS } = await import(
  '@/server/services/monthScanRefresh'
)

const TZ = 'Asia/Tashkent'
// 10:00 in Tashkent — inside the working day.
const NOW = new Date('2026-10-28T05:00:00Z')

describe('storedMonthQuestions — which closed months the worker keeps', () => {
  it('keeps every closed month from January of last year, the newest first; FAKT for this year and the month just closed', () => {
    const questions = storedMonthQuestions(NOW, TZ)
    const bitrix = questions.filter((q) => q.kind === 'bitrix').map((q) => q.key)
    const fakt = questions.filter((q) => q.kind === 'fakt').map((q) => q.key)
    expect(bitrix[0]).toBe('v1:bitrix:2026-09')
    expect(bitrix.at(-1)).toBe('v1:bitrix:2025-01')
    expect(bitrix).toHaveLength(21)
    expect(fakt).toEqual(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'].map((m) => `v1:fakt:${m}`))
    // The running month is never stored.
    expect(questions.some((q) => q.key.endsWith('2026-10'))).toBe(false)
  })

  it("keeps last December's FAKT in January — «Oʻtgan oy» then — and no other of last year", () => {
    const fakt = storedMonthQuestions(new Date('2027-01-10T05:00:00Z'), TZ).filter((q) => q.kind === 'fakt')
    expect(fakt.map((q) => q.key)).toEqual(['v1:fakt:2026-12'])
  })
})

describe('monthScanEvery / dueMonthQuestions — how often', () => {
  const [september, august] = storedMonthQuestions(NOW, TZ).filter((q) => q.kind === 'bitrix')

  it('reads a month whose sales still open every half hour of the working day, three hours at night; an older one twice a day', () => {
    expect(monthScanEvery(september!.month, NOW)).toBe(30 * 60_000)
    expect(monthScanEvery(september!.month, new Date('2026-10-28T20:00:00Z'))).toBe(3 * 3_600_000)
    expect(monthScanEvery(august!.month, NOW)).toBe(12 * 3_600_000)
  })

  it('is due when missing or older than its cadence, and only then', () => {
    const built = new Map([
      [september!.key, new Date(NOW.getTime() - 10 * 60_000)],
      [august!.key, new Date(NOW.getTime() - 13 * 3_600_000)],
    ])
    const due = dueMonthQuestions(storedMonthQuestions(NOW, TZ), built, NOW).map((q) => q.key)
    expect(due).not.toContain(september!.key)
    expect(due).toContain(august!.key)
    expect(due).toContain('v1:fakt:2026-09')
  })
})

describe('refreshMonthScans — one month at a time, at most a few a pass', () => {
  it('reads the newest due months, widest scan brand-keyed, under its own limit, and stores them as of the read', async () => {
    const statements: string[] = []
    const written: { key: string; builtAt: Date; rows: number }[] = []
    const run = async (sql: string) => {
      statements.push(sql)
      return []
    }
    const prisma = {
      monthScan: {
        findMany: async () => [],
        upsert: async ({ create }: { create: { key: string; builtAt: Date; payload: unknown[] } }) => {
          written.push({ key: create.key, builtAt: create.builtAt, rows: create.payload.length })
        },
      },
      $queryRawUnsafe: run,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ $executeRawUnsafe: async (sql: string) => statements.push(sql), $queryRawUnsafe: run }),
    }
    let tick = 0
    const now = () => new Date(NOW.getTime() + 1000 * tick++)
    const result = await refreshMonthScans({ prisma: prisma as never, timeZone: TZ, stopping: () => false, now })
    expect(result.failed).toEqual([])
    expect(written.map((w) => w.key)).toEqual([
      'v1:bitrix-days:2026-09',
      'v1:bitrix:2026-09',
      'v1:fakt:2026-09',
      'v1:bitrix-days:2026-08',
      'v1:bitrix:2026-08',
    ])
    expect(MONTH_SCAN_PER_PASS).toBe(3)
    expect(statements.filter((s) => s.startsWith('SET LOCAL statement_timeout = 300000'))).toHaveLength(MONTH_SCAN_PER_PASS)
    // The widest read: every grouping set, the brand inputs in each.
    expect(statements.some((s) => s.includes('GROUPING SETS ((b_source') && s.includes('(registrar, b_source'))).toBe(true)
    // `builtAt` is the instant the read began — what the screen relies on.
    expect(written[0]!.builtAt.getTime()).toBe(NOW.getTime() + 1000)
  })
})
