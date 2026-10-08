import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const envState = {
  BITRIX24_APP_TOKEN: 'tok123' as string | undefined,
  BITRIX24_WEBHOOK_URL: 'https://obey.bitrix24.kz/rest/1/x/',
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
