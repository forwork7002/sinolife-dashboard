import { describe, expect, it } from 'vitest'

import {
  type AiCall,
  type Handoff,
  type SaleDeal,
  HANDOFF_SLACK_MS,
  aiTransfers,
  assignSales,
  activityAt,
  attemptsByExtension,
  callFunnel,
  groupStats,
  leadOutcome,
  readTransferAttempts,
  selectCalls,
} from '@/server/domain/aiRegistrator/aiRegistrator'

const DAY = 86_400_000
const HOUR = 3_600_000
const T = new Date('2026-10-22T07:00:00Z') // 12:00 in Tashkent
const at = (ms: number) => new Date(T.getTime() + ms)

const call = (over: Partial<AiCall> = {}): AiCall => ({
  callId: 'c1',
  dealExternalId: '1001',
  phone: '+998901234567',
  startedAt: T,
  answeredAt: T,
  durationSec: 60,
  outcome: 'interested_transferred',
  transferredTo: '115',
  transferAttempts: [],
  result: null,
  isTest: false,
  ...over,
})

const sale = (over: Partial<SaleDeal> = {}): SaleDeal => ({
  externalId: 's1',
  customerId: 'cu1',
  role: 'QUALIFICATION',
  status: 'OPEN',
  countsAsRevenue: false,
  amountMinor: 0n,
  createdAt: at(5 * 60_000),
  pipeline: 'Первичный отдел',
  stage: 'Новая',
  operatorId: null,
  ownerId: 'e115',
  ...over,
})

const handoff = (leadKey: string, when: Date, customerId = 'cu1'): Handoff => ({ leadKey, customerId, at: when })

describe('aiTransfers — one lead per deal, at its first transfer', () => {
  it('keeps the first transfer of a deal and drops tests and other outcomes', () => {
    const rows = aiTransfers([
      call({ callId: 'b', startedAt: at(HOUR) }),
      call({ callId: 'a', startedAt: T }),
      call({ callId: 't', dealExternalId: '1002', isTest: true }),
      call({ callId: 'n', dealExternalId: '1003', outcome: 'not_interested', transferredTo: null }),
    ])
    expect(rows.map((r) => [r.dealExternalId, r.call.callId])).toEqual([['1001', 'a']])
  })
})

describe('callFunnel', () => {
  it('counts calls, distinct deals and pick-ups without the test calls', () => {
    const f = callFunnel([
      call({ callId: '1' }),
      call({ callId: '2', answeredAt: null, outcome: 'no_answer' }),
      call({ callId: '3', dealExternalId: '1002', outcome: 'no_answer', answeredAt: null }),
      call({ callId: '4', isTest: true }),
    ])
    expect(f).toEqual({
      calls: 3,
      deals: 2,
      answered: 1,
      tests: 1,
      byOutcome: { interested_transferred: 1, no_answer: 2 },
    })
  })
})

describe('transfer attempts', () => {
  it('reads the stored JSON leniently', () => {
    expect(
      readTransferAttempts([
        { ext: '115', result: 'busy', at: '2026-10-22T07:00:01Z' },
        { ext: '112', result: 'answered' },
        { ext: '', result: 'answered' },
        { ext: '114', result: 'maybe' },
        'junk',
      ]),
    ).toEqual([
      { ext: '115', result: 'busy', at: new Date('2026-10-22T07:00:01Z') },
      { ext: '112', result: 'answered', at: null },
    ])
    expect(readTransferAttempts(null)).toEqual([])
  })

  it('tallies each extension, counting a call with no list as one answered try of its transferredTo', () => {
    const rows = attemptsByExtension([
      call({
        callId: '1',
        transferredTo: '112',
        transferAttempts: [
          { ext: '115', result: 'busy', at: null },
          { ext: '112', result: 'answered', at: null },
        ],
      }),
      call({
        callId: '2',
        outcome: 'transfer_failed',
        transferredTo: null,
        transferAttempts: [
          { ext: '115', result: 'no_answer', at: null },
          { ext: '112', result: 'busy', at: null },
          { ext: '114', result: 'failed', at: null },
        ],
      }),
      call({ callId: '3', transferredTo: '117' }),
      call({ callId: '4', isTest: true, transferAttempts: [{ ext: '115', result: 'answered', at: null }] }),
    ])
    expect(rows).toEqual([
      { ext: '112', tried: 2, answered: 1, busy: 1, rejected: 0, noAnswer: 0, failed: 0 },
      { ext: '115', tried: 2, answered: 0, busy: 1, rejected: 0, noAnswer: 1, failed: 0 },
      { ext: '114', tried: 1, answered: 0, busy: 0, rejected: 0, noAnswer: 0, failed: 1 },
      { ext: '117', tried: 1, answered: 1, busy: 0, rejected: 0, noAnswer: 0, failed: 0 },
    ])
  })

  it('keeps a seller who turned the call down apart from one on another call, with how long it rang', () => {
    const attempts = readTransferAttempts([
      { ext: '134', result: 'busy', at: '2026-10-27T10:00:00Z' },
      { ext: '135', result: 'rejected', at: '2026-10-27T10:00:01Z', ring_sec: 4.4 },
      { ext: '136', result: 'no_answer', at: '2026-10-27T10:00:06Z', ring_sec: 15 },
      { ext: '141', result: 'caller_left', at: '2026-10-27T10:00:21Z', ring_sec: 3 },
      { ext: '143', result: 'answered', at: '2026-10-27T10:00:30Z', ring_sec: 6 },
      { ext: '143', result: 'answered', ring_sec: 'soon' },
    ])
    expect(attempts.map((a) => [a.ext, a.result, a.ringSec])).toEqual([
      ['134', 'busy', undefined],
      ['135', 'rejected', 4],
      ['136', 'no_answer', 15],
      ['141', 'caller_left', 3],
      ['143', 'answered', 6],
      ['143', 'answered', undefined],
    ])
    // the caller hanging up while it rang is not the seller's try
    expect(attemptsByExtension([call({ callId: '1', transferredTo: '143', transferAttempts: attempts.slice(0, 5) })])).toEqual([
      { ext: '134', tried: 1, answered: 0, busy: 1, rejected: 0, noAnswer: 0, failed: 0 },
      { ext: '135', tried: 1, answered: 0, busy: 0, rejected: 1, noAnswer: 0, failed: 0 },
      { ext: '136', tried: 1, answered: 0, busy: 0, rejected: 0, noAnswer: 1, failed: 0 },
      { ext: '143', tried: 1, answered: 1, busy: 0, rejected: 0, noAnswer: 0, failed: 0 },
    ])
  })
})

describe('what a seller was doing when the agent found them busy', () => {
  // 26.10 at 16:18:06 Tashkent the agent found ten sellers busy; Bitrix24 had each of them on a customer call.
  const T = new Date('2026-10-26T11:18:06Z')
  const sc = (startIso: string, durationSec: number, connected = true, direction: 'INBOUND' | 'OUTBOUND' = 'OUTBOUND') => ({
    employeeId: 'e',
    direction,
    phone: '+998901112233',
    startedAt: new Date(startIso),
    durationSec,
    connected,
  })

  it('reads a connected call that spans the moment as talking, with when it ended', () => {
    const act = activityAt([sc('2026-10-26T11:09:01Z', 922)], T) // 108: 16:09:01–16:24:23
    expect(act.kind).toBe('talking')
    expect(act.kind === 'talking' && act.endsAt.toISOString()).toBe('2026-10-26T11:24:23.000Z')
    // 123: hung up ten seconds after the check — still talking at it
    expect(activityAt([sc('2026-10-26T11:01:09Z', 1027)], T).kind).toBe('talking')
  })

  it('reads a call not yet answered that started just before as dialing', () => {
    expect(activityAt([sc('2026-10-26T11:17:50Z', 0, false)], T).kind).toBe('dialing')
    expect(activityAt([sc('2026-10-26T11:16:00Z', 0, false)], T).kind).toBe('none') // two minutes before: over
  })

  it('names a call that had just ended or was about to start, and how far off', () => {
    const ended = activityAt([sc('2026-10-26T11:10:00Z', 476)], T) // ended 16:17:56, 10 s before
    expect(ended).toMatchObject({ kind: 'ended', gapSec: 10 })
    const starting = activityAt([sc('2026-10-26T11:18:22Z', 600)], T)
    expect(starting).toMatchObject({ kind: 'starting', gapSec: 16 })
  })

  it('says none when Bitrix24 has no call near the moment', () => {
    expect(activityAt([sc('2026-10-26T10:00:00Z', 60), sc('2026-10-26T11:30:00Z', 60)], T)).toEqual({ kind: 'none' })
    expect(activityAt([], T)).toEqual({ kind: 'none' })
  })

  it('keeps the ATS line word, since when and when it came free', () => {
    const [a] = readTransferAttempts([
      { ext: '136', result: 'busy', at: '2026-10-27T11:00:00Z', note: 'Ringing', since: '2026-10-27T10:59:58Z', freed_at: '2026-10-27T11:00:09Z' },
    ])
    expect(a).toMatchObject({ note: 'Ringing', since: new Date('2026-10-27T10:59:58Z'), freedAt: new Date('2026-10-27T11:00:09Z') })
  })
})

describe('assignSales — one sale, one lead', () => {
  it('gives a sale to the latest hand-off at or before it, within the slack and 30 days', () => {
    const sales = [
      sale({ externalId: 'early', createdAt: at(-HANDOFF_SLACK_MS + 1000) }), // inside the slack
      sale({ externalId: 'tooEarly', createdAt: at(-HANDOFF_SLACK_MS - 1000) }),
      sale({ externalId: 'late', createdAt: at(29 * DAY) }),
      sale({ externalId: 'tooLate', createdAt: at(31 * DAY) }),
    ]
    const out = assignSales([handoff('L1', T)], sales)
    expect(out.get('L1')?.map((s) => s.externalId)).toEqual(['early', 'late'])
  })

  it('credits a sale after a newer lead of the same contact to the newer one', () => {
    const out = assignSales(
      [handoff('old', T), handoff('new', at(2 * DAY))],
      [sale({ externalId: 'a', createdAt: at(HOUR) }), sale({ externalId: 'b', createdAt: at(3 * DAY) })],
    )
    expect(out.get('old')?.map((s) => s.externalId)).toEqual(['a'])
    expect(out.get('new')?.map((s) => s.externalId)).toEqual(['b'])
  })

  it('never crosses contacts', () => {
    const out = assignSales([handoff('L1', T, 'cu1')], [sale({ customerId: 'cu2' })])
    expect(out.size).toBe(0)
  })

  it('treats two hand-offs of one lead (the AI call, then its WON) as that one lead', () => {
    const out = assignSales([handoff('L1', T), handoff('L1', at(HOUR))], [sale({ createdAt: at(2 * HOUR) })])
    expect(out.get('L1')).toHaveLength(1)
  })
})

describe('leadOutcome', () => {
  it('reads a delivered Доставка deal as sold, its money as the Доставка sum', () => {
    const o = leadOutcome([
      sale({ externalId: 'q' }),
      sale({ externalId: 'c', role: 'CONFIRMATION', amountMinor: 500_000n, createdAt: at(HOUR), operatorId: 'e112' }),
      sale({ externalId: 'r', role: 'REVENUE', countsAsRevenue: true, status: 'WON', amountMinor: 450_000n, createdAt: at(2 * HOUR) }),
    ])
    expect(o).toEqual({
      verdict: 'sold',
      hasSalesDeal: true,
      ordered: true,
      orderMinor: 450_000n,
      sold: true,
      soldMinor: 450_000n,
      firstOrderAt: at(HOUR),
      sellerId: 'e112',
    })
  })

  it('reads a Тасдиклаш deal alone as ordered, at its own sum', () => {
    const o = leadOutcome([sale({ role: 'CONFIRMATION', amountMinor: 300_000n })])
    expect(o.verdict).toBe('ordered')
    expect(o.orderMinor).toBe(300_000n)
    expect(o.sold).toBe(false)
  })

  it('never counts a Доставка deal without countsAsRevenue as money', () => {
    const o = leadOutcome([sale({ role: 'REVENUE', countsAsRevenue: false, status: 'WON', amountMinor: 900n })])
    expect(o.sold).toBe(false)
    expect(o.soldMinor).toBe(0n)
  })

  it('tells with_seller, lost and no_deal apart', () => {
    expect(leadOutcome([sale()]).verdict).toBe('with_seller')
    expect(leadOutcome([sale({ status: 'LOST' })]).verdict).toBe('lost')
    expect(leadOutcome([]).verdict).toBe('no_deal')
    expect(leadOutcome([]).sellerId).toBeNull()
    // An order refused later is still an order, and the lead is not «lost» while a deal is open.
    expect(leadOutcome([sale({ role: 'CONFIRMATION', status: 'LOST' }), sale({ externalId: 'q2' })]).verdict).toBe('ordered')
  })

  it('credits the first sales deal\'s owner when there is no order', () => {
    expect(leadOutcome([sale({ ownerId: 'e114' })]).sellerId).toBe('e114')
  })
})

describe('groupStats', () => {
  it('sums the cohort and takes the median hours to the first order', () => {
    const g = groupStats([
      { outcome: leadOutcome([sale({ role: 'CONFIRMATION', amountMinor: 100n, createdAt: at(2 * HOUR) })]), handoffAt: T },
      { outcome: leadOutcome([sale({ role: 'CONFIRMATION', amountMinor: 200n, createdAt: at(4 * HOUR) })]), handoffAt: T },
      { outcome: leadOutcome([]), handoffAt: T },
    ])
    expect(g).toEqual({
      leads: 3,
      withSalesDeal: 2,
      ordered: 2,
      orderMinor: 300n,
      sold: 0,
      soldMinor: 0n,
      lost: 0,
      noDeal: 1,
      medianHoursToOrder: 3,
    })
    expect(groupStats([]).medianHoursToOrder).toBeNull()
  })
})

describe('selectCalls — the calls behind a number', () => {
  const calls: AiCall[] = [
    call({ callId: 'a', dealExternalId: '1', startedAt: at(0), outcome: 'no_answer', answeredAt: null, transferredTo: null }),
    call({ callId: 'b', dealExternalId: '1', startedAt: at(HOUR), outcome: 'interested_transferred', transferredTo: '115', transferAttempts: [
      { ext: '112', result: 'busy', at: null },
      { ext: '115', result: 'answered', at: null },
    ] }),
    call({ callId: 'c', dealExternalId: '2', phone: '+998 90 777 66 55', startedAt: at(2 * HOUR), outcome: 'transfer_failed', transferredTo: null, transferAttempts: [
      { ext: '112', result: 'no_answer', at: null },
    ] }),
    call({ callId: 'd', dealExternalId: '1', startedAt: at(3 * HOUR), outcome: 'interested_transferred', transferredTo: '112' }),
    call({ callId: 't', dealExternalId: '9', isTest: true }),
  ]
  const keyOf = (ext: string | null) => (ext === '115' ? 'e115' : ext ? `ext:${ext}` : null)
  const ids = (picked: AiCall[]) => picked.map((c) => c.callId)

  it('lists every real call, newest first, never a test call', () => {
    expect(ids(selectCalls(calls, { kind: 'all' }, keyOf))).toEqual(['d', 'c', 'b', 'a'])
  })

  it('takes each deal’s latest call for «Xil lid»', () => {
    expect(ids(selectCalls(calls, { kind: 'unique' }, keyOf))).toEqual(['d', 'c'])
  })

  it('picks by pick-up, by outcome and by every extension tried', () => {
    expect(ids(selectCalls(calls, { kind: 'answered' }, keyOf))).toEqual(['d', 'c', 'b'])
    expect(ids(selectCalls(calls, { kind: 'outcome', outcome: 'transfer_failed' }, keyOf))).toEqual(['c'])
    expect(ids(selectCalls(calls, { kind: 'ext', ext: '112' }, keyOf))).toEqual(['d', 'c', 'b'])
  })

  it('gives a seller the leads put through to them at their FIRST transfer, as the seller rows count', () => {
    // Deal 1 went to 115 first, then to 112: it is 115's lead, and not 112's.
    expect(ids(selectCalls(calls, { kind: 'seller', seller: 'e115' }, keyOf))).toEqual(['b'])
    expect(ids(selectCalls(calls, { kind: 'seller', seller: 'ext:112' }, keyOf))).toEqual([])
    expect(ids(selectCalls(calls, { kind: 'deals', deals: new Set(['1']) }, keyOf))).toEqual(['b'])
  })

  it('narrows by a phone’s digits or a deal id', () => {
    expect(ids(selectCalls(calls, { kind: 'all', q: '777 66' }, keyOf))).toEqual(['c'])
    expect(ids(selectCalls(calls, { kind: 'all', q: '2' }, keyOf))).toEqual(['c'])
  })
})
