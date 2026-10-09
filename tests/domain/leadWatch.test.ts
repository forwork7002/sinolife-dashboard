import { describe, expect, it } from 'vitest'

import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'
import type { LeadSourceVocabulary } from '@/server/domain/leads/leadSources'
import {
  type FeedHourRow,
  type LeadWatchInput,
  type LeadWatchSettings,
  type WatchArrival,
  type WatchChannel,
  type WatchChat,
  type WatchFeed,
  type WatchInboundCall,
  type WatchLead,
  type WatchSplit,
  WATCH_ISSUE_KINDS,
  arrivalPercent,
  buildLeadWatch,
  channelStopIssue,
  chatChannel,
  chatsIssue,
  flowHours,
  idleIssue,
  missedCallers,
  missedCallsIssue,
  noProjectIssue,
  oldestFeed,
  silentFeeds,
  unassignedIssue,
  unevenIssue,
  watchChannel,
  watchFeed,
} from '@/server/domain/leads/leadWatch'
import { zonedHour, zonedHourStart } from '@/server/domain/period/period'

/**
 * «Лид назорати» — every rule of `domain/leads/leadWatch.ts`, at its limit.
 *
 * The thresholds are read from `LEAD_WATCH_SETTINGS`, never restated: the
 * client asked for one file to change them in, and a test that typed «10»
 * would be a second one.
 */

const TZ = 'Asia/Tashkent'
const S: LeadWatchSettings = LEAD_WATCH_SETTINGS
/** 15:00 in Tashkent on Friday 9 October 2026 — the middle of the working day. */
const NOW = new Date('2026-10-09T10:00:00.000Z')

const MIN = 60_000
const ago = (minutes: number, extraMs = 0) => new Date(NOW.getTime() - minutes * MIN - extraMs)

let nextId = 1000
const lead = (over: Partial<WatchLead> = {}): WatchLead => ({
  dealId: String(nextId++),
  title: 'Заполнение CRM-формы "Sinolife (UMAR) 777"',
  customerName: 'Dilnoza',
  createdAt: ago(5),
  open: true,
  firstStage: true,
  channel: 'generated',
  brand: 'Collagen',
  feed: null,
  origin: 'Sinolife (UMAR) 777',
  owner: 'Doniyor',
  rop: 'Azizbek',
  ropAssigned: true,
  projectFilled: true,
  lastCallAt: null,
  replayed: false,
  ...over,
})

const FORM: WatchFeed = { key: 'form|Sinolife (UMAR) 777', name: 'Sinolife (UMAR) 777', channel: 'generated', brand: 'Collagen' }
const PAGE: WatchFeed = { key: 'source|UC_MWIKOC', name: 'collagen.marine', channel: 'smm', brand: 'Collagen' }

/** `leads` a day at `hour` for `feed`, on each of the seven days before today. */
const weekOf = (feed: WatchFeed | null, hour: number, leadsPerDay: number, channel: WatchChannel = feed?.channel ?? 'inbound'): FeedHourRow[] =>
  Array.from({ length: S.channelStop.historyDays }, (_, i) => ({
    day: `2026-10-0${i + 2}`,
    hour,
    channel,
    feed,
    leads: leadsPerDay,
  }))

const input = (over: Partial<LeadWatchInput> = {}): LeadWatchInput => ({
  now: NOW,
  timeZone: TZ,
  settings: S,
  leads: [],
  history: [],
  chats: [],
  inbound: [],
  outbound: [],
  contacts: new Map(),
  arrivals: [],
  split: null,
  feedsAsOf: { deals: null, calls: null, chats: null },
  ...over,
})

describe('the clock hours the watch reads', () => {
  it('reads the wall clock of the app zone, not UTC', () => {
    expect(zonedHour(NOW, TZ)).toBe(15)
    // The day's edge: 18:59:59 UTC is still 23:59 in Tashkent, a second later it is tomorrow's first hour.
    expect(zonedHour(new Date('2026-10-09T18:59:59.000Z'), TZ)).toBe(23)
    expect(zonedHour(new Date('2026-10-09T19:00:00.000Z'), TZ)).toBe(0)
  })

  it('finds an hour of the day the instant falls on', () => {
    expect(zonedHourStart(NOW, TZ, S.workHours.from).toISOString()).toBe('2026-10-09T04:00:00.000Z')
    // 00:30 in Tashkent on the 10th is still the 9th in UTC — the working day meant is the 10th's.
    expect(zonedHourStart(new Date('2026-10-09T19:30:00.000Z'), TZ, 9).toISOString()).toBe('2026-10-10T04:00:00.000Z')
  })
})

describe('an empty day', () => {
  it('answers all seven issues, quiet, in the page order', () => {
    const dto = buildLeadWatch(input())

    expect(dto.issues.map((i) => i.kind)).toEqual([...WATCH_ISSUE_KINDS])
    expect(dto.issues).toHaveLength(7)
    for (const issue of dto.issues) {
      expect(issue).toEqual({
        kind: issue.kind,
        count: 0,
        severity: 'ok',
        oldestSince: null,
        summary: null,
        byChannel: { generated: 0, smm: 0, inbound: 0, telegram: 0, other: 0 },
        rows: [],
      })
    }
    expect(dto.critical).toBe(0)
    expect(dto.flow.stops).toEqual([])
    expect(dto.generatedAt).toBe(NOW.toISOString())
  })

  it('still draws every working hour, at zero', () => {
    const { hours } = buildLeadWatch(input()).flow
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: S.workHours.to - S.workHours.from }, (_, i) => S.workHours.from + i))
    expect(hours.every((h) => h.average === 0 && Object.values(h.counts).every((n) => n === 0))).toBe(true)
  })
})

describe('1 · «РОП (Первичка)» empty', () => {
  const { warnMin, criticalMin } = S.unassigned
  const unrouted = (over: Partial<WatchLead>) => lead({ ropAssigned: false, rop: null, ...over })

  it('is a problem strictly past the warning minutes', () => {
    expect(unassignedIssue([unrouted({ createdAt: ago(warnMin) })], NOW, S).count).toBe(0)
    const issue = unassignedIssue([unrouted({ createdAt: ago(warnMin, 1000) })], NOW, S)
    expect(issue.count).toBe(1)
    expect(issue.severity).toBe('warn')
  })

  it('turns red at the critical minutes exactly', () => {
    expect(unassignedIssue([unrouted({ createdAt: ago(criticalMin, -1000) })], NOW, S).severity).toBe('warn')
    expect(unassignedIssue([unrouted({ createdAt: ago(criticalMin) })], NOW, S).severity).toBe('critical')
  })

  it('counts open, unrouted leads only', () => {
    const issue = unassignedIssue(
      [
        unrouted({ dealId: 'waiting', createdAt: ago(20) }),
        unrouted({ dealId: 'closed', createdAt: ago(20), open: false }),
        lead({ dealId: 'routed', createdAt: ago(20) }),
      ],
      NOW,
      S,
    )
    expect(issue.rows.map((r) => r.dealId)).toEqual(['waiting'])
  })

  it('names the customer, else the deal, and counts the wait from the creation', () => {
    const created = ago(12)
    const [named, bare, blank] = unassignedIssue(
      [
        unrouted({ dealId: 'a', createdAt: created, customerName: 'Dilnoza', title: 'Deal A' }),
        unrouted({ dealId: 'b', createdAt: created, customerName: null, title: 'Deal B' }),
        unrouted({ dealId: 'c', createdAt: created, customerName: '   ', title: 'Deal C' }),
      ],
      NOW,
      S,
    ).rows
    expect(named).toEqual({
      key: 'a',
      dealId: 'a',
      title: 'Dilnoza',
      channel: 'generated',
      brand: 'Collagen',
      owner: 'Doniyor',
      rop: null,
      since: created.toISOString(),
      note: 'Sinolife (UMAR) 777',
    })
    expect(bare!.title).toBe('Deal B')
    expect(blank!.title).toBe('Deal C')
  })

  it('lists the longest wait first and reports it', () => {
    const issue = unassignedIssue(
      [
        unrouted({ dealId: 'mid', createdAt: ago(25) }),
        unrouted({ dealId: 'old', createdAt: ago(40) }),
        unrouted({ dealId: 'new', createdAt: ago(11) }),
      ],
      NOW,
      S,
    )
    expect(issue.rows.map((r) => r.dealId)).toEqual(['old', 'mid', 'new'])
    expect(issue.oldestSince).toBe(ago(40).toISOString())
    expect(issue.severity).toBe('critical')
    expect(issue.summary).toBeNull()
  })

  it('caps the rows, never the count or the channels', () => {
    const capped: LeadWatchSettings = { ...S, maxRows: 2 }
    const issue = unassignedIssue(
      [
        unrouted({ dealId: '1', createdAt: ago(50), channel: 'smm' }),
        unrouted({ dealId: '2', createdAt: ago(40), channel: 'smm' }),
        unrouted({ dealId: '3', createdAt: ago(30), channel: 'inbound' }),
        unrouted({ dealId: '4', createdAt: ago(20), channel: 'telegram' }),
        unrouted({ dealId: '5', createdAt: ago(15), channel: 'other' }),
      ],
      NOW,
      capped,
    )
    expect(issue.count).toBe(5)
    expect(issue.rows.map((r) => r.dealId)).toEqual(['1', '2'])
    expect(issue.byChannel).toEqual({ generated: 0, smm: 2, inbound: 1, telegram: 1, other: 1 })
  })
})

describe('2 · on the first stage, no call', () => {
  const { warnMin, criticalMin } = S.idle

  it('holds its own limits', () => {
    expect(idleIssue([lead({ createdAt: ago(warnMin) })], NOW, S).count).toBe(0)
    expect(idleIssue([lead({ createdAt: ago(warnMin, 1000) })], NOW, S).severity).toBe('warn')
    expect(idleIssue([lead({ createdAt: ago(criticalMin) })], NOW, S).severity).toBe('critical')
  })

  it('lets go of a lead that moved on, was closed, or was rung', () => {
    const created = ago(25)
    const issue = idleIssue(
      [
        lead({ dealId: 'idle', createdAt: created }),
        lead({ dealId: 'moved', createdAt: created, firstStage: false }),
        lead({ dealId: 'closed', createdAt: created, open: false }),
        // `lastCallAt` is a call that WORKED the lead — outgoing, or connected; the repository folds only those.
        lead({ dealId: 'rung', createdAt: created, lastCallAt: ago(10) }),
      ],
      NOW,
      S,
    )
    expect(issue.rows.map((r) => r.dealId)).toEqual(['idle'])
  })

  it('does not take an old conversation with the contact for a call about this lead', () => {
    const created = ago(25)
    const before = idleIssue([lead({ createdAt: created, lastCallAt: new Date(created.getTime() - 1000) })], NOW, S)
    expect(before.count).toBe(1)
    // The call that CREATED the lead starts in its own second: that is a call about it.
    const atOnce = idleIssue([lead({ createdAt: created, lastCallAt: created })], NOW, S)
    expect(atOnce.count).toBe(0)
  })
})

describe('3 · open chats', () => {
  const { warnMin, criticalMin } = S.chats
  const chat = (over: Partial<WatchChat> = {}): WatchChat => ({
    key: '9001',
    dealId: '555',
    title: 'Madina',
    channel: 'smm',
    brand: 'Collagen',
    owner: 'Sevara',
    rop: null,
    openedAt: ago(12),
    line: 'sinolifeuz instagram',
    ...over,
  })

  it('holds its own limits', () => {
    expect(chatsIssue([chat({ openedAt: ago(warnMin) })], NOW, S).count).toBe(0)
    expect(chatsIssue([chat({ openedAt: ago(warnMin, 1000) })], NOW, S).severity).toBe('warn')
    expect(chatsIssue([chat({ openedAt: ago(criticalMin) })], NOW, S).severity).toBe('critical')
  })

  it('carries the chat’s own responsible and the line’s name', () => {
    const opened = ago(12)
    expect(chatsIssue([chat({ openedAt: opened })], NOW, S).rows).toEqual([
      {
        key: '9001',
        dealId: '555',
        title: 'Madina',
        channel: 'smm',
        brand: 'Collagen',
        owner: 'Sevara',
        rop: null,
        since: opened.toISOString(),
        note: 'sinolifeuz instagram',
      },
    ])
  })

  it('keeps a chat whose deal is not imported yet, on no channel', () => {
    const issue = chatsIssue([chat({ dealId: null, channel: null, brand: null })], NOW, S)
    expect(issue.count).toBe(1)
    expect(issue.byChannel).toEqual({ generated: 0, smm: 0, inbound: 0, telegram: 0, other: 0 })
  })
})

describe('channels', () => {
  const vocabulary: LeadSourceVocabulary = {
    pages: new Set(['PAGE']),
    inbound: new Set(['CALL']),
    outbound: new Set(['OUT']),
    telegram: new Set(['TG']),
    smm: new Set(['SMM']),
    web: new Set(['WEB']),
    sarafan: new Set(['SARAFAN']),
    generated: 'GEN',
  }

  it('folds «Lid manbalari»’s channels into the watch’s five and leaves «Исход» out', () => {
    expect(watchChannel('form')).toBe('generated')
    expect(watchChannel('manual')).toBe('generated')
    expect(watchChannel('page')).toBe('smm')
    expect(watchChannel('smm')).toBe('smm')
    expect(watchChannel('inbound')).toBe('inbound')
    expect(watchChannel('telegram')).toBe('telegram')
    expect(watchChannel('other')).toBe('other')
    expect(watchChannel('outbound')).toBeNull()
  })

  it('files a chat by where it is happening', () => {
    expect(chatChannel('PAGE', null, vocabulary)).toBe('smm')
    expect(chatChannel('SMM', null, vocabulary)).toBe('smm')
    expect(chatChannel('TG', null, vocabulary)).toBe('telegram')
    // The source speaks before the form here, unlike for a lead.
    expect(chatChannel('PAGE', 'Some form', vocabulary)).toBe('smm')
    expect(chatChannel('GEN', 'Some form', vocabulary)).toBe('generated')
    expect(chatChannel('CALL', null, vocabulary)).toBe('inbound')
    expect(chatChannel(null, null, vocabulary)).toBe('other')
    // An outgoing call's deal has no channel of the watch's own.
    expect(chatChannel('OUT', null, vocabulary)).toBe('other')
  })

  it('watches a form by its name and a page by its source, and nothing else', () => {
    expect(watchFeed('form', 'Form A', 'GEN', 'Ген лид', 'Zextra')).toEqual({ key: 'form|Form A', name: 'Form A', channel: 'generated', brand: 'Zextra' })
    expect(watchFeed('page', null, 'PAGE', 'collagen.marine', 'Collagen')).toEqual({
      key: 'source|PAGE',
      name: 'collagen.marine',
      channel: 'smm',
      brand: 'Collagen',
    })
    expect(watchFeed('smm', null, 'SMM', null, null)).toEqual({ key: 'source|SMM', name: 'SMM', channel: 'smm', brand: null })
    expect(watchFeed('manual', null, 'GEN', 'Ген лид', null)).toBeNull()
    expect(watchFeed('inbound', null, 'CALL', 'Входящий', null)).toBeNull()
    expect(watchFeed('telegram', null, 'TG', 'Телеграмм', null)).toBeNull()
  })
})

describe('4 · missed calls nobody rang back', () => {
  const { warnMin, criticalMin } = S.missedCalls
  const call = (minutesAgo: number, over: Partial<WatchInboundCall> = {}): WatchInboundCall => ({
    phone: '+998 00 000 00 01',
    startedAt: ago(minutesAgo),
    talked: false,
    customerId: null,
    operator: null,
    ...over,
  })
  const KEY = '000000001'

  it('counts a number from its first unanswered call, however it was typed', () => {
    const callers = missedCallers([call(50), call(40, { phone: '998000000001' }), call(35, { phone: '000000001', operator: 'Sevara' })], [])
    expect(callers).toEqual([{ key: KEY, phone: '000000001', since: ago(50), customerId: null, operator: 'Sevara' }])
  })

  it('lets a caller go once they got through', () => {
    expect(missedCallers([call(50), call(40, { talked: true })], [])).toEqual([])
  })

  it('still waits for a caller answered in the morning and missed since', () => {
    // «Qoʻngʻiroqlar»'s own list would leave this number out: it did talk today.
    const callers = missedCallers([call(300, { talked: true }), call(45)], [])
    expect(callers.map((c) => c.since)).toEqual([ago(45)])
  })

  it('takes any outgoing call after the miss as a callback, answered or not', () => {
    expect(missedCallers([call(50)], [{ key: KEY, startedAt: ago(45) }])).toEqual([])
    // A call made BEFORE they rang answered nothing they asked.
    expect(missedCallers([call(50)], [{ key: KEY, startedAt: ago(55) }])).toHaveLength(1)
    // Rung back, then missed again: the wait starts over, at the new miss.
    expect(missedCallers([call(50), call(20)], [{ key: KEY, startedAt: ago(45) }]).map((c) => c.since)).toEqual([ago(20)])
  })

  it('reads two records of one instant unanswered first, so the answered leg ends the wait', () => {
    // One ring, two legs: a queue tried two operators and the second picked up.
    const at = ago(50)
    const missedLeg = { ...call(0), startedAt: at }
    const answeredLeg = { ...call(0), startedAt: at, talked: true }
    expect(missedCallers([missedLeg, answeredLeg], [])).toEqual([])
    expect(missedCallers([answeredLeg, missedLeg], [])).toEqual([])
    // The same for a callback stamped in the very second of the miss.
    expect(missedCallers([missedLeg], [{ key: KEY, startedAt: at }])).toEqual([])
  })

  it('leaves out a call nobody could ring back', () => {
    expect(missedCallers([call(50, { phone: null }), call(50, { phone: '105' })], [])).toEqual([])
  })

  it('keeps the contact any of the number’s calls names', () => {
    const callers = missedCallers([call(50), call(40, { customerId: 'cust-1' })], [])
    expect(callers[0]!.customerId).toBe('cust-1')
  })

  it('holds its own limits', () => {
    const at = (minutes: number, extraMs = 0) =>
      missedCallsIssue([{ ...call(0), startedAt: ago(minutes, extraMs) }], [], new Map(), NOW, S)
    expect(at(warnMin).count).toBe(0)
    expect(at(warnMin, 1000).severity).toBe('warn')
    expect(at(criticalMin, -1000).severity).toBe('warn')
    expect(at(criticalMin).severity).toBe('critical')
  })

  it('names the caller and the brand of their latest deal, and says so when there is none', () => {
    const since = ago(45)
    const issue = missedCallsIssue(
      [
        call(45, { customerId: 'known', operator: 'Sevara' }),
        call(40, { phone: '+998 00 000 00 02' }),
      ],
      [],
      new Map([['known', { name: 'Dilnoza', dealId: '777', brand: 'Zextra' as const }]]),
      NOW,
      S,
    )
    expect(issue.rows).toEqual([
      {
        key: KEY,
        dealId: '777',
        title: 'Dilnoza',
        channel: 'inbound',
        brand: 'Zextra',
        owner: 'Sevara',
        rop: null,
        since: since.toISOString(),
        note: '+998 00 000 00 01 · liniya: Zextra',
      },
      {
        key: '000000002',
        dealId: null,
        title: '+998 00 000 00 02',
        channel: 'inbound',
        brand: null,
        owner: null,
        rop: null,
        since: ago(40).toISOString(),
        note: '+998 00 000 00 02 · liniya aniqlanmadi',
      },
    ])
    expect(issue.byChannel.inbound).toBe(2)
  })
})

describe('5 · «Канал стоп»', () => {
  const { silentMin, usualPerHour, historyDays, arrivalWarnPct, arrivalCriticalPct, arrivalMinMetaLeads } = S.channelStop
  const HOUR = 15
  const usualWeek = weekOf(FORM, HOUR, usualPerHour)
  const formLead = (minutesAgo: number, over: Partial<WatchLead> = {}) => lead({ feed: FORM, createdAt: ago(minutesAgo), ...over })

  it('calls a feed silent at the silent minutes exactly', () => {
    expect(silentFeeds([formLead(silentMin - 1)], usualWeek, NOW, TZ, S)).toEqual([])
    const [stop] = silentFeeds([formLead(silentMin)], usualWeek, NOW, TZ, S)
    expect(stop).toEqual({ feed: FORM, since: ago(silentMin), usual: usualPerHour })
  })

  it('only where this clock hour usually delivers', () => {
    // One lead short of the average over the week: not «usual».
    const thin = [...usualWeek.slice(1), { ...usualWeek[0]!, leads: usualPerHour - 1 }]
    expect(silentFeeds([formLead(90)], thin, NOW, TZ, S)).toEqual([])
    // Busy at ANOTHER hour says nothing about this one.
    expect(silentFeeds([formLead(90)], weekOf(FORM, HOUR - 1, 20), NOW, TZ, S)).toEqual([])
    // A day the feed brought nothing counts as zero: seven leads on one day is exactly one a day.
    const oneDay: FeedHourRow[] = [{ day: '2026-10-05', hour: HOUR, channel: 'generated', feed: FORM, leads: historyDays * usualPerHour }]
    expect(silentFeeds([formLead(90)], oneDay, NOW, TZ, S)).toHaveLength(1)
  })

  it('is quiet outside the working hours', () => {
    const beforeWork = new Date('2026-10-09T03:59:00.000Z') // 08:59 in Tashkent
    const afterWork = new Date('2026-10-09T16:00:00.000Z') // 21:00 in Tashkent
    for (const now of [beforeWork, afterWork]) {
      expect(silentFeeds([], weekOf(FORM, zonedHour(now, TZ), 50), now, TZ, S)).toEqual([])
    }
    // The first and the last working hour are inside.
    const first = new Date('2026-10-09T05:00:00.000Z') // 10:00, an hour of silence since 09:00
    expect(silentFeeds([], weekOf(FORM, 10, 5), first, TZ, S)).toHaveLength(1)
    const last = new Date('2026-10-09T15:59:00.000Z') // 20:59
    expect(silentFeeds([], weekOf(FORM, 20, 5), last, TZ, S)).toHaveLength(1)
  })

  it('does not hold the night against a feed that brought a lead in it', () => {
    // The last lead came at 02:30; the working day opens at 09:00.
    const night = lead({ feed: FORM, createdAt: new Date('2026-10-08T21:30:00.000Z') })
    const week = weekOf(FORM, 9, 5)
    const at = (iso: string) => silentFeeds([night], week, new Date(iso), TZ, S)
    // 09:00:01 — not «390 daq» of silence: one second of the working day.
    expect(at('2026-10-09T04:00:01.000Z')).toEqual([])
    expect(at('2026-10-09T04:59:59.000Z')).toEqual([])
    // 10:00 — an hour of the working day without a lead.
    const [stop] = silentFeeds([night], weekOf(FORM, 10, 5), new Date('2026-10-09T05:00:00.000Z'), TZ, S)
    expect(stop!.since.toISOString()).toBe('2026-10-09T04:00:00.000Z')
    // A lead inside the working day still counts from itself.
    const morning = lead({ feed: FORM, createdAt: new Date('2026-10-09T04:20:00.000Z') })
    expect(silentFeeds([night, morning], weekOf(FORM, 10, 5), new Date('2026-10-09T05:00:00.000Z'), TZ, S)).toEqual([])
  })

  it('counts a feed with no lead today from the start of the working day', () => {
    const [stop] = silentFeeds([], usualWeek, NOW, TZ, S)
    expect(stop!.since.toISOString()).toBe('2026-10-09T04:00:00.000Z')
    // …so at 09:30 the night's quiet is not yet an hour of silence.
    const early = new Date('2026-10-09T04:30:00.000Z')
    expect(silentFeeds([], weekOf(FORM, 9, 5), early, TZ, S)).toEqual([])
  })

  it('does not take a late «Qayta zayavka» copy for a sign of life', () => {
    const stops = silentFeeds([formLead(90), formLead(5, { replayed: true })], usualWeek, NOW, TZ, S)
    expect(stops.map((s) => s.since)).toEqual([ago(90)])
  })

  it('reads «Yetib keldi» as Bitrix24 over Meta', () => {
    expect(arrivalPercent({ key: 'k', targetolog: 'Umar', brand: null, metaLeads: 120, leads: 74 })).toBeCloseTo(61.67, 2)
    expect(arrivalPercent({ key: 'k', targetolog: 'Umar', brand: null, metaLeads: 0, leads: 5 })).toBeNull()
  })

  const arrival = (over: Partial<WatchArrival>): WatchArrival => ({
    key: 'Collagen|Umar',
    targetolog: 'Umar',
    brand: 'Collagen',
    metaLeads: 100,
    leads: 100,
    ...over,
  })
  const onlyArrivals = (arrivals: WatchArrival[]) => channelStopIssue([], [], arrivals, NOW, TZ, S).issue

  it('flags an arrival rate under the warning line, with enough Meta leads to judge', () => {
    const issue = onlyArrivals([arrival({ metaLeads: 120, leads: 74 })])
    expect(issue.severity).toBe('warn')
    expect(issue.summary).toBe('1 targetolog')
    expect(issue.oldestSince).toBeNull()
    expect(issue.rows).toEqual([
      {
        key: 'arrival|Collagen|Umar',
        dealId: null,
        title: 'Umar',
        channel: 'generated',
        brand: 'Collagen',
        owner: null,
        rop: null,
        since: null,
        note: 'Yetib keldi 62% · Meta 120 · Bitrix 74',
      },
    ])
  })

  it('holds the arrival limits exactly', () => {
    expect(onlyArrivals([arrival({ leads: arrivalWarnPct })]).count).toBe(0)
    expect(onlyArrivals([arrival({ leads: arrivalWarnPct - 1 })]).severity).toBe('warn')
    expect(onlyArrivals([arrival({ leads: arrivalCriticalPct })]).severity).toBe('warn')
    expect(onlyArrivals([arrival({ leads: arrivalCriticalPct - 1 })]).severity).toBe('critical')
    // Too few Meta leads to judge a percentage on, however low it reads.
    expect(onlyArrivals([arrival({ metaLeads: arrivalMinMetaLeads - 1, leads: 0 })]).count).toBe(0)
    expect(onlyArrivals([arrival({ metaLeads: arrivalMinMetaLeads, leads: 0 })]).severity).toBe('critical')
  })

  it('puts the silent feeds first, red, and marks them on the chart', () => {
    const { issue, stops } = channelStopIssue(
      [formLead(100), lead({ feed: PAGE, channel: 'smm', createdAt: ago(70) })],
      [...weekOf(FORM, HOUR, 6), ...weekOf(PAGE, HOUR, 2)],
      [arrival({ key: 'Zextra|Kamron', targetolog: 'Kamron', brand: 'Zextra', leads: 70 }), arrival({ leads: 50 })],
      NOW,
      TZ,
      S,
    )
    expect(issue.severity).toBe('critical')
    expect(issue.count).toBe(4)
    expect(issue.summary).toBe('1 forma · 1 sahifa · 2 targetolog')
    expect(issue.rows.map((r) => [r.title, r.channel, r.since, r.note])).toEqual([
      ['Sinolife (UMAR) 777', 'generated', ago(100).toISOString(), 'odatda shu soatda ~6 ta'],
      ['collagen.marine', 'smm', ago(70).toISOString(), 'odatda shu soatda ~2 ta'],
      // No timer: the lowest arrival first.
      ['Umar', 'generated', null, 'Yetib keldi 50% · Meta 100 · Bitrix 50'],
      ['Kamron', 'generated', null, 'Yetib keldi 70% · Meta 100 · Bitrix 70'],
    ])
    expect(issue.oldestSince).toBe(ago(100).toISOString())
    expect(issue.byChannel).toEqual({ generated: 3, smm: 1, inbound: 0, telegram: 0, other: 0 })
    // 13:20 → the bar of hour 13 through the hour now running (15), end exclusive.
    expect(stops).toEqual([
      { fromHour: 13, toHour: 16, label: 'Ген лид · Sinolife (UMAR) 777 · 100 daq lead yoʻq' },
      { fromHour: 13, toHour: 16, label: 'СММ · collagen.marine · 70 daq lead yoʻq' },
    ])
  })

  it('never starts a band, or a silence, before the working day', () => {
    // The last lead came at 08:10; at 10:30 the silence is the 90 minutes since 09:00, from the first working bar.
    const now = new Date('2026-10-09T05:30:00.000Z')
    const { stops } = channelStopIssue([lead({ feed: FORM, createdAt: new Date('2026-10-09T03:10:00.000Z') })], weekOf(FORM, 10, 3), [], now, TZ, S)
    expect(stops).toEqual([{ fromHour: S.workHours.from, toHour: 11, label: 'Ген лид · Sinolife (UMAR) 777 · 90 daq lead yoʻq' }])
  })
})

describe('6 · uneven hand-out', () => {
  const { minLeads, timesAverage, planDeviationPct, minDiffLeads } = S.uneven
  const team = (rop: string, received: number, planLeads: number | null = null) => ({ rop, received, planLeads, brand: 'Collagen' as const })
  const split = (rops: WatchSplit['rops'], planned = false, total = rops.reduce((n, r) => n + r.received, 0)): WatchSplit => ({ total, planned, rops })

  it('says nothing before enough leads are handed out, or when the split could not be read', () => {
    expect(unevenIssue(null, S).severity).toBe('ok')
    expect(unevenIssue(split([team('Azizbek', minLeads - 1), team('Lola', 0)]), S).count).toBe(0)
  })

  it('flags a team strictly above the multiple of the average', () => {
    // Average of the three teams in play is 20: exactly twice it is not «more than».
    const even = split([team('Azizbek', timesAverage * 20), team('Lola', 10), team('Sevinch', 10)])
    expect(unevenIssue(even, S).count).toBe(0)

    const issue = unevenIssue(split([team('Azizbek', 61), team('Lola', 9), team('Sevinch', 8), team('Gulzora', 2)]), S)
    expect(issue.severity).toBe('warn')
    expect(issue.summary).toBe('1 ROP')
    expect(issue.oldestSince).toBeNull()
    expect(issue.rows).toEqual([
      { key: 'Azizbek', dealId: null, title: 'Azizbek', channel: null, brand: 'Collagen', owner: null, rop: 'Azizbek', since: null, note: 'oʻrtacha 20 · keldi 61' },
    ])
    expect(issue.byChannel).toEqual({ generated: 0, smm: 0, inbound: 0, telegram: 0, other: 0 })
  })

  it('averages over the teams in play, not the ones standing at zero by design', () => {
    // Four working teams at 20 and five idle ones: over all nine the average would be 8.9 and every team «above» it.
    const rops = [team('A', 20), team('B', 20), team('C', 20), team('D', 20), ...['E', 'F', 'G', 'H', 'I'].map((r) => team(r, 0))]
    expect(unevenIssue(split(rops), S).count).toBe(0)
  })

  it('turns red at twice the multiple', () => {
    const rops = [team('Azizbek', 80), ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((r) => team(r, 5))]
    // 115 leads over eight teams: the average is 14.4 and 80 is 5.6 times it.
    expect(unevenIssue(split(rops), S).severity).toBe('critical')
  })

  it('reads a saved split as the plan, off by more than the allowed per cent either way', () => {
    const within = split([team('Azizbek', 26, 20), team('Lola', 14, 20)], true, 40)
    // +30 % and −30 % exactly: on the line, not past it.
    expect(planDeviationPct).toBe(30)
    expect(unevenIssue(within, S).count).toBe(0)

    const issue = unevenIssue(split([team('Azizbek', 31, 20), team('Lola', 13, 20), team('Sevinch', 20, 20)], true), S)
    expect(issue.severity).toBe('warn')
    expect(issue.summary).toBe('2 ROP')
    expect(issue.rows.map((r) => [r.title, r.rop, r.note])).toEqual([
      ['Azizbek', 'Azizbek', 'reja 20 · keldi 31 (+55%)'],
      ['Lola', 'Lola', 'reja 20 · keldi 13 (-35%)'],
    ])
  })

  it('needs a real number of leads behind the per cent', () => {
    // Plan 3, received 5: +67 %, and two leads — not a row, let alone a red one.
    const tiny = unevenIssue(split([team('Azizbek', 5, 3), team('Lola', 20, 20), team('Sevinch', 20, 20)], true), S)
    expect(tiny.count).toBe(0)
    expect(tiny.severity).toBe('ok')
    // Plan 20, received 31: +55 % and eleven leads.
    const real = unevenIssue(split([team('Azizbek', 31, 20), team('Lola', 20, 20)], true), S)
    expect(real.rows.map((r) => r.note)).toEqual(['reja 20 · keldi 31 (+55%)'])
    // Exactly the floor counts; one lead under it does not.
    const at = (diff: number) => unevenIssue(split([team('Azizbek', 4 + diff, 4), team('Lola', 40, 40)], true), S).count
    expect(at(minDiffLeads)).toBe(1)
    expect(at(minDiffLeads - 1)).toBe(0)
    // The average rule too: 3 against an average of 1.2 is 2.5 times it, and under two leads.
    const small = split([team('A', 3), team('B', 1), team('C', 1), team('D', 1), team('E', 0, 1)], false, minLeads)
    expect(unevenIssue(small, S).count).toBe(0)
  })

  it('turns red at twice the allowed deviation, and for leads given against no share', () => {
    const double = split([team('Azizbek', 32, 20), team('Lola', 8, 20)], true)
    expect(unevenIssue(double, S).severity).toBe('critical')

    const noShare = unevenIssue(split([team('Azizbek', 30, 30), team('Hayot', 5, 0)], true), S)
    expect(noShare.severity).toBe('critical')
    expect(noShare.rows.map((r) => r.note)).toEqual(['reja 0 · keldi 5'])
  })

  it('does not hold a team to a plan nobody saved', () => {
    // A stale plan figure with no split saved for today is not a plan.
    expect(unevenIssue(split([team('Azizbek', 31, 20), team('Lola', 20, 20)], false), S).count).toBe(0)
  })
})

describe('7 · «Проект» empty', () => {
  const { criticalCount } = S.noProject
  const bare = (n: number) => Array.from({ length: n }, (_, i) => lead({ projectFilled: false, createdAt: ago(i + 1) }))

  it('warns at one and turns red at the critical count', () => {
    expect(noProjectIssue(bare(1), S).severity).toBe('warn')
    expect(noProjectIssue(bare(criticalCount - 1), S).severity).toBe('warn')
    expect(noProjectIssue(bare(criticalCount), S).severity).toBe('critical')
  })

  it('needs no waiting time, counts open leads only, oldest first', () => {
    const issue = noProjectIssue(
      [
        lead({ dealId: 'fresh', projectFilled: false, createdAt: ago(0) }),
        lead({ dealId: 'old', projectFilled: false, createdAt: ago(200) }),
        lead({ dealId: 'closed', projectFilled: false, open: false }),
        lead({ dealId: 'filled' }),
      ],
      S,
    )
    expect(issue.rows.map((r) => r.dealId)).toEqual(['old', 'fresh'])
    expect(issue.oldestSince).toBe(ago(200).toISOString())
  })
})

describe('the intake by hour', () => {
  it('puts each lead in the Tashkent hour it was created in, by channel', () => {
    const hours = flowHours(
      [
        lead({ createdAt: new Date('2026-10-09T04:00:00.000Z'), channel: 'generated' }), // 09:00
        lead({ createdAt: new Date('2026-10-09T04:59:59.000Z'), channel: 'smm' }), // 09:59
        lead({ createdAt: new Date('2026-10-09T05:00:00.000Z'), channel: 'inbound' }), // 10:00
        lead({ createdAt: new Date('2026-10-09T09:30:00.000Z'), channel: 'telegram', open: false }), // 14:30 — closed leads are intake too
        lead({ createdAt: new Date('2026-10-09T09:40:00.000Z'), replayed: true }), // a late copy is no lead of this hour
        lead({ createdAt: new Date('2026-10-09T03:30:00.000Z') }), // 08:30 — before the working day, on no bar
      ],
      [],
      NOW,
      TZ,
      S,
    )
    const at = (hour: number) => hours.find((h) => h.hour === hour)!.counts
    expect(at(9)).toEqual({ generated: 1, smm: 1, inbound: 0, telegram: 0, other: 0 })
    expect(at(10)).toEqual({ generated: 0, smm: 0, inbound: 1, telegram: 0, other: 0 })
    expect(at(14)).toEqual({ generated: 0, smm: 0, inbound: 0, telegram: 1, other: 0 })
    expect(hours.reduce((n, h) => n + Object.values(h.counts).reduce((a, b) => a + b, 0), 0)).toBe(4)
  })

  it('averages the hour over the history days, every channel together', () => {
    const history = [...weekOf(FORM, 11, 3), ...weekOf(null, 11, 1, 'inbound'), { day: '2026-10-08', hour: 12, channel: 'other' as const, feed: null, leads: 5 }]
    const hours = flowHours([], history, NOW, TZ, S)
    expect(hours.find((h) => h.hour === 11)!.average).toBe(4)
    // Five leads on one day of seven: 0.714… to one decimal.
    expect(hours.find((h) => h.hour === 12)!.average).toBe(0.7)
    expect(hours.find((h) => h.hour === 13)!.average).toBe(0)
  })

  it('marks the hours that have started, the running one included', () => {
    const hours = flowHours([], [], NOW, TZ, S)
    expect(hours.filter((h) => h.past).map((h) => h.hour)).toEqual([9, 10, 11, 12, 13, 14, 15])
    // Before the working day nothing has started; after it, everything has.
    expect(flowHours([], [], new Date('2026-10-09T03:00:00.000Z'), TZ, S).some((h) => h.past)).toBe(false)
    expect(flowHours([], [], new Date('2026-10-09T17:00:00.000Z'), TZ, S).every((h) => h.past)).toBe(true)
  })
})

describe('the whole answer', () => {
  it('is as old as its oldest feed, and unknown while one was never read', () => {
    const deals = ago(1)
    const calls = ago(7)
    const chats = ago(3)
    expect(oldestFeed({ deals, calls, chats })).toEqual(calls)
    expect(oldestFeed({ deals, calls: null, chats })).toBeNull()
    expect(buildLeadWatch(input({ feedsAsOf: { deals, calls, chats } })).dataAsOf).toBe(calls.toISOString())
    expect(buildLeadWatch(input({ feedsAsOf: { deals, calls, chats: null } })).dataAsOf).toBeNull()
  })

  it('counts the red cards', () => {
    const dto = buildLeadWatch(
      input({
        leads: [
          // Unrouted for 40 minutes, rung since: red on «unassigned» only.
          lead({ ropAssigned: false, rop: null, createdAt: ago(40), lastCallAt: ago(30) }),
          // Idle for 20 minutes: amber.
          lead({ createdAt: ago(20) }),
          // No project: amber.
          lead({ projectFilled: false, firstStage: false }),
        ],
        chats: [
          { key: '1', dealId: null, title: 'Chat', channel: null, brand: null, owner: null, rop: null, openedAt: ago(45), line: null },
        ],
      }),
    )
    const severity = Object.fromEntries(dto.issues.map((i) => [i.kind, i.severity]))
    expect(severity).toEqual({
      unassigned: 'critical',
      idle: 'warn',
      chats: 'critical',
      missedCalls: 'ok',
      channelStop: 'ok',
      uneven: 'ok',
      noProject: 'warn',
    })
    expect(dto.critical).toBe(2)
  })
})
