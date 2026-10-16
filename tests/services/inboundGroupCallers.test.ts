import { describe, expect, it } from 'vitest'

import type { InboundCall } from '@/server/domain/calls/inboundCalls'

// The service module pulls `callQuality` and `ttlCache`, whose logger reads `env` lazily; set it as the siblings do.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InboundCallsService } = await import('@/server/services/inboundCallsService')
const { resolvePeriod } = await import('@/server/domain/period/period')

const at = (hhmm: string) => new Date(`2026-09-21T${hhmm}:00Z`)
const call = (phone: string | null, start: string, durationSec: number, customerId: string | null): InboundCall => ({
  phone,
  startedAt: at(start),
  durationSec,
  customerId,
  day: '2026-09-21',
  operator: 'Aziza',
})

describe('InboundCallsService.callers', () => {
  it('lists a group tile number by number, with the contact and the callback', async () => {
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-09-21T00:00:00Z'),
      customEnd: new Date('2026-09-21T00:00:00Z'),
    })
    const asked: { key: string; after: Date }[][] = []
    const service = new InboundCallsService(
      {
        inboundCalls: async () => [
          call('+998901110001', '05:00', 0, 'c1'),
          call('+998901110001', '05:10', 0, 'c1'),
          call('+998901110002', '06:00', 45, 'c2'),
          call(null, '07:00', 0, null),
          // Not fresh: an old contact.
          call('+998901110009', '08:00', 0, 'old'),
        ],
        outboundByDay: async () => new Map(),
        contactHistories: async () =>
          new Map([
            ['c1', { createdAt: at('05:00'), deals: [] }],
            ['c2', { createdAt: at('06:01'), deals: [] }],
            ['old', { createdAt: new Date('2026-01-01T00:00:00Z'), deals: [] }],
          ]),
        outboundTo: async (pairs: readonly { key: string; after: Date }[]) => {
          asked.push([...pairs])
          return [
            { key: '901110001', startedAt: at('05:20'), durationSec: 0, operator: 'Bekzod' },
            { key: '901110001', startedAt: at('05:40'), durationSec: 30, operator: 'Bekzod' },
          ]
        },
        contactCards: async () => new Map([['c1', { name: 'Malika', bitrixId: '501' }]]),
      } as never,
      'Asia/Tashkent',
    )

    const r = await service.callers(period, 'fresh', at('09:00'))
    // A number with no digits is on the list but asked about by nobody.
    expect(asked).toEqual([
      [
        { key: '901110001', after: at('05:10') },
        { key: '901110002', after: at('06:00') },
      ],
    ])
    expect(r.group).toBe('fresh')
    expect(r.rows.map((x) => [x.key, x.calls, x.talked, x.talkSec, x.callback?.attempts ?? 0])).toEqual([
      ['901110001', 2, false, 0, 2],
      ['901110002', 1, true, 45, 0],
      ['#3', 1, false, 0, 0],
    ])
    expect(r.rows[0]).toMatchObject({
      phone: '+998901110001',
      tel: '+998901110001',
      contact: { name: 'Malika', bitrixId: '501' },
      firstCallAt: at('05:00').toISOString(),
      callback: { talked: true, operator: 'Bekzod', at: at('05:40').toISOString() },
    })
    expect(r.rows[1]!.contact).toBeNull()
    expect(r.rows[2]).toMatchObject({ phone: null, tel: null, callback: null })
  })
})
