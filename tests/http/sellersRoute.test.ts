import { describe, expect, it, vi } from 'vitest'

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
  it('medals, records, faktTrend va sources — toʻrttalasi ham qabul qilinadi', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/app/api/v1/analytics/sellers/route.ts', 'utf8'),
    )
    expect(source).toContain(`z.enum(['records', 'faktTrend', 'medals', 'sources'])`)
    expect(source).toContain(`ctx.query.include === 'medals'`)
    expect(source).toContain(`ctx.query.include === 'sources'`)
  })
})

/**
 * THE META BLOCK NAMES THE WINDOW AND NO COMPARISON — 2026-10-06.
 *
 * Nothing on this route reads `ctx.comparison` since the board's FAKT 2 trend
 * went, so `periodMeta`'s comparison window — and the «Taqqoslash davri
 * qisqartirildi» chip `PageShell` prints off its truncation flag — would tell
 * the television and Savdo dinamikasi about a comparison neither of them shows.
 */
describe('the sellers route’s meta', () => {
  it('sends the period alone, on every include', async () => {
    /*
      The handler itself, called past the gate: `getHandler` hands back the
      inner function, and every service answer is a stub, so the test reads
      the `meta` the route actually returns rather than its source text.
    */
    vi.doMock('@/server/http/handler', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/server/http/handler')>()),
      getHandler: (_access: unknown, _schema: unknown, handle: unknown) => handle,
    }))
    vi.doMock('@/server/services/container', () => ({
      sellerBoardService: {
        board: async () => 'board',
        records: async () => 'records',
        faktTrend: async () => 'faktTrend',
        sources: async () => 'sources',
        medals: async () => 'medals',
      },
    }))
    const { GET } = (await import('@/app/api/v1/analytics/sellers/route')) as unknown as {
      GET: (ctx: unknown) => Promise<{ data: unknown; meta: Record<string, unknown> }>
    }

    for (const include of [undefined, 'records', 'faktTrend', 'sources', 'medals']) {
      const { data, meta } = await GET({
        query: { preset: 'this_month', basis: 'queue', include },
        currency: 'UZS',
        timeZone: 'Asia/Tashkent',
        now: new Date('2026-10-06T07:00:00Z'),
      })

      expect(data).toBe(include ?? 'board')
      expect(Object.keys(meta)).toEqual(['period'])
    }
  })
})
