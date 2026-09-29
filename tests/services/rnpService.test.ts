import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { staleWhileRevalidate } = await import('@/server/services/rnpService')

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
})

const { leadBrand } = await import('@/server/services/rnpService')

describe('leadBrand', () => {
  it('takes the page first, then the form', () => {
    expect(leadBrand('UC_1X1J24', null)).toBe('Collagen')
    expect(leadBrand('UC_AA84D0', null)).toBe('Zextra')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Sinolife Collagen - 30.04 Eldor»')).toBe('Collagen')
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Zextra Umar 3»')).toBe('Zextra')
    // Kamron runs only Zextra accounts; his form names no product.
    expect(leadBrand('REPEAT_SALE', 'Заполнение CRM-формы «Kamron 6 etap filt forma 05.07»')).toBe('Zextra')
    expect(leadBrand('UC_KPZA32', null)).toBeNull()
  })
})
