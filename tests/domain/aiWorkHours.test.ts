import { describe, expect, it } from 'vitest'

import { DEFAULT_WORK_HOURS, clockMinutes, hoursText, sameHours, workHoursProblems } from '@/lib/aiWorkHours'
import { type ControlSettings, controlChanges, controlProblems } from '@/server/domain/aiRegistrator/control'

/**
 * «Ish vaqti» (2026-11-04): the agent's own rules (`ai_registrator/app/hours.py`
 * `check_hours`, d0abf97) — it refuses the WHOLE config over hours that break
 * one, so neither the page nor the server lets such hours be saved.
 */

const day = { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30' }

describe('workHoursProblems — the agent\'s rules', () => {
  it('passes the starting day, a day without a lunch, and a lunch on the day\'s edges', () => {
    expect(DEFAULT_WORK_HOURS).toEqual(day)
    expect(workHoursProblems(day)).toEqual([])
    expect(workHoursProblems({ ...day, lunchStart: null, lunchEnd: null })).toEqual([])
    expect(workHoursProblems({ start: '00:00', end: '23:59', lunchStart: '00:00', lunchEnd: '23:59' })).toEqual([])
  })

  it('takes «HH:MM» only, 00:00–23:59', () => {
    for (const bad of ['9:00', '24:00', '09:60', '0900', '09:00:00', '', ' 09:00x']) {
      expect(workHoursProblems({ ...day, start: bad }).join(' '), bad).toMatch(/Ish boshlanishi SS:DD/)
    }
    expect(workHoursProblems({ ...day, end: '25:00' }).join(' ')).toMatch(/Ish tugashi SS:DD/)
    expect(clockMinutes('23:59')).toBe(23 * 60 + 59)
    expect(clockMinutes('7:05')).toBeNull()
  })

  it('keeps the day inside one day — start before end, never across midnight', () => {
    expect(workHoursProblems({ ...day, start: '22:00', end: '22:00' }).join(' ')).toMatch(/bitta kun ichida/)
    expect(workHoursProblems({ start: '22:00', end: '06:00', lunchStart: null, lunchEnd: null }).join(' ')).toMatch(/tun oʻtmaydi/)
  })

  it('wants the lunch whole or not at all, after its start, inside the day', () => {
    expect(workHoursProblems({ ...day, lunchEnd: null }).join(' ')).toMatch(/Tushliksiz/)
    expect(workHoursProblems({ ...day, lunchStart: null }).join(' ')).toMatch(/Tushliksiz/)
    expect(workHoursProblems({ ...day, lunchStart: '13:30', lunchEnd: '13:30' })).toEqual(['Tushlik tugashi boshlanishidan keyin boʻlsin.'])
    expect(workHoursProblems({ ...day, lunchStart: '08:30' })).toEqual(['Tushlik ish vaqti ichida boʻlsin (09:00–22:00).'])
    expect(workHoursProblems({ ...day, lunchStart: '21:30', lunchEnd: '22:30' })).toEqual(['Tushlik ish vaqti ichida boʻlsin (09:00–22:00).'])
    expect(workHoursProblems({ ...day, lunchStart: '1230', lunchEnd: '13:30' }).join(' ')).toMatch(/Tushlik boshlanishi SS:DD/)
  })

  it('says the hours as the owner reads them', () => {
    expect(hoursText(day)).toBe('09:00–22:00, tushlik 12:30–13:30')
    expect(hoursText({ ...day, lunchStart: null, lunchEnd: null })).toBe('09:00–22:00, tushliksiz')
    expect(sameHours(day, { ...day })).toBe(true)
    expect(sameHours(day, { ...day, end: '21:00' })).toBe(false)
    expect(sameHours(null, null)).toBe(true)
    expect(sameHours(day, null)).toBe(false)
  })
})

describe('the hours in a save', () => {
  const ok: ControlSettings = { sellers: ['122', '120'], parked: [], maxCalls: 4, maxNew: 4, maxRetry: 0, saleHandoff: 'refer', enabled: true, hours: null, pauseUntil: null, linesOff: [], tuning: null }

  it('refuses a whole setting whose hours break a rule, as the agent would', () => {
    expect(controlProblems({ ...ok, hours: day })).toEqual([])
    expect(controlProblems({ ...ok, hours: { ...day, end: '08:00' } }).join(' ')).toMatch(/bitta kun ichida/)
  })

  it('records the hours as one change, only when they changed', () => {
    expect(controlChanges({ ...ok, hours: day }, { ...ok, hours: day })).toEqual([])
    expect(controlChanges(ok, { ...ok, hours: day })).toEqual([{ field: 'hours', before: null, after: day }])
    // A row stored before the hours existed reads as «not set».
    const { hours: _h, ...older } = ok
    expect(controlChanges(older as ControlSettings, ok)).toEqual([])
    // The first save ever: the hours only when set.
    expect(controlChanges(null, ok).map((c) => c.field)).not.toContain('hours')
    expect(controlChanges(null, { ...ok, hours: day }).map((c) => c.field)).toContain('hours')
  })
})

describe('the hours columns (migration 20261104190000)', () => {
  it('adds four nullable columns and nothing else — the row there is reads as «not set», the agent keeps its own hours', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('prisma/migrations/20261104190000_ai_registrator_hours/migration.sql', 'utf8')
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join(' ')
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s !== '')
    expect(statements).toEqual([
      'ALTER TABLE "ai_registrator_config" ADD COLUMN "hoursStart" TEXT, ADD COLUMN "hoursEnd" TEXT, ADD COLUMN "lunchStart" TEXT, ADD COLUMN "lunchEnd" TEXT',
    ])
  })
})
