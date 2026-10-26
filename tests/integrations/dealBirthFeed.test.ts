import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import type { RawDealBirth } from '@/server/integrations/crm/CrmProvider'
import {
  DEAL_BIRTH_OVERLAP_MS,
  type DealBirthStore,
  parseDealBirthsState,
  refreshDealBirths,
} from '@/server/integrations/crm/sync/dealBirthFeed'
import type { FeedClock, LeadWatchFeed } from '@/server/integrations/crm/sync/leadWatchFeeds'

/**
 * THE DEAL BIRTHS (2026-10-22) — where each deal opened, for «Безквал». The
 * table is APPENDED and never pruned, so the read throws on anything it did
 * not ask for, and the clock says «whole» only once a pass reached the newest.
 */

const NOW = new Date('2026-10-22T13:00:00.000Z')
const FROM = new Date('2026-07-31T19:00:00.000Z')

/** A portal answering the chained `batch` of `crm.stagehistory.list` pages with `pageOf(command)`. */
function portal(pageOf: (command: string, key: string) => unknown[] | { error: string }) {
  const batches: Record<string, string>[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const { cmd } = JSON.parse(init.body) as { cmd: Record<string, string> }
    batches.push(cmd)
    const result: Record<string, unknown> = {}
    const result_error: Record<string, unknown> = {}
    for (const [key, command] of Object.entries(cmd)) {
      const page = pageOf(command, key)
      if (Array.isArray(page)) result[key] = { items: page }
      else result_error[key] = page
    }
    return new Response(JSON.stringify({ result: { result, result_error } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { batches, provider: new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, maxRetries: 0, rateLimitRps: 1000 }) }
}

const row = (ID: number, over: Record<string, unknown> = {}) => ({
  ID,
  OWNER_ID: 1161678,
  CATEGORY_ID: 0,
  STAGE_ID: 'UC_MVRVO1',
  CREATED_TIME: '2026-10-20T22:00:03+03:00',
  TYPE_ID: 1,
  ...over,
})

describe('fetchDealBirths', () => {
  it('walks TYPE_ID 1 rows above the floor, in id order, and reads each into a birth', async () => {
    const { provider, batches } = portal((_c, key) => (key === 'c0' ? [row(5019636), row(5019638, { OWNER_ID: 1161680, CATEGORY_ID: 20, STAGE_ID: 'C20:NEW' })] : { error: 'INVALID_ARG_VALUE' }))

    const answer = await provider.fetchDealBirths('5019600')

    const first = decodeURIComponent(batches[0]!.c0!)
    expect(first).toContain('crm.stagehistory.list?')
    expect(first).toContain('filter[TYPE_ID]=1')
    expect(first).toContain('filter[>ID]=5019600')
    expect(first).toContain('order[ID]=ASC')
    expect(answer).toEqual({
      complete: true,
      births: [
        { externalId: '5019636', dealExternalId: '1161678', categoryId: 0, stageExternalId: 'UC_MVRVO1', bornAt: new Date('2026-10-20T19:00:03.000Z') },
        { externalId: '5019638', dealExternalId: '1161680', categoryId: 20, stageExternalId: 'C20:NEW', bornAt: new Date('2026-10-20T19:00:03.000Z') },
      ],
    })
  })

  it('reads the MOVES with TYPE_ID 5 — the pipeline a deal moved into, at the move\'s instant (2026-10-26)', async () => {
    const { provider, batches } = portal((_c, key) => (key === 'c0' ? [row(5019700, { TYPE_ID: 5, CATEGORY_ID: 0, STAGE_ID: 'NEW' })] : { error: 'INVALID_ARG_VALUE' }))
    const answer = await provider.fetchDealBirths('5019600', 5)
    expect(decodeURIComponent(batches[0]!.c0!)).toContain('filter[TYPE_ID]=5')
    expect(answer.births).toEqual([{ externalId: '5019700', dealExternalId: '1161678', categoryId: 0, stageExternalId: 'NEW', bornAt: new Date('2026-10-20T19:00:03.000Z') }])
    const born = portal((_c, key) => (key === 'c0' ? [row(5019701)] : { error: 'INVALID_ARG_VALUE' }))
    await expect(born.provider.fetchDealBirths('5019600', 5)).rejects.toThrow(/bitim koʻchishi.*filtr eʼtiborsiz qoldi/)
  })

  it('refuses a row of another kind or at the floor — an ignored filter must not be appended', async () => {
    const moved = portal((_c, key) => (key === 'c0' ? [row(5019636, { TYPE_ID: 5 })] : { error: 'INVALID_ARG_VALUE' }))
    await expect(moved.provider.fetchDealBirths('5019600')).rejects.toThrow(/filtr eʼtiborsiz qoldi/)
    const old = portal((_c, key) => (key === 'c0' ? [row(5019600)] : { error: 'INVALID_ARG_VALUE' }))
    await expect(old.provider.fetchDealBirths('5019600')).rejects.toThrow(/filtr eʼtiborsiz qoldi/)
  })
})

function fakeClock(initial: unknown = null) {
  let state = initial
  const log: string[] = []
  const clock: FeedClock = {
    async read(feed: LeadWatchFeed) {
      log.push(`read:${feed}`)
      return state === null ? null : JSON.parse(JSON.stringify(state))
    },
    async remember(feed, next) {
      state = next
      log.push(`remember:${feed}`)
    },
    async succeeded(feed, next) {
      state = next
      log.push(`succeeded:${feed}`)
    },
    async failed(feed) {
      log.push(`failed:${feed}`)
    },
  }
  return { clock, log, state: () => state }
}

function fakeStore() {
  const written: RawDealBirth[] = []
  const store: DealBirthStore = {
    async insert(births) {
      written.push(...births)
      return births.length
    },
  }
  return { store, written }
}

const birth = (id: string, bornAt = new Date('2026-10-22T09:00:00.000Z')): RawDealBirth => ({
  externalId: id,
  dealExternalId: `d${id}`,
  categoryId: 0,
  stageExternalId: 'UC_MVRVO1',
  bornAt,
})

describe('refreshDealBirths', () => {
  it('finds its first floor once, walks to the newest, and only then calls the table whole', async () => {
    const { clock, log, state } = fakeClock()
    const { store, written } = fakeStore()
    const asked: string[] = []
    const r = await refreshDealBirths({
      clock,
      store,
      fetch: async (after) => {
        asked.push(after)
        return after === '3276553' ? { births: [birth('3276554'), birth('3276560')], complete: false } : { births: [birth('3276570')], complete: true }
      },
      firstIdSince: async () => '3276554',
      from: FROM,
      now: NOW,
    })
    expect(asked).toEqual(['3276553', '3276560'])
    expect(written.map((b) => b.externalId)).toEqual(['3276554', '3276560', '3276570'])
    expect(r).toMatchObject({ complete: true, bootstrap: true, read: 3, written: 3, floor: '3276570' })
    expect(log).toEqual(['read:births', 'remember:births', 'succeeded:births'])
    expect(parseDealBirthsState(state())).toEqual({ floor: '3276570', from: FROM })
  })

  it('keeps its floor behind the births of the last minutes, so a late commit is read again', async () => {
    const { clock } = fakeClock({ floor: '100', from: FROM.toISOString() })
    const { store } = fakeStore()
    const fresh = new Date(NOW.getTime() - DEAL_BIRTH_OVERLAP_MS / 2)
    const r = await refreshDealBirths({
      clock,
      store,
      fetch: async () => ({ births: [birth('101'), birth('102', fresh)], complete: true }),
      firstIdSince: async () => null,
      from: FROM,
      now: NOW,
    })
    expect(r.floor).toBe('101')
  })

  it('stops at its cap without calling the table whole, and a failure keeps what came before it', async () => {
    const capped = fakeClock({ floor: '100', from: FROM.toISOString() })
    const r = await refreshDealBirths({
      clock: capped.clock,
      store: fakeStore().store,
      fetch: async (after) => ({ births: [birth(String(Number(after) + 1))], complete: false }),
      firstIdSince: async () => null,
      from: FROM,
      now: NOW,
      maxBatches: 2,
    })
    expect(r.complete).toBe(false)
    expect(capped.log).toEqual(['read:births', 'remember:births'])

    const failing = fakeClock({ floor: '100', from: FROM.toISOString() })
    let n = 0
    await expect(
      refreshDealBirths({
        clock: failing.clock,
        store: fakeStore().store,
        fetch: async () => {
          if (n++ > 0) throw new Error('portal refused')
          return { births: [birth('150')], complete: false }
        },
        firstIdSince: async () => null,
        from: FROM,
        now: NOW,
      }),
    ).rejects.toThrow('portal refused')
    expect(parseDealBirthsState(failing.state())!.floor).toBe('150')
  })

  it('the moves keep a bookmark of their own', async () => {
    const { clock, log } = fakeClock()
    const r = await refreshDealBirths({
      feed: 'moves',
      clock,
      store: fakeStore().store,
      fetch: async () => ({ births: [birth('900')], complete: true }),
      firstIdSince: async () => '900',
      from: FROM,
      now: NOW,
    })
    expect(r).toMatchObject({ complete: true, bootstrap: true, floor: '900' })
    expect(log).toEqual(['read:moves', 'remember:moves', 'succeeded:moves'])
    await expect(
      refreshDealBirths({ feed: 'moves', clock: fakeClock().clock, store: fakeStore().store, fetch: async () => ({ births: [], complete: true }), firstIdSince: async () => null, from: FROM, now: NOW }),
    ).rejects.toThrow(/bitim koʻchishlari: boshlanish nuqtasi topilmadi/)
  })

  it('throws rather than walking the portal\'s whole history when no first floor is found', async () => {
    await expect(
      refreshDealBirths({ clock: fakeClock().clock, store: fakeStore().store, fetch: async () => ({ births: [], complete: true }), firstIdSince: async () => null, from: FROM, now: NOW }),
    ).rejects.toThrow(/boshlanish nuqtasi topilmadi/)
  })
})
