import { describe, expect, it } from 'vitest'

import {
  type AiCall,
  type Handoff,
  type SaleDeal,
  HANDOFF_SLACK_MS,
  aiTransfers,
  assignSales,
  attemptsByExtension,
  callFunnel,
  groupStats,
  leadOutcome,
  readTransferAttempts,
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
      { ext: '112', tried: 2, answered: 1, busy: 1, noAnswer: 0, failed: 0 },
      { ext: '115', tried: 2, answered: 0, busy: 1, noAnswer: 1, failed: 0 },
      { ext: '114', tried: 1, answered: 0, busy: 0, noAnswer: 0, failed: 1 },
      { ext: '117', tried: 1, answered: 1, busy: 0, noAnswer: 0, failed: 0 },
    ])
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
