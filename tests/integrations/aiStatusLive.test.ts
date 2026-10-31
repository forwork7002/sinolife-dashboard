import { describe, expect, it } from 'vitest'

import { aiStatusSchema } from '@/server/integrations/aiRegistrator/control'
import type { AiRegistratorControlRepository } from '@/server/repositories/aiRegistratorControlRepository'
import { AiRegistratorControlService } from '@/server/services/aiRegistratorControlService'

/**
 * «AI registrator → Boshqaruv» live (2026-10-31): the report's `live` part and
 * the sellers' product / aiRinging — `ai_registrator/app/telephony/live.py`.
 * The newest part of the report may not fail it. Fake names and deals only.
 */

const call = (over: Record<string, unknown> = {}) => ({
  line: '291',
  deal: 1001,
  product: 'Kollagen',
  client: 'Aziz',
  test: false,
  state: 'talking',
  since: '2026-10-31T05:42:00+00:00',
  seller: null,
  ...over,
})

const event = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-31T05:40:00+00:00',
  line: '293',
  deal: 1002,
  product: 'Zekstra',
  client: 'Bobur',
  test: true,
  what: 'connected',
  seller: '120',
  ...over,
})

const report = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-31T05:42:10.123456+00:00',
  appliedVersion: 3,
  applyError: null,
  limits: { calls: 6, maxNew: 4, maxRetry: 2, saleHandoff: 'refer', maxSipLegs: 10, fused: false },
  lines: { '178': 'free', '291': 'call' },
  sellers: [{ ext: '120', name: 'Dilnoza', state: 'busy', inList: true, transfersToday: 2, product: 'Kollagen', aiRinging: true }],
  live: { lines: [call()], recent: [event()] },
  today: { calls: 10, answered: 6, transferred: 2, transferFailed: 1, atsRejected: 0 },
  ...over,
})

const parse = (body: unknown) => aiStatusSchema.parse(body)

describe('aiStatusSchema — live', () => {
  it('keeps the live calls, the feed and the sellers\' product and ringing', () => {
    const r = parse(report())
    expect(r.live?.lines).toEqual([call()])
    expect(r.live?.recent[0]).toMatchObject({ what: 'connected', seller: '120', test: true, product: 'Zekstra' })
    expect(r.sellers[0]).toMatchObject({ product: 'Kollagen', aiRinging: true })
  })

  it('drops one wrong element and keeps the rest of the report', () => {
    const r = aiStatusSchema.safeParse(
      report({
        live: {
          lines: [call({ since: 'yesterday' }), call({ line: '292', state: 'dialing' }), 'garbage', call({ line: '' })],
          recent: [event({ what: 'Not A Word!' }), event({ line: '290' })],
        },
      }),
    )
    expect(r.success).toBe(true)
    expect(r.data?.live?.lines.map((c) => c.line)).toEqual(['292'])
    expect(r.data?.live?.recent.map((e) => e.line)).toEqual(['290'])
    expect(r.data?.limits.calls).toBe(6)
    expect(r.data?.sellers).toHaveLength(1)
  })

  it('reads a live that is no live at all as null — the report still stands', () => {
    expect(parse(report({ live: 'garbage' })).live).toBeNull()
    expect(parse(report({ live: { lines: 'x' } })).live).toBeNull()
    expect(parse(report({ live: null })).live).toBeNull()
    expect(parse(report({ live: null })).today.calls).toBe(10)
  })

  it('takes the report of an agent before live (the shape on prod 31.10)', () => {
    const { live: _live, ...old } = report()
    const r = parse({ ...old, sellers: [{ ext: '122', name: 'Dilnoza', state: 'free', inList: true, transfersToday: 0 }] })
    expect(r.live).toBeNull()
    expect(r.sellers[0]).toMatchObject({ product: null, aiRinging: false })
  })

  it('never refuses a report over a seller\'s product or ringing flag', () => {
    const r = parse(report({ sellers: [{ ext: '120', name: 'Dilnoza', state: 'free', inList: true, transfersToday: 0, product: 7, aiRinging: 'yes' }] }))
    expect(r.sellers[0]).toMatchObject({ product: null, aiRinging: false })
  })

  it('takes a state or an outcome the panel does not know yet, raw', () => {
    const r = parse(report({ live: { lines: [call({ state: 'on_hold2' })], recent: [event({ what: 'callback_booked' })] } }))
    expect(r.live?.lines[0]?.state).toBe('on_hold2')
    expect(r.live?.recent[0]?.what).toBe('callback_booked')
  })

  it('keeps the bounds: 32 lines, 50 events, a 60-letter name with no digit in it', () => {
    const many = Array.from({ length: 40 }, (_, i) => call({ line: String(300 + i) }))
    const feed = Array.from({ length: 60 }, () => event())
    const r = parse(report({ live: { lines: many, recent: feed } }))
    expect(r.live?.lines).toHaveLength(32)
    expect(r.live?.recent).toHaveLength(50)
    expect(parse(report({ live: { lines: [call({ client: 'A'.repeat(80) })], recent: [] } })).live?.lines[0]?.client).toHaveLength(60)
    expect(parse(report({ live: { lines: [call({ client: 'Aziz +12345' })], recent: [] } })).live?.lines[0]?.client).toBe('Aziz')
  })

  it('defaults what the agent leaves out: no seller, not a test, no live part', () => {
    const r = parse(report({ live: { lines: [{ line: '290', state: 'dialing', since: '2026-10-31T05:42:00+00:00' }] } }))
    expect(r.live?.lines[0]).toMatchObject({ seller: null, test: false, client: '', deal: null, product: null })
    expect(r.live?.recent).toEqual([])
  })
})

describe('the 5 s read', () => {
  it('reads the one status row and nothing else, a row stored before live as the agent sends it now', async () => {
    const reads: string[] = []
    const { live: _live, ...old } = report()
    const stored = { ...old, sellers: [{ ext: '122', name: 'Dilnoza', state: 'free', inList: true, transfersToday: 0 }] }
    const repository = {
      status: async () => {
        reads.push('status')
        return { receivedAt: new Date('2026-10-31T05:42:10Z'), payload: stored }
      },
      config: async () => {
        reads.push('config')
        return null
      },
    } as unknown as AiRegistratorControlRepository
    const service = new AiRegistratorControlService(repository, async () => {
      reads.push('roster')
      return []
    })

    const fresh = await service.live(new Date('2026-10-31T05:43:00Z'))
    expect(reads).toEqual(['status'])
    expect(fresh.staleAfterSec).toBe(90)
    expect(fresh.status).toMatchObject({ receivedAt: '2026-10-31T05:42:10.000Z', stale: false })
    expect(fresh.status?.report.live).toBeNull()
    expect(fresh.status?.report.sellers[0]).toMatchObject({ product: null, aiRinging: false })
    expect((await service.live(new Date('2026-10-31T05:44:00Z'))).status?.stale).toBe(true)
  })
})
