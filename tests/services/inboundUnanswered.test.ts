import { describe, expect, it } from 'vitest'

import type { InboundCall } from '@/server/domain/calls/inboundCalls'

// The service module pulls `callQuality` and `ttlCache`, whose logger reads `env` lazily; set it as the siblings do.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InboundCallsService } = await import('@/server/services/inboundCallsService')
const { resolvePeriod } = await import('@/server/domain/period/period')

const at = (hhmm: string) => new Date(`2026-09-20T${hhmm}:00Z`)
const call = (phone: string, start: string, durationSec: number, customerId: string | null): InboundCall => ({
  phone,
  startedAt: at(start),
  durationSec,
  customerId,
  day: '2026-09-20',
  operator: 'Aziza',
})

describe('InboundCallsService.unanswered', () => {
  it('lists who never got through, waiting first, with the contact and the callback', async () => {
    const period = resolvePeriod('custom', {
      timeZone: 'Asia/Tashkent',
      customStart: new Date('2026-09-20T00:00:00Z'),
      customEnd: new Date('2026-09-20T00:00:00Z'),
    })
    const asked: { key: string; after: Date }[][] = []
    const service = new InboundCallsService(
      {
        inboundCalls: async () => [
          call('+998901110001', '05:00', 0, 'c1'), // rung back and reached
          call('+998901110002', '06:00', 0, 'c2'), // rung back, no answer
          call('+998901110003', '07:00', 0, null), // nobody rang back
          call('+998901110004', '08:00', 30, 'c4'), // talked: not on the list
        ],
        outboundByDay: async () => new Map(),
        contactHistories: async () => new Map(),
        outboundTo: async (pairs: readonly { key: string; after: Date }[]) => {
          asked.push([...pairs])
          return [
            { key: '901110001', startedAt: at('05:30'), durationSec: 45, operator: 'Bekzod' },
            { key: '901110002', startedAt: at('06:30'), durationSec: 0, operator: 'Bekzod' },
            // Before the caller's call: no callback.
            { key: '901110003', startedAt: at('06:59'), durationSec: 60, operator: 'Bekzod' },
          ]
        },
        contactCards: async () =>
          new Map([
            ['c1', { name: 'Malika', bitrixId: '501' }],
            ['c2', { name: 'Aziz', bitrixId: '502' }],
          ]),
      } as never,
      'Asia/Tashkent',
    )

    const r = await service.unanswered(period)
    // Each number is asked about after its OWN latest call.
    expect(asked).toEqual([
      [
        { key: '901110001', after: at('05:00') },
        { key: '901110002', after: at('06:00') },
        { key: '901110003', after: at('07:00') },
      ],
    ])
    expect(r.rows.map((x) => [x.key, x.callback?.talked ?? null])).toEqual([
      ['901110003', null],
      ['901110002', false],
      ['901110001', true],
    ])
    expect(r.rows[2]!.contact).toEqual({ name: 'Malika', bitrixId: '501' })
    expect(r.rows[0]!.contact).toBeNull()
    expect(r).toMatchObject({ waiting: 1, calledBack: 2, reached: 1 })
  })
})
