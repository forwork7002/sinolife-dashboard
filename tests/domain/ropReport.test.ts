import { describe, expect, it } from 'vitest'

import { buildRopReport, PLAN_PER_LEAD_MINOR, type RosterMember, type SellerFaktRow } from '@/server/domain/registration/ropReport'

/*
  «ROP otchet» — the client's group sheet for 31.07.2026 («ASLIDDIN GRUPPA»),
  with «Лид руч» gone: conversion is Транз-1 ÷ Лид сони, plan 500 000 × Лид сони
  (2026-10-02), deviation План − Факт-1.
*/

const roster: RosterMember[] = [
  { employeeId: 'asl', fullName: 'Asliddin Karimberdiyev', rop: 'Asliddin', isHead: true },
  { employeeId: 'sar', fullName: 'Sardor Davlatov', rop: 'Asliddin', isHead: false },
  { employeeId: 'mal', fullName: 'Malika Rahmonova', rop: 'Asliddin', isHead: false },
  { employeeId: 'sev', fullName: 'Sevinch Head', rop: 'Sevinch', isHead: true },
]

const fakt = (employeeId: string, rop: string | null, fakt1Som: number, fakt1Orders: number, fakt2Som = 0, fakt2Orders = 0): SellerFaktRow => ({
  employeeId,
  rop,
  fakt1Minor: BigInt(fakt1Som) * 100n,
  fakt1Orders,
  fakt2Minor: BigInt(fakt2Som) * 100n,
  fakt2Orders,
})

const base = {
  day: '2026-07-31',
  roster,
  names: new Map([['x', 'Begona Sotuvchi']]),
  calls: [],
}

describe('buildRopReport', () => {
  const report = buildRopReport({
    ...base,
    leads: [
      { rop: 'Asliddin', employeeId: 'asl', leads: 2 },
      { rop: 'Asliddin', employeeId: 'sar', leads: 7 },
      { rop: null, employeeId: null, leads: 3 },
    ],
    fakt: [fakt('asl', 'Asliddin', 4_050_000, 2, 4_050_000, 2), fakt('sar', 'Asliddin', 4_800_000, 2), fakt('x', 'Asliddin', 1_000_000, 1)],
    calls: [
      { employeeId: 'sar', connected: 12, talkSec: 1_800 },
      { employeeId: 'mal', connected: 3, talkSec: 95 },
      { employeeId: 'desk', connected: 40, talkSec: 9_000 },
    ],
  })
  const asliddin = report.groups.find((g) => g.rop === 'Asliddin')!
  const som = (n: number) => String(BigInt(n) * 100n)

  it('plans 500 000 per lead and deviates by План − Факт-1', () => {
    const sardor = asliddin.sellers.find((s) => s.employeeId === 'sar')!
    expect(sardor.conversionPercent).toBeCloseTo((2 / 7) * 100)
    expect(sardor.plan.amountMinor).toBe(som(3_500_000))
    // 4 800 000 against 3 500 000: ahead, so below zero.
    expect(sardor.deviation.amountMinor).toBe(som(-1_300_000))
    const head = asliddin.sellers.find((s) => s.employeeId === 'asl')!
    expect(head.conversionPercent).toBe(100)
    expect(head.plan.amountMinor).toBe(som(1_000_000))
    expect(head.deviation.amountMinor).toBe(som(-3_050_000))
    expect(PLAN_PER_LEAD_MINOR).toBe(500_000n * 100n)
  })

  it('keeps a quiet roster member at zero, and conversion with no lead is null', () => {
    const malika = asliddin.sellers.find((s) => s.employeeId === 'mal')!
    expect(malika.leads).toBe(0)
    expect(malika.plan.amountMinor).toBe('0')
    expect(malika.deviation.amountMinor).toBe('0')
    expect(malika.conversionPercent).toBeNull()
    const x = asliddin.sellers.find((s) => s.employeeId === 'x')!
    expect(x.onRoster).toBe(false)
    expect(x.fullName).toBe('Begona Sotuvchi')
    expect(x.conversionPercent).toBeNull()
    // No lead, an order: no plan to miss.
    expect(x.deviation.amountMinor).toBe(som(-1_000_000))
  })

  it('puts the ROP first, then by FAKT 1', () => {
    expect(asliddin.sellers.map((s) => s.employeeId)).toEqual(['asl', 'sar', 'x', 'mal'])
  })

  it('sums the group and the company', () => {
    expect(asliddin.total.leads).toBe(9)
    expect(asliddin.total.fakt1Orders).toBe(5)
    expect(asliddin.total.fakt1.amountMinor).toBe(som(9_850_000))
    expect(asliddin.total.plan.amountMinor).toBe(som(4_500_000))
    expect(asliddin.total.deviation.amountMinor).toBe(som(-5_350_000))
    expect(asliddin.total.fakt2Orders).toBe(2)
    expect(report.total.leads).toBe(12)
    expect(report.total.plan.amountMinor).toBe(som(6_000_000))
    expect(report.total.fakt1.amountMinor).toBe(asliddin.total.fakt1.amountMinor)
  })

  it('puts each seller\'s connected calls and talk time on their row, and leaves out callers who are no row', () => {
    const sardor = asliddin.sellers.find((s) => s.employeeId === 'sar')!
    expect(sardor.connectedCalls).toBe(12)
    expect(sardor.talkSec).toBe(1_800)
    expect(asliddin.sellers.find((s) => s.employeeId === 'asl')!.connectedCalls).toBe(0)
    expect(asliddin.total.connectedCalls).toBe(15)
    expect(asliddin.total.talkSec).toBe(1_895)
    expect(report.total.connectedCalls).toBe(15)
  })

  it('prints no call figure for a day before the call data floor', () => {
    const early = buildRopReport({ ...base, leads: [], fakt: [], calls: null })
    const malika = early.groups.flatMap((g) => g.sellers).find((s) => s.employeeId === 'mal')!
    expect(malika.connectedCalls).toBeNull()
    expect(malika.talkSec).toBeNull()
    expect(early.total.connectedCalls).toBeNull()
  })

  it('orders the split\'s teams first and the no-team group last', () => {
    expect(report.groups.map((g) => g.rop)).toEqual(['Sevinch', 'Asliddin', null])
    expect(report.groups.at(-1)!.sellers[0]!.fullName).toBe('Hech kimga biriktirilmagan')
  })

  it('folds an old team name into today\'s, as «RNP jadvali» does', () => {
    const folded = buildRopReport({ ...base, leads: [{ rop: 'Sevinchxon', employeeId: 'z', leads: 1 }], fakt: [] })
    expect(folded.groups.map((g) => g.rop)).not.toContain('Sevinchxon')
  })

  it('leaves out a team with nobody on it', () => {
    const empty = buildRopReport({ ...base, roster: [], leads: [], fakt: [] })
    expect(empty.groups).toEqual([])
    expect(empty.total.conversionPercent).toBeNull()
  })

  it('credits calls once — on the roster row — when the seller is a row in two groups', () => {
    const twice = buildRopReport({
      ...base,
      leads: [{ rop: null, employeeId: 'sar', leads: 1 }],
      fakt: [fakt('sar', 'Sevinch', 2_000_000, 1)],
      calls: [{ employeeId: 'sar', connected: 5, talkSec: 300 }],
    })
    const rows = twice.groups.flatMap((g) => g.sellers.filter((s) => s.employeeId === 'sar').map((s) => ({ rop: g.rop, s })))
    expect(rows.map((r) => r.rop)).toEqual(['Sevinch', 'Asliddin', null])
    expect(rows.filter((r) => r.s.connectedCalls !== 0).map((r) => r.rop)).toEqual(['Asliddin'])
    expect(rows.find((r) => r.rop === 'Sevinch')!.s.onRoster).toBe(false)
    expect(twice.total.connectedCalls).toBe(5)
    // The plan follows each row's own leads: the no-team row's one lead.
    expect(twice.total.plan.amountMinor).toBe(som(500_000))
  })

  it('puts an off-roster seller\'s calls on the group where they earned the most', () => {
    const off = buildRopReport({
      ...base,
      leads: [{ rop: 'Sevinch', employeeId: 'x', leads: 4 }],
      fakt: [fakt('x', 'Asliddin', 1_000_000, 1)],
      calls: [{ employeeId: 'x', connected: 2, talkSec: 60 }],
    })
    const called = off.groups.flatMap((g) => g.sellers.filter((s) => s.employeeId === 'x' && s.connectedCalls !== 0).map(() => g.rop))
    expect(called).toEqual(['Asliddin'])
  })

  it('never puts calls on a row that is not drawn', () => {
    // An empty cohort row under Sevinch (queued, nothing delivered), a FAKT 2 order under Asliddin.
    const hidden = buildRopReport({
      ...base,
      leads: [],
      fakt: [fakt('x', 'Sevinch', 0, 0), fakt('x', 'Asliddin', 0, 0, 700_000, 1)],
      calls: [{ employeeId: 'x', connected: 6, talkSec: 400 }],
    })
    const rows = hidden.groups.flatMap((g) => g.sellers.filter((s) => s.employeeId === 'x').map((s) => ({ rop: g.rop, s })))
    expect(rows.map((r) => r.rop)).toEqual(['Asliddin'])
    expect(rows[0]!.s.connectedCalls).toBe(6)
    expect(hidden.total.connectedCalls).toBe(6)
  })
})
