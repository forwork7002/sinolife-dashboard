import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

/**
 * `?include=` ning qiymatlari — schema darajasida.
 *
 * Yangi qiymat qo'shilganda eskilari joyida turishi kerak: `records` ni
 * rekord devori, `faktTrend` ni Savdo dinamikasining hero grafigi o'qiydi,
 * va ikkalasi ham shu marshrutdan boshqa manzilni bilmaydi.
 */
describe('sellers marshrutining include parametri', () => {
  it('medals, records va faktTrend — uchalasi ham qabul qilinadi', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/app/api/v1/analytics/sellers/route.ts', 'utf8'),
    )
    expect(source).toContain(`z.enum(['records', 'faktTrend', 'medals'])`)
    expect(source).toContain(`ctx.query.include === 'medals'`)
  })
})
