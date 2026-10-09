import { afterEach, describe, expect, it, vi } from 'vitest'

import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'
import type { InboundCall } from '@/server/domain/calls/inboundCalls'
import type { InboundCallsRepository } from '@/server/repositories/inboundCallsRepository'
import type { LeadWatchRepository, WatchChatRow, WatchLeadRow } from '@/server/repositories/leadWatchRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'

/*
  The service imports rnpService for `leadBrand`, whose repositories read
  `env` at module scope — the same preamble leadSourcesService.test.ts explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { LeadWatchService, watchChats, watchHistory, watchLeads } = await import('@/server/services/leadWatchService')

/**
 * «Лид назорати»'s service: each lead named the way «Lid manbalari» names it
 * (channel, brand, form), and the reads wired so the checks get the rows they
 * are about. The rules themselves are tests/domain/leadWatch.test.ts.
 */

const TZ = 'Asia/Tashkent'
/** 15:00 in Tashkent. */
const NOW = new Date('2026-10-09T10:00:00.000Z')
const MIN = 60_000
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN)

const UMAR_FORM = 'Заполнение CRM-формы "Sinolife (UMAR) 777"'

const leadRow = (over: Partial<WatchLeadRow> = {}): WatchLeadRow => ({
  dealId: '1090001',
  title: UMAR_FORM,
  customerName: 'Dilnoza',
  createdAt: ago(20),
  status: 'OPEN',
  stageId: 'NEW',
  sourceId: 'REPEAT_SALE',
  source: 'Ген лид',
  formTitle: UMAR_FORM,
  productLine: null,
  owner: 'Doniyor',
  rop: null,
  ropAssigned: false,
  lastCallAt: null,
  replayed: false,
  ...over,
})

describe('watchLeads', () => {
  it('names a form lead as «Lid manbalari» does', () => {
    expect(watchLeads([leadRow()])).toEqual([
      {
        dealId: '1090001',
        title: UMAR_FORM,
        customerName: 'Dilnoza',
        createdAt: ago(20),
        open: true,
        firstStage: true,
        channel: 'generated',
        brand: 'Collagen',
        feed: { key: 'form|Sinolife (UMAR) 777', name: 'Sinolife (UMAR) 777', channel: 'generated', brand: 'Collagen' },
        origin: 'Sinolife (UMAR) 777',
        owner: 'Doniyor',
        rop: null,
        ropAssigned: false,
        projectFilled: false,
        lastCallAt: null,
        replayed: false,
      },
    ])
  })

  it('leaves «Исход» out — unless a form opened the deal, which wins over its source', () => {
    const rows = watchLeads([
      leadRow({ dealId: 'out', sourceId: 'UC_KPZA32', source: 'Исход', formTitle: null, title: '+998 00 000 00 02' }),
      leadRow({ dealId: 'form-on-out', sourceId: 'UC_KPZA32', source: 'Исход' }),
    ])
    expect(rows.map((r) => [r.dealId, r.channel])).toEqual([['form-on-out', 'generated']])
  })

  it('files every other source on one of the five channels', () => {
    const channelOf = (sourceId: string | null) => watchLeads([leadRow({ sourceId, formTitle: null })])[0]!.channel
    expect(channelOf('REPEAT_SALE')).toBe('generated') // typed in by hand
    expect(channelOf('UC_MWIKOC')).toBe('smm') // an ad page
    expect(channelOf('UC_5JW4YK')).toBe('smm') // «Сммщик»
    expect(channelOf('CALL')).toBe('inbound')
    expect(channelOf('UC_8NZNYM')).toBe('telegram')
    expect(channelOf('WEB')).toBe('other')
    expect(channelOf(null)).toBe('other')
  })

  it('takes the brand from «Проект» first, and keeps the feed’s own', () => {
    const [lead] = watchLeads([leadRow({ productLine: 'Zextra sure' })])
    expect(lead!.brand).toBe('Zextra')
    expect(lead!.projectFilled).toBe(true)
    // The form sells the collagen whatever one lead's project says.
    expect(lead!.feed!.brand).toBe('Collagen')
  })

  it('watches a page by its source, and a hand-typed lead by nothing', () => {
    const [page, typed] = watchLeads([
      leadRow({ sourceId: 'UC_MWIKOC', source: 'collagen.marine', formTitle: null }),
      leadRow({ formTitle: null }),
    ])
    expect(page!.feed).toEqual({ key: 'source|UC_MWIKOC', name: 'collagen.marine', channel: 'smm', brand: 'Collagen' })
    expect(page!.origin).toBe('collagen.marine')
    expect(typed!.feed).toBeNull()
  })

  it('reads «intake stage» and «open» off the portal’s own ids', () => {
    const [fresh, smm, worked, won, duplicate] = watchLeads([
      leadRow({ stageId: 'UC_MVRVO1' }),
      leadRow({ stageId: 'UC_CJU776' }),
      leadRow({ stageId: 'UC_H2QZYE' }),
      leadRow({ status: 'WON', stageId: 'WON' }),
      leadRow({ stageId: 'UC_GV19A1' }),
    ])
    expect(fresh).toMatchObject({ open: true, firstStage: true })
    expect(smm).toMatchObject({ open: true, firstStage: true })
    expect(worked).toMatchObject({ open: true, firstStage: false })
    expect(won).toMatchObject({ open: false, firstStage: false })
    // «Дубликат (лид)» is parked: never a problem row.
    expect(duplicate).toMatchObject({ open: false, firstStage: false })
  })
})

describe('watchHistory', () => {
  it('names the week’s rows the same way and drops «Исход»', () => {
    expect(
      watchHistory([
        { day: '2026-10-08', hour: 15, sourceId: 'REPEAT_SALE', source: 'Ген лид', formTitle: UMAR_FORM, leads: 6 },
        { day: '2026-10-08', hour: 15, sourceId: 'CALL', source: 'Входящий', formTitle: null, leads: 4 },
        { day: '2026-10-08', hour: 15, sourceId: 'UC_KPZA32', source: 'Исход', formTitle: null, leads: 30 },
      ]),
    ).toEqual([
      {
        day: '2026-10-08',
        hour: 15,
        channel: 'generated',
        feed: { key: 'form|Sinolife (UMAR) 777', name: 'Sinolife (UMAR) 777', channel: 'generated', brand: 'Collagen' },
        leads: 6,
      },
      { day: '2026-10-08', hour: 15, channel: 'inbound', feed: null, leads: 4 },
    ])
  })
})

const chatRow = (over: Partial<WatchChatRow> = {}): WatchChatRow => ({
  chatId: '5001',
  subject: 'Чат открытой линии - "Madina - sinolifeuz instagram" (NEXTBOT)',
  openedAt: ago(40),
  responsible: 'Sevara',
  dealId: '1081546',
  dealTitle: 'Madina - sinolifeuz instagram',
  customerName: 'Madina',
  sourceId: 'UC_MWIKOC',
  formTitle: null,
  productLine: null,
  rop: null,
  ...over,
})

describe('watchChats', () => {
  it('reads the chat with its deal: the page’s channel and brand, the line from the subject', () => {
    expect(watchChats([chatRow()])).toEqual([
      {
        key: '5001',
        dealId: '1081546',
        title: 'Madina',
        channel: 'smm',
        brand: 'Collagen',
        owner: 'Sevara',
        rop: null,
        openedAt: ago(40),
        line: 'sinolifeuz instagram',
      },
    ])
  })

  it('keeps a chat whose deal is not imported yet, titled by what it has', () => {
    const [chat] = watchChats([chatRow({ dealId: null, dealTitle: null, customerName: null, sourceId: null })])
    expect(chat).toMatchObject({ dealId: null, channel: null, brand: null, title: 'Madina', line: 'sinolifeuz instagram' })
    // A subject in no shape the portal writes is still a title rather than nothing.
    expect(watchChats([chatRow({ dealId: null, dealTitle: null, customerName: null, subject: 'Chat' })])[0]).toMatchObject({ title: 'Chat', line: null })
  })
})

describe('LeadWatchService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const inboundCall = (minutesAgo: number, over: Partial<InboundCall> = {}): InboundCall => ({
    phone: '+998 00 000 00 01',
    startedAt: ago(minutesAgo),
    durationSec: 0,
    customerId: 'cust-1',
    day: '2026-10-09',
    operator: 'Sevara',
    ...over,
  })

  function service(over: { forms?: () => Promise<unknown>; leads?: WatchLeadRow[]; inbound?: InboundCall[] } = {}) {
    const asked = { outbound: [] as { key: string; after: Date }[][], windows: [] as [Date, Date][], history: [] as [Date, Date][] }
    const repository = {
      todayLeads: async (start: Date, end: Date) => {
        asked.windows.push([start, end])
        return over.leads ?? [leadRow({ createdAt: ago(45) })]
      },
      feedHours: async (start: Date, end: Date) => {
        asked.history.push([start, end])
        return []
      },
      openChats: async () => [chatRow()],
      latestDeals: async (ids: readonly string[]) =>
        ids.map((customerId) => ({ customerId, dealId: '777', sourceId: 'UC_AA84D0', formTitle: null, productLine: 'Zextra sure' })),
      feedClocks: async () => ({ calls: ago(3), chats: ago(2) }),
    } as unknown as LeadWatchRepository
    const calls = {
      inboundCalls: async () => over.inbound ?? [inboundCall(70), inboundCall(50, { phone: '+998 00 000 00 03', durationSec: 40, customerId: null })],
      outboundTo: async (pairs: { key: string; after: Date }[]) => {
        asked.outbound.push(pairs)
        return []
      },
      contactCards: async (ids: readonly string[]) => new Map(ids.map((id) => [id, { name: 'Dilnoza', bitrixId: '42' }])),
    } as unknown as InboundCallsRepository
    const registration = {
      distributedDays: async () => [
        { day: '2026-10-09', rop: 'Azizbek', leads: 31, duplicates: 0 },
        { day: '2026-10-09', rop: 'Lola', leads: 9, duplicates: 0 },
      ],
      split: async () => ({
        rows: [
          { rop: 'Azizbek', shareBp: 5000 },
          { rop: 'Lola', shareBp: 5000 },
        ],
        updatedAt: '2026-10-09T04:00:00.000Z',
      }),
    } as unknown as RegistrationRepository
    const reference = { findLastSuccessfulSync: async () => ago(1) } as unknown as ReferenceRepository
    const leadSources = {
      targetologForms:
        over.forms ??
        (async () => ({
          forms: { owners: [{ key: 'Collagen|Umar', targetolog: 'Umar', product: 'Collagen', metaLeads: 120, outcome: { leads: 74 } }] },
        })),
    } as never
    return { asked, service: new LeadWatchService(repository, calls, registration, reference, leadSources) }
  }

  it('answers the seven checks from one day’s reads', async () => {
    // Its own day key, so no other case's memo is read.
    const now = new Date('2026-10-09T10:00:00.000Z')
    const { service: s, asked } = service()
    const dto = await s.watch(now, TZ)

    // Today in Tashkent, and the seven whole days before it.
    expect(asked.windows).toEqual([[new Date('2026-10-08T19:00:00.000Z'), new Date('2026-10-09T19:00:00.000Z')]])
    expect(asked.history).toEqual([[new Date('2026-10-01T19:00:00.000Z'), new Date('2026-10-08T19:00:00.000Z')]])
    // Outgoing calls are asked for the number that was missed — not for the caller who got through.
    expect(asked.outbound).toEqual([[{ key: '000000001', after: ago(70) }]])

    const by = Object.fromEntries(dto.issues.map((i) => [i.kind, i]))
    expect(Object.keys(by)).toHaveLength(7)
    expect(by.unassigned).toMatchObject({ count: 1, severity: 'critical' })
    expect(by.idle).toMatchObject({ count: 1, severity: 'critical' })
    expect(by.noProject).toMatchObject({ count: 1, severity: 'warn' })
    expect(by.chats!.rows[0]).toMatchObject({ dealId: '1081546', owner: 'Sevara', note: 'sinolifeuz instagram', channel: 'smm' })
    // The caller's latest deal gives the link and the brand the call itself cannot.
    expect(by.missedCalls!.rows).toEqual([
      {
        key: '000000001',
        dealId: '777',
        title: 'Dilnoza',
        channel: 'inbound',
        brand: 'Zextra',
        owner: 'Sevara',
        rop: null,
        since: ago(70).toISOString(),
        note: '+998 00 000 00 01 · liniya: Zextra',
      },
    ])
    expect(by.missedCalls!.severity).toBe('critical')
    // «Yetib keldi» is the targetolog card's own figure.
    expect(by.channelStop!.rows.map((r) => r.note)).toEqual(['Yetib keldi 62% · Meta 120 · Bitrix 74'])
    // The split card's own numbers: 40 handed out, a 50/50 plan of 20 each.
    expect(by.uneven!.rows.map((r) => [r.rop, r.note, r.brand])).toEqual([
      ['Azizbek', 'reja 20 · keldi 31 (+55%)', 'Collagen'],
      ['Lola', 'reja 20 · keldi 9 (-55%)', 'Collagen'],
    ])
    expect(dto.critical).toBe(4)
    // The oldest of the deals' sync (1 min), the calls (3) and the chats (2).
    expect(dto.dataAsOf).toBe(ago(3).toISOString())
    expect((await s.summary(now, TZ)).critical).toBe(4)
  })

  it('answers without the arrival rows when the Meta read fails', async () => {
    // Another day: every memo here is keyed by it.
    const now = new Date('2026-10-12T10:00:00.000Z')
    const { service: s } = service({
      leads: [],
      inbound: [],
      forms: async () => {
        throw new Error('meta down')
      },
    })
    const dto = await s.watch(now, TZ)
    expect(dto.issues.find((i) => i.kind === 'channelStop')).toMatchObject({ count: 0, severity: 'ok' })
    expect(dto.issues).toHaveLength(7)
  })

  it('builds nothing outside the working day', async () => {
    const { service: s, asked } = service()
    // 03:00 in Tashkent.
    expect(await s.warm(new Date('2026-10-13T22:00:00.000Z'), TZ)).toBe('off-hours')
    expect(asked.windows).toEqual([])
    // 09:00 in Tashkent: a real build, waited for.
    expect(await s.warm(new Date('2026-10-14T04:00:00.000Z'), TZ)).toBeUndefined()
    expect(asked.windows).toHaveLength(1)
  })

  it('takes its thresholds from the settings file', () => {
    // The page colours its timers from the same object; a second copy here would be a second definition.
    expect(LEAD_WATCH_SETTINGS.staleAfterMin * 60_000).toBeGreaterThan(60_000)
  })
})
