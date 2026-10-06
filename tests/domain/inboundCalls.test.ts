import { describe, expect, it } from 'vitest'

import {
  type ContactHistory,
  type InboundCall,
  callbackOf,
  inboundGroup,
  inboundReport,
  phoneKey,
  telTarget,
  unansweredCallers,
} from '@/server/domain/calls/inboundCalls'

const T = new Date('2026-10-01T10:00:00Z')
const min = (n: number) => new Date(T.getTime() + n * 60_000)
const deal = (pipeline: string, stage: string, createdAt: Date) => ({ pipeline, stage, createdAt })

describe('phoneKey', () => {
  it('compares on the last nine digits', () => {
    expect(phoneKey('+998 93 322 10 28')).toBe('933221028')
    expect(phoneKey('998933221028')).toBe('933221028')
    expect(phoneKey('933221028')).toBe('933221028')
  })
  it('keeps a short extension as itself and nothing as null', () => {
    expect(phoneKey('101')).toBe('101')
    expect(phoneKey(null)).toBeNull()
  })
})

describe('inboundGroup', () => {
  it('is fresh when the contact was born with the call, five minutes either side', () => {
    expect(inboundGroup(T, { createdAt: min(-5), deals: [] })).toBe('fresh')
    expect(inboundGroup(T, { createdAt: min(30), deals: [] })).toBe('fresh')
    expect(inboundGroup(T, { createdAt: min(-6), deals: [] })).toBe('noDeal')
  })

  it('never calls a contact with no known creation time fresh', () => {
    expect(inboundGroup(T, { createdAt: null, deals: [] })).toBe('noDeal')
  })

  it('reads a buyer before a sales deal, and a sales deal before Регистрация', () => {
    const old = min(-10_000)
    expect(inboundGroup(T, { createdAt: old, deals: [deal('0', 'NEW', old), deal('6', 'C6:WON', old)] })).toBe('buyer')
    expect(inboundGroup(T, { createdAt: old, deals: [deal('10', 'C10:NEW', old)] })).toBe('buyer')
    expect(inboundGroup(T, { createdAt: old, deals: [deal('0', 'NEW', old), deal('12', 'C12:NEW', old)] })).toBe('talkedNoBuy')
    expect(inboundGroup(T, { createdAt: old, deals: [deal('4', 'C4:NEW', old)] })).toBe('talkedNoBuy')
    expect(inboundGroup(T, { createdAt: old, deals: [deal('0', 'WON', old)] })).toBe('talkedNoBuy')
    expect(inboundGroup(T, { createdAt: old, deals: [deal('0', 'UC_H2QZYE', old), deal('20', 'C20:NEW', old)] })).toBe('notReached')
  })

  it('ignores deals opened after the call', () => {
    const old = min(-10_000)
    expect(inboundGroup(T, { createdAt: old, deals: [deal('6', 'C6:NEW', min(1))] })).toBe('noDeal')
  })

  it('reads a call no contact is linked to as fresh', () => {
    expect(inboundGroup(T, undefined)).toBe('fresh')
  })
})

describe('inboundReport', () => {
  const contacts = new Map<string, ContactHistory>([
    ['new', { createdAt: min(0), deals: [] }],
    ['buyer', { createdAt: min(-10_000), deals: [deal('6', 'C6:WON', min(-9_000))] }],
  ])
  const call = (phone: string, at: Date, durationSec: number, customerId: string, day: string): InboundCall => ({
    phone,
    startedAt: at,
    durationSec,
    customerId,
    day,
  })
  const calls = [
    // Out of order on purpose: the report sorts by start.
    call('+998901112233', min(60), 40, 'new', '2026-10-01'),
    call('998901112233', min(0), 0, 'new', '2026-10-01'),
    call('901112233', min(1500), 0, 'new', '2026-10-02'),
    call('+998935554433', min(10), 0, 'buyer', '2026-10-01'),
    call('+998935554433', min(1510), 0, 'buyer', '2026-10-02'),
  ]

  it('counts numbers once a day and once over the window', () => {
    const r = inboundReport(calls, contacts, new Map([['2026-10-01', 7]]), ['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(r.days.map((d) => [d.day, d.calls, d.numbers, d.talked, d.outbound])).toEqual([
      ['2026-10-01', 3, 2, 1, 7],
      ['2026-10-02', 2, 2, 0, 0],
      ['2026-10-03', 0, 0, 0, 0],
    ])
    expect(r.total).toMatchObject({ calls: 5, numbers: 2, talked: 1, outbound: 7 })
  })

  it('groups a number by its first call of the day, and the window total by its first call of the window', () => {
    const r = inboundReport(calls, contacts, new Map(), ['2026-10-01', '2026-10-02'])
    // On the 2nd the «new» contact is a day old, so it is no longer fresh.
    expect(r.days[0]!.groups).toMatchObject({ fresh: 1, buyer: 1 })
    expect(r.days[1]!.groups).toMatchObject({ fresh: 0, noDeal: 1, buyer: 1 })
    expect(r.total.groups).toMatchObject({ fresh: 1, buyer: 1, noDeal: 0 })
  })

  it('takes the contact from a later call when the first one was not linked yet', () => {
    const linkedLater = [
      call('+998935554433', min(10), 0, 'buyer', '2026-10-01'),
      call('+998935554433', min(20), 0, 'buyer', '2026-10-01'),
    ].map((c, i) => (i === 0 ? { ...c, customerId: null } : c))
    const r = inboundReport(linkedLater, contacts, new Map(), ['2026-10-01'])
    expect(r.total.groups).toMatchObject({ fresh: 0, buyer: 1 })
  })

  it('counts a number as unreached only when no call in the window had a second of talk', () => {
    const r = inboundReport(calls, contacts, new Map(), ['2026-10-01', '2026-10-02'])
    expect(r.total.unreached).toMatchObject({ fresh: 0, buyer: 1 })
  })
})

describe('unansweredCallers', () => {
  const contacts = new Map<string, ContactHistory>([
    ['new', { createdAt: min(0), deals: [] }],
    ['buyer', { createdAt: min(-10_000), deals: [deal('6', 'C6:WON', min(-9_000))] }],
  ])
  const call = (phone: string | null, at: Date, durationSec: number, customerId: string | null, operator?: string): InboundCall => ({
    phone,
    startedAt: at,
    durationSec,
    customerId,
    day: '2026-10-01',
    operator,
  })

  it('lists the numbers that never got a second, one row each, as many as the tile says', () => {
    const calls = [
      call('+998935554433', min(30), 0, 'buyer', 'Aziza'),
      call('998935554433', min(10), 0, null, 'Bekzod'),
      // Talked once: not unanswered, however many misses around it.
      call('+998901112233', min(0), 0, 'new'),
      call('901112233', min(5), 25, 'new'),
      // No usable number: nobody can ring it back.
      call(null, min(40), 0, null),
    ]
    const rows = unansweredCallers(calls, contacts)
    expect(rows).toEqual([
      {
        key: '935554433',
        phone: '+998935554433',
        tel: '+998935554433',
        group: 'buyer',
        customerId: 'buyer',
        calls: 2,
        firstCallAt: min(10),
        lastCallAt: min(30),
        operator: 'Aziza',
      },
    ])
    const report = inboundReport(calls, contacts, new Map(), ['2026-10-01'])
    // The no-number call is unreached on the tile but cannot be listed.
    expect(report.total.unreached.buyer).toBe(rows.filter((r) => r.group === 'buyer').length)
  })

  it('is as long as every tile says, group by group, once the undiallable are set aside', () => {
    const many = [
      call('+998901000001', min(0), 0, 'new'),
      call('+998901000002', min(1), 0, null),
      call('+998901000003', min(2), 0, 'buyer'),
      call('+998901000003', min(3), 0, null),
      call('+998901000004', min(4), 9, 'buyer'),
      call('+7 916 123 45 67', min(5), 0, null),
    ]
    const rows = unansweredCallers(many, contacts)
    const tiles = inboundReport(many, contacts, new Map(), ['2026-10-01']).total.unreached
    for (const g of ['fresh', 'notReached', 'talkedNoBuy', 'buyer', 'noDeal'] as const) {
      expect(rows.filter((r) => r.group === g).length).toBe(tiles[g])
    }
  })

  it('leaves out an internal extension', () => {
    expect(unansweredCallers([call('101', min(0), 0, null)], contacts)).toEqual([])
  })
})

describe('callbackOf', () => {
  const caller = {
    key: '935554433',
    phone: '+998935554433',
    tel: '+998935554433',
    group: 'fresh' as const,
    customerId: null,
    calls: 1,
    firstCallAt: min(0),
    lastCallAt: min(10),
    operator: null,
  }
  const out = (at: Date, durationSec: number, key = '935554433') => ({ key, startedAt: at, durationSec, operator: 'Aziza' })

  it('is null when nobody rang back after the latest call', () => {
    expect(callbackOf(caller, [out(min(5), 60), out(min(20), 60, '901112233')])).toBeNull()
  })

  it('shows the first callback that got through, counting every attempt', () => {
    expect(callbackOf(caller, [out(min(50), 0), out(min(30), 40), out(min(20), 0)])).toEqual({
      at: min(30),
      talked: true,
      operator: 'Aziza',
      attempts: 3,
    })
  })

  it('shows the latest attempt when none got through', () => {
    expect(callbackOf(caller, [out(min(20), 0), out(min(50), 0)])).toMatchObject({ at: min(50), talked: false, attempts: 2 })
  })
})

describe('telTarget', () => {
  it('dials a local number with +998 and an international one as written', () => {
    expect(telTarget('901112233')).toBe('+998901112233')
    expect(telTarget('+998 90 111 22 33')).toBe('+998901112233')
    expect(telTarget('998901112233')).toBe('+998901112233')
    // Never +998 on the last nine digits of a foreign number.
    expect(telTarget('+7 916 123 45 67')).toBe('+79161234567')
  })
  it('dials nothing for an extension', () => {
    expect(telTarget('101')).toBeNull()
  })
})
