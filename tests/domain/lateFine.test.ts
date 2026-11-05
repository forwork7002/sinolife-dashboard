import { describe, expect, it } from 'vitest'

import { fineableMinutes, isWorkday, lateFineMinor, lateSkipOf, netOfFine, shiftStartOf } from '@/server/domain/payroll/lateFine'
import { exactNameLinks, nameKey, nameSimilarity } from '@/server/domain/timepay/names'
import { daysToPull, dayRowOf, keptFrom } from '@/server/integrations/timepay/timepayImport'

/** The owner, 2026-11-05: «har bir kechikkan minutiga 1 somdan jarima». */

const day = (d: string, over: Partial<Parameters<typeof fineableMinutes>[0]> = {}) => ({
  day: d,
  checkIn: '08:45',
  lateMinutes: 15,
  holiday: false,
  onLeave: false,
  ...over,
})

describe('the lateness fine', () => {
  it('is 1 soʻm a minute, in minor units', () => {
    expect(lateFineMinor(15)).toBe(1_500n)
    expect(lateFineMinor(0)).toBe(0n)
  })

  it('takes TimePay minutes on a workday with an arrival mark', () => {
    // 2026-11-04 is a Wednesday.
    expect(fineableMinutes(day('2026-11-04'))).toBe(15)
  })

  it('fines nothing on a Sunday, a company holiday, TimePay holiday or leave', () => {
    expect(isWorkday('2026-11-01')).toBe(false) // Sunday
    expect(fineableMinutes(day('2026-11-01'))).toBe(0)
    expect(fineableMinutes(day('2026-10-01'))).toBe(0) // company holiday
    expect(fineableMinutes(day('2026-11-04', { holiday: true }))).toBe(0)
    expect(fineableMinutes(day('2026-11-04', { onLeave: true }))).toBe(0)
  })

  it('fines nothing without an arrival mark — a missing FaceID scan is not lateness', () => {
    expect(fineableMinutes(day('2026-11-04', { checkIn: null }))).toBe(0)
  })

  it('names why a late day is not fined, and reads the shift start back from TimePay’s figures', () => {
    expect(lateSkipOf(day('2026-11-04'))).toBeNull()
    expect(lateSkipOf(day('2026-11-01'))).toBe('sunday')
    expect(lateSkipOf(day('2026-10-01'))).toBe('holiday')
    expect(lateSkipOf(day('2026-11-04', { onLeave: true }))).toBe('leave')
    expect(lateSkipOf(day('2026-11-04', { checkIn: null }))).toBe('no_mark')
    expect(shiftStartOf('08:46', 16)).toBe('08:30')
    expect(shiftStartOf('10:05', 95)).toBe('08:30')
    expect(shiftStartOf('8:46', 16)).toBeNull()
  })

  it('never takes pay below zero', () => {
    expect(netOfFine(10_000n, 1_500n)).toBe(8_500n)
    expect(netOfFine(1_000n, 1_500n)).toBe(0n)
  })
})

describe('TimePay rows', () => {
  it('stores minutes only when TimePay says late', () => {
    expect(dayRowOf({ id: 1, stats: { first_check_in: '08:46:10', late: true, late_minutes: 16 } })).toEqual({
      checkIn: '08:46',
      lateMinutes: 16,
      holiday: false,
      onLeave: false,
    })
    expect(dayRowOf({ id: 1, stats: { first_check_in: '08:20', late: false, late_minutes: 5 } }).lateMinutes).toBe(0)
    expect(dayRowOf({ id: 1 }).checkIn).toBeNull()
  })

  it('asks for today, the recent days, then the missing ones from the previous month', () => {
    expect(keptFrom('2026-11-05')).toBe('2026-10-01')
    expect(keptFrom('2026-01-10')).toBe('2025-12-01')
    const stored = new Set<string>()
    for (let d = 1; d <= 31; d++) stored.add(`2026-10-${String(d).padStart(2, '0')}`)
    const { days, missing } = daysToPull('2026-11-05', stored, true)
    expect(days).toEqual(['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'])
    expect(missing).toBe(0)
    const cold = daysToPull('2026-11-05', new Set(), false)
    expect(cold.days[0]).toBe('2026-11-05')
    expect(cold.days[1]).toBe('2026-10-01')
    expect(cold.days).toHaveLength(13)
    expect(cold.missing).toBe(35 - 12)
  })
})

describe('linking TimePay people to employees by name', () => {
  it('reads the portal’s «Name Surname 115» and TimePay’s «Surname Name Patronymic» alike, in either script', () => {
    expect(nameKey('Davlatbek Sirojov 115')).toBe(nameKey('Сирожов Давлатбек Холмирзаевич'))
    expect(nameKey('Madina Shodiyeva (stajor) 177')).toBe(nameKey('Shodiyeva Madina'))
    expect(nameKey('118.')).toBe('')
    // «Ozoda» is a given name, not a «-zoda» patronymic.
    expect(nameKey('Mirzayeva Ozoda')).toBe(nameKey('Ozoda Mirzayeva 114'))
    expect(nameKey('Mirzayeva Ozoda')).not.toBe('')
  })

  it('links only a name that is unique on both sides', () => {
    const links = exactNameLinks(
      [
        { timepayId: 1, fullName: 'Sirojov Davlatbek' },
        { timepayId: 2, fullName: 'Hamroyeva Madina' },
        { timepayId: 3, fullName: 'Hamroyeva Madina Akmalovna' },
        { timepayId: 4, fullName: 'Ergashev Elbek' },
      ],
      [
        { id: 'e1', fullName: 'Davlatbek Sirojov 115' },
        { id: 'e2', fullName: 'Madina Hamroyeva 129' },
        { id: 'e4', fullName: 'Elbek Ergashev 101' },
        { id: 'e5', fullName: 'Elbek Ergashev 201' },
      ],
    )
    expect([...links]).toEqual([[1, 'e1']])
  })

  it('suggests near spellings without linking them', () => {
    expect(nameSimilarity('Djanqulova Nilufar', 'Nilufar Djanukolava 140')).toBeGreaterThan(0.75)
    expect(nameSimilarity('Sirojov Davlatbek', 'Elbek Ergashev')).toBeLessThan(0.5)
  })
})
