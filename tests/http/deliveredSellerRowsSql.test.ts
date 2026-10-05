import { describe, expect, it } from 'vitest'

/* `env` is read at module scope; a unit test about SQL shape has no database. */
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The payroll's FAKT 2 (the client, 2026-10-05: «yetkazilgan sana»): the board's
 * FAKT 2 dated by the delivery instead of the queue arrival — so everything but
 * the date has to stay the board's.
 */
function capture() {
  const calls: { sql: string; params: unknown[] }[] = []
  const prisma = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params })
      return [
        {
          employee_id: 'e1',
          full_name: 'Seller One',
          rop: 'Sevinch',
          last_at: new Date('2026-09-20T10:00:00Z'),
          orders: 3n,
          delivered: '450000000',
        },
      ]
    },
  }
  return { calls, repository: new InsightsRepository(prisma as never) }
}

const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

describe('deliveredSellerRows', () => {
  const window = { start: new Date('2026-09-01T00:00:00+05:00'), end: new Date('2026-10-01T00:00:00+05:00') }

  it('dates FAKT 2 by the last entry into a delivery stage, inside the window', async () => {
    const { calls, repository } = capture()
    await repository.deliveredSellerRows(window)
    const sql = bare(calls[0]!.sql)
    expect(calls[0]!.params).toEqual([window.start, window.end])
    expect(sql).toContain('max(h."enteredAt") AS delivered_at')
    expect(sql).toContain(`s."logisticsRole" = 'DELIVERED'`)
    expect(sql).toContain('HAVING max(h."enteredAt") < $2')
  })

  it('bounds the history scan on the LEFT only — a right bound there would pay a re-delivered deal twice', async () => {
    const { calls, repository } = capture()
    await repository.deliveredSellerRows(window)
    const sql = bare(calls[0]!.sql)
    const scan = sql.slice(sql.indexOf('WITH delivered AS'), sql.indexOf('GROUP BY h."dealId"'))
    expect(scan).toContain('h."enteredAt" >= $1')
    expect(scan).not.toContain('< $2')
  })

  it('falls back to closedAt only for a WON deal with no delivery row in its history', async () => {
    const { calls, repository } = capture()
    await repository.deliveredSellerRows(window)
    const sql = bare(calls[0]!.sql)
    expect(sql).toContain('d."closedAt" >= $1 AND d."closedAt" < $2')
    expect(sql).toMatch(/d\."status" = 'WON'[\s\S]*NOT EXISTS[\s\S]*s2\."logisticsRole" = 'DELIVERED'/)
  })

  it('keeps the board’s FAKT 2 otherwise: current delivery stage, queue members, operator, deal team', async () => {
    const { calls, repository } = capture()
    await repository.deliveredSellerRows(window)
    const sql = bare(calls[0]!.sql)
    // The deal stands in a delivery stage NOW — a bounced parcel is not delivered money.
    expect(sql).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    // Passed through the confirmation queue, as the board's cohort.
    expect(sql).toContain(`qs."confirmationSignal" = 'CONFIRM_NEW'`)
    expect(sql).toContain('COALESCE(d."operatorEmployeeId", d."employeeId")')
    expect(sql).toContain('d."operatorTeamSource"')
    expect(sql).toContain('d."countsAsRevenue"')
  })

  it('returns rating-shaped rows the team fold can read', async () => {
    const { repository } = capture()
    const [row] = await repository.deliveredSellerRows(window)
    expect(row).toMatchObject({
      employeeId: 'e1',
      rop: 'Sevinch',
      deliveredOrders: 3,
      deliveredMinor: 450_000_000n,
      confirmedMinor: 0n,
      lastQueuedAt: new Date('2026-09-20T10:00:00Z'),
    })
  })
})
