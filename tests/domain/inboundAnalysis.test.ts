import { describe, expect, it } from 'vitest'

import {
  type HistoryCall,
  analysisGroup,
  groupOutcome,
  inboundAnalysis,
  judgeNumbers,
  returningDetail,
  silenceBucket,
} from '@/server/domain/calls/inboundAnalysis'
import type { ContactHistory, InboundCall } from '@/server/domain/calls/inboundCalls'

const DAY = 86_400_000
const T = new Date('2026-10-10T07:00:00Z') // 12:00 in Tashkent

const call = (phone: string, at: Date, durationSec = 0, customerId: string | null = 'c1'): InboundCall => ({
  phone,
  startedAt: at,
  durationSec,
  customerId,
  day: new Date(at.getTime() + 5 * 3_600_000).toISOString().slice(0, 10),
})

const talk = (key: string, at: Date, durationSec = 60, outbound = true): HistoryCall => ({ key, startedAt: at, durationSec, outbound })

const old = (deals: ContactHistory['deals'] = []): ContactHistory => ({ createdAt: new Date('2026-03-01T00:00:00Z'), deals })
const ago = (days: number) => new Date(T.getTime() - days * DAY)

describe('analysisGroup — the CLAUDE.md\'s two groups', () => {
  it('reads a contact created with the call (±5 min) as «Соф янги»', () => {
    const fresh: ContactHistory = { createdAt: new Date(T.getTime() - 2 * 60_000), deals: [] }
    expect(analysisGroup(T, fresh, []).group).toBe('fresh')
    // Six minutes before is a contact that already existed.
    expect(analysisGroup(T, { createdAt: new Date(T.getTime() - 6 * 60_000), deals: [] }, []).group).toBeNull()
  })

  it('reads more than 14 days since the last real conversation as «Қайта мурожат»', () => {
    const r = analysisGroup(T, old(), [talk('901234567', ago(20))])
    expect(r.group).toBe('returning')
    expect(r.silenceDays).toBeCloseTo(20, 6)
  })

  it('needs MORE than 14 days: 14 exactly, or fewer, is no return', () => {
    expect(analysisGroup(T, old(), [talk('901234567', ago(14))]).group).toBeNull()
    expect(analysisGroup(T, old(), [talk('901234567', ago(3))]).group).toBeNull()
  })

  it('takes the LAST conversation, either way, and only one with a second of talk', () => {
    const history = [talk('9', ago(40)), talk('9', ago(5), 30, false), talk('9', ago(2), 0)]
    // The inbound talk 5 days ago is the last one; the 0-second call 2 days ago is no conversation.
    expect(analysisGroup(T, old(), history)).toMatchObject({ group: null, silenceDays: 5 })
  })

  it('leaves out a number that never talked to us — the CLAUDE.md\'s fourth limitation', () => {
    expect(analysisGroup(T, old(), [talk('9', ago(30), 0)]).group).toBeNull()
  })

  it('leaves out a buyer: a Доставка or База deal created before the call', () => {
    const history = [talk('9', ago(60))]
    expect(analysisGroup(T, old([{ pipeline: '6', stage: 'C6:WON', createdAt: ago(90) }]), history).group).toBeNull()
    expect(analysisGroup(T, old([{ pipeline: '10', stage: 'C10:NEW', createdAt: ago(90) }]), history).group).toBeNull()
    // A База deal opened AFTER the call does not count against it.
    expect(analysisGroup(T, old([{ pipeline: '10', stage: 'C10:NEW', createdAt: ago(-1) }]), history).group).toBe('returning')
    // Any other funnel is no buyer.
    expect(analysisGroup(T, old([{ pipeline: '12', stage: 'C12:LOSE', createdAt: ago(90) }]), history).group).toBe('returning')
  })
})

describe('judgeNumbers — each number followed to the end', () => {
  const contacts = new Map<string, ContactHistory>([['c1', old()]])

  it('reads answered, called back, talked and lost per number', () => {
    const history = new Map<string, HistoryCall[]>([
      // Answered on its own call.
      ['901111111', [talk('901111111', ago(30)), talk('901111111', T, 45, false)]],
      // Missed, then reached on our callback an hour later.
      ['902222222', [talk('902222222', ago(30)), talk('902222222', new Date(T.getTime() + 3_600_000), 90, true)]],
      // Missed, never reached.
      ['903333333', [talk('903333333', ago(30))]],
    ])
    const verdicts = judgeNumbers(
      [call('+998 90 111 11 11', T, 45), call('+998902222222', T, 0), call('903333333', T, 0)],
      contacts,
      history,
    )
    const by = Object.fromEntries(verdicts.map((v) => [v.key, v]))
    expect(by['901111111']).toMatchObject({ group: 'returning', answered: true, calledBack: false, talked: true })
    expect(by['902222222']).toMatchObject({ group: 'returning', answered: false, calledBack: true, talked: true })
    expect(by['903333333']).toMatchObject({ group: 'returning', answered: false, calledBack: false, talked: false })
    expect(groupOutcome(verdicts, 'returning')).toEqual({ numbers: 3, answered: 1, calledBack: 1, talked: 2, lost: 1 })
  })

  it('judges a number once, at its first call, on its last nine digits', () => {
    const history = new Map([['901111111', [talk('901111111', ago(30))]]])
    const verdicts = judgeNumbers(
      [call('+998901111111', T), call('901111111', new Date(T.getTime() + 60_000), 20)],
      contacts,
      history,
    )
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ calls: 2, answered: true, firstCallAt: T })
  })
})

describe('inboundAnalysis — days and the period', () => {
  it('judges a day row at the day\'s first call, the period at the period\'s', () => {
    const contacts = new Map([['c1', old()]])
    // Last talk 20 days before the first call; the number rings again two days later.
    const history = new Map([['901111111', [talk('901111111', ago(20)), talk('901111111', T, 30, false)]]])
    const second = new Date(T.getTime() + 2 * DAY)
    const { days, verdicts } = inboundAnalysis(
      [call('901111111', T, 30), call('901111111', second, 0)],
      contacts,
      history,
      ['2026-10-10', '2026-10-11', '2026-10-12'],
    )
    expect(days.map((d) => [d.day, d.calls, d.returning.numbers])).toEqual([
      ['2026-10-10', 1, 1],
      ['2026-10-11', 0, 0],
      // Two days after a talk: on its own day the number is no return.
      ['2026-10-12', 1, 0],
    ])
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]!.group).toBe('returning')
  })
})

describe('returningDetail — how long they were silent', () => {
  it('buckets the silence as the CLAUDE.md does, with the median and the longest', () => {
    const v = (silenceDays: number) => ({
      key: String(silenceDays),
      phone: null,
      customerId: null,
      firstCallAt: T,
      calls: 1,
      group: 'returning' as const,
      answered: false,
      calledBack: false,
      talked: false,
      silenceDays,
    })
    const detail = returningDetail([v(15), v(30), v(31), v(90), v(91), v(400.6)])
    expect(detail.buckets).toEqual({ d14_30: 2, m1_3: 2, m3_6: 1, m6: 1 })
    expect(detail.medianDays).toBe(61)
    expect(detail.longestDays).toBe(400)
    expect(silenceBucket(14.5)).toBe('d14_30')
    expect(returningDetail([]).medianDays).toBeNull()
  })
})
