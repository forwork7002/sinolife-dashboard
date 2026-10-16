import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { CRM_FORM_PROVIDER_ID } from '@/server/integrations/crm/bitrix24/mapping'
import type { RawFormFill } from '@/server/integrations/crm/CrmProvider'
import type { FeedClock, LeadWatchFeed } from '@/server/integrations/crm/sync/leadWatchFeeds'
import {
  FORM_FILL_OVERLAP_MS,
  type FormFillStore,
  parseFormFillsState,
  refreshFormFills,
} from '@/server/integrations/crm/sync/formFillFeed'
import { formFillBrand, formNameOf } from '@/server/domain/leads/leadSources'
import { isIntegrationForm } from '@/server/domain/leads/formFills'

/**
 * THE CRM-FORM FILLS (2026-10-15) — the Bitrix24 side of Meta's form leads,
 * one per fill. The table is APPENDED and never pruned, so the read must
 * throw on anything it did not ask for, and the clock may only say «whole»
 * once a pass has reached the newest fill.
 */

const NOW = new Date('2026-10-15T10:00:00.000Z')
const FROM = new Date('2026-07-31T19:00:00.000Z')

function portal(answer: (body: Record<string, unknown>, n: number) => unknown) {
  const bodies: Record<string, unknown>[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    bodies.push(body)
    return new Response(JSON.stringify(answer(body, bodies.length)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { bodies, provider: new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, rateLimitRps: 1000 }) }
}

const activity = (ID: string, over: Record<string, unknown> = {}) => ({
  ID,
  OWNER_ID: '928996',
  OWNER_TYPE_ID: '2',
  SUBJECT: 'Заполнена CRM-форма "Umar-collagen Collagen FULL (UMAR)"',
  CREATED: '2026-10-12T19:40:46+03:00',
  PROVIDER_ID: CRM_FORM_PROVIDER_ID,
  ...over,
})

describe('fetchFormFills', () => {
  it('asks for the web-form provider above the floor, by id, with no date and no row count', async () => {
    const { provider, bodies } = portal(() => ({ result: [activity('4986874'), activity('4986878', { OWNER_TYPE_ID: '3', OWNER_ID: '679386' })] }))

    const answer = await provider.fetchFormFills('4986870', 40)

    expect(bodies[0]).toEqual({
      order: { ID: 'ASC' },
      filter: { PROVIDER_ID: 'CRM_WEBFORM', '>ID': '4986870' },
      select: ['ID', 'OWNER_ID', 'OWNER_TYPE_ID', 'SUBJECT', 'CREATED', 'PROVIDER_ID'],
      start: -1,
    })
    expect(answer).toEqual({
      complete: true,
      fills: [
        {
          externalId: '4986874',
          subject: 'Заполнена CRM-форма "Umar-collagen Collagen FULL (UMAR)"',
          filledAt: new Date('2026-10-12T16:40:46.000Z'),
          ownerTypeId: '2',
          ownerExternalId: '928996',
        },
        {
          externalId: '4986878',
          subject: 'Заполнена CRM-форма "Umar-collagen Collagen FULL (UMAR)"',
          filledAt: new Date('2026-10-12T16:40:46.000Z'),
          ownerTypeId: '3',
          ownerExternalId: '679386',
        },
      ],
    })
  })

  it('seeks on from the last id of a full page, and stops short of the newest at its page cap', async () => {
    const page = (start: number) => Array.from({ length: 50 }, (_, i) => activity(String(start + i)))
    const { provider, bodies } = portal((_b, n) => ({ result: page(6000 + (n - 1) * 50) }))

    const answer = await provider.fetchFormFills('5999', 2)

    expect(bodies.map((b) => (b.filter as Record<string, unknown>)['>ID'])).toEqual(['5999', '6049'])
    expect(answer.fills).toHaveLength(100)
    expect(answer.complete).toBe(false)
  })

  it.each([
    ['another provider’s activity', activity('5001', { PROVIDER_ID: 'VOXIMPLANT_CALL' })],
    ['an id at the floor', activity('4990')],
    ['an id under the floor', activity('12')],
    ['a row with no owner', activity('5001', { OWNER_ID: '' })],
    ['a row with no date', activity('5001', { CREATED: '' })],
  ])('throws on %s — the table is appended and never pruned', async (_name, row) => {
    const { provider } = portal(() => ({ result: [activity('5000'), row] }))
    await expect(provider.fetchFormFills('4990', 40)).rejects.toThrow(/filtr eʼtiborsiz qoldi/)
  })
})

function fakeClock(initial: unknown = null) {
  let state = initial
  const log: string[] = []
  let succeededAt: Date | null = null
  const clock: FeedClock = {
    async read(feed: LeadWatchFeed) {
      log.push(`read:${feed}`)
      return state === null ? null : JSON.parse(JSON.stringify(state))
    },
    async remember(feed, next) {
      state = next
      log.push(`remember:${feed}`)
    },
    async succeeded(feed, next, at) {
      state = next
      succeededAt = at
      log.push(`succeeded:${feed}`)
    },
    async failed(feed) {
      log.push(`failed:${feed}`)
    },
  }
  return { clock, log, state: () => state, succeededAt: () => succeededAt }
}

function fakeStore() {
  const written: RawFormFill[] = []
  const store: FormFillStore = {
    async insert(fills) {
      written.push(...fills)
      return fills.length
    },
  }
  return { store, written }
}

const fill = (id: string, filledAt = new Date('2026-10-15T09:00:00.000Z')): RawFormFill => ({
  externalId: id,
  subject: 'Заполнена CRM-форма "Umar-collagen Collagen (UMAR)"',
  filledAt,
  ownerTypeId: '2',
  ownerExternalId: '1132402',
})

describe('refreshFormFills', () => {
  it('finds the first floor once, by date, and writes it before the walk', async () => {
    const { clock, log, state, succeededAt } = fakeClock()
    const { store, written } = fakeStore()
    const asked: string[] = []

    const r = await refreshFormFills({
      clock,
      store,
      fetch: async (afterId) => {
        asked.push(afterId)
        return { fills: [fill('4210001'), fill('4210004')], complete: true }
      },
      firstIdSince: async (since) => {
        expect(since).toEqual(FROM)
        return '4210000'
      },
      from: FROM,
      now: NOW,
    })

    expect(asked).toEqual(['4209999'])
    expect(log).toEqual(['read:forms', 'remember:forms', 'succeeded:forms'])
    expect(written.map((f) => f.externalId)).toEqual(['4210001', '4210004'])
    expect(parseFormFillsState(state())).toEqual({ floor: '4210004', from: FROM })
    expect(succeededAt()).toEqual(NOW)
    expect(r).toEqual({ floor: '4210004', read: 2, written: 2, complete: true, bootstrap: true })
  })

  it('reads on from its floor page by page, and does not call a pass cut by the page cap whole', async () => {
    const { clock, log, state, succeededAt } = fakeClock({ floor: '5000000', from: FROM.toISOString() })
    const { store, written } = fakeStore()
    const asked: string[] = []

    const r = await refreshFormFills({
      clock,
      store,
      fetch: async (afterId) => {
        asked.push(afterId)
        return { fills: [fill(String(Number(afterId) + 50))], complete: false }
      },
      firstIdSince: async () => {
        throw new Error('the dated read is asked once in a database’s life')
      },
      from: FROM,
      now: NOW,
      maxPages: 3,
    })

    expect(asked).toEqual(['5000000', '5000050', '5000100'])
    expect(written).toHaveLength(3)
    expect(log).toEqual(['read:forms', 'remember:forms'])
    expect(succeededAt()).toBeNull()
    expect(parseFormFillsState(state())?.floor).toBe('5000150')
    expect(r.complete).toBe(false)
  })

  it('leaves the floor under the last ten minutes, so a fill that commits late is still read', async () => {
    const { clock, state } = fakeClock({ floor: '5000000', from: FROM.toISOString() })
    const { store } = fakeStore()
    const old = new Date(NOW.getTime() - FORM_FILL_OVERLAP_MS - 1)
    const fresh = new Date(NOW.getTime() - 60_000)

    await refreshFormFills({
      clock,
      store,
      fetch: async () => ({ fills: [fill('5000010', old), fill('5000020', fresh)], complete: true }),
      firstIdSince: async () => null,
      from: FROM,
      now: NOW,
    })

    expect(parseFormFillsState(state())?.floor).toBe('5000010')
  })

  it('keeps the pages before a failing one, and remembers how far they reached', async () => {
    const { clock, log, state } = fakeClock({ floor: '5000000', from: FROM.toISOString() })
    const { store, written } = fakeStore()

    await expect(
      refreshFormFills({
        clock,
        store,
        fetch: async (afterId) => {
          if (afterId !== '5000000') throw new Error('QUERY_LIMIT_EXCEEDED')
          return { fills: [fill('5000050')], complete: false }
        },
        firstIdSince: async () => null,
        from: FROM,
        now: NOW,
      }),
    ).rejects.toThrow(/QUERY_LIMIT_EXCEEDED/)

    expect(written.map((f) => f.externalId)).toEqual(['5000050'])
    expect(parseFormFillsState(state())?.floor).toBe('5000050')
    expect(log).toEqual(['read:forms', 'remember:forms'])
  })

  it('ends the walk between two pages once the worker is stopping, and does not call it whole', async () => {
    const { clock, succeededAt } = fakeClock({ floor: '5000000', from: FROM.toISOString() })
    const { store } = fakeStore()
    let pages = 0

    const r = await refreshFormFills({
      clock,
      store,
      fetch: async (afterId) => {
        pages++
        return { fills: [fill(String(Number(afterId) + 50))], complete: false }
      },
      firstIdSince: async () => null,
      from: FROM,
      now: NOW,
      stopping: () => true,
    })

    expect(pages).toBe(1)
    expect(r.complete).toBe(false)
    expect(succeededAt()).toBeNull()
  })

  it('keeps its floor on a pass with nothing new, and calls it whole', async () => {
    const { clock, state, succeededAt } = fakeClock({ floor: '5000000', from: FROM.toISOString() })
    const { store } = fakeStore()

    await refreshFormFills({ clock, store, fetch: async () => ({ fills: [], complete: true }), firstIdSince: async () => null, from: FROM, now: NOW })

    expect(parseFormFillsState(state())?.floor).toBe('5000000')
    expect(succeededAt()).toEqual(NOW)
  })

  it('throws rather than guess a floor — «0» would walk the portal’s whole history', async () => {
    const { clock, log } = fakeClock()
    const { store, written } = fakeStore()
    await expect(
      refreshFormFills({ clock, store, fetch: async () => ({ fills: [fill('1')], complete: true }), firstIdSince: async () => null, from: FROM, now: NOW }),
    ).rejects.toThrow(/boshlanish nuqtasi topilmadi/)
    expect(written).toEqual([])
    expect(log).toEqual(['read:forms'])
  })
})

describe('isIntegrationForm', () => {
  it('names the AI targetolog\'s forms, an empty one too', () => {
    expect(isIntegrationForm('AI targetolog · Sinolife AI forma 26.09.2026 17:44')).toBe(true)
    expect(isIntegrationForm(formNameOf('CRM-формы «AI targetolog · »')!)).toBe(true)
    expect(isIntegrationForm('Umar-collagen Collagen (UMAR)')).toBe(false)
  })
})

describe('formFillBrand', () => {
  it('reads the brand off the form’s name, then its targetolog', () => {
    expect(formFillBrand('Umar-collagen Collagen (UMAR)')).toBe('Collagen')
    expect(formFillBrand('Timur-zextra zextra - 27 / 09 Варианты')).toBe('Zextra')
    expect(formFillBrand('Sobirjon-collagen I.S | Short form | 14.09.2026')).toBe('Collagen')
    // No brand word: Kamron's forms are Zextra's, as his accounts are.
    expect(formFillBrand('Kamron 6 etap filt forma 05.07')).toBe('Zextra')
    // The portal's subject keeps a line break the form's name was saved with.
    expect(formFillBrand(formNameOf('Заполнена CRM-форма "Tursunbek-zextra Zextra filtr savol (Tursunbek Targetolog) \n"')!)).toBe('Zextra')
  })

  it('counts no website, vacancy or cosmetics form, and no form that names nobody', () => {
    expect(formFillBrand('collagen form web')).toBeNull()
    expect(formFillBrand('Sayt forma collagen')).toBeNull()
    expect(formFillBrand('Collagen vakansiya forma')).toBeNull()
    expect(formFillBrand('Kosmetika forma Eldor')).toBeNull()
    expect(formFillBrand('Yangi forma 12.10')).toBeNull()
  })
})
