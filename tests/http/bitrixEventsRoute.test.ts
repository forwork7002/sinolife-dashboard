import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const envState = {
  BITRIX24_APP_TOKEN: 'tok123' as string | undefined,
  BITRIX24_WEBHOOK_URL: 'https://obey.bitrix24.kz/rest/1/x/' as string | undefined,
  LOG_LEVEL: 'error',
  NODE_ENV: 'test',
}
vi.mock('@/server/config/env', () => ({ env: envState }))

const recorded: unknown[][] = []
vi.mock('@/server/services/container', () => ({
  crmEventRepository: { record: async (...args: unknown[]) => void recorded.push(args) },
}))

const { POST } = await import('@/app/api/bitrix24/events/route')

/**
 * `/api/bitrix24/events` — the portal's outgoing webhook. The token is the
 * only gate; a well-formed authenticated event becomes exactly one queue row.
 */

const form = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    event: 'ONCRMDEALDELETE',
    'data[FIELDS][ID]': '1050732',
    'auth[domain]': 'obey.bitrix24.kz',
    'auth[application_token]': 'tok123',
    ...over,
  }).toString()

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/bitrix24/events', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body,
    }),
  )

describe('POST /api/bitrix24/events', () => {
  beforeEach(() => {
    recorded.length = 0
    envState.BITRIX24_APP_TOKEN = 'tok123'
  })
  afterEach(() => vi.restoreAllMocks())

  it('queues an authenticated deal event', async () => {
    const res = await post(form())
    expect(res.status).toBe(200)
    expect(recorded).toEqual([['BITRIX24', 'ONCRMDEALDELETE', '1050732']])
  })

  it('answers 401 and records nothing on a wrong or missing token', async () => {
    expect((await post(form({ 'auth[application_token]': 'nope' }))).status).toBe(401)
    expect((await post(form({ 'auth[application_token]': '' }))).status).toBe(401)
    expect((await post('')).status).toBe(401)
    expect(recorded).toEqual([])
  })

  it('answers 401 for another portal\'s deals', async () => {
    expect((await post(form({ 'auth[domain]': 'other.bitrix24.kz' }))).status).toBe(401)
    expect(recorded).toEqual([])
  })

  it('skips the domain check when no portal URL is configured (demo), the token still decides', async () => {
    envState.BITRIX24_WEBHOOK_URL = undefined
    try {
      expect((await post(form({ 'auth[domain]': 'other.bitrix24.kz' }))).status).toBe(200)
      expect(recorded).toHaveLength(1)
      expect((await post(form({ 'auth[application_token]': 'nope' }))).status).toBe(401)
    } finally {
      envState.BITRIX24_WEBHOOK_URL = 'https://obey.bitrix24.kz/rest/1/x/'
    }
  })

  it('answers 200 but drops an event about another entity', async () => {
    const res = await post(form({ event: 'ONCRMCONTACTUPDATE' }))
    expect(res.status).toBe(200)
    expect(recorded).toEqual([])
  })

  it('answers 404 when no token is configured', async () => {
    envState.BITRIX24_APP_TOKEN = undefined
    expect((await post(form())).status).toBe(404)
    expect(recorded).toEqual([])
  })

  it('refuses an oversized body', async () => {
    expect((await post('a'.repeat(20_000))).status).toBe(413)
    expect((await post(form(), { 'content-length': '999999' })).status).toBe(413)
  })
})

describe('POST /api/bitrix24/events, body bound', () => {
  it('cuts off a chunked body past the cap before reading it whole', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 1000) controller.close()
        else controller.enqueue(new TextEncoder().encode('a'.repeat(1024)))
      },
    })
    const res = await POST(
      new Request('http://localhost/api/bitrix24/events', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: stream,
        // @ts-expect-error — Node's fetch needs this for a streaming body
        duplex: 'half',
      }),
    )
    expect(res.status).toBe(413)
    // 16 KiB cap → at most 17 chunks pulled, not a thousand.
    expect(pulled).toBeLessThan(30)
  })
})

describe('POST /api/bitrix24/events when the queue cannot be written', () => {
  it('answers 503, not 500', async () => {
    const { crmEventRepository } = await import('@/server/services/container')
    const spy = vi.spyOn(crmEventRepository, 'record').mockRejectedValueOnce(new Error('db down'))
    expect((await post(form())).status).toBe(503)
    spy.mockRestore()
  })
})
