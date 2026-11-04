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

describe('the 2026-11-02 contract (ai_registrator ca9c52a) — optional, never a refusal', () => {
  it('keeps started, events, the presence word and since, the flags and the transfer order', () => {
    const parsed = aiStatusSchema.parse(
      report({
        limits: { calls: 4, transferOrder: 'fewest' },
        sellers: [{ ext: '120', name: 'Malika', state: 'busy', word: 'On the phone', since: '2026-10-31T05:41:00+00:00' }],
        live: { lines: [call({ started: '2026-10-31T05:41:30+00:00' })], recent: [event({ started: '2026-10-31T05:39:20+00:00' })], events: [event({ what: 'no_answer' })] },
        flags: { held: false, no_free_specialist: true, active_calls: 2 },
      }),
    )
    expect(parsed.limits.transferOrder).toBe('fewest')
    expect(parsed.sellers[0]).toMatchObject({ word: 'On the phone', since: '2026-10-31T05:41:00+00:00' })
    expect(parsed.live?.lines[0]?.started).toBe('2026-10-31T05:41:30+00:00')
    expect(parsed.live?.recent[0]?.started).toBe('2026-10-31T05:39:20+00:00')
    expect(parsed.live?.events.map((e) => e.what)).toEqual(['no_answer'])
    expect(parsed.flags).toMatchObject({ held: false, no_free_specialist: true, active_calls: 2 })
  })

  it('reads an older agent — none of them sent — and drops a wrong one without failing the report', () => {
    const old = aiStatusSchema.parse(report())
    expect(old.flags).toBeNull()
    expect(old.live?.events ?? []).toEqual([])
    const wrong = aiStatusSchema.parse(report({ flags: 'yes', sellers: [{ ext: '120', since: 'soon' }], live: { lines: [call({ started: 'later' })], recent: [] } }))
    expect(wrong.flags).toBeNull()
    expect(wrong.sellers[0]?.since).toBeUndefined()
    expect(wrong.live?.lines[0]?.started).toBeUndefined()
  })
})

describe('the stop (2026-11-04) — enabled and flags.stopped, optional', () => {
  it('keeps what the agent applied: stopped, and running', () => {
    const stopped = aiStatusSchema.parse(report({ enabled: false, flags: { stopped: true, held: false } }))
    expect(stopped.enabled).toBe(false)
    expect(stopped.flags).toMatchObject({ stopped: true, held: false })
    const running = aiStatusSchema.parse(report({ enabled: true, flags: { stopped: false } }))
    expect(running.enabled).toBe(true)
    expect(running.flags?.stopped).toBe(false)
  })

  it('reads an agent older than the button — neither sent — and never refuses a wrong one', () => {
    const old = aiStatusSchema.parse(report())
    expect(old.enabled).toBeUndefined()
    const wrong = aiStatusSchema.safeParse(report({ enabled: 'no', flags: { stopped: 'yes', no_specialist: true } }))
    expect(wrong.success).toBe(true)
    expect(wrong.data?.enabled).toBeUndefined()
    expect(wrong.data?.flags).toMatchObject({ no_specialist: true })
    expect(wrong.data?.flags?.stopped).toBeUndefined()
    expect(wrong.data?.limits.calls).toBe(6)
  })
})

describe('«Ish vaqti» (2026-11-04, ai_registrator d0abf97) — hours, optional', () => {
  const hours = { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30', sellersStart: '09:00', sellersEnd: '22:00' }

  it('keeps the hours the agent runs — the lunch null for none', () => {
    expect(parse(report({ hours })).hours).toEqual(hours)
    expect(parse(report({ hours: { ...hours, lunchStart: null, lunchEnd: null } })).hours).toMatchObject({ lunchStart: null, lunchEnd: null })
  })

  it('reads an agent older than the hours, and never refuses a report over them', () => {
    expect(parse(report()).hours).toBeUndefined()
    const odd = aiStatusSchema.safeParse(report({ hours: { ...hours, end: '25:00', lunchStart: 7, extra: 'x' } }))
    expect(odd.success).toBe(true)
    expect(odd.data?.hours).toMatchObject({ start: '09:00', end: null, lunchStart: null, lunchEnd: '13:30' })
    const junk = aiStatusSchema.safeParse(report({ hours: 'always' }))
    expect(junk.success).toBe(true)
    expect(junk.data?.hours).toBeUndefined()
    expect(junk.data?.limits.calls).toBe(6)
    expect(parse(report({ hours: null })).hours).toBeNull()
  })
})

/*
  The rest of the panel (2026-11-04, T144, ai_registrator 2bc906f): the pause
  it runs, its lines, its tuning, its answers to presses, and the two flags.
  Each is optional and lenient — one the agent got wrong drops alone, the
  report is stored.
*/
describe('aiStatusSchema — the panel\'s controls (T144)', () => {
  const t144 = {
    pausedUntil: '2026-11-04T16:30:00+00:00',
    aiLines: [
      { ext: '178', pool: 'main', transport: 'udp', state: 'free', registration: 'Registered', enabled: true },
      { ext: '292', pool: 'main', transport: 'tls', state: 'off', registration: 'Rejected', enabled: false },
    ],
    tuning: { attemptsPerDay: 5, retryDays: 2, transferOrder: 'random', ringSec: 15, missedSec: 600, firstCallDelaySec: 60, whyUs: 'on', maxAttempts: 10 },
    actions: [{ id: 5, kind: 'reregister', line: '292', state: 'refused', text: 'ATS bloklamasin — 10 daqiqadan keyin', at: '2026-11-04T15:00:00+00:00' }],
    flags: { paused: true, day_off: false },
    hours: { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30', days: [1, 2, 3, 4, 5] },
  }

  it('keeps each as the agent sent it', () => {
    const r = parse(report(t144))
    expect(r.pausedUntil).toBe('2026-11-04T16:30:00+00:00')
    expect(r.aiLines).toEqual(t144.aiLines)
    expect(r.tuning).toMatchObject({ attemptsPerDay: 5, maxAttempts: 10, whyUs: 'on' })
    expect(r.actions).toEqual([{ ...t144.actions[0] }])
    expect(r.flags).toMatchObject({ paused: true, day_off: false })
    expect(r.hours?.days).toEqual([1, 2, 3, 4, 5])
  })

  it('reads a report from an agent older than them as before', () => {
    const r = parse(report())
    expect(r.pausedUntil).toBeUndefined()
    expect(r.aiLines).toBeUndefined()
    expect(r.tuning).toBeUndefined()
    expect(r.actions).toBeUndefined()
  })

  it('drops a wrong one alone and stores the report', () => {
    const r = aiStatusSchema.safeParse(
      report({
        pausedUntil: 'soon',
        aiLines: [{ ext: '178', pool: 7, enabled: 'yes' }, { ext: 'x' }],
        tuning: { attemptsPerDay: 'five', ringSec: 15 },
        actions: [{ id: 0, state: 'done' }, { id: 6, kind: 'tls_reset', line: null, state: 'pending', text: '', at: '2026-11-04T15:00:00+00:00' }],
        hours: { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null, days: [0, 9] },
      }),
    )
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.pausedUntil).toBeUndefined()
    expect(r.data.aiLines).toEqual([{ ext: '178', pool: 'main', transport: 'udp', state: 'unknown', registration: 'unknown', enabled: true }])
    expect(r.data.tuning).toMatchObject({ ringSec: 15 })
    expect(r.data.tuning?.attemptsPerDay).toBeUndefined()
    expect(r.data.actions).toEqual([{ id: 6, kind: 'tls_reset', line: null, state: 'pending', text: '', at: '2026-11-04T15:00:00+00:00' }])
    expect(r.data.hours?.days).toBeUndefined()
  })
})
