import { describe, expect, it, vi } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { UF } from '@/server/integrations/crm/bitrix24/mapping'

/*
  A NEW LIST ITEM IS NAMED WITHOUT A REDEPLOY.

  The deal's enumeration fields (targetolog, registrar, region, «Проект»)
  arrive as item ids, resolved through `crm.deal.fields`. That answer was kept
  for the life of the worker process, so every deal naming an item added
  since the last deploy was written with NULL in that column — «Koʻrsatilmagan»
  on Target tahlili, the brand rule falling through «Проект».
*/

/**
 * A portal whose «Таргетолог» list is `targetologs()` at the moment
 * `crm.deal.fields` is asked, or an error while `refuseFields` is set, and
 * whose deals walk answers one Регистрация deal per id in `deals`.
 */
function portal(targetologs: () => Record<string, string>) {
  const state = { fieldReads: 0, refuseFields: false, deals: ['900'] as string[] }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  const fetchImpl = (async (url: string) => {
    if (String(url).includes('crm.deal.fields')) {
      state.fieldReads += 1
      if (state.refuseFields) return json({ error: 'INTERNAL_SERVER_ERROR', error_description: 'x' })
      const items = Object.entries(targetologs()).map(([ID, VALUE]) => ({ ID, VALUE }))
      return json({ result: { [UF.TARGETOLOG]: { type: 'enumeration', items } } })
    }
    const rows = state.deals.map((targetolog, i) => ({
      ID: String(5000 + i),
      TITLE: 'Lid',
      CATEGORY_ID: '0',
      STAGE_ID: 'NEW',
      STAGE_SEMANTIC_ID: 'P',
      ASSIGNED_BY_ID: '5',
      OPPORTUNITY: '0',
      DATE_CREATE: '2026-10-06T10:00:00+03:00',
      [UF.TARGETOLOG]: targetolog,
    }))
    return json({ result: { result: { c0: rows }, result_error: {} } })
  }) as unknown as typeof fetch

  const provider = new Bitrix24CrmProvider({
    webhookUrl: 'https://portal/rest/1/tok/',
    fetchImpl,
    maxRetries: 0,
    rateLimitRps: 1000,
  })
  return { provider, state }
}

const targetologsOf = async (provider: Bitrix24CrmProvider) =>
  (await provider.fetchDeals()).items.map((deal) => deal.targetolog)

describe('enumeration labels', () => {
  it('re-reads the list when a deal names an item added since, and names it', async () => {
    let list: Record<string, string> = { '898': 'Eldor' }
    const { provider, state } = portal(() => list)
    state.deals = ['898']
    expect(await targetologsOf(provider)).toEqual(['Eldor'])
    expect(state.fieldReads).toBe(1)

    // The worker started before «Umar» was added to the list…
    list = { '898': 'Eldor', '900': 'Umar' }
    state.deals = ['898', '900']
    expect(await targetologsOf(provider)).toEqual(['Eldor', 'Umar'])
    expect(state.fieldReads).toBe(2)

    // …and once known, the item costs nothing more.
    expect(await targetologsOf(provider)).toEqual(['Eldor', 'Umar'])
    expect(state.fieldReads).toBe(2)
  })

  it('asks once about an item the portal no longer has, never on every page', async () => {
    const { provider, state } = portal(() => ({ '898': 'Eldor' }))
    state.deals = ['777']

    expect(await targetologsOf(provider)).toEqual([undefined])
    expect(state.fieldReads).toBe(2)
    expect(await targetologsOf(provider)).toEqual([undefined])
    expect(state.fieldReads).toBe(2)
  })

  /*
    WRITTEN OFF FOR AN HOUR, NOT FOR THE PROCESS. A re-read that came back
    without the item — a stale or partial answer — used to pin it dead until
    the next deploy, and every deal naming it was written NULL in between.
  */
  it('asks again, an hour on, about an item a fresh answer did not know', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-06T09:00:00.000Z'))
      let list: Record<string, string> = { '898': 'Eldor' }
      const { provider, state } = portal(() => list)
      state.deals = ['900']
      expect(await targetologsOf(provider)).toEqual([undefined])
      expect(state.fieldReads).toBe(2)

      // «Umar» is on the list now, but inside the hour nobody asks.
      list = { '898': 'Eldor', '900': 'Umar' }
      vi.setSystemTime(new Date('2026-10-06T09:59:00.000Z'))
      expect(await targetologsOf(provider)).toEqual([undefined])
      expect(state.fieldReads).toBe(2)

      vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'))
      expect(await targetologsOf(provider)).toEqual(['Umar'])
      expect(state.fieldReads).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the labels it had when the re-read is refused, and asks again later', async () => {
    let list: Record<string, string> = { '898': 'Eldor' }
    const { provider, state } = portal(() => list)
    state.deals = ['898']
    expect(await targetologsOf(provider)).toEqual(['Eldor'])

    list = { '898': 'Eldor', '900': 'Umar' }
    state.refuseFields = true
    state.deals = ['898', '900']
    expect(await targetologsOf(provider)).toEqual(['Eldor', undefined])
    // A refused re-read must not cost the next deals pass its labels, or the pass.
    expect(await targetologsOf(provider)).toEqual(['Eldor', undefined])

    // A refusal is not an answer: once the portal answers, the item is named.
    state.refuseFields = false
    expect(await targetologsOf(provider)).toEqual(['Eldor', 'Umar'])
  })
})
