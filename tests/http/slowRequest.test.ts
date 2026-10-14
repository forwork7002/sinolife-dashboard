import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { readSafely, SLOW_REQUEST_MS, slowRequestEntry } from '@/server/http/slowRequest'

/*
  THE SLOW-REQUEST LOG (2026-10-14). The deployed dashboard «qotadi» between
  pages and nothing on the server said which request took how long. One line
  per request over a second — and never the search text or a list of ids.
*/
describe('slowRequestEntry', () => {
  const atStart = { total: 8, idle: 0, waiting: 3 }
  const pool = { total: 8, idle: 2, waiting: 0 }

  it('writes nothing for a quick request', () => {
    const url = new URL('https://x.test/api/v1/rnp/overview?month=2026-10')
    expect(slowRequestEntry(url, 200, SLOW_REQUEST_MS - 1, 12, atStart, pool)).toBeNull()
  })

  it('names the path, the status, the time, the caller lookup and the pool on arrival and at the end', () => {
    const url = new URL('https://x.test/api/v1/leads/overview?preset=this_month&brand=Collagen')
    expect(slowRequestEntry(url, 200, 4321.6, 2987.2, atStart, pool)).toEqual({
      path: '/api/v1/leads/overview',
      params: { preset: 'this_month', brand: 'Collagen' },
      status: 200,
      ms: 4322,
      authMs: 2987,
      poolAtStart: atStart,
      pool,
    })
  })

  it('keeps the keys that shape the answer and drops what a person typed or who they named', () => {
    const url = new URL(
      'https://x.test/api/v1/search?q=Aliyev%20%2B998901234567&employeeIds=a,b&include=faktTrend&from=2026-10-01',
    )
    const entry = slowRequestEntry(url, 500, 20_100, null, null, null)
    expect(entry?.params).toEqual({ include: 'faktTrend', from: '2026-10-01' })
    expect(JSON.stringify(entry)).not.toContain('Aliyev')
    expect(JSON.stringify(entry)).not.toContain('998901234567')
    expect(entry?.authMs).toBeNull()
  })

  it('cuts a long value and a long path short — a dynamic segment is whatever the caller sent', () => {
    const url = new URL(`https://x.test/api/v1/users/${'b'.repeat(500)}?include=${'a'.repeat(200)}`)
    const entry = slowRequestEntry(url, 200, 5_000, 1, atStart, pool)
    expect(entry?.params.include).toHaveLength(40)
    expect(entry?.path).toHaveLength(160)
  })
})

describe('readSafely', () => {
  it('hands back the reading, or null when reading it throws — never the throw', () => {
    expect(readSafely(() => ({ total: 8, idle: 8, waiting: 0 }))).toEqual({ total: 8, idle: 8, waiting: 0 })
    expect(
      readSafely(() => {
        throw new Error('No "poolStats" export is defined on the mock')
      }),
    ).toBeNull()
  })
})

describe('every answer passes through the slow-request line', () => {
  it('times both outcomes of the GET and the POST handler', () => {
    const source = readFileSync('src/server/http/handler.ts', 'utf8')
    expect(
      source.match(/return noteIfSlow\(request, correlationId, started, poolAtStart, authMs, response\)/g),
    ).toHaveLength(4)
    expect(source).not.toMatch(/return jsonResponse\(/)
  })

  it('reads the clock before anything else and never lets the log line throw', () => {
    const source = readFileSync('src/server/http/handler.ts', 'utf8')
    const note = source.slice(source.indexOf('function noteIfSlow'), source.indexOf('function baseMeta'))
    expect(note.indexOf('if (ms < SLOW_REQUEST_MS) return response')).toBeLessThan(note.indexOf('poolStats()'))
    expect(note).toMatch(/try \{[\s\S]*slowRequestEntry[\s\S]*\} catch \{/)
  })

  it('times the page guard every navigation waits on', () => {
    const source = readFileSync('src/server/auth/pageGuard.ts', 'utf8')
    expect(source).toContain("'slow page guard'")
    expect(source).toContain('SLOW_REQUEST_MS')
    expect(source).toContain('resolved: principal !== null')
  })

  it('times the health probe the platform restarts the container on', () => {
    const source = readFileSync('src/app/api/health/route.ts', 'utf8')
    expect(source).toContain("'slow health check'")
    expect(source).toContain('SLOW_REQUEST_MS')
  })
})
