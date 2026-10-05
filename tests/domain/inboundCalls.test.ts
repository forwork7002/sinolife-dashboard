import { describe, expect, it } from 'vitest'

import {
  type ContactHistory,
  type InboundCall,
  inboundGroup,
  inboundReport,
  phoneKey,
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
