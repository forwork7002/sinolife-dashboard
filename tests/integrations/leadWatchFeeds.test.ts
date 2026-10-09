import { afterEach, describe, expect, it, vi } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { OPEN_LINE_BOT_USER_ID, OPEN_LINE_PROVIDER_ID, openLineName, openLineSubject } from '@/server/integrations/crm/bitrix24/mapping'
import type { FetchOptions, Page, RawCall, RawOpenLineChat } from '@/server/integrations/crm/CrmProvider'
import {
  type ChatStore,
  type ChatsState,
  type FeedClock,
  type LeadWatchFeed,
  CALLS_OVERLAP_MS,
  CALLS_SETTLE_EVERY_MS,
  CALLS_SETTLE_REACH_MS,
  CHAT_ANCHOR_EVERY_MS,
  CHAT_WINDOW_MS,
  advanceChatWindow,
  chatAnchorDue,
  chatGoneLimit,
  chatsGone,
  describeFeedError,
  parseCallsState,
  parseChatsState,
  recentCallsWindow,
  refreshOpenLineChats,
  refreshRecentCalls,
} from '@/server/integrations/crm/sync/leadWatchFeeds'

/**
 * «Лид назорати»'s two feeds — the recent calls and the open-line chats the
 * worker reads every two minutes. The chats pass REPLACES its table with what
 * the portal answered, so every way that answer can be wrong has to throw, and
 * every way a whole answer can be implausible has to be held, not believed.
 */

const NOW = new Date('2026-10-09T10:00:00.000Z')
const MIN = 60_000
const HOUR = 60 * MIN

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** `lead_watch_sync`, in memory, with a log of what was done to it. */
function fakeClock(initial: Partial<Record<LeadWatchFeed, unknown>> = {}) {
  const state: Partial<Record<LeadWatchFeed, unknown>> = { ...initial }
  const log: string[] = []
  const succeededAt: Partial<Record<LeadWatchFeed, Date>> = {}
  const failures: string[] = []
  const clock: FeedClock = {
    async read(feed) {
      // Through JSON, as the database would hand it back.
      return state[feed] === undefined ? null : JSON.parse(JSON.stringify(state[feed]))
    },
    async remember(feed, next) {
      state[feed] = next
      log.push(`remember:${feed}`)
    },
    async succeeded(feed, next, at) {
      state[feed] = next
      succeededAt[feed] = at
      log.push(`succeeded:${feed}`)
    },
    async failed(feed, message) {
      failures.push(message)
      log.push(`failed:${feed}`)
    },
  }
  return { clock, state, log, succeededAt, failures }
}

/** `open_line_chat`, in memory. */
function fakeStore(ids: readonly string[] = []) {
  let held = new Set(ids)
  const calls: { live: string[]; keepMissing: boolean }[] = []
  const store: ChatStore = {
    async openIds() {
      return [...held]
    },
    async replace(chats, _at, keepMissing) {
      const live = chats.map((c) => c.externalId)
      calls.push({ live, keepMissing })
      const next = new Set(keepMissing ? [...held, ...live] : live)
      const deleted = keepMissing ? 0 : [...held].filter((id) => !next.has(id)).length
      held = next
      return { deleted }
    },
  }
  return { store, calls, ids: () => [...held].sort() }
}

const chat = (id: string, over: Partial<RawOpenLineChat> = {}): RawOpenLineChat => ({
  externalId: id,
  dealExternalId: `9${id}`,
  responsibleExternalId: '42',
  subject: 'Чат открытой линии - "Madina - sinolifeuz instagram" (NEXTBOT)',
  openedAt: new Date(NOW.getTime() - 20 * MIN),
  ...over,
})

/** A portal that answers `crm.activity.list` through `answer`, recording what it was asked. */
function activityPortal(answer: (body: Record<string, unknown>, n: number) => unknown, status = 200) {
  const bodies: Record<string, unknown>[] = []
  const urls: string[] = []
  const fetchImpl = (async (url: string, init: { body: string }) => {
    urls.push(url)
    const body = JSON.parse(init.body) as Record<string, unknown>
    bodies.push(body)
    return new Response(JSON.stringify(answer(body, bodies.length)), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return {
    bodies,
    urls,
    provider: new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, rateLimitRps: 1000 }),
  }
}

const activity = (ID: string, over: Record<string, unknown> = {}) => ({
  ID,
  OWNER_ID: '1081546',
  OWNER_TYPE_ID: '2',
  RESPONSIBLE_ID: '42',
  SUBJECT: 'Чат открытой линии - "Madina - sinolifeuz instagram" (NEXTBOT)',
  CREATED: '2026-10-09T12:40:00+03:00',
  COMPLETED: 'N',
  PROVIDER_ID: OPEN_LINE_PROVIDER_ID,
  ...over,
})

// ---------------------------------------------------------------------------
// The portal's vocabulary
// ---------------------------------------------------------------------------

describe('openLineName', () => {
  it('reads the line after the user’s name', () => {
    expect(openLineName('Чат открытой линии - "Madina - sinolifeuz instagram" (NEXTBOT)')).toBe('sinolifeuz instagram')
    expect(openLineName('Чат открытой линии - "Ali - collagen.marine" (NEXTBOT)')).toBe('collagen.marine')
  })

  it('takes the LAST dash: a name can carry one of its own', () => {
    expect(openLineName('Чат открытой линии - "Abdu - Rahmon - zextra.sinolife" (NEXTBOT)')).toBe('zextra.sinolife')
  })

  it('reads the other quote spellings, and a subject cut before its closing quote', () => {
    expect(openLineName('Чат открытой линии - «Madina - sinolif_tg» (NEXTBOT)')).toBe('sinolif_tg')
    expect(openLineName('Чат открытой линии - "Madina - sinolifeuz instagram')).toBe('sinolifeuz instagram')
  })

  it('names who wrote, too', () => {
    expect(openLineSubject('Чат открытой линии - "Abdu - Rahmon - zextra.sinolife" (NEXTBOT)')).toEqual({ user: 'Abdu - Rahmon', line: 'zextra.sinolife' })
    expect(openLineSubject('Чат открытой линии - "sinolif_tg"')).toEqual({ user: null, line: 'sinolif_tg' })
    expect(openLineSubject('Звонок')).toEqual({ user: null, line: null })
  })

  it('is null for anything that is not the portal’s shape', () => {
    expect(openLineName(null)).toBeNull()
    expect(openLineName('')).toBeNull()
    expect(openLineName('Звонок клиенту')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The open chats' read
// ---------------------------------------------------------------------------

describe('fetchOpenLineChats', () => {
  it('asks for a person’s open chats above the floor, by id, with no row count', async () => {
    const { provider, bodies, urls } = activityPortal(() => ({ result: [activity('5001'), activity('5007', { RESPONSIBLE_ID: '77', OWNER_ID: '1090000' })] }))

    const chats = await provider.fetchOpenLineChats('4990')

    expect(urls).toEqual(['https://portal/rest/1/tok/crm.activity.list.json'])
    expect(bodies[0]).toEqual({
      order: { ID: 'ASC' },
      filter: {
        PROVIDER_ID: 'IMOPENLINES_SESSION',
        COMPLETED: 'N',
        OWNER_TYPE_ID: '2',
        '!RESPONSIBLE_ID': OPEN_LINE_BOT_USER_ID,
        '>ID': '4990',
      },
      select: ['ID', 'OWNER_ID', 'OWNER_TYPE_ID', 'RESPONSIBLE_ID', 'SUBJECT', 'CREATED', 'COMPLETED', 'PROVIDER_ID'],
      // The indexed seek: -1 skips the count that made offsets cost twenty-five minutes.
      start: -1,
    })
    // No date anywhere: the dated form of this read took 12–16 s a page on the live portal.
    expect(JSON.stringify(bodies[0])).not.toMatch(/CREATED"\s*:|>=|DATE/)
    expect(chats).toEqual([
      {
        externalId: '5001',
        dealExternalId: '1081546',
        responsibleExternalId: '42',
        subject: 'Чат открытой линии - "Madina - sinolifeuz instagram" (NEXTBOT)',
        openedAt: new Date('2026-10-09T09:40:00.000Z'),
      },
      {
        externalId: '5007',
        dealExternalId: '1090000',
        responsibleExternalId: '77',
        subject: 'Чат открытой линии - "Madina - sinolifeuz instagram" (NEXTBOT)',
        openedAt: new Date('2026-10-09T09:40:00.000Z'),
      },
    ])
  })

  it('seeks on from the last id of a full page', async () => {
    const first = Array.from({ length: 50 }, (_, i) => activity(String(6000 + i)))
    const { provider, bodies } = activityPortal((_body, n) => ({ result: n === 1 ? first : [activity('6100')] }))

    const chats = await provider.fetchOpenLineChats('5999')

    expect(chats).toHaveLength(51)
    expect(bodies.map((b) => (b.filter as Record<string, unknown>)['>ID'])).toEqual(['5999', '6049'])
  })

  it('answers an empty list as an empty list', async () => {
    const { provider } = activityPortal(() => ({ result: [] }))
    expect(await provider.fetchOpenLineChats('1')).toEqual([])
  })

  it.each([
    ['the bot’s chat', activity('5001', { RESPONSIBLE_ID: OPEN_LINE_BOT_USER_ID })],
    ['a completed chat', activity('5001', { COMPLETED: 'Y' })],
    ['another provider’s activity', activity('5001', { PROVIDER_ID: 'VOXIMPLANT_CALL' })],
    ['an activity that is not a deal’s', activity('5001', { OWNER_TYPE_ID: '3' })],
    ['an id at the floor', activity('4990')],
    ['an id under the floor', activity('12')],
    ['a row with no id', activity('')],
  ])('throws on %s — what an ignored filter looks like', async (_name, row) => {
    const { provider } = activityPortal(() => ({ result: [activity('5000'), row] }))
    await expect(provider.fetchOpenLineChats('4990')).rejects.toThrow(/filtr eʼtiborsiz qoldi/)
  })

  it('prints the offending id only when it is one', async () => {
    const odd = activityPortal(() => ({ result: [activity('5001<script>', { COMPLETED: 'Y' })] }))
    await expect(odd.provider.fetchOpenLineChats('4990')).rejects.toThrow(/qaytardi: — — filtr/)
    const numeric = activityPortal(() => ({ result: [activity('5001', { COMPLETED: 'Y' })] }))
    await expect(numeric.provider.fetchOpenLineChats('4990')).rejects.toThrow(/qaytardi: 5001 — filtr/)
  })

  it('throws on a row it cannot place or date', async () => {
    for (const row of [activity('5001', { CREATED: '' }), activity('5001', { OWNER_ID: '' })]) {
      const { provider } = activityPortal(() => ({ result: [row] }))
      await expect(provider.fetchOpenLineChats('4990')).rejects.toThrow(/bitim yoki sana yoʻq/)
    }
  })

  it('throws on an answer that is not a list', async () => {
    const { provider } = activityPortal(() => ({ result: { total: 3 } }))
    await expect(provider.fetchOpenLineChats('4990')).rejects.toThrow(/roʻyxat qaytarmadi/)
  })

  it('refuses a walk that will not end rather than replacing the table with it', async () => {
    let next = 7000
    const { provider, bodies } = activityPortal(() => ({ result: Array.from({ length: 50 }, () => activity(String(next++))) }))
    await expect(provider.fetchOpenLineChats('6999')).rejects.toThrow(/sahifadan oshdi/)
    expect(bodies).toHaveLength(10)
  })

  it('asks once and does not retry a refused read', async () => {
    const { provider, bodies } = activityPortal(() => ({ error: 'INTERNAL_SERVER_ERROR' }), 500)
    await expect(provider.fetchOpenLineChats('4990')).rejects.toThrow()
    expect(bodies).toHaveLength(1)
  })
})

describe('the window’s two helper reads', () => {
  it('finds the portal’s newest activity with no filter at all', async () => {
    const { provider, bodies } = activityPortal(() => ({ result: [{ ID: '881234' }, { ID: '881233' }] }))
    expect(await provider.newestActivityId()).toBe('881234')
    expect(bodies).toEqual([{ order: { ID: 'DESC' }, select: ['ID'], start: -1 }])
  })

  it('finds the first activity since an instant, by date, with no provider in the filter', async () => {
    const { provider, bodies } = activityPortal(() => ({ result: [{ ID: '866000', CREATED: '2026-10-08T13:00:02+03:00' }] }))
    expect(await provider.firstActivityIdSince(new Date('2026-10-08T10:00:00.000Z'))).toBe('866000')
    expect(bodies).toEqual([
      { order: { ID: 'ASC' }, filter: { '>=CREATED': '2026-10-08T10:00:00+00:00' }, select: ['ID', 'CREATED'], start: -1 },
    ])
  })

  it('asks whether any open-line chat is open at all, the bot’s included, on one page', async () => {
    const some = activityPortal(() => ({ result: [{ ID: '5001' }] }))
    expect(await some.provider.anyOpenLineChat('4990')).toBe(true)
    expect(some.bodies).toEqual([
      { order: { ID: 'ASC' }, filter: { PROVIDER_ID: 'IMOPENLINES_SESSION', COMPLETED: 'N', OWNER_TYPE_ID: '2', '>ID': '4990' }, select: ['ID'], start: -1 },
    ])
    expect(await activityPortal(() => ({ result: [] })).provider.anyOpenLineChat('4990')).toBe(false)
    await expect(activityPortal(() => ({ result: {} })).provider.anyOpenLineChat('4990')).rejects.toThrow(/roʻyxat qaytarmadi/)
  })

  it('answers null on an empty list and throws on a non-list', async () => {
    expect(await activityPortal(() => ({ result: [] })).provider.newestActivityId()).toBeNull()
    await expect(activityPortal(() => ({ result: null })).provider.firstActivityIdSince(NOW)).rejects.toThrow(/roʻyxat qaytarmadi/)
  })
})

// ---------------------------------------------------------------------------
// What may be logged
// ---------------------------------------------------------------------------

describe('describeFeedError', () => {
  it('passes the provider’s own, already redacted errors, capped', () => {
    const error = Object.assign(new Error('Bitrix24 error: OVERLOAD_LIMIT (REST API is blocked due to overload)'), { name: 'Bitrix24Error' })
    expect(describeFeedError(error)).toBe('Bitrix24 error: OVERLOAD_LIMIT (REST API is blocked due to overload)')
    expect(describeFeedError(Object.assign(new Error('x'.repeat(900)), { name: 'Bitrix24Error' }))).toHaveLength(500)
  })

  it('reduces anything else to its class, its code and one struck-out line', () => {
    const driver = Object.assign(
      new Error('connect failed for postgresql://app:hunter2@db.internal:25060/sinolife?sslmode=require\nDETAIL: Key ("subject")=(Чат "Madina") already exists'),
      { name: 'PrismaClientKnownRequestError', code: 'P2002' },
    )
    const text = describeFeedError(driver)
    expect(text).toBe('PrismaClientKnownRequestError [P2002]: connect failed for ‹url›')
    expect(text).not.toMatch(/hunter2|db\.internal|Madina/)

    expect(describeFeedError(new Error('auth: token=abcDEF123 password: s3cret'))).toBe('Error: auth: token=‹…› password=‹…›')
    expect(describeFeedError(new Error(`key ${'k'.repeat(40)} refused`))).toBe('Error: key ‹…› refused')
    expect(describeFeedError(new Error('y'.repeat(900))).length).toBeLessThanOrEqual(170)
    expect(describeFeedError('boom')).toBe('string: boom')
  })

  it('keeps our own sentences readable', () => {
    expect(describeFeedError(new Error('3 ta ochiq chat birdan yoʻqoldi'))).toBe('Error: 3 ta ochiq chat birdan yoʻqoldi')
  })
})

// ---------------------------------------------------------------------------
// Recent calls
// ---------------------------------------------------------------------------

describe('recentCallsWindow', () => {
  const dayStart = new Date('2026-10-08T19:00:00.000Z') // 00:00 in Tashkent

  it('makes a database’s first pass a settle read, not the whole day', () => {
    // The three-hourly reference pass already holds the rest of the day.
    expect(recentCallsWindow(null, NOW, dayStart)).toEqual({ since: new Date(NOW.getTime() - CALLS_SETTLE_REACH_MS), settle: true })
  })

  it('re-reads the overlap behind the last pass', () => {
    const state = { passAt: new Date(NOW.getTime() - 2 * MIN), settledAt: new Date(NOW.getTime() - 4 * MIN) }
    expect(recentCallsWindow(state, NOW, dayStart)).toEqual({
      since: new Date(NOW.getTime() - 2 * MIN - CALLS_OVERLAP_MS),
      settle: false,
    })
  })

  it('reaches back past the longest call when a settle read is due', () => {
    const state = { passAt: new Date(NOW.getTime() - 2 * MIN), settledAt: new Date(NOW.getTime() - CALLS_SETTLE_EVERY_MS) }
    expect(recentCallsWindow(state, NOW, dayStart)).toEqual({ since: new Date(NOW.getTime() - CALLS_SETTLE_REACH_MS), settle: true })
    const justBefore = { ...state, settledAt: new Date(NOW.getTime() - CALLS_SETTLE_EVERY_MS + 1) }
    expect(recentCallsWindow(justBefore, NOW, dayStart).settle).toBe(false)
  })

  it('leaves the days before today to the reference pass after a long stop', () => {
    const state = { passAt: new Date('2026-10-07T12:00:00.000Z'), settledAt: new Date(NOW.getTime() - MIN) }
    expect(recentCallsWindow(state, NOW, dayStart).since).toEqual(dayStart)
  })

  it('reads its bookmark back, and nothing from a row it does not understand', () => {
    expect(parseCallsState({ passAt: '2026-10-09T09:58:00.000Z', settledAt: null })).toEqual({
      passAt: new Date('2026-10-09T09:58:00.000Z'),
      settledAt: null,
    })
    for (const junk of [null, 'x', [], {}, { passAt: 'yesterday' }]) expect(parseCallsState(junk)).toBeNull()
  })
})

describe('refreshRecentCalls', () => {
  const dayStart = new Date('2026-10-08T19:00:00.000Z')
  const call = (id: string): RawCall => ({
    externalId: id,
    direction: 'INBOUND',
    startedAt: new Date(NOW.getTime() - 3 * MIN),
    durationSec: 0,
    connected: false,
  })

  it('walks every page, writes each through the ordinary upsert and moves the bookmark', async () => {
    const { clock, state, succeededAt } = fakeClock({
      calls: { passAt: new Date(NOW.getTime() - 2 * MIN).toISOString(), settledAt: new Date(NOW.getTime() - 5 * MIN).toISOString() },
    })
    const asked: FetchOptions[] = []
    const pages: Page<RawCall>[] = [{ items: [call('1'), call('2')], nextCursor: '0:2' }, { items: [call('3')] }]
    const written: string[][] = []

    const r = await refreshRecentCalls({
      clock,
      fetch: async (options) => {
        asked.push(options)
        return pages[asked.length - 1]!
      },
      persist: async (calls) => {
        written.push(calls.map((c) => c.externalId))
        return { failed: 0 }
      },
      now: NOW,
      dayStart,
    })

    const since = new Date(NOW.getTime() - 2 * MIN - CALLS_OVERLAP_MS)
    expect(asked).toEqual([
      { updatedSince: since, cursor: undefined },
      { updatedSince: since, cursor: '0:2' },
    ])
    expect(written).toEqual([['1', '2'], ['3']])
    expect(r).toEqual({ since, settle: false, read: 3, pages: 2, failed: 0, stopped: false })
    // The next pass starts from THIS pass's start; the settle clock did not move.
    expect(state.calls).toEqual({ passAt: NOW.toISOString(), settledAt: new Date(NOW.getTime() - 5 * MIN).toISOString() })
    expect(succeededAt.calls).toEqual(NOW)
  })

  it('stamps the settle read when it made one', async () => {
    const { clock, state } = fakeClock()
    const r = await refreshRecentCalls({ clock, fetch: async () => ({ items: [] }), persist: async () => ({ failed: 0 }), now: NOW, dayStart })
    expect(r).toMatchObject({ since: new Date(NOW.getTime() - CALLS_SETTLE_REACH_MS), settle: true, read: 0, pages: 1 })
    expect(state.calls).toEqual({ passAt: NOW.toISOString(), settledAt: NOW.toISOString() })
  })

  it('keeps the bookmark when a read fails, so the stretch is read again', async () => {
    const before = { passAt: new Date(NOW.getTime() - 2 * MIN).toISOString(), settledAt: NOW.toISOString() }
    const { clock, state, log } = fakeClock({ calls: before })
    await expect(
      refreshRecentCalls({
        clock,
        fetch: async () => {
          throw new Error('Bitrix24 error: OVERLOAD_LIMIT')
        },
        persist: async () => ({ failed: 0 }),
        now: NOW,
        dayStart,
      }),
    ).rejects.toThrow(/OVERLOAD_LIMIT/)
    expect(state.calls).toEqual(before)
    expect(log).toEqual([])
  })

  it('stops between two pages when the worker is stopping, and leaves the bookmark', async () => {
    const before = { passAt: new Date(NOW.getTime() - 2 * MIN).toISOString(), settledAt: NOW.toISOString() }
    const { clock, state, log } = fakeClock({ calls: before })
    let fetched = 0
    const written: string[] = []
    const r = await refreshRecentCalls({
      clock,
      fetch: async () => {
        fetched += 1
        return { items: [call(String(fetched))], nextCursor: `0:${fetched}` }
      },
      persist: async (calls) => {
        written.push(...calls.map((c) => c.externalId))
        return { failed: 0 }
      },
      now: NOW,
      dayStart,
      stopping: () => fetched >= 2,
    })
    // The page in hand is written (an upsert, read again next start); no third page is asked for.
    expect(fetched).toBe(2)
    expect(written).toEqual(['1', '2'])
    expect(r).toMatchObject({ read: 2, pages: 2, stopped: true })
    expect(state.calls).toEqual(before)
    expect(log).toEqual([])
  })

  it('reports a rejected row and moves on rather than re-reading a growing day', async () => {
    const { clock, state } = fakeClock()
    const r = await refreshRecentCalls({
      clock,
      fetch: async () => ({ items: [call('1'), call('2')] }),
      persist: async () => ({ failed: 1 }),
      now: NOW,
      dayStart,
    })
    expect(r.failed).toBe(1)
    expect(state.calls).toMatchObject({ passAt: NOW.toISOString() })
  })
})

// ---------------------------------------------------------------------------
// The chats' window
// ---------------------------------------------------------------------------

describe('the open chats’ window', () => {
  const empty: ChatsState = { floor: '100', dated: true, anchors: [], heldAt: null }

  it('owes an anchor when there is none, or the newest is an hour old', () => {
    expect(chatAnchorDue(empty, NOW)).toBe(true)
    const at = (ms: number): ChatsState => ({ ...empty, anchors: [{ id: '500', at: new Date(NOW.getTime() - ms) }] })
    expect(chatAnchorDue(at(CHAT_ANCHOR_EVERY_MS - 1), NOW)).toBe(false)
    expect(chatAnchorDue(at(CHAT_ANCHOR_EVERY_MS), NOW)).toBe(true)
  })

  it('notes the head and leaves the floor until an anchor is a whole window old', () => {
    const next = advanceChatWindow(empty, '900', NOW)
    expect(next.floor).toBe('100')
    expect(next.anchors).toEqual([{ id: '900', at: NOW }])
  })

  it('raises the floor to the newest anchor a window old, and drops the ones behind it', () => {
    const state: ChatsState = {
      ...empty,
      anchors: [
        { id: '300', at: new Date(NOW.getTime() - CHAT_WINDOW_MS - 2 * HOUR) },
        { id: '400', at: new Date(NOW.getTime() - CHAT_WINDOW_MS) },
        { id: '500', at: new Date(NOW.getTime() - CHAT_WINDOW_MS + 1) },
        { id: '800', at: new Date(NOW.getTime() - HOUR) },
      ],
    }
    const next = advanceChatWindow(state, null, NOW)
    expect(next.floor).toBe('400')
    expect(next.anchors.map((a) => a.id)).toEqual(['400', '500', '800'])
  })

  it('never lowers the floor', () => {
    const state: ChatsState = { ...empty, floor: '700', anchors: [{ id: '400', at: new Date(NOW.getTime() - CHAT_WINDOW_MS) }] }
    expect(advanceChatWindow(state, null, NOW).floor).toBe('700')
  })

  it('reads its bookmark back, dropping what is not an id or a date', () => {
    expect(
      parseChatsState({
        floor: '4990',
        dated: true,
        anchors: [{ id: '5000', at: '2026-10-09T09:00:00.000Z' }, { id: 'x', at: '2026-10-09T09:00:00.000Z' }, { id: '5', at: 'soon' }, null],
        heldAt: null,
      }),
    ).toEqual({ floor: '4990', dated: true, anchors: [{ id: '5000', at: new Date('2026-10-09T09:00:00.000Z') }], heldAt: null })
    expect(parseChatsState({ floor: 'DROP TABLE' })).toEqual({ floor: null, dated: false, anchors: [], heldAt: null })
    expect(parseChatsState(null)).toBeNull()
  })
})

describe('what a pass may delete', () => {
  const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(from + i))

  it('lets a handful close, and holds most of the table going at once', () => {
    expect(chatGoneLimit(4)).toBe(10)
    expect(chatGoneLimit(30)).toBe(15)

    const stored = ids(1000, 30)
    const some = new Set(stored.slice(15))
    expect(chatsGone(stored, some, '0', false)).toEqual({ gone: 15, hold: false })
    const most = new Set(stored.slice(16))
    expect(chatsGone(stored, most, '0', false)).toEqual({ gone: 16, hold: true })
    expect(chatsGone(stored, new Set(), '0', false)).toEqual({ gone: 30, hold: true })
  })

  it('believes the same answer the second time', () => {
    expect(chatsGone(ids(1000, 30), new Set(), '0', true)).toEqual({ gone: 30, hold: false })
  })

  it('does not judge the rows that aged out under the floor', () => {
    // Forty stored, thirty of them under the floor now: the portal was not asked about those.
    const stored = [...ids(100, 30), ...ids(1000, 10)]
    expect(chatsGone(stored, new Set(ids(1000, 10)), '999', false)).toEqual({ gone: 0, hold: false })
  })
})

// ---------------------------------------------------------------------------
// The chats' pass
// ---------------------------------------------------------------------------

describe('refreshOpenLineChats', () => {
  /** A saved bookmark as the database holds it: JSON, dates as ISO text. */
  const settled = (over: Record<string, unknown> = {}) => ({
    floor: '4990',
    dated: true,
    anchors: [{ id: '5100', at: new Date(NOW.getTime() - 10 * MIN).toISOString() }],
    heldAt: null,
    ...over,
  })
  const never = async (): Promise<never> => {
    throw new Error('must not be asked')
  }
  type ChatDeps = Parameters<typeof refreshOpenLineChats>[0]
  /** The pass with the control read forbidden unless a case allows it — so a case that sends one says so. */
  const refreshChats = (deps: Omit<ChatDeps, 'anyOpenChat'> & Partial<Pick<ChatDeps, 'anyOpenChat'>>) =>
    refreshOpenLineChats({ anyOpenChat: never, ...deps })

  it('replaces the table with what the portal holds open now', async () => {
    const { clock, log, succeededAt } = fakeClock({ chats: settled() })
    const { store, calls, ids } = fakeStore(['5001', '5002', '5003'])
    const asked: string[] = []

    const r = await refreshChats({
      clock,
      store,
      fetchChats: async (afterId) => {
        asked.push(afterId)
        return [chat('5002'), chat('5050')]
      },
      newestId: never,
      firstIdSince: never,
      now: NOW,
    })

    // One read, above the saved floor; no anchor (ten minutes old), no dated read.
    expect(asked).toEqual(['4990'])
    expect(calls).toEqual([{ live: ['5002', '5050'], keepMissing: false }])
    expect(ids()).toEqual(['5002', '5050'])
    expect(r).toEqual({ open: 2, deleted: 2, held: 0, floor: '4990', bootstrap: null })
    expect(log).toEqual(['succeeded:chats'])
    expect(succeededAt.chats).toEqual(NOW)
  })

  it('wipes nothing when the read fails', async () => {
    const { clock, log } = fakeClock({ chats: settled() })
    const { store, calls, ids } = fakeStore(['5001', '5002'])
    await expect(
      refreshChats({
        clock,
        store,
        fetchChats: async () => {
          throw new Error('Bitrix24 error: OVERLOAD_LIMIT')
        },
        newestId: never,
        firstIdSince: never,
        now: NOW,
      }),
    ).rejects.toThrow(/OVERLOAD_LIMIT/)
    expect(calls).toEqual([])
    expect(ids()).toEqual(['5001', '5002'])
    expect(log).toEqual([])
  })

  it('holds an answer that empties most of the table, and believes it the second time', async () => {
    const stored = Array.from({ length: 30 }, (_, i) => String(5000 + i))
    const { clock, log, failures, state } = fakeClock({ chats: settled() })
    const { store, calls, ids } = fakeStore(stored)
    const pass = (now: Date) => refreshChats({ clock, store, fetchChats: async () => [chat('5005')], newestId: never, firstIdSince: never, now })

    const first = await pass(NOW)
    expect(first).toMatchObject({ open: 1, deleted: 0, held: 29 })
    expect(calls[0]).toEqual({ live: ['5005'], keepMissing: true })
    expect(ids()).toHaveLength(30)
    // Not a success: the screen's clock must not call doubted rows current.
    expect(log).toEqual(['remember:chats', 'failed:chats'])
    expect(failures[0]).toMatch(/29 ta ochiq chat birdan yoʻqoldi/)
    expect((state.chats as { heldAt: string }).heldAt).toBe(NOW.toISOString())

    const second = await pass(new Date(NOW.getTime() + 2 * MIN))
    expect(second).toMatchObject({ open: 1, deleted: 29, held: 0 })
    expect(ids()).toEqual(['5005'])
    expect(log.at(-1)).toBe('succeeded:chats')
    expect((state.chats as { heldAt: string | null }).heldAt).toBeNull()
  })

  it('does not let a hold from long ago confirm today’s answer', async () => {
    const stored = Array.from({ length: 30 }, (_, i) => String(5000 + i))
    const { clock } = fakeClock({ chats: settled({ heldAt: new Date(NOW.getTime() - 3 * HOUR).toISOString() }) })
    const { store, ids } = fakeStore(stored)
    const r = await refreshChats({ clock, store, fetchChats: async () => [chat('5005')], newestId: never, firstIdSince: never, now: NOW })
    expect(r.held).toBe(29)
    expect(ids()).toHaveLength(30)
  })

  describe('an empty answer over a table that holds chats', () => {
    const stored = Array.from({ length: 30 }, (_, i) => String(5000 + i))

    it('is believed at once when the control read shows the lines are visible', async () => {
      const { clock, log } = fakeClock({ chats: settled() })
      const { store, ids } = fakeStore(stored)
      const controls: string[] = []
      const r = await refreshChats({
        clock,
        store,
        fetchChats: async () => [],
        newestId: never,
        firstIdSince: never,
        anyOpenChat: async (afterId) => {
          controls.push(afterId)
          return true
        },
        now: NOW,
      })
      // One control read, at the same floor — and no hold: thirty chats really did close.
      expect(controls).toEqual(['4990'])
      expect(r).toMatchObject({ open: 0, deleted: 30, held: 0 })
      expect(ids()).toEqual([])
      expect(log).toEqual(['succeeded:chats'])
    })

    it('fails the pass and wipes nothing when the control read is empty too', async () => {
      const { clock, log, state } = fakeClock({ chats: settled() })
      const { store, calls, ids } = fakeStore(['5001', '5002', '5003'])
      const before = JSON.stringify(state.chats)
      await expect(
        refreshChats({ clock, store, fetchChats: async () => [], newestId: never, firstIdSince: never, anyOpenChat: async () => false, now: NOW }),
      ).rejects.toThrow(/ochiq liniyalar koʻrinmayapti/)
      // Even three rows: an answer from a portal that shows us nothing deletes nothing.
      expect(calls).toEqual([])
      expect(ids()).toEqual(['5001', '5002', '5003'])
      // No success, so the clock «Лид назорати» shows does not move; the worker records the failure.
      expect(log).toEqual([])
      expect(JSON.stringify(state.chats)).toBe(before)
    })

    it('wipes nothing when the control read itself fails', async () => {
      const { clock } = fakeClock({ chats: settled() })
      const { store, ids } = fakeStore(['5001'])
      await expect(
        refreshChats({
          clock,
          store,
          fetchChats: async () => [],
          newestId: never,
          firstIdSince: never,
          anyOpenChat: async () => {
            throw new Error('Bitrix24 error: OVERLOAD_LIMIT')
          },
          now: NOW,
        }),
      ).rejects.toThrow(/OVERLOAD_LIMIT/)
      expect(ids()).toEqual(['5001'])
    })

    it('sends no control read for an empty table, or for rows that only aged out under the floor', async () => {
      for (const held of [[], ['12', '13']]) {
        const { clock } = fakeClock({ chats: settled() })
        const { store, ids } = fakeStore(held)
        // `anyOpenChat` is the default here: it throws if asked.
        const r = await refreshChats({ clock, store, fetchChats: async () => [], newestId: never, firstIdSince: never, now: NOW })
        expect(r).toMatchObject({ open: 0, held: 0 })
        expect(ids()).toEqual([])
      }
    })

    it('costs the portal exactly two requests: the read, and one control page', async () => {
      const { provider, bodies } = activityPortal((body) =>
        // The people's chats: none. With the bot's: a full page — which must NOT be walked on.
        '!RESPONSIBLE_ID' in (body.filter as Record<string, unknown>) ? { result: [] } : { result: Array.from({ length: 50 }, (_, i) => ({ ID: String(6000 + i) })) },
      )
      const { clock } = fakeClock({ chats: settled() })
      const { store, ids } = fakeStore(['5001', '5002'])
      const r = await refreshOpenLineChats({
        clock,
        store,
        fetchChats: (afterId) => provider.fetchOpenLineChats(afterId),
        newestId: never,
        firstIdSince: never,
        anyOpenChat: (afterId) => provider.anyOpenLineChat(afterId),
        now: NOW,
      })
      expect(r).toMatchObject({ open: 0, deleted: 2 })
      expect(ids()).toEqual([])
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).toEqual({
        order: { ID: 'ASC' },
        // The same floor and filter, without `!RESPONSIBLE_ID`.
        filter: { PROVIDER_ID: 'IMOPENLINES_SESSION', COMPLETED: 'N', OWNER_TYPE_ID: '2', '>ID': '4990' },
        select: ['ID'],
        start: -1,
      })
    })
  })

  it('notes the hour’s anchor and moves the floor up a day behind it', async () => {
    const { clock, state } = fakeClock({
      chats: settled({
        anchors: [
          { id: '5100', at: new Date(NOW.getTime() - CHAT_WINDOW_MS - MIN).toISOString() },
          { id: '9000', at: new Date(NOW.getTime() - CHAT_ANCHOR_EVERY_MS).toISOString() },
        ],
      }),
    })
    const { store } = fakeStore()
    const asked: string[] = []
    let heads = 0
    const r = await refreshChats({
      clock,
      store,
      fetchChats: async (afterId) => {
        asked.push(afterId)
        return []
      },
      newestId: async () => {
        heads += 1
        return '9500'
      },
      firstIdSince: never,
      now: NOW,
    })
    expect(heads).toBe(1)
    expect(asked).toEqual(['5100'])
    expect(r.floor).toBe('5100')
    expect((state.chats as { anchors: { id: string }[] }).anchors.map((a) => a.id)).toEqual(['5100', '9000', '9500'])
  })

  it('reads the chats even when the anchor is refused', async () => {
    const { clock, log } = fakeClock({ chats: settled({ anchors: [] }) })
    const { store } = fakeStore()
    const r = await refreshChats({
      clock,
      store,
      fetchChats: async () => [chat('5001')],
      newestId: async () => {
        throw new Error('refused')
      },
      firstIdSince: never,
      now: NOW,
    })
    expect(r.open).toBe(1)
    expect(log).toEqual(['succeeded:chats'])
  })

  describe('the first pass of a database', () => {
    it('finds the floor by date ONCE, a day back, and says it asked before it asks', async () => {
      const { clock, log, state } = fakeClock()
      const { store } = fakeStore()
      const order: string[] = []
      const r = await refreshChats({
        clock,
        store,
        fetchChats: async (afterId) => {
          order.push(`chats>${afterId}`)
          return [chat('866500')]
        },
        newestId: async () => {
          order.push('head')
          return '881234'
        },
        firstIdSince: async (since) => {
          // `dated` is already saved: a pass killed on this read never sends it again.
          order.push(`date:${since.toISOString()}:${JSON.stringify(state.chats)}`)
          return '866000'
        },
        now: NOW,
      })

      expect(order).toEqual([
        `date:${new Date(NOW.getTime() - CHAT_WINDOW_MS).toISOString()}:{"floor":null,"dated":true,"anchors":[],"heldAt":null}`,
        'head',
        // One under the window's first activity, so `>ID` includes it.
        'chats>865999',
      ])
      expect(r).toMatchObject({ floor: '865999', bootstrap: 'date', open: 1 })
      expect(log).toEqual(['remember:chats', 'remember:chats', 'succeeded:chats'])
      expect(state.chats).toEqual({ floor: '865999', dated: true, anchors: [{ id: '881234', at: NOW.toISOString() }], heldAt: null })
    })

    it('falls back to the head when the dated read fails, and never sends it again', async () => {
      const { clock, state } = fakeClock()
      const { store } = fakeStore()
      let dated = 0
      const deps = {
        clock,
        store,
        fetchChats: async () => [],
        newestId: async () => '881234',
        firstIdSince: async () => {
          dated += 1
          throw new Error('timeout')
        },
      }
      const first = await refreshChats({ ...deps, now: NOW })
      expect(first).toMatchObject({ floor: '881234', bootstrap: 'head' })
      expect(state.chats).toMatchObject({ floor: '881234', dated: true, anchors: [{ id: '881234' }] })

      const second = await refreshChats({ ...deps, now: new Date(NOW.getTime() + 2 * MIN) })
      expect(second.bootstrap).toBeNull()
      expect(dated).toBe(1)
    })

    it('does not send the dated read twice even when the whole first pass died', async () => {
      const { clock } = fakeClock()
      const { store } = fakeStore()
      let dated = 0
      let headDown = true
      const deps = {
        clock,
        store,
        fetchChats: async () => [],
        newestId: async () => {
          if (headDown) throw new Error('portal down')
          return '881234'
        },
        firstIdSince: async () => {
          dated += 1
          throw new Error('timeout')
        },
      }
      await expect(refreshChats({ ...deps, now: NOW })).rejects.toThrow(/portal down/)
      headDown = false
      const second = await refreshChats({ ...deps, now: new Date(NOW.getTime() + 2 * MIN) })
      expect(second).toMatchObject({ floor: '881234', bootstrap: 'head' })
      expect(dated).toBe(1)
    })

    it('starts from the head when nothing on the portal is a day new', async () => {
      const { clock } = fakeClock()
      const { store } = fakeStore()
      const r = await refreshChats({ clock, store, fetchChats: async () => [], newestId: async () => null, firstIdSince: async () => null, now: NOW })
      expect(r).toMatchObject({ floor: '0', bootstrap: 'head' })
    })
  })
})

// ---------------------------------------------------------------------------
// What an ordinary pass costs the portal
// ---------------------------------------------------------------------------

describe('an ordinary pass costs the portal two requests', () => {
  it('reads a quiet stretch of calls and the open chats in 2 requests, 3 invocations', async () => {
    // Midday UTC, so the twelve minutes read sit inside one UTC day (`fetchCalls` walks by day).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)

    const requests: { method: string; invocations: number }[] = []
    const fetchImpl = (async (url: string, init: { body: string }) => {
      const method = /rest\/1\/tok\/(.+)\.json$/.exec(url)![1]!
      const body = JSON.parse(init.body) as { cmd?: Record<string, string> }
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      if (method === 'batch') {
        const keys = Object.keys(body.cmd!)
        requests.push({ method: 'voximplant.statistic.get', invocations: keys.length })
        // Thirty calls in the stretch: a short first page ends the walk.
        const rows = Array.from({ length: 30 }, (_, i) => ({
          ID: String(700_000 + i),
          PORTAL_USER_ID: '42',
          PHONE_NUMBER: `+99800000${String(1000 + i)}`,
          CALL_TYPE: '2',
          CALL_DURATION: '0',
          CALL_START_DATE: '2026-10-09T12:55:00+03:00',
          CALL_FAILED_CODE: '304',
          CRM_ENTITY_TYPE: 'CONTACT',
          CRM_ENTITY_ID: String(500 + i),
        }))
        return json({ result: { result: { c0: rows }, result_error: { c1: { error: 'INVALID_ARG_VALUE' } } } })
      }
      requests.push({ method, invocations: 1 })
      return json({ result: [activity('5001')] })
    }) as unknown as typeof fetch
    const provider = new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, rateLimitRps: 1000 })

    const { clock } = fakeClock({
      calls: { passAt: new Date(NOW.getTime() - 2 * MIN).toISOString(), settledAt: new Date(NOW.getTime() - 4 * MIN).toISOString() },
      chats: { floor: '4990', dated: true, anchors: [{ id: '5100', at: new Date(NOW.getTime() - 10 * MIN).toISOString() }], heldAt: null },
    })
    const { store } = fakeStore()
    const written: RawCall[] = []

    const calls = await refreshRecentCalls({
      clock,
      fetch: (options) => provider.fetchCalls(options),
      persist: async (batch) => {
        written.push(...batch)
        return { failed: 0 }
      },
      now: NOW,
      dayStart: new Date('2026-10-08T19:00:00.000Z'),
    })
    const chats = await refreshOpenLineChats({
      clock,
      store,
      fetchChats: (afterId) => provider.fetchOpenLineChats(afterId),
      newestId: () => provider.newestActivityId(),
      firstIdSince: (since) => provider.firstActivityIdSince(since),
      anyOpenChat: (afterId) => provider.anyOpenLineChat(afterId),
      now: NOW,
    })

    /*
      PINNED EXACTLY, like the idle hour in portalBudget.test.ts: a range would
      absorb a third request nobody costed. 2 = the walk's narrow chain
      (`CHAIN_MIN`), 1 = the chats' one plain call.
    */
    expect(requests).toEqual([
      { method: 'voximplant.statistic.get', invocations: 2 },
      { method: 'crm.activity.list', invocations: 1 },
    ])
    expect(calls.read).toBe(30)
    expect(chats.open).toBe(1)
    // The ordinary call mapping, not a second one: the contact link and the direction as the reference pass writes them.
    expect(written[0]).toMatchObject({ externalId: '700000', customerExternalId: '500', direction: 'INBOUND', connected: false, failedCode: '304' })
    expect(provider.budget.state(new Date()).spent).toBe(3)
  })
})
