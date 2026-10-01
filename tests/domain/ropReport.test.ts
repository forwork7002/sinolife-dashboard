import { describe, expect, it } from 'vitest'

import { buildRopReport, type RosterMember, type SellerFaktRow } from '@/server/domain/registration/ropReport'

/*
  «ROP otchet» — the client's group sheet for 31.07.2026 («ASLIDDIN GRUPPA»),
  with «Лид руч» gone: conversion is Транз-1 ÷ Лид сони, deviation Факт-1 − План.
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
  canEdit: false,
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
    plans: [{ employeeId: 'sar', amountMinor: 5_000_000n * 100n }],
  })
  const asliddin = report.groups.find((g) => g.rop === 'Asliddin')!

  it('computes the sheet\'s conversion and deviation per seller', () => {
    const sardor = asliddin.sellers.find((s) => s.employeeId === 'sar')!
    expect(sardor.conversionPercent).toBeCloseTo((2 / 7) * 100)
    expect(sardor.deviation?.amountMinor).toBe(String(-200_000n * 100n))
    const head = asliddin.sellers.find((s) => s.employeeId === 'asl')!
    expect(head.conversionPercent).toBe(100)
    expect(head.plan).toBeNull()
    expect(head.deviation).toBeNull()
  })

  it('keeps a quiet roster member at zero, and conversion with no lead is null', () => {
    const malika = asliddin.sellers.find((s) => s.employeeId === 'mal')!
    expect(malika.leads).toBe(0)
    expect(malika.conversionPercent).toBeNull()
    const x = asliddin.sellers.find((s) => s.employeeId === 'x')!
    expect(x.onRoster).toBe(false)
    expect(x.fullName).toBe('Begona Sotuvchi')
    expect(x.conversionPercent).toBeNull()
  })

  it('puts the ROP first, then by FAKT 1', () => {
    expect(asliddin.sellers.map((s) => s.employeeId)).toEqual(['asl', 'sar', 'x', 'mal'])
  })

  it('sums the group and the company, the plan only where one is typed', () => {
    expect(asliddin.total.leads).toBe(9)
    expect(asliddin.total.fakt1Orders).toBe(5)
    expect(asliddin.total.fakt1.amountMinor).toBe(String(9_850_000n * 100n))
    expect(asliddin.total.plan?.amountMinor).toBe(String(5_000_000n * 100n))
    expect(asliddin.total.deviation?.amountMinor).toBe(String(4_850_000n * 100n))
    expect(asliddin.total.fakt2Orders).toBe(2)
    expect(report.total.leads).toBe(12)
    expect(report.total.fakt1.amountMinor).toBe(asliddin.total.fakt1.amountMinor)
  })

  it('orders the split\'s teams first and the no-team group last', () => {
    expect(report.groups.map((g) => g.rop)).toEqual(['Sevinch', 'Asliddin', null])
    expect(report.groups.at(-1)!.sellers[0]!.fullName).toBe('Hech kimga biriktirilmagan')
  })

  it('folds an old team name into today\'s, as «RNP jadvali» does', () => {
    const folded = buildRopReport({ ...base, leads: [{ rop: 'Sevinchxon', employeeId: 'z', leads: 1 }], fakt: [], plans: [] })
    expect(folded.groups.map((g) => g.rop)).not.toContain('Sevinchxon')
  })

  it('leaves out a team with nobody on it', () => {
    const empty = buildRopReport({ ...base, roster: [], leads: [], fakt: [], plans: [] })
    expect(empty.groups).toEqual([])
    expect(empty.total.conversionPercent).toBeNull()
    expect(empty.month).toBe('2026-07')
  })

  it('credits a plan once — on the roster row — when the seller is a row in two groups', () => {
    const twice = buildRopReport({
      ...base,
      leads: [{ rop: null, employeeId: 'sar', leads: 1 }],
      fakt: [fakt('sar', 'Sevinch', 2_000_000, 1)],
      plans: [{ employeeId: 'sar', amountMinor: 5_000_000n * 100n }],
    })
    const rows = twice.groups.flatMap((g) => g.sellers.filter((s) => s.employeeId === 'sar').map((s) => ({ rop: g.rop, s })))
    expect(rows.map((r) => r.rop)).toEqual(['Sevinch', 'Asliddin', null])
    expect(rows.filter((r) => r.s.plan !== null).map((r) => r.rop)).toEqual(['Asliddin'])
    expect(rows.find((r) => r.rop === 'Sevinch')!.s.onRoster).toBe(false)
    expect(twice.total.plan?.amountMinor).toBe(String(5_000_000n * 100n))
  })

  it('puts an off-roster seller\'s plan on the group where they earned the most', () => {
    const off = buildRopReport({
      ...base,
      leads: [{ rop: 'Sevinch', employeeId: 'x', leads: 4 }],
      fakt: [fakt('x', 'Asliddin', 1_000_000, 1)],
      plans: [{ employeeId: 'x', amountMinor: 100n }],
    })
    const planned = off.groups.flatMap((g) => g.sellers.filter((s) => s.employeeId === 'x' && s.plan !== null).map(() => g.rop))
    expect(planned).toEqual(['Asliddin'])
  })
})
