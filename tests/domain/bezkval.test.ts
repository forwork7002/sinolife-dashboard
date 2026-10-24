import { describe, expect, it } from 'vitest'

import {
  type BezkvalHistoryRow,
  type BezkvalLeadRow,
  bezkvalClientRows,
  bezkvalClients,
  bezkvalDayTotals,
  bezkvalInvariantProblems,
  buildBezkvalDay,
  dealKeys,
  maskPhone,
  novelty,
  phoneNine,
} from '@/server/domain/registration/bezkval'
import { pickClients } from '@/features/leads/bezkvalLogic'

/**
 * «Безквал» by the client's spec (2026-10-22): a day's lead deals become
 * clients by phone number — every number of a contact tied together — and
 * each client goes to the first ROP its deals were handed to.
 */

let seq = 0
function lead(over: Partial<BezkvalLeadRow> = {}): BezkvalLeadRow {
  seq++
  return {
    dealId: `d${seq}`,
    externalId: String(1000 + seq),
    day: '2026-10-21',
    at: new Date(`2026-10-21T0${seq % 10}:00:00Z`),
    hour: 10,
    leadGuard: false,
    bornCategory: 0,
    pipeline: '0',
    contactId: `c${seq}`,
    phones: [`90${String(1000000 + seq).slice(-7)}`],
    dealPhone: null,
    rop: null,
    ropPrimary: null,
    ...over,
  }
}

describe('phoneNine', () => {
  it('keeps the last nine digits of a typed number', () => {
    expect(phoneNine('+998 90 123-45-67')).toBe('901234567')
    expect(phoneNine('901234567')).toBe('901234567')
    expect(phoneNine('8 (90) 123 45 67')).toBe('901234567')
  })

  it('refuses a number shorter than nine digits, and nine equal digits', () => {
    expect(phoneNine('12345678')).toBeNull()
    expect(phoneNine('')).toBeNull()
    expect(phoneNine(null)).toBeNull()
    expect(phoneNine('+998 11 111 11 11')).toBeNull()
  })
})

describe('dealKeys — the spec\'s 4.3 order', () => {
  it('a contact\'s numbers first, then the deal\'s own number, then the contact, then the deal', () => {
    expect(dealKeys(lead({ phones: ['931112233', '901234567'] }))).toEqual({ kind: 'phone', keys: ['p:901234567', 'p:931112233'] })
    expect(dealKeys(lead({ phones: [], dealPhone: '+998 97 555 44 33' }))).toEqual({ kind: 'dealPhone', keys: ['p:975554433'] })
    expect(dealKeys(lead({ phones: ['111111111'], contactId: '77' }))).toEqual({ kind: 'contact', keys: ['c:77'] })
    expect(dealKeys(lead({ dealId: 'x', phones: [], contactId: null }))).toEqual({ kind: 'deal', keys: ['d:x'] })
  })
})

describe('bezkvalClients', () => {
  it('one number a day is one client, however many deals and whatever their stage', () => {
    const a = lead({ phones: ['901234567'], at: new Date('2026-10-21T05:00:00Z') })
    const b = lead({ phones: ['901234567'], at: new Date('2026-10-21T06:00:00Z') })
    const c = lead({ phones: ['931112233'] })
    const clients = bezkvalClients([b, a, c])
    expect(clients).toHaveLength(2)
    const one = clients.find((x) => x.key === 'p:901234567')!
    expect(one.deals.map((d) => d.dealId)).toEqual([a.dealId, b.dealId])
  })

  it('ties a contact\'s two numbers, and a third deal through either (union-find)', () => {
    const both = lead({ phones: ['912223344', '931112233'] })
    const viaSecond = lead({ phones: ['931112233'] })
    const viaFirst = lead({ phones: ['912223344'] })
    const clients = bezkvalClients([viaSecond, viaFirst, both])
    expect(clients).toHaveLength(1)
    expect(clients[0]!.phones).toEqual(['912223344', '931112233'])
    expect(clients[0]!.key).toBe('p:912223344')
  })

  it('ties two deals of one contact even when only one of them has a number', () => {
    const withNumber = lead({ contactId: '1004', phones: [], dealPhone: '975554433' })
    const without = lead({ contactId: '1004', phones: [] })
    const clients = bezkvalClients([withNumber, without])
    expect(clients).toHaveLength(1)
    expect(clients[0]!.kind).toBe('dealPhone')
  })

  it('never ties two days: the same number back the next day is a client of that day too', () => {
    const clients = bezkvalClients([lead({ phones: ['901234567'] }), lead({ phones: ['901234567'], day: '2026-10-22' })])
    expect(clients.map((c) => c.day)).toEqual(['2026-10-21', '2026-10-22'])
  })

  it('credits the first ROP the client\'s deals were handed to, «ROP KVAL LID» before «РОП (Первичка)»', () => {
    const desk = lead({ phones: ['901234567'], at: new Date('2026-10-21T04:00:00Z') })
    const primary = lead({ phones: ['901234567'], at: new Date('2026-10-21T05:00:00Z'), ropPrimary: 'Azizbek' })
    const kval = lead({ phones: ['901234567'], at: new Date('2026-10-21T06:00:00Z'), rop: 'Sevinch', ropPrimary: 'Lola' })
    const [client] = bezkvalClients([kval, desk, primary])
    expect(client!.rop).toBe('Azizbek')
    expect(client!.multiRop).toBe(true)
    expect(bezkvalClients([lead({ rop: 'Sevinch', ropPrimary: 'Lola' })])[0]!.rop).toBe('Sevinch')
  })

  it('a client no deal of which reached a ROP is «Tarqatilmagan»', () => {
    expect(bezkvalClients([lead(), lead()]).every((c) => c.rop === null && !c.multiRop)).toBe(true)
  })

  it('puts every deal in exactly one client', () => {
    const rows = [lead({ phones: ['901234567'] }), lead({ phones: ['901234567', '931112233'] }), lead({ phones: ['931112233'] }), lead(), lead({ phones: [], contactId: null })]
    const ids = bezkvalClients(rows).flatMap((c) => c.deals.map((d) => d.dealId))
    expect(ids.sort()).toEqual(rows.map((r) => r.dealId).sort())
  })
})

describe('bezkvalDayTotals', () => {
  it('sums the day × ROP rows into a day\'s lead deals and clients', () => {
    const totals = bezkvalDayTotals([
      { day: '2026-10-21', leads: 1, deals: 2 },
      { day: '2026-10-21', leads: 1, deals: 1 },
      { day: '2026-10-22', leads: 3, deals: 4 },
    ])
    expect(totals.get('2026-10-21')).toEqual({ total: 3, bezkval: 2 })
    expect(totals.get('2026-10-22')).toEqual({ total: 4, bezkval: 3 })
  })
})

describe('novelty', () => {
  const history = (rows: BezkvalHistoryRow[]) => new Map(rows.map((r) => [r.key, r]))

  it('a lead of the 30 days before makes a repeat; any earlier deal makes the client not new outright', () => {
    const client = { phones: ['901234567', '931112233'], contactIds: ['1'] }
    const recent = { externalId: '9', at: new Date('2026-10-05T05:00:00Z'), pipeline: 'Регистрация' }
    const old = { externalId: '3', at: new Date('2026-01-05T05:00:00Z'), pipeline: 'Доставка' }
    expect(novelty(client, history([]))).toEqual({ new30: true, newEver: true, previous: null })
    expect(novelty(client, history([{ key: 'p:931112233', lastLeadAt: null, lastDeal: old }]))).toEqual({ new30: true, newEver: false, previous: old })
    expect(novelty(client, history([{ key: 'p:931112233', lastLeadAt: null, lastDeal: old }, { key: 'p:901234567', lastLeadAt: recent.at, lastDeal: recent }]))).toEqual({
      new30: false,
      newEver: false,
      previous: recent,
    })
  })

  it('a number-less client is looked up by its contact', () => {
    const prior = { externalId: '5', at: new Date('2026-09-01T05:00:00Z'), pipeline: 'Доставка' }
    expect(novelty({ phones: [], contactIds: ['77'] }, history([{ key: 'c:77', lastLeadAt: null, lastDeal: prior }])).newEver).toBe(false)
  })
})

describe('maskPhone', () => {
  it('hides the middle of the number', () => {
    expect(maskPhone('901234567')).toBe('+998 90 ***-45-67')
  })
})

describe('the day card', () => {
  const day = '2026-10-21'
  const rows = [
    lead({ phones: ['901234567'], rop: 'Sevinch', hour: 9, source: 'Ген лид', leadGuard: true }),
    lead({ phones: ['901234567'], rop: 'Azizbek', hour: 10, source: 'sinolifeuz' }),
    lead({ phones: ['931112233'], ropPrimary: 'Azizbek', hour: 11, source: 'Ген лид', bornCategory: 20 }),
    lead({ phones: ['941112233'], hour: 11, source: null, bornCategory: null }),
    lead({ phones: [], contactId: null, hour: 23, source: 'Входящий' }),
  ]
  const clients = bezkvalClients(rows)
  const hist = new Map<string, BezkvalHistoryRow>([
    ['p:931112233', { key: 'p:931112233', lastLeadAt: new Date('2026-10-10T05:00:00Z'), lastDeal: { externalId: '7', at: new Date('2026-10-10T05:00:00Z'), pipeline: 'Регистрация' } }],
    ['p:941112233', { key: 'p:941112233', lastLeadAt: null, lastDeal: { externalId: '8', at: new Date('2026-03-10T05:00:00Z'), pipeline: 'Доставка' } }],
  ])
  const list = bezkvalClientRows(day, clients, hist).map((r) => r.client)
  const dto = buildBezkvalDay({
    day,
    clients: list,
    computedAt: '2026-10-21T13:00:00.000Z',
    trendDays: ['2026-10-20', day],
    // The day × ROP rows are counted in SQL (`bezkvalDays`); one row for the whole day sums the same.
    totals: bezkvalDayTotals([{ day, leads: clients.length, deals: rows.length }]),
    order: (rops) => [...rops].sort(),
  })

  it('counts deals, clients, new ones and the unassigned, and the invariants hold', () => {
    expect(dto).toMatchObject({ total: 5, bezkval: 4, new30: 3, newEver: 2, repeat30: 1, unassigned: 2, multiRop: 1, leadGuard: 1, movedIn: 1, noBirth: 1 })
    expect(dto.problems).toEqual([])
    expect(dto.keyKinds).toEqual({ phone: 3, dealPhone: 0, contact: 0, deal: 1 })
  })

  it('splits the clients by ROP, «Tarqatilmagan» last, the shares summing to the whole', () => {
    expect(dto.rops.map((r) => [r.rop, r.bezkval, r.new30, r.newEver, r.repeat30])).toEqual([
      ['Azizbek', 1, 0, 0, 1],
      ['Sevinch', 1, 1, 1, 0],
      [null, 2, 2, 1, 0],
    ])
    expect(dto.rops.reduce((n, r) => n + r.sharePct, 0)).toBeCloseTo(100)
  })

  it('reads the source and the hour off the client\'s first deal', () => {
    expect(dto.sources.find((s) => s.source === 'Ген лид')!.bezkval).toBe(2)
    expect(dto.sources.find((s) => s.source === 'sinolifeuz')).toBeUndefined()
    expect(dto.hours[9]).toBe(1)
    expect(dto.hours[10]).toBe(0)
    expect(dto.trend).toEqual([
      { day: '2026-10-20', total: 0, bezkval: 0 },
      { day, total: 5, bezkval: 4 },
    ])
  })

  it('every number\'s drill-down lists exactly the clients it counted', () => {
    expect(pickClients(list, {})).toHaveLength(dto.bezkval)
    expect(pickClients(list, { kind: 'new30' })).toHaveLength(dto.new30)
    expect(pickClients(list, { kind: 'newEver' })).toHaveLength(dto.newEver)
    expect(pickClients(list, { kind: 'repeat30' })).toHaveLength(dto.repeat30)
    expect(pickClients(list, { rop: null })).toHaveLength(dto.unassigned)
    expect(pickClients(list, { kind: 'multiRop' })).toHaveLength(dto.multiRop)
    for (const r of dto.rops) expect(pickClients(list, { rop: r.rop })).toHaveLength(r.bezkval)
    for (const s of dto.sources) expect(pickClients(list, { source: s.source })).toHaveLength(s.bezkval)
    dto.hours.forEach((n, hour) => expect(pickClients(list, { hour })).toHaveLength(n))
    expect(pickClients(list, { kind: 'noPhone' })).toHaveLength(dto.keyKinds.contact + dto.keyKinds.deal)
  })

  it('masks the numbers and proves a repeat with its earlier deal', () => {
    const repeat = list.find((c) => !c.new30)!
    expect(repeat.phone).toBe('+998 93 ***-22-33')
    expect(repeat.previous).toEqual({ id: '7', at: '2026-10-10T05:00:00.000Z', pipeline: 'Регистрация' })
    expect(list.every((c) => c.phone === null || /\*\*\*/.test(c.phone))).toBe(true)
  })
})

describe('bezkvalInvariantProblems', () => {
  it('names a ROP sum that misses the whole, and an out-of-order count', () => {
    expect(bezkvalInvariantProblems({ total: 5, bezkval: 4, new30: 3, newEver: 2, unassigned: 1, rops: [{ bezkval: 3 }] })).toEqual([])
    expect(bezkvalInvariantProblems({ total: 5, bezkval: 4, new30: 3, newEver: 2, unassigned: 0, rops: [{ bezkval: 3 }] })).toHaveLength(1)
    expect(bezkvalInvariantProblems({ total: 3, bezkval: 4, new30: 3, newEver: 2, unassigned: 1, rops: [{ bezkval: 3 }] })).toHaveLength(1)
  })
})
