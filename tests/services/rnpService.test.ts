import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

/*
  The service's memos keep the clock they were made with (`Date.now`), so the
  one a test moves is in place before the module loads; unmoved, it is real.
*/
const realNow = Date.now.bind(Date)
let movedNow: number | null = null
vi.spyOn(Date, 'now').mockImplementation(() => movedNow ?? realNow())

const { staleWhileRevalidate, monthDays } = await import('@/server/services/rnpService')

/** Lets every pending callback run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/*
  The registration desk's closed days are a 7–10 s read on production, so a
  reader past the half hour must be handed the old answer, not made to wait.
*/
describe('staleWhileRevalidate', () => {
  it('builds once, serves the old answer after the ttl while rebuilding, then the new one', async () => {
    let now = 0
    let builds = 0
    const memo = staleWhileRevalidate<number>(1_000, () => now)
    const build = () => Promise.resolve(++builds)

    expect(await memo.get('k', build)).toBe(1)
    expect(await memo.get('k', build)).toBe(1)
    now = 1_500
    expect(await memo.get('k', build)).toBe(1) // stale, handed back at once
    expect(builds).toBe(2) // …while the rebuild ran
    await Promise.resolve()
    expect(await memo.get('k', build)).toBe(2)
  })

  it('waits for a fresh build once the answer is older than the hard limit', async () => {
    let now = 0
    let builds = 0
    const memo = staleWhileRevalidate<number>(1_000, () => now, 10_000)
    const build = () => Promise.resolve(++builds)
    expect(await memo.get('k', build)).toBe(1)
    now = 5_000
    expect(await memo.get('k', build)).toBe(1) // stale but young enough
    await Promise.resolve()
    now = 20_000
    expect(await memo.get('k', build)).toBe(3) // too old: built in the open
  })

  it('keeps the old answer when a rebuild fails, and forgets a first build that failed', async () => {
    let now = 0
    const memo = staleWhileRevalidate<number>(1_000, () => now)
    expect(await memo.get('k', () => Promise.resolve(7))).toBe(7)
    now = 2_000
    expect(await memo.get('k', () => Promise.reject(new Error('timeout')))).toBe(7)
    await Promise.resolve()
    expect(await memo.get('k', () => Promise.resolve(8))).toBe(7)

    await expect(memo.get('x', () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(await memo.get('x', () => Promise.resolve(1))).toBe(1)
  })

  it('reports a rebuild that failed behind a reader — nobody else would hear of it (2026-10-02)', async () => {
    let now = 0
    const failures: [string, unknown][] = []
    const memo = staleWhileRevalidate<number>(1_000, () => now, Infinity, (key, error) => failures.push([key, error]))
    expect(await memo.get('k', () => Promise.resolve(7))).toBe(7)
    now = 2_000
    const timeout = new Error('canceling statement due to statement timeout')
    expect(await memo.get('k', () => Promise.reject(timeout))).toBe(7)
    await flush()
    expect(failures).toEqual([['k', timeout]])
    expect(await memo.get('k', () => Promise.resolve(8))).toBe(7) // still the old answer; this read rebuilds
  })

  it('refresh: the warmer’s real rebuild, waited for — a reader meanwhile shares it — and a failed one rejects (2026-10-02)', async () => {
    let now = 0
    const failures: unknown[] = []
    const memo = staleWhileRevalidate<number>(60_000, () => now, Infinity, (_key, error) => failures.push(error))
    expect(memo.has('k')).toBe(false)
    await memo.refresh('k', () => Promise.resolve(1)) // nothing to hand out yet: a first build
    expect(memo.has('k')).toBe(true)
    now = 1_000 // fresh by the ttl, rebuilt anyway
    await memo.refresh('k', () => Promise.resolve(2))
    expect(await memo.get('k', () => Promise.resolve(99))).toBe(2)

    now = 70_000
    let release!: (value: number) => void
    let warmed = false
    const tick = memo.refresh('k', () => new Promise<number>((resolve) => (release = resolve))).then(() => (warmed = true))
    await flush()
    expect(warmed).toBe(false) // it waits for the build
    let readerBuilds = 0
    expect(await memo.get('k', () => Promise.resolve(++readerBuilds))).toBe(2) // stale, but the rebuild is on its way
    expect(readerBuilds).toBe(0)
    release(3)
    await tick
    expect(await memo.get('k', () => Promise.resolve(99))).toBe(3)

    await expect(memo.refresh('k', () => Promise.reject(new Error('timeout')))).rejects.toThrow('timeout')
    expect(await memo.get('k', () => Promise.resolve(99))).toBe(3)
    expect(failures).toEqual([]) // the warmer logs its own failure
  })

  it('refresh while a reader’s first build runs waits for that build — never a second one beside it', async () => {
    let now = 0
    let builds = 0
    const memo = staleWhileRevalidate<number>(60_000, () => now, 10 * 60_000)
    let release!: (value: number) => void
    const reading = memo.get('k', () => {
      builds++
      return new Promise<number>((resolve) => (release = resolve))
    })
    let warmed = false
    const tick = memo.refresh('k', () => Promise.resolve(++builds)).then(() => (warmed = true))
    now = 61_000 // a slow first build: a reader past the ttl shares it too
    const late = memo.get('k', () => Promise.resolve(++builds))
    await flush()
    expect(builds).toBe(1)
    expect(warmed).toBe(false)
    release(1)
    await tick
    expect([await reading, await late]).toEqual([1, 1])
  })
})

const { RnpService } = await import('@/server/services/rnpService')
const { logger } = await import('@/server/logging/logger')

const TZ = 'Asia/Tashkent'
/** 10:00 in Tashkent, 2 October 2026. */
const T0 = Date.parse('2026-10-02T05:00:00Z')

/**
 * The service over fakes that answer nothing; `scan` stands for a month's
 * scans — told the month, it may hold the build open or fail it.
 */
function serviceOver(scan: (month: string) => Promise<void>) {
  const none = async () => []
  const repository = {
    leadDays: async (from: string) => {
      await scan(from.slice(0, 7))
      return []
    },
    registrationDays: none,
    registrarKvalDays: none,
    callDays: none,
    warehouseDays: none,
    teams: async () => [{ rop: 'Sevinch', head: 'S' }],
    plans: async () => ({ rows: [], fakt: [] }),
    manualCosts: none,
    manualHeadcount: none,
  }
  const usd = { forDays: async (days: readonly string[]) => days.map(() => 12_000) }
  return new RnpService({ rnpTeamDays: none } as never, repository as never, { campaignDays: none } as never, usd)
}

const read = (service: ReturnType<typeof serviceOver>, month: string) =>
  service.overview({ month, timeZone: TZ, now: new Date(Date.now()), canEditPlans: false })

/** Whether a read is answered at once — not waiting on a build held open. */
const servedAtOnce = (reading: Promise<unknown>) =>
  Promise.race([reading.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))])

describe('RnpService — the month memo (2026-10-02)', () => {
  afterEach(() => {
    movedNow = null
  })

  it('serves a month that ended before today at once 31 minutes later, and rebuilds it behind the reader', async () => {
    const scans: string[] = []
    let hold = Promise.resolve()
    const service = serviceOver((month) => {
      scans.push(month)
      return hold
    })
    movedNow = T0
    await read(service, '2026-07')
    movedNow = T0 + 31 * 60_000
    let release!: () => void
    hold = new Promise((resolve) => (release = resolve))
    expect(await servedAtOnce(read(service, '2026-07'))).toBe(true)
    expect(scans).toEqual(['2026-07', '2026-07']) // …while it was rebuilt behind the reader
    release()
  })

  it('still holds the month that has today to its half hour: past it, the reader waits for a fresh build', async () => {
    let hold = Promise.resolve()
    const service = serviceOver(() => hold)
    movedNow = T0
    await read(service, '2026-10')
    movedNow = T0 + 31 * 60_000
    let release!: () => void
    hold = new Promise((resolve) => (release = resolve))
    const reading = read(service, '2026-10')
    expect(await servedAtOnce(reading)).toBe(false)
    release()
    await reading
  })

  it('logs a rebuild that failed behind a reader, who is still served the previous answer', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const timeout = new Error('canceling statement due to statement timeout')
    let fail = false
    const service = serviceOver(async () => {
      if (fail) throw timeout
    })
    movedNow = T0
    await read(service, '2026-06')
    movedNow = T0 + 31 * 60_000
    fail = true
    await read(service, '2026-06')
    await flush()
    expect(warn).toHaveBeenCalledWith({ err: timeout, key: '2026-06' }, 'rnp rebuild failed; serving the previous answer')
    warn.mockRestore()
  })

  it('warm(): a real rebuild of the month, waited for; in a month’s first week the last month too, once', async () => {
    const scans: string[] = []
    let hold = Promise.resolve()
    const service = serviceOver((month) => {
      scans.push(month)
      return hold
    })
    const fifthOfMarch = new Date('2027-03-05T05:00:00Z')
    await service.warm(fifthOfMarch, TZ)
    expect(scans).toEqual(['2027-03', '2027-02'])

    // The next tick, the month fresh in the memo: rebuilt anyway and waited for, so «rnp warmed {ms}» is its time.
    let release!: () => void
    hold = new Promise((resolve) => (release = resolve))
    let warmed = false
    const tick = service.warm(fifthOfMarch, TZ).then(() => (warmed = true))
    await flush()
    expect(warmed).toBe(false)
    release()
    await tick
    expect(scans).toEqual(['2027-03', '2027-02', '2027-03']) // the month that ended: once

    // From the 8th the month that ended is left to its readers.
    await service.warm(new Date('2027-05-08T05:00:00Z'), TZ)
    expect(scans.slice(3)).toEqual(['2027-05'])
  })
})

const { leadBrand } = await import('@/server/services/rnpService')

describe('leadBrand', () => {
  it('takes the page first, then the form', () => {
    expect(leadBrand('UC_1X1J24', null)).toBe('Collagen')
    expect(leadBrand('UC_MWIKOC', null)).toBe('Collagen') // collagen.marine, through the ad pages
    expect(leadBrand('UC_AA84D0', null)).toBe('Zextra')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Sinolife Collagen - 30.04 Eldor»')).toBe('Collagen')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Zextra Umar 3»')).toBe('Zextra')
    // Kamron runs only Zextra accounts; his form names no product.
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Kamron 6 etap filt forma 05.07»')).toBe('Zextra')
    expect(leadBrand('UC_KPZA32', null)).toBeNull()
  })

  it('lets a form that names the collagen outrank its owner (2026-10-02)', () => {
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Kamron-collagen 01.10»')).toBe('Collagen')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Kamron Коллаген тест»')).toBe('Collagen')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Kamron-zextra 01.10»')).toBe('Zextra')
  })

  it('takes the «Проект» field before the page and the form (2026-10-06)', () => {
    expect(leadBrand('REPEAT_SALE', null, 'Collagen Marine')).toBe('Collagen')
    expect(leadBrand('REPEAT_SALE', null, 'Sinolife collagen tabletka')).toBe('Collagen')
    expect(leadBrand('UC_1X1J24', null, 'Zextra sure')).toBe('Zextra')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Zextra Umar 3»', 'Collagen Marine')).toBe('Collagen')
    // A project that is neither brand is brandless, not its page's.
    expect(leadBrand('UC_1X1J24', null, 'Kosmetika')).toBeNull()
    // Empty, it decides nothing.
    expect(leadBrand('UC_AA84D0', null, '  ')).toBe('Zextra')
    expect(leadBrand('UC_AA84D0', null, null)).toBe('Zextra')
  })

  it('brands the Sinolife pages added on 2026-10-02, and a form title with no closing quote', () => {
    expect(leadBrand('UC_NBCV5K', null)).toBe('Collagen') // collagen.sinolife
    expect(leadBrand('UC_5JW4YK', null)).toBe('Collagen') // Сммщик sinolifeuz
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы "Sinolifecollgen marine')).toBe('Collagen')
  })
})

describe('monthDays', () => {
  it('lists a month, including a leap February', () => {
    expect(monthDays('2026-09')).toHaveLength(30)
    expect(monthDays('2028-02')).toHaveLength(29)
    expect(monthDays('2026-12').at(-1)).toBe('2026-12-31')
  })
})

describe('RnpService — the Collagen funnel reads Meta views and clicks (2026-10-03)', () => {
  it('passes impressions and clicks through, hiring campaigns left out', async () => {
    const none = async () => []
    const repository = {
      leadDays: none,
      registrationDays: none,
      registrarKvalDays: none,
      callDays: none,
      warehouseDays: none,
      teams: none,
      plans: async () => ({ rows: [], fakt: [] }),
      manualCosts: none,
      manualHeadcount: none,
    }
    const campaign = (o: { campaignName: string; impressions: number; clicks: number }) => ({
      date: '2025-03-10',
      accountId: '1383613729264521', // Collagen marine Eldor
      accountName: 'Collagen marine Eldor',
      campaignId: o.campaignName,
      objective: 'OUTCOME_ENGAGEMENT',
      spendMicroUsd: 1_000_000n,
      leads: 0,
      conversations: 0,
      ...o,
    })
    const reklama = {
      campaignDays: async () => [
        campaign({ campaignName: 'DM', impressions: 5_000, clicks: 70 }),
        campaign({ campaignName: 'EX - Sinolife (vakansiya) - DM', impressions: 900, clicks: 9 }),
      ],
    }
    const usd = { forDays: async (days: readonly string[]) => days.map(() => 12_000) }
    const service = new RnpService({ rnpTeamDays: none } as never, repository as never, reklama as never, usd)
    const sheet = await service.overview({ month: '2025-03', timeZone: TZ, now: new Date(Date.now()), canEditPlans: false })
    const rows = sheet.blocks.find((b) => b.id === 'funnel:collagen')!.rows
    expect(rows.find((r) => r.key === 'fn:collagen:impressions')!.fact).toBe(5_000)
    expect(rows.find((r) => r.key === 'fn:collagen:clicks')!.fact).toBe(70)
  })
})
