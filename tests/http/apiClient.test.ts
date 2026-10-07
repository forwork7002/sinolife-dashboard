import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError, apiGet, apiWrite } from '@/lib/api'

/**
 * THE CLIENT READS EVERY ANSWER, NOT ONLY THE ONES WE SHAPED.
 *
 * During a restart or an upstream timeout the platform's proxy answers with an
 * HTML page, and a crashed route can answer an empty 500. `response.json()`
 * then rejected with a bare SyntaxError, and every card printed «Unexpected
 * token '<', "<!DOCTYPE "… is not valid JSON» with the status lost. A real
 * `Response` here, so the parsing under test is the platform's own.
 */

afterEach(() => vi.unstubAllGlobals())

function answer(response: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => response))
}

const html = (status: number) =>
  new Response('<!DOCTYPE html><html><body>504 Gateway Time-out</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  })

describe('apiGet', () => {
  it('turns a proxy’s HTML error page into a typed failure that keeps the status', async () => {
    answer(html(504))

    const failure = await apiGet('/insights/logistics').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiClientError)
    expect((failure as ApiClientError).status).toBe(504)
    expect((failure as ApiClientError).code).toBe('UPSTREAM_UNAVAILABLE')
    expect((failure as ApiClientError).message).not.toMatch(/JSON|token/)
  })

  it('does the same for an empty 500', async () => {
    answer(new Response('', { status: 500 }))

    const failure = await apiGet('/rnp/overview').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiClientError)
    expect((failure as ApiClientError).status).toBe(500)
  })

  it('still reads our own error envelope, code and correlation id included', async () => {
    answer(
      Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Soʻrov parametrlari notoʻgʻri' }, meta: { correlationId: 'c-1' } },
        { status: 400 },
      ),
    )

    const failure = (await apiGet('/kpi').catch((error: unknown) => error)) as ApiClientError

    expect(failure.code).toBe('VALIDATION_ERROR')
    expect(failure.message).toBe('Soʻrov parametrlari notoʻgʻri')
    expect(failure.correlationId).toBe('c-1')
  })

  it('lets an abort through as itself, so a cancelled request is never a fault', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    answer({ ok: true, status: 200, json: async () => Promise.reject(abort) } as unknown as Response)

    await expect(apiGet('/sverka/overview')).rejects.toBe(abort)
  })
})

describe('apiWrite', () => {
  it('turns a proxy’s HTML error page into a typed failure too', async () => {
    answer(html(502))

    const failure = await apiWrite('POST', '/rnp/plan', { month: '2026-10' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiClientError)
    expect((failure as ApiClientError).status).toBe(502)
  })
})
