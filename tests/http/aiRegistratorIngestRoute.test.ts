import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const envState = {
  AI_REGISTRATOR_INGEST_TOKEN: 'tok123' as string | undefined,
  LOG_LEVEL: 'error',
  NODE_ENV: 'test',
}
vi.mock('@/server/config/env', () => ({ env: envState }))

const stored: unknown[] = []
let failNext = false
vi.mock('@/server/services/container', () => ({
  aiRegistratorRepository: {
    upsert: async (call: unknown) => {
      if (failNext) throw new Error('db down')
      stored.push(call)
    },
  },
}))

const { POST } = await import('@/app/api/ai-registrator/calls/route')

/**
 * `/api/ai-registrator/calls` — the voice agent's finished calls. The bearer
 * token is the only gate; a valid call becomes exactly one upsert.
 */

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    callId: '7b0c8a52-6a0e-4c39-9b8e-3f6a1c2d4e5f',
    dealId: 1050732,
    phone: '+998901234567',
    attempt: 1,
    // Python's isoformat: microseconds and an offset.
    startedAt: '2026-10-22T12:00:00.123456+05:00',
    answeredAt: '2026-10-22T12:00:05+05:00',
    endedAt: '2026-10-22T12:02:00Z',
    durationSec: 115,
    outcome: 'interested_transferred',
    transferredTo: '112',
    transferAttempts: [
      { ext: '115', result: 'busy', at: '2026-10-22T12:01:30+05:00' },
      { ext: '112', result: 'answered', at: '2026-10-22T12:01:31+05:00' },
    ],
    result: { problem: 'Boʻgʻim ogʻrigʻi', for_whom: 'self' },
    isTest: false,
    ...over,
  })

const post = (text: string, token: string | null = 'tok123', headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/ai-registrator/calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers },
      body: text,
    }),
  )

describe('POST /api/ai-registrator/calls', () => {
  beforeEach(() => {
    stored.length = 0
    failNext = false
    envState.AI_REGISTRATOR_INGEST_TOKEN = 'tok123'
  })

  it('stores an authenticated call, the deal id as the portal\'s string', async () => {
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ callId: '7b0c8a52-6a0e-4c39-9b8e-3f6a1c2d4e5f', dealId: '1050732', transferredTo: '112' })
  })

  it('accepts the minimal call the agent sends for a no-answer', async () => {
    const res = await post(
      JSON.stringify({
        callId: 'x1',
        dealId: '77',
        startedAt: '2026-10-22T12:00:00+05:00',
        endedAt: '2026-10-22T12:00:30+05:00',
        outcome: 'no_answer',
      }),
    )
    expect(res.status).toBe(200)
    expect(stored[0]).toMatchObject({ dealId: '77', answeredAt: null, transferAttempts: [], result: null, isTest: false })
  })

  it('answers 401 and stores nothing on a wrong or missing token', async () => {
    expect((await post(body(), 'nope')).status).toBe(401)
    expect((await post(body(), '')).status).toBe(401)
    expect((await post(body(), null)).status).toBe(401)
    expect(stored).toEqual([])
  })

  it('answers 404 when no token is configured', async () => {
    envState.AI_REGISTRATOR_INGEST_TOKEN = undefined
    expect((await post(body())).status).toBe(404)
  })

  it('answers 400 for a body that is not a call', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post(body({ startedAt: 'yesterday' }))).status).toBe(400)
    expect((await post(body({ dealId: 'abc' }))).status).toBe(400)
    expect((await post(body({ transferAttempts: [{ ext: '115', result: 'maybe' }] }))).status).toBe(400)
    expect((await post(body({ transferAttempts: [{ ext: '115', result: 'busy', ring_sec: -1 }] }))).status).toBe(400)
    expect(stored).toEqual([])
  })

  it('stores a turned-down try and how long each one rang', async () => {
    const attempts = [
      { ext: '135', result: 'rejected', at: '2026-10-27T15:20:01+05:00', ring_sec: 4.2 },
      { ext: '136', result: 'no_answer', at: '2026-10-27T15:20:06+05:00', ring_sec: 15 },
      { ext: '141', result: 'caller_left', at: '2026-10-27T15:20:21+05:00', ring_sec: 3 },
      { ext: '143', result: 'answered', at: '2026-10-27T15:20:24+05:00', ring_sec: 6.1 },
    ]
    expect((await post(body({ transferAttempts: attempts }))).status).toBe(200)
    expect(stored[0]).toMatchObject({ transferAttempts: attempts })
  })

  it('stores an outcome it does not know yet rather than losing the call', async () => {
    expect((await post(body({ outcome: 'callback_later' }))).status).toBe(200)
  })

  it('refuses an oversized body', async () => {
    expect((await post(body({ result: { summary: 'a'.repeat(70_000) } }))).status).toBe(413)
    expect((await post(body(), 'tok123', { 'content-length': '999999' })).status).toBe(413)
  })

  it('answers 503 when the database is down, so the agent retries', async () => {
    failNext = true
    expect((await post(body())).status).toBe(503)
  })
})
