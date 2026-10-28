import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { monthReadsWarm } = await import('@/server/services/monthReadsWarmer')
const { OFF_HOURS, WARM_OWNED_TTL_MS } = await import('@/server/services/rnpWarmer')

const TZ = 'Asia/Tashkent'
// 12:00 in Tashkent on 28.10.2026 — inside the working day.
const NOON = new Date('2026-10-28T07:00:00Z')

function harness(fail: (name: string, preset: string) => boolean = () => false) {
  const built: string[] = []
  const read = (name: string) => async (period: { preset: string }, ...rest: unknown[]) => {
    const ttl = rest[rest.length - 1] as number
    built.push(`${name} ${period.preset} ${ttl / 60_000}`)
    if (fail(name, period.preset)) throw new Error(`${name} 57014`)
  }
  const services = {
    insights: { warmCallActivity: read('calls') },
    inboundAnalysis: { warm: read('analysis') },
    reklama: { warm: read('reklama') },
  }
  let now = 0
  const warm = monthReadsWarm(services as never, () => now)
  return { built, warm, tick: (ms: number) => void (now += ms) }
}

describe('monthReadsWarm — the month reads the screens could not build (2026-10-28)', () => {
  it('builds «Shu oy» every tick, each read for two ticks', async () => {
    const { built, warm } = harness()
    await warm(NOON, TZ)
    const ttl = WARM_OWNED_TTL_MS / 60_000
    expect(built).toEqual([`calls this_month ${ttl}`, `analysis this_month ${ttl}`, `reklama this_month ${ttl}`])
  })

  it('adds «Oʻtgan oy» from the second tick, then once an hour, good for two', async () => {
    const { built, warm, tick } = harness()
    await warm(NOON, TZ)
    tick(12 * 60_000)
    await warm(NOON, TZ)
    expect(built.filter((b) => b.includes('previous_month'))).toEqual([
      'calls previous_month 120',
      'analysis previous_month 120',
      'reklama previous_month 120',
    ])
    built.length = 0
    tick(12 * 60_000)
    await warm(NOON, TZ)
    expect(built.some((b) => b.includes('previous_month'))).toBe(false)
    tick(50 * 60_000)
    await warm(NOON, TZ)
    expect(built.filter((b) => b.includes('previous_month'))).toHaveLength(3)
  })

  it('tries every read when one fails, throws the first after, and retries a failed «Oʻtgan oy» on the next tick', async () => {
    let failing = true
    const { built, warm, tick } = harness((name, preset) => failing && name === 'calls')
    await expect(warm(NOON, TZ)).rejects.toThrow('calls 57014')
    expect(built).toHaveLength(3)
    tick(12 * 60_000)
    await expect(warm(NOON, TZ)).rejects.toThrow('calls 57014')
    failing = false
    built.length = 0
    tick(12 * 60_000)
    await warm(NOON, TZ)
    expect(built.filter((b) => b.includes('previous_month'))).toHaveLength(3)
  })

  it('does nothing at night', async () => {
    const { built, warm } = harness()
    expect(await warm(new Date('2026-10-28T20:00:00Z'), TZ)).toBe(OFF_HOURS) // 01:00 in Tashkent
    expect(built).toEqual([])
  })
})
