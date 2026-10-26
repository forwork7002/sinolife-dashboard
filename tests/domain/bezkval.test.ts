import { describe, expect, it } from 'vitest'

import {
  type BezkvalHistoryRow,
  type BezkvalLeadRow,
  LEAD_GUARD_SOURCE,
  bezkvalClientRows,
  bezkvalClients,
  bezkvalDayTotals,
  bezkvalInvariantProblems,
  buildBezkvalDay,
  dealKeys,
  dealRop,
  historyIndex,
  maskPhone,
  novelty,
  phoneKey,
  phoneTail,
} from '@/server/domain/registration/bezkval'
import { bezkvalCsvRows, pickClients, ropLabel } from '@/features/leads/bezkvalLogic'

/**
 * «Безквал» by the client's spec v2 (2026-10-26): a day's kirim deals —
 * created in Регистрация or moved there from «ИИ» — become clients by phone
 * number, every number of a contact tied together; each client is new, a
 * repeat of the 30 days before, or an older repeat, and goes to its main
 * deal's ROP.
 */

let seq = 0
function lead(over: Partial<BezkvalLeadRow> = {}): BezkvalLeadRow {
  seq++
  return {
    dealId: `d${seq}`,
    externalId: String(1000 + seq),
    day: '2026-10-23',
    at: new Date(`2026-10-23T0${seq % 10}:00:00Z`),
    hour: 10,
    entry: 'created',
    leadGuard: false,
    contactId: `c${seq}`,
    phones: [`90${String(1000000 + seq).slice(-7)}`],
    dealPhone: null,
    ropKval: null,
    ropPrimary: null,
    ownerRop: null,
    ownerDesk: true,
    ...over,
  }
}

describe('phoneKey — the spec\'s 4.4', () => {
  it('a local number is its nine digits, with or without the code', () => {
    expect(phoneKey('+998 90 123-45-67')).toBe('901234567')
    expect(phoneKey('998901234567')).toBe('901234567')
    expect(phoneKey('90 123 45 67')).toBe('901234567')
  })

  it('a foreign number keeps every digit — it is not the local nine it ends in', () => {
    expect(phoneKey('+7 916 123 45 67')).toBe('x79161234567')
    expect(phoneKey('+992 93 123 4567')).toBe('x992931234567')
    expect(phoneKey('+7 916 123 45 67')).not.toBe(phoneKey('+998 16 123 45 67'))
    expect(phoneTail('x79161234567')).toBe('161234567')
    expect(phoneTail('901234567')).toBe('901234567')
  })

  it('refuses what is no number: too short, a 998 of the wrong length, one digit repeated', () => {
    expect(phoneKey('12345678')).toBeNull()
    expect(phoneKey('9989012345')).toBeNull()
    expect(phoneKey('99890123456789')).toBeNull()
    expect(phoneKey('')).toBeNull()
    expect(phoneKey(null)).toBeNull()
    expect(phoneKey('+998 11 111 11 11')).toBeNull()
    expect(phoneKey('999999999')).toBeNull()
  })
})

describe('dealKeys — the contact\'s numbers, the deal\'s own, the contact, the deal', () => {
  it('in that order', () => {
    expect(dealKeys(lead({ phones: ['931112233', '901234567'] }))).toEqual({ kind: 'phone', keys: ['p:901234567', 'p:931112233'] })
    expect(dealKeys(lead({ phones: [], dealPhone: '+998 97 555 44 33' }))).toEqual({ kind: 'dealPhone', keys: ['p:975554433'] })
    expect(dealKeys(lead({ phones: ['111111111'], contactId: '77' }))).toEqual({ kind: 'contact', keys: ['c:77'] })
    expect(dealKeys(lead({ dealId: 'x', phones: [], contactId: null }))).toEqual({ kind: 'deal', keys: ['d:x'] })
  })
})

describe('dealRop — the spec\'s 5.5', () => {
  const none = { ropKval: null, ropPrimary: null, ownerRop: null, ownerDesk: false }
  it('«ROP KVAL LID», then «РОП (Первичка)», then the owner\'s team', () => {
    expect(dealRop({ ...none, ropKval: 'Asliddin', ropPrimary: 'Lola', ownerRop: 'Sevinch' })).toEqual({ rop: 'Asliddin', bucket: 'rop' })
    expect(dealRop({ ...none, ropPrimary: 'Lola', ownerRop: 'Sevinch' })).toEqual({ rop: 'Lola', bucket: 'rop' })
    expect(dealRop({ ...none, ownerRop: 'Sevinch' })).toEqual({ rop: 'Sevinch', bucket: 'rop' })
  })

  it('no team: the desk (users 10 and 1) is «Taqsimlanmagan», anyone else «Регистрация boʻlimida»', () => {
    expect(dealRop({ ...none, ownerDesk: true })).toEqual({ rop: null, bucket: 'unassigned' })
    expect(dealRop(none)).toEqual({ rop: null, bucket: 'registration' })
  })
})

describe('bezkvalClients', () => {
  it('one number a day is one client, however many deals and whatever their stage', () => {
    const a = lead({ phones: ['901234567'], at: new Date('2026-10-23T05:00:00Z') })
    const b = lead({ phones: ['901234567'], at: new Date('2026-10-23T06:00:00Z') })
    const c = lead({ phones: ['931112233'] })
    const clients = bezkvalClients([b, a, c])
    expect(clients).toHaveLength(2)
    const one = clients.find((x) => x.key === 'p:901234567')!
    expect(one.deals.map((d) => d.dealId)).toEqual([a.dealId, b.dealId])
  })

  it('a +7 number and the local nine it ends in are two clients', () => {
    expect(bezkvalClients([lead({ phones: ['+7 916 123 45 67'] }), lead({ phones: ['+998 16 123 45 67'] })])).toHaveLength(2)
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
    const clients = bezkvalClients([lead({ phones: ['901234567'] }), lead({ phones: ['901234567'], day: '2026-10-24' })])
    expect(clients.map((c) => c.day)).toEqual(['2026-10-23', '2026-10-24'])
  })

  it('keeps a deal in twice a day once, at its first entry', () => {
    const first = lead({ dealId: 'same', at: new Date('2026-10-23T05:00:00Z'), entry: 'created' })
    const again = { ...first, at: new Date('2026-10-23T09:00:00Z'), entry: 'ai' as const }
    const [client] = bezkvalClients([again, first])
    expect(client!.deals).toHaveLength(1)
    expect(client!.deals[0]!.entry).toBe('created')
  })

  it('the ROP is the MAIN deal\'s — the earliest — and two teams on its deals are flagged', () => {
    const desk = lead({ phones: ['901234567'], at: new Date('2026-10-23T04:00:00Z'), ownerDesk: true })
    const later = lead({ phones: ['901234567'], at: new Date('2026-10-23T05:00:00Z'), ropPrimary: 'Azizbek' })
    const third = lead({ phones: ['901234567'], at: new Date('2026-10-23T06:00:00Z'), ropKval: 'Sevinch' })
    const [client] = bezkvalClients([third, desk, later])
    expect(client!.rop).toBeNull()
    expect(client!.bucket).toBe('unassigned')
    expect(client!.multiRop).toBe(true)
    expect(bezkvalClients([lead({ ropKval: 'Sevinch', ropPrimary: 'Lola' })])[0]!).toMatchObject({ rop: 'Sevinch', bucket: 'rop' })
  })

  it('puts every deal in exactly one client', () => {
    const rows = [lead({ phones: ['901234567'] }), lead({ phones: ['901234567', '931112233'] }), lead({ phones: ['931112233'] }), lead(), lead({ phones: [], contactId: null })]
    const ids = bezkvalClients(rows).flatMap((c) => c.deals.map((d) => d.dealId))
    expect(ids.sort()).toEqual(rows.map((r) => r.dealId).sort())
  })
})

describe('bezkvalDayTotals', () => {
  it('sums the day × ROP rows into a day\'s kirim deals and clients', () => {
    const totals = bezkvalDayTotals([
      { day: '2026-10-21', leads: 1, deals: 2 },
      { day: '2026-10-21', leads: 1, deals: 1 },
      { day: '2026-10-22', leads: 3, deals: 4 },
    ])
    expect(totals.get('2026-10-21')).toEqual({ kirim: 3, bezkval: 2 })
    expect(totals.get('2026-10-22')).toEqual({ kirim: 4, bezkval: 3 })
  })
})

describe('novelty — the spec\'s 5.4', () => {
  const dayStart = new Date('2026-10-22T19:00:00Z') // 23.10 00:00 in Tashkent
  const deal = (id: string, at: string, pipeline = 'Доставка') => ({ externalId: id, at: new Date(at), pipeline })
  const client = { phones: ['901234567', '931112233'], contactIds: ['1'] }

  it('no earlier deal: new; the latest within 30 days: takror 30; before that: takror eski', () => {
    expect(novelty(client, historyIndex([]), dayStart)).toEqual({ status: 'new', previous: null })
    const old = deal('3', '2026-01-05T05:00:00Z')
    expect(novelty(client, historyIndex([{ contactId: '9', phones: ['+998 93 111 22 33'], lastDeal: old }]), dayStart)).toEqual({ status: 'old', previous: old })
    const recent = deal('9', '2026-10-05T05:00:00Z', 'Регистрация')
    const index = historyIndex([
      { contactId: '9', phones: ['+998 93 111 22 33'], lastDeal: old },
      { contactId: '8', phones: ['901234567'], lastDeal: recent },
    ])
    expect(novelty(client, index, dayStart)).toEqual({ status: 't30', previous: recent })
  })

  it('the 30 days end at the day\'s start: one second before is still recent, a deal of the day itself is not prior', () => {
    const edge = deal('5', '2026-09-22T19:00:00Z')
    expect(novelty(client, historyIndex([{ contactId: '1', phones: [], lastDeal: edge }]), dayStart).status).toBe('t30')
    const older = deal('6', '2026-09-22T18:59:59Z')
    expect(novelty(client, historyIndex([{ contactId: '1', phones: [], lastDeal: older }]), dayStart).status).toBe('old')
    const sameDay = deal('7', '2026-10-23T03:00:00Z')
    expect(novelty(client, historyIndex([{ contactId: '1', phones: [], lastDeal: sameDay }]), dayStart).status).toBe('new')
  })

  it('a candidate found by the last nine digits counts only on the exact number', () => {
    const foreign = { phones: ['x79161234567'], contactIds: ['4'] }
    const local = historyIndex([{ contactId: '5', phones: ['+998 16 123 45 67'], lastDeal: deal('2', '2026-10-01T05:00:00Z') }])
    expect(novelty(foreign, local, dayStart).status).toBe('new')
    const same = historyIndex([{ contactId: '6', phones: ['+79161234567'], lastDeal: deal('2', '2026-10-01T05:00:00Z') }])
    expect(novelty(foreign, same, dayStart).status).toBe('t30')
  })

  it('a number-less client is looked up by its contact', () => {
    const prior = deal('5', '2026-09-01T05:00:00Z')
    expect(novelty({ phones: [], contactIds: ['77'] }, historyIndex([{ contactId: '77', phones: [], lastDeal: prior }]), dayStart).status).toBe('old')
  })
})

describe('maskPhone — the last four digits only', () => {
  it('local and foreign', () => {
    expect(maskPhone('901234567')).toBe('+998 •• •••-45-67')
    expect(maskPhone('x79161234567')).toBe('+•••45-67')
  })
})

describe('the day card', () => {
  const day = '2026-10-23'
  const dayStart = new Date('2026-10-22T19:00:00Z')
  const rows = [
    lead({ phones: ['901234567'], ropKval: 'Sevinch', hour: 9, source: 'Повторная продажа', leadGuard: true, at: new Date('2026-10-23T04:00:00Z') }),
    lead({ phones: ['901234567'], ropKval: 'Azizbek', hour: 10, source: 'sinolifeuz', at: new Date('2026-10-23T05:00:00Z') }),
    lead({ phones: ['931112233'], ropPrimary: 'Azizbek', hour: 11, source: 'Facebook', entry: 'ai' }),
    lead({ phones: ['941112233'], hour: 11, source: null, ownerDesk: false }),
    lead({ phones: [], contactId: null, hour: 23, source: 'Входящий' }),
  ]
  const clients = bezkvalClients(rows)
  const history: BezkvalHistoryRow[] = [
    { contactId: 'h1', phones: ['+998 93 111 22 33'], lastDeal: { externalId: '7', at: new Date('2026-10-10T05:00:00Z'), pipeline: 'Регистрация' } },
    { contactId: 'h2', phones: ['941112233'], lastDeal: { externalId: '8', at: new Date('2026-03-10T05:00:00Z'), pipeline: 'Доставка' } },
  ]
  const list = bezkvalClientRows(day, clients, { index: historyIndex(history), dayStart }).map((r) => r.client)
  const kval = bezkvalClientRows(day, bezkvalClients([lead({ phones: ['901234567'], ropKval: 'Sevinch' })]), null).map((r) => r.client)
  const dto = buildBezkvalDay({
    day,
    clients: list,
    kval,
    computedAt: '2026-10-23T13:00:00.000Z',
    trendDays: ['2026-10-22', day],
    // The day × ROP rows are counted in SQL (`bezkvalDays`); one row for the whole day sums the same.
    totals: bezkvalDayTotals([{ day, leads: clients.length, deals: rows.length }]),
    order: (rops) => [...rops].sort(),
    heads: new Map([['Sevinch', 'Sevinch Usmonova']]),
  })

  it('counts kirim, clients, new and both repeats, the two buckets and kval, and the checks hold', () => {
    expect(dto).toMatchObject({ kirim: 5, bezkval: 4, fresh: 2, repeat30: 1, repeatOld: 1, unassigned: 1, registration: 1, multiRop: 1, kval: { deals: 1, clients: 1 } })
    expect(dto.problems).toEqual([])
    expect(dto.keyKinds).toEqual({ phone: 3, dealPhone: 0, contact: 0, deal: 1 })
    expect(dto.entries).toEqual({ created: { deals: 3, clients: 2 }, ai: { deals: 1, clients: 1 }, leadGuard: { deals: 1, clients: 1 } })
  })

  it('splits the clients by ROP, then «Регистрация boʻlimida» and «Taqsimlanmagan», the shares summing to the whole', () => {
    expect(dto.rops.map((r) => [ropLabel(r), r.head, r.bezkval, r.fresh, r.repeat30, r.repeatOld])).toEqual([
      ['Azizbek', null, 1, 0, 1, 0],
      ['Sevinch', 'Sevinch Usmonova', 1, 1, 0, 0],
      ['Регистрация boʻlimida', null, 1, 0, 0, 1],
      ['Taqsimlanmagan', null, 1, 1, 0, 0],
    ])
    expect(dto.rops.reduce((n, r) => n + r.sharePct, 0)).toBeCloseTo(100)
  })

  it('reads the source and the hour off the client\'s main deal — Lead Guard under its own name', () => {
    expect(dto.sources.find((s) => s.source === LEAD_GUARD_SOURCE)!.bezkval).toBe(1)
    expect(dto.sources.find((s) => s.source === 'sinolifeuz')).toBeUndefined()
    expect(dto.hours[9]).toBe(1)
    expect(dto.hours[10]).toBe(0)
    expect(dto.trend).toEqual([
      { day: '2026-10-22', kirim: 0, bezkval: 0 },
      { day, kirim: 5, bezkval: 4 },
    ])
  })

  it('every number\'s drill-down lists exactly the clients it counted', () => {
    expect(pickClients(list, {})).toHaveLength(dto.bezkval)
    expect(pickClients(list, { status: 'new' })).toHaveLength(dto.fresh)
    expect(pickClients(list, { status: 't30' })).toHaveLength(dto.repeat30)
    expect(pickClients(list, { status: 'old' })).toHaveLength(dto.repeatOld)
    expect(pickClients(list, { rop: null, bucket: 'unassigned' })).toHaveLength(dto.unassigned)
    expect(pickClients(list, { rop: null, bucket: 'registration' })).toHaveLength(dto.registration)
    expect(pickClients(list, { kind: 'multiRop' })).toHaveLength(dto.multiRop)
    for (const r of dto.rops) {
      const pick = r.rop !== null ? { rop: r.rop } : { rop: null, bucket: r.bucket }
      expect(pickClients(list, pick)).toHaveLength(r.bezkval)
      expect(pickClients(list, { ...pick, status: 'new' })).toHaveLength(r.fresh)
    }
    for (const s of dto.sources) expect(pickClients(list, { source: s.source })).toHaveLength(s.bezkval)
    dto.hours.forEach((n, hour) => expect(pickClients(list, { hour })).toHaveLength(n))
    for (const k of ['created', 'ai', 'leadGuard'] as const) expect(pickClients(list, { entry: k })).toHaveLength(dto.entries[k].clients)
    expect(pickClients(list, { kind: 'noPhone' })).toHaveLength(dto.keyKinds.contact + dto.keyKinds.deal)
    expect(pickClients(kval, {})).toHaveLength(dto.kval.clients)
  })

  it('masks the numbers and proves a repeat with its earlier deal', () => {
    const repeat = list.find((c) => c.status === 't30')!
    expect(repeat.phone).toBe('+998 •• •••-22-33')
    expect(repeat.previous).toEqual({ id: '7', at: '2026-10-10T05:00:00.000Z', pipeline: 'Регистрация' })
    expect(list.every((c) => c.phone === null || c.phone.includes('••'))).toBe(true)
    expect(kval[0]!.status).toBeNull()
  })

  it('hands Excel one client a row, with a link to every deal', () => {
    const csv = bezkvalCsvRows(day, list)
    expect(csv[0]).toEqual(['Sana', 'Telefon', 'Kirim vaqti', 'Kirim turi', 'Manba', 'ROP', 'Holat', 'Sdelkalar soni', 'Sdelkalar', 'Oldingi sdelka', 'Oldingi sdelka sanasi'])
    expect(csv).toHaveLength(list.length + 1)
    const two = csv.find((r) => r[7] === '2')!
    expect(two[8]!.split(' ')).toHaveLength(2)
    expect(two[8]).toContain('https://obey.bitrix24.kz/crm/deal/details/')
    expect(csv.find((r) => r[6] === 'Takror 30 kun')![9]).toBe('https://obey.bitrix24.kz/crm/deal/details/7/')
  })
})

describe('bezkvalInvariantProblems — the spec\'s automatic checks', () => {
  const ok = { kirim: 5, bezkval: 4, fresh: 2, repeat30: 1, repeatOld: 1, lines: [{ bezkval: 3 }, { bezkval: 1 }], dealIds: ['1', '2', '3'] }
  it('names a ROP sum that misses the whole, statuses that miss it, more clients than deals, a deal twice', () => {
    expect(bezkvalInvariantProblems(ok)).toEqual([])
    expect(bezkvalInvariantProblems({ ...ok, lines: [{ bezkval: 3 }] })).toHaveLength(1)
    expect(bezkvalInvariantProblems({ ...ok, repeatOld: 0 })).toHaveLength(1)
    expect(bezkvalInvariantProblems({ ...ok, kirim: 3 })).toHaveLength(1)
    expect(bezkvalInvariantProblems({ ...ok, dealIds: ['1', '1'] })).toHaveLength(1)
  })
})
