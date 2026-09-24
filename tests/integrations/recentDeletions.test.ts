import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { goneDeals, goneLimit } from '@/server/integrations/crm/sync/recentDeletions'

/**
 * The Tasdiqlash queue's recent-deletion check. The caller DELETES whatever
 * `existingDealIds` does not return, so every way the answer can be wrong has
 * to throw instead of coming back short.
 */

type Answer = (ids: string[]) => { rows?: { ID: string }[]; error?: { error: string } }

/** A portal that answers each `crm.deal.list?filter[ID][]…` command through `answer`. */
function portal(answer: Answer) {
  const batches: Record<string, string>[] = []

  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const { cmd } = JSON.parse(init.body) as { cmd: Record<string, string> }
    batches.push(cmd)
    const result: Record<string, unknown> = {}
    const result_error: Record<string, unknown> = {}
    for (const [key, command] of Object.entries(cmd)) {
      const ids = [...command.matchAll(/filter%5BID%5D%5B\d+%5D=(\d+)|filter\[ID\]\[\d+\]=(\d+)/g)].map(
        (m) => m[1] ?? m[2]!,
      )
      const a = answer(ids)
      if (a.error) result_error[key] = a.error
      else if (a.rows) result[key] = a.rows
    }
    return new Response(JSON.stringify({ result: { result, result_error } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return {
    batches,
    provider: new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, maxRetries: 0 }),
  }
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(from + i))

describe('existingDealIds', () => {
  it('returns the ids the portal still has, 50 ids to a command', async () => {
    const deleted = new Set(['1003', '1120'])
    const { provider, batches } = portal((ids) => ({
      rows: ids.filter((id) => !deleted.has(id)).map((ID) => ({ ID })),
    }))

    const live = await provider.existingDealIds(range(1000, 130))

    expect(live.size).toBe(128)
    expect(live.has('1003')).toBe(false)
    expect(live.has('1120')).toBe(false)
    expect(batches).toHaveLength(1)
    expect(Object.keys(batches[0]!)).toHaveLength(3)
    // Only the ID column, and the same pipeline filter as the full sweep.
    expect(batches[0]!.c0).toContain('select')
    expect(batches[0]!.c0).toContain('CATEGORY_ID')
  })

  it('splits more than 50 commands across round trips', async () => {
    const { provider, batches } = portal((ids) => ({ rows: ids.map((ID) => ({ ID })) }))
    const live = await provider.existingDealIds(range(1, 2_600))
    expect(live.size).toBe(2_600)
    expect(batches.map((b) => Object.keys(b).length)).toEqual([50, 2])
  })

  it('throws on a refused command instead of reading it as «none exist»', async () => {
    const { provider } = portal((ids) =>
      ids.includes('60') ? { error: { error: 'OPERATION_TIME_LIMIT' } } : { rows: ids.map((ID) => ({ ID })) },
    )
    await expect(provider.existingDealIds(range(1, 100))).rejects.toThrow(/rad etdi/)
  })

  it('throws when a command has no answer at all', async () => {
    const { provider } = portal((ids) => (ids.includes('60') ? {} : { rows: ids.map((ID) => ({ ID })) }))
    await expect(provider.existingDealIds(range(1, 100))).rejects.toThrow(/javobsiz/)
  })

  it('throws when the ID filter was ignored — a row that was not asked for', async () => {
    const { provider } = portal(() => ({ rows: range(9_000, 50).map((ID) => ({ ID })) }))
    await expect(provider.existingDealIds(range(1, 10))).rejects.toThrow(/filtr/)
  })
})

describe('goneDeals', () => {
  it('names the ids the portal did not return', () => {
    expect(goneDeals(['1', '2', '3'], new Set(['1', '3']))).toEqual(['2'])
  })

  it('refuses a mass deletion rather than cascading it', () => {
    const candidates = range(1, 300)
    expect(() => goneDeals(candidates, new Set())).toThrow(/hech narsa oʻchirilmadi/)
  })

  it('allows up to 25, or 2% of a large check', () => {
    expect(goneLimit(100)).toBe(25)
    expect(goneLimit(7_000)).toBe(140)
    const candidates = range(1, 100)
    expect(goneDeals(candidates, new Set(candidates.slice(25)))).toHaveLength(25)
  })
})
