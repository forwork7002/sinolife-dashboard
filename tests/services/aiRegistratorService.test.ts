import { describe, expect, it } from 'vitest'

import type { AiCall, Handoff, SaleDeal, SellerCall } from '@/server/domain/aiRegistrator/aiRegistrator'
import type { Period } from '@/server/domain/period/period'
import type { AiRegistratorRepository, ClassicLeadRow, LeadDealRow } from '@/server/repositories/aiRegistratorRepository'
import { AiRegistratorService } from '@/server/services/aiRegistratorService'

/**
 * The service joins the agent's calls to the synced deals: the AI cohort by
 * transfer, the classic cohort by «Сделка успешна», sellers by floor number.
 */

const T = new Date('2026-10-22T07:00:00Z')
const HOUR = 3_600_000
const at = (ms: number) => new Date(T.getTime() + ms)
const period: Period = { start: new Date('2026-10-21T19:00:00Z'), end: new Date('2026-10-22T19:00:00Z'), timeZone: 'Asia/Tashkent', preset: 'today' }

const call = (over: Partial<AiCall>): AiCall => ({
  callId: 'c',
  dealExternalId: '1',
  phone: '+998901234567',
  startedAt: T,
  answeredAt: T,
  durationSec: 60,
  outcome: 'interested_transferred',
  transferredTo: '115',
  transferAttempts: [],
  result: { problem: 'Teri', summary: 'Oʻzi uchun' },
  isTest: false,
  ...over,
})

const lead = (externalId: string, customerId: string | null): LeadDealRow => ({
  externalId,
  customerId,
  title: `Lid ${externalId}`,
  pipeline: 'Регистрация',
  stage: 'Обработка',
  status: 'OPEN',
  createdAt: at(-HOUR),
})

const sale = (over: Partial<SaleDeal>): SaleDeal => ({
  externalId: 's',
  customerId: 'cu1',
  role: 'QUALIFICATION',
  status: 'OPEN',
  countsAsRevenue: false,
  amountMinor: 0n,
  createdAt: at(10 * 60_000),
  pipeline: 'Первичный отдел',
  stage: 'Новая',
  operatorId: null,
  ownerId: 'e115',
  ...over,
})

function service(data: {
  calls: AiCall[]
  leads: LeadDealRow[]
  classic: ClassicLeadRow[]
  sales: SaleDeal[]
  history?: Handoff[]
  sellerCalls?: SellerCall[]
}) {
  const repo = {
    calls: async () => data.calls,
    classicLeads: async () => data.classic,
    roster: async () => [
      { id: 'e115', fullName: 'Sirojov 115 Davlatbek' },
      { id: 'e112', fullName: 'Karimova 112 Malika' },
      { id: 'e200', fullName: 'Boshqa 200 Sotuvchi' },
    ],
    leadDeals: async (ids: readonly string[]) => new Map(data.leads.filter((l) => ids.includes(l.externalId)).map((l) => [l.externalId, l])),
    handoffs: async () => data.history ?? [],
    sales: async () => data.sales,
    sellerCalls: async (ids: readonly string[]) => (data.sellerCalls ?? []).filter((c) => ids.includes(c.employeeId)),
  } as unknown as AiRegistratorRepository
  return new AiRegistratorService(repo, 'UZS')
}

describe('AiRegistratorService.report', () => {
  it('follows an AI lead to its order and names the seller by the extension', async () => {
    const svc = service({
      calls: [
        call({
          callId: 'a',
          transferAttempts: [
            { ext: '112', result: 'busy', at: null },
            { ext: '115', result: 'answered', at: null },
          ],
        }),
        call({ callId: 't', dealExternalId: '9', isTest: true }),
      ],
      leads: [lead('1', 'cu1')],
      classic: [{ externalId: '2', customerId: 'cu2', closedAt: at(HOUR) }],
      sales: [
        sale({ externalId: 'q1' }),
        sale({ externalId: 'c1', role: 'CONFIRMATION', amountMinor: 50_000_000n, createdAt: at(2 * HOUR), operatorId: 'e115' }),
        sale({ externalId: 'q2', customerId: 'cu2', createdAt: at(HOUR), ownerId: 'e115' }),
      ],
    })
    const dto = await svc.report(period, at(5 * HOUR))

    expect(dto.funnel).toMatchObject({ calls: 1, tests: 1, deals: 1 })
    expect(dto.ai).toMatchObject({ leads: 1, ordered: 1, orderedRateBp: 10_000, sold: 0 })
    expect(dto.ai.orderSum.amountMinor).toBe('50000000')
    expect(dto.classic).toMatchObject({ leads: 1, withSalesDeal: 1, ordered: 0, orderedRateBp: 0 })

    expect(dto.extensions.map((e) => [e.ext, e.name, e.tried, e.answered, e.busy])).toEqual([
      ['112', 'Karimova 112 Malika', 1, 0, 1],
      ['115', 'Sirojov 115 Davlatbek', 1, 1, 0],
    ])
    // Both extensions tried are rows; the classic lead sold by 115 sits beside 115's AI lead.
    expect(dto.sellers.map((s) => [s.ext, s.ai.leads, s.classic.leads])).toEqual([
      ['112', 0, 0],
      ['115', 1, 1],
    ])

    expect(dto.deals).toHaveLength(1)
    expect(dto.deals[0]).toMatchObject({
      dealId: '1',
      title: 'Lid 1',
      seller: 'Sirojov 115 Davlatbek',
      verdict: 'ordered',
      soldBy: null,
      problem: 'Teri',
      lead: { pipeline: 'Регистрация', stage: 'Обработка', status: 'OPEN' },
    })
    expect(dto.deals[0]!.sales.map((s) => s.dealId)).toEqual(['q1', 'c1'])
    expect(dto.enoughToCompare).toBe(false)
  })

  it('names who wrote the deal when it is not the seller the AI rang', async () => {
    const svc = service({
      calls: [call({ callId: 'a' })],
      leads: [lead('1', 'cu1')],
      classic: [],
      sales: [sale({ role: 'CONFIRMATION', operatorId: 'e200' })],
    })
    const dto = await svc.report({ ...period, preset: 'yesterday' }, at(HOUR))
    expect(dto.deals[0]).toMatchObject({ seller: 'Sirojov 115 Davlatbek', soldBy: 'Boshqa 200 Sotuvchi' })
  })

  it('lists a lead every transfer failed on, and one the sync has not read yet', async () => {
    const svc = service({
      calls: [
        call({ callId: 'f', dealExternalId: '5', outcome: 'transfer_failed', transferredTo: null }),
        call({ callId: 'n', dealExternalId: '6' }),
      ],
      leads: [lead('5', 'cu5')],
      classic: [],
      sales: [],
    })
    const dto = await svc.report({ ...period, preset: 'this_week' }, at(HOUR))
    expect(dto.deals.map((d) => [d.dealId, d.verdict]).sort()).toEqual([
      ['5', 'not_transferred'],
      ['6', 'not_synced'],
    ])
    expect(dto.ai.leads).toBe(1)
    expect(dto.ai.orderedRateBp).toBe(0)
    expect(dto.classic.orderedRateBp).toBeNull()
  })
})

describe('AiRegistratorService.calls', () => {
  // Its own window: the report and the calls are memoised per window, module-wide.
  const window: Period = { ...period, start: new Date('2026-10-20T19:00:00Z'), preset: 'custom' }

  it('lists the calls behind a number with the extensions’ sellers, the agent’s notes and the lead’s verdict', async () => {
    const svc = service({
      calls: [
        call({
          callId: 'a',
          attempt: 2,
          transferAttempts: [
            { ext: '112', result: 'busy', at: null },
            { ext: '115', result: 'answered', at: null },
          ],
          result: { for_whom: 'Oʻzi', problem: 'Teri', summary: '', extra: { a: 1 } },
        }),
        call({ callId: 'b', dealExternalId: '5', outcome: 'no_answer', answeredAt: null, transferredTo: null, startedAt: at(HOUR), result: null }),
      ],
      leads: [lead('1', 'cu1'), lead('5', null)],
      classic: [],
      sales: [sale({ externalId: 'c1', role: 'CONFIRMATION', amountMinor: 50_000_000n, createdAt: at(2 * HOUR), operatorId: 'e115' })],
    })
    const all = await svc.calls(window, { kind: 'all', limit: 100 }, at(5 * HOUR))
    expect(all.total).toBe(2)
    expect(all.rows.map((r) => r.callId)).toEqual(['b', 'a'])

    const put = all.rows[1]!
    expect(put).toMatchObject({ dealId: '1', title: 'Lid 1', attempt: 2, seller: 'Sirojov 115 Davlatbek', verdict: 'ordered' })
    expect(put.attempts.map((x) => [x.ext, x.name, x.result])).toEqual([
      ['112', 'Karimova 112 Malika', 'busy'],
      ['115', 'Sirojov 115 Davlatbek', 'answered'],
    ])
    // Empty fields left out; a nested one as its JSON.
    expect(put.notes).toEqual([
      { key: 'for_whom', value: 'Oʻzi' },
      { key: 'problem', value: 'Teri' },
      { key: 'extra', value: '{"a":1}' },
    ])
    expect(put.sales.map((x) => x.dealId)).toEqual(['c1'])

    // A call the report does not follow carries no verdict.
    expect(all.rows[0]).toMatchObject({ verdict: null, seller: null, lead: { pipeline: 'Регистрация' } })

    const ordered = await svc.calls(window, { kind: 'ordered', limit: 100 }, at(5 * HOUR))
    expect(ordered.rows.map((r) => r.callId)).toEqual(['a'])
    const capped = await svc.calls(window, { kind: 'all', limit: 1 }, at(5 * HOUR))
    expect(capped).toMatchObject({ total: 2 })
    expect(capped.rows).toHaveLength(1)
  })

  it('tells what each seller who did not take the caller was doing then, from their own calls', async () => {
    const svc = service({
      calls: [
        call({
          callId: 'a',
          transferAttempts: [
            { ext: '112', result: 'busy', at: at(60_000), note: 'On the phone' },
            { ext: '200', result: 'no_answer', at: at(61_000), ringSec: 15 },
            { ext: '115', result: 'answered', at: at(76_000), ringSec: 5 },
          ],
        }),
      ],
      leads: [lead('1', 'cu1')],
      classic: [],
      sales: [],
      sellerCalls: [
        { employeeId: 'e112', direction: 'OUTBOUND', phone: '998901112233', startedAt: at(-9 * 60_000), durationSec: 900, connected: true },
        { employeeId: 'e115', direction: 'INBOUND', phone: '998907778899', startedAt: at(0), durationSec: 30, connected: true },
      ],
    })
    // its own window: the drawer's calls are cached per window across tests
    const own: Period = { ...window, start: new Date('2026-10-19T19:00:00Z') }
    const [row] = (await svc.calls(own, { kind: 'all', limit: 100 }, at(5 * HOUR))).rows
    expect(row!.attempts.map((x) => [x.ext, x.doing?.kind ?? null, x.note])).toEqual([
      ['112', 'talking', 'On the phone'],
      ['200', 'none', null], // no call of theirs near it: an internal call or other work
      ['115', null, null], // the one who answered is not looked up
    ])
    expect(row!.attempts[0]!.doing).toMatchObject({ direction: 'OUTBOUND', phone: '998901112233', from: at(-9 * 60_000).toISOString() })
    // the same moment read minutes later: the call sync may not have read their calls yet
    const fresh = (await svc.calls(own, { kind: 'all', limit: 100 }, at(5 * 60_000))).rows[0]!
    expect(fresh.attempts[1]!.doing?.kind).toBe('pending')
  })
})
