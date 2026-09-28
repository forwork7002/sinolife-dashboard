import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { dayEnds, notPackedAt } = await import('@/server/repositories/rnpRepository')

/*
  «Не собран» — an order standing in a packing stage when the Tashkent day
  ends. Computed in TypeScript from the stays, because the statement that
  did it per day in SQL ran 9–77 s on production.
*/
describe('dayEnds', () => {
  it('ends each day at Tashkent midnight, today at now, and skips days not begun', () => {
    const now = new Date('2026-09-28T06:00:00Z') // 11:00 in Tashkent
    const ends = dayEnds('2026-09-27', '2026-09-30', 'Asia/Tashkent', now)
    expect(ends).toEqual([
      { day: '2026-09-27', end: new Date('2026-09-27T19:00:00Z') },
      { day: '2026-09-28', end: now },
    ])
  })
})

describe('notPackedAt', () => {
  const end21 = new Date('2026-09-21T19:00:00Z')
  const end22 = new Date('2026-09-22T19:00:00Z')

  it('counts a stay that began before the instant and had not left by it', () => {
    const stays = [
      { dealId: 'a', enteredAt: new Date('2026-09-21T10:00:00Z'), leftAt: null },
      // Left at 02:00 on the 22nd (Tashkent): still standing when the 21st ended.
      { dealId: 'b', enteredAt: new Date('2026-09-21T10:00:00Z'), leftAt: new Date('2026-09-21T21:00:00Z') },
      // Left before the day ended.
      { dealId: 'c', enteredAt: new Date('2026-09-21T10:00:00Z'), leftAt: new Date('2026-09-21T12:00:00Z') },
    ]
    expect(notPackedAt(stays, [end21, end22])).toEqual([2, 1])
  })

  it('counts an order once however many packing stages it stands in', () => {
    const stays = [
      { dealId: 'a', enteredAt: new Date('2026-09-21T10:00:00Z'), leftAt: new Date('2026-09-21T11:00:00Z') },
      { dealId: 'a', enteredAt: new Date('2026-09-21T11:00:00Z'), leftAt: null },
      { dealId: 'a', enteredAt: new Date('2026-09-21T11:00:00Z'), leftAt: null },
    ]
    expect(notPackedAt(stays, [end21])).toEqual([1])
  })
})
