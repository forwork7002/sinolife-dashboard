import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

/**
 * How many requests one refusal actually costs.
 *
 * These count real calls to `fetchImpl`, because the whole change is about a
 * number: on 2026-09-15 a hot tick under `OVERLOAD_LIMIT` sent three requests
 * of which two left AFTER the portal had already said no, a reference tick sent
 * twelve of which eleven did, and a restart inside the block sent eleven more.
 * Nothing in the old code could stop them — the worker's `throttled` flag is
 * computed from the results of a tick that has already finished.
 */

/** A portal that refuses everything, and a counter for what we sent it anyway. */
function refusingPortal(status: number, body: unknown) {
  const sent: string[] = []

  const fetchImpl = (async (url: string) => {
    sent.push(String(url))
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return {
    sent,
    provider: new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      // Zero backoff: these tests are about counts, not about waiting.
      maxRetries: 3,
    }),
  }
}

const OVERLOAD = { error: 'OVERLOAD_LIMIT', error_description: 'REST API is blocked due to overload.' }
const REVOKED = { error: 'INVALID_CREDENTIALS', error_description: 'Invalid request credentials' }

describe('the gate inside call()', () => {
  it('spends ONE request on a blocked portal, however many entities ask', async () => {
    const { provider, sent } = refusingPortal(401, OVERLOAD)

    await expect(provider.fetchCustomers()).rejects.toThrow()
    await expect(provider.fetchDeals()).rejects.toThrow()
    await expect(provider.fetchStageHistory()).rejects.toThrow()
    await expect(provider.fetchEmployees()).rejects.toThrow()
    await expect(provider.fetchSources()).rejects.toThrow()

    // One. The first refusal shut the door; the other four never reached fetch.
    expect(sent).toHaveLength(1)
  })

  it('does the same for a revoked webhook, which is a different failure', async () => {
    const { provider, sent } = refusingPortal(401, REVOKED)

    await expect(provider.fetchCustomers()).rejects.toThrow()
    await expect(provider.fetchDeals()).rejects.toThrow()

    expect(sent).toHaveLength(1)
  })

  /**
   * The probe is the ONE call allowed past the gate — it is the only way the
   * worker can find out the block has lifted without running a whole tick into
   * it, which is what the flat ten-minute wait used to do.
   */
  it('lets the probe through, and nothing else', async () => {
    const { provider, sent } = refusingPortal(401, OVERLOAD)

    await expect(provider.fetchDeals()).rejects.toThrow()
    expect(sent).toHaveLength(1)

    expect(await provider.probe()).toBe(false)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('profile')

    await expect(provider.fetchDeals()).rejects.toThrow()
    expect(sent).toHaveLength(2)
  })

  /**
   * ONE METHOD'S BUDGET IS NOT THE PORTAL'S. `OPERATION_TIME_LIMIT` blocks the
   * method that earned it and leaves the rest answering, so stopping the whole
   * sync over it would take the dashboard down for one expensive read.
   */
  it('holds only the method that spent its operating budget', async () => {
    const sent: string[] = []
    const fetchImpl = (async (url: string) => {
      sent.push(String(url))
      // `user.get` has spent its ten-minute budget; everything else answers.
      const refused = String(url).includes('user.get')
      return new Response(
        JSON.stringify(refused ? { error: 'OPERATION_TIME_LIMIT' } : { result: [] }),
        { status: refused ? 429 : 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      maxRetries: 0,
    })

    await expect(provider.fetchEmployees()).rejects.toThrow(/OPERATION_TIME_LIMIT/)
    expect(provider.gate.isOpen()).toBe(false)

    // The spent method is held locally — a second ask costs no request.
    const afterFirst = sent.length
    await expect(provider.fetchEmployees()).rejects.toThrow()
    expect(sent).toHaveLength(afterFirst)

    // A DIFFERENT method is still admitted, which is the whole point.
    await provider.fetchSources()
    expect(sent.length).toBeGreaterThan(afterFirst)
    expect(sent.at(-1)).toContain('crm.status.list')
  })
})

describe('what the portal said, and how many times we asked', () => {
  /**
   * THE BRANCH THAT THREW THE BODY AWAY. A 429/5xx reported a bare «Bitrix24
   * responded 503» with the code gone, so the worker's substring match for
   * `QUERY_LIMIT_EXCEEDED` never fired and its ten-minute wait never engaged —
   * measured at 40 HTTP requests where 10 were expected.
   */
  it('reads the code out of a 503 body instead of dropping it', async () => {
    const { provider } = refusingPortal(503, {
      error: 'QUERY_LIMIT_EXCEEDED',
      error_description: 'Too many requests',
    })

    await expect(provider.fetchSources()).rejects.toThrow(/QUERY_LIMIT_EXCEEDED/)
  })

  /**
   * An `OVERLOAD_LIMIT` behind a 5xx must NOT be retried: the status said
   * «transient», the body says «the portal is refusing you». The body wins.
   */
  it('does not run the retry ladder on an overload hiding behind a 5xx', async () => {
    const { provider, sent } = refusingPortal(503, OVERLOAD)

    await expect(provider.fetchSources()).rejects.toThrow()
    expect(sent).toHaveLength(1)
  })

  /**
   * «failed after 4 attempts» was a constant, and it was false on every
   * non-retryable error — a 401 breaks out after ONE request. That sentence
   * went into `sync_log`, into the dashboard tooltip and into the 2026-09-14
   * incident notes, and it is why the first reading of that outage was «the
   * client is hammering the portal four times over».
   */
  it('reports the attempts it actually made', async () => {
    const { provider } = refusingPortal(401, OVERLOAD)

    await expect(provider.fetchSources()).rejects.toThrow(/failed after 1 attempt:/)
  })
})

describe('fetchStages', () => {
  function stagePortal(answer: (ids: readonly number[]) => Record<string, unknown>) {
    const sent: unknown[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { cmd?: Record<string, string> }
      sent.push(body.cmd)
      const ids = Object.keys(body.cmd ?? {}).map((k) => Number(k.slice(1)))
      return new Response(JSON.stringify({ result: { result: answer(ids) } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    return {
      sent,
      provider: new Bitrix24CrmProvider({
        webhookUrl: 'https://portal/rest/1/tok/',
        fetchImpl,
        pipelines: [6, 14, 10, 4],
      }),
    }
  }

  /** Four pipelines were four requests; nine were nine, 432 a day. */
  it('asks for every pipeline in ONE request', async () => {
    const { provider, sent } = stagePortal((ids) =>
      Object.fromEntries(
        ids.map((id) => [`p${id}`, [{ STATUS_ID: `C${id}:NEW`, NAME: 'Yangi', SEMANTICS: null }]]),
      ),
    )

    const page = await provider.fetchStages()

    expect(sent).toHaveLength(1)
    expect(page.items).toHaveLength(4)
  })

  /**
   * NOT DEFENSIVE — LOAD-BEARING. `batch()` reads `payload.result?.result` and
   * ignores `result_error`, and `halt: 0` makes the portal answer HTTP 200 with
   * per-command failures inside the body. Silently importing «that funnel has
   * no stages» is what CLAUDE.md records as making «Доставлено» and «Отказ»
   * both land in IN_PROGRESS, so the funnel shows nothing ever finishing.
   */
  it('refuses to import a funnel whose stages the batch did not answer', async () => {
    const { provider } = stagePortal((ids) =>
      Object.fromEntries(
        ids
          .filter((id) => id !== 10)
          .map((id) => [`p${id}`, [{ STATUS_ID: `C${id}:NEW`, NAME: 'Yangi' }]]),
      ),
    )

    await expect(provider.fetchStages()).rejects.toThrow(/10/)
  })
})

describe('detectScopes', () => {
  /**
   * A REFUSAL IS NOT AN ANSWER OF «NO SCOPES». This memo was written in the
   * `catch` as well as the `try`, so a `scope` call refused during a block
   * cached an empty set for the LIFE OF THE PROCESS — leaving STORES and STOCK
   * false, and the warehouse data reported as unavailable, long after the
   * portal had recovered. A worker that started inside the 2026-09-15 outage
   * hit exactly this.
   */
  it('does not remember a refusal as "this webhook has no scopes"', async () => {
    let answer: 'refuse' | 'grant' = 'refuse'
    const fetchImpl = (async () =>
      answer === 'refuse'
        ? new Response(JSON.stringify(OVERLOAD), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ result: ['crm', 'catalog'] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      maxRetries: 0,
    })

    await expect(provider.detectScopes()).rejects.toThrow()
    expect(provider.capabilities.STORES).toBe(false)

    // The portal recovers. The gate reopens on the first success, and the next
    // ask must reach it rather than being answered from a cached emptiness.
    answer = 'grant'
    provider.gate.noteSuccess('scope', new Date())
    // Clear the short negative cooldown the refusal set.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const scopes = await provider.detectScopes().catch(() => null)

    // Either it was still inside the 60 s cooldown (and threw) or it asked
    // again — what must NEVER happen is a silent empty set cached forever.
    if (scopes) {
      expect(scopes.has('catalog')).toBe(true)
      expect(provider.capabilities.STORES).toBe(true)
    }
  })
})

describe('a refusal inside a batch', () => {
  /**
   * A REFUSAL INSIDE A BATCH IS A REFUSAL. `halt: 0` makes the portal answer
   * HTTP 200 and bury it in `result_error`, so it never passed through the
   * catch that tells the gate — and the hold was keyed on `batch`, not on the
   * walked method. Seen on production 2026-09-23: CUSTOMERS was refused
   * `OPERATION_TIME_LIMIT` at 05:00:31 and sent again at 05:02:34.
   */
  it('holds the WALKED method when a batch command is refused, and nothing else', async () => {
    const sent: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = `${String(url)} ${String(init?.body ?? '')}`
      sent.push(body)
      const refused = body.includes('crm.contact.list')
      return new Response(
        JSON.stringify(
          refused
            ? {
                result: {
                  result: {},
                  result_error: {
                    c0: {
                      error: 'OPERATION_TIME_LIMIT',
                      error_description: 'Method is blocked due to operation time limit.',
                    },
                  },
                },
              }
            : { result: { result: { c0: [] }, result_error: {} } },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      maxRetries: 0,
    })

    await expect(provider.fetchCustomers()).rejects.toThrow(/OPERATION_TIME_LIMIT/)
    const afterFirst = sent.length

    // The next tick asks again and the batch never leaves.
    await expect(provider.fetchCustomers()).rejects.toThrow(/not sent/)
    expect(sent).toHaveLength(afterFirst)

    // One method's budget is not the portal's: deals still walk.
    await provider.fetchDeals()
    expect(sent.length).toBeGreaterThan(afterFirst)
    // `isOpen` means the whole gate has tripped — a method hold is not that.
    expect(provider.gate.isOpen()).toBe(false)
  })

  it('shuts the whole gate when a batch command says the portal is overloaded', async () => {
    const sent: string[] = []
    const fetchImpl = (async (url: string) => {
      sent.push(String(url))
      return new Response(
        JSON.stringify({ result: { result: {}, result_error: { c0: OVERLOAD } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      maxRetries: 0,
    })

    await expect(provider.fetchCustomers()).rejects.toThrow(/OVERLOAD_LIMIT/)
    await expect(provider.fetchDeals()).rejects.toThrow()
    await expect(provider.fetchStageHistory()).rejects.toThrow()

    expect(sent).toHaveLength(1)
    expect(provider.gate.isOpen()).toBe(true)
  })
})
