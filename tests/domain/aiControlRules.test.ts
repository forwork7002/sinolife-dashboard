import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TUNING,
  linesOffProblems,
  normalLinesOff,
  pauseProblems,
  secondsText,
  tashkentIso,
  tuningDiff,
  tuningProblems,
  tuningValueText,
  linePasswordProblem,
} from '@/lib/aiControlRules'
import { daysText, normalDays, sameHours, workHoursProblems, worksOn } from '@/lib/aiWorkHours'
import { type ControlSettings, controlChanges, controlProblems } from '@/server/domain/aiRegistrator/control'

/**
 * «AI registrator → Boshqaruv», the rest of the panel (2026-11-04, T144): the
 * agent's own rules (ai_registrator 2bc906f, `app/control.py` `check_pause`,
 * `check_lines_off`, `check_tuning`, `check_hours` days) — it refuses the
 * WHOLE config over one, so neither the page nor the server saves one that
 * breaks it.
 */

const now = new Date('2026-11-04T15:00:00Z') // 20:00 Tashkent, Wednesday

describe('pauseProblems — the agent\'s check_pause', () => {
  it('passes a pause ahead of now and at most seven days away', () => {
    expect(pauseProblems('2026-11-04T21:30:00+05:00', now)).toEqual([])
    expect(pauseProblems('2026-11-11T20:00:00+05:00', now)).toEqual([])
  })

  it('refuses a time gone by, one past seven days, and no time at all', () => {
    expect(pauseProblems('2026-11-04T19:00:00+05:00', now)[0]).toMatch(/oʻtib ketgan/)
    expect(pauseProblems('2026-11-11T20:01:00+05:00', now)[0]).toMatch(/7 kundan uzoq/)
    expect(pauseProblems('kecha', now)[0]).toMatch(/notoʻgʻri/)
  })

  it('writes an instant as Tashkent with the offset spelt out — the agent refuses one without a zone', () => {
    expect(tashkentIso(new Date('2026-11-04T16:30:00Z'))).toBe('2026-11-04T21:30:00+05:00')
    expect(tashkentIso(new Date('2026-11-04T20:00:00Z'))).toBe('2026-11-05T01:00:00+05:00')
  })
})

describe('linesOff — the agent\'s check_lines_off', () => {
  const lines = [
    { ext: '178', pool: 'main' },
    { ext: '290', pool: 'main' },
    { ext: '296', pool: 'zextra' },
  ]

  it('keeps only our lines, once each, by number', () => {
    expect(normalLinesOff(['290', '999', '178', '290', ' 296 '], lines)).toEqual(['178', '290', '296'])
  })

  it('refuses every main line off — a Zextra line alone does not keep Collagen going', () => {
    expect(linesOffProblems(['178'], lines)).toEqual([])
    expect(linesOffProblems(['178', '290'], lines)[0]).toMatch(/asosiy \(Collagen\)/)
    expect(linesOffProblems(['296'], lines)).toEqual([])
  })
})

describe('tuning — the agent\'s check_tuning', () => {
  it('passes the server\'s .env of 2026-11-04', () => {
    expect(tuningProblems(DEFAULT_TUNING)).toEqual([])
  })

  it('names every number out of bounds and every unknown word — all problems in one message', () => {
    const bad = { ...DEFAULT_TUNING, attemptsPerDay: 11, retryDays: 0, ringSec: 9.5, missedSec: 1801, firstCallDelaySec: -1 }
    expect(tuningProblems(bad)).toEqual([
      'Nedozvonga kuniga: 1–10 oraligʻida butun son boʻlsin.',
      'Nedozvon kunlari: 1–5 oraligʻida butun son boʻlsin.',
      'Sotuvchini jiringlatish: 10–40 oraligʻida butun son boʻlsin.',
      'Koʻtarmagan sotuvchi navbat oxirida: 0–1800 oraligʻida butun son boʻlsin.',
      'Yangi lidga birinchi qoʻngʻiroq: 0–600 oraligʻida butun son boʻlsin.',
    ])
    expect(tuningProblems({ ...DEFAULT_TUNING, transferOrder: 'first' as never, whyUs: 'all' as never })).toEqual([
      'Ulash tartibi: random yoki fewest boʻlsin.',
      'Ikki sabab (WHY_US): off, test yoki on boʻlsin.',
    ])
  })

  it('says what changed, in the owner\'s words', () => {
    expect(tuningDiff(DEFAULT_TUNING, { ...DEFAULT_TUNING, ringSec: 20, whyUs: 'test' })).toEqual(['ringSec', 'whyUs'])
    expect(tuningDiff(null, DEFAULT_TUNING)).toHaveLength(7)
    expect(secondsText(600)).toBe('10 daq')
    expect(secondsText(90)).toBe('1 daq 30 s')
    expect(secondsText(45)).toBe('45 s')
    expect(secondsText(0)).toBe('0')
    expect(tuningValueText('attemptsPerDay', 5)).toBe('5 marta')
    expect(tuningValueText('transferOrder', 'fewest')).toBe('bugun eng kam olgan birinchi')
    expect(tuningValueText('whyUs', 'test')).toBe('faqat sinov qoʻngʻiroqlarida')
  })
})

describe('the working days — `hours.days`', () => {
  const day = { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30' }

  it('passes every day (no list) and any non-empty set of ISO weekdays', () => {
    expect(workHoursProblems(day)).toEqual([])
    expect(workHoursProblems({ ...day, days: [1, 2, 3, 4, 5] })).toEqual([])
  })

  it('refuses no day at all and a weekday out of 1–7', () => {
    expect(workHoursProblems({ ...day, days: [] })[0]).toMatch(/Kamida bitta ish kuni/)
    expect(workHoursProblems({ ...day, days: [0, 8] })[0]).toMatch(/1 \(dushanba\) dan 7 \(yakshanba\)/)
  })

  it('reads all seven as every day, and says the days as the owner reads them', () => {
    expect(normalDays([7, 6, 5, 4, 3, 2, 1])).toBeNull()
    expect(normalDays([5, 1, 3, 1])).toEqual([1, 3, 5])
    expect(daysText(null)).toBe('har kuni')
    expect(daysText([1, 2, 3, 4, 5])).toBe('Du–Ju')
    expect(daysText([1, 3, 5])).toBe('Du, Ch, Ju')
    expect(worksOn(6, { days: [1, 2, 3, 4, 5] })).toBe(false)
    expect(worksOn(6, { days: null })).toBe(true)
    expect(sameHours({ ...day, days: null }, { ...day, days: [1, 2, 3, 4, 5, 6, 7] })).toBe(true)
    expect(sameHours({ ...day, days: [1, 2] }, { ...day, days: [1, 2, 3] })).toBe(false)
  })
})

describe('the new fields in a save and its audit', () => {
  const ok: ControlSettings = {
    sellers: ['122', '120'],
    parked: [],
    maxCalls: 4,
    maxNew: 4,
    maxRetry: 0,
    saleHandoff: 'refer',
    enabled: true,
    hours: null,
    pauseUntil: null,
    linesOff: [],
    tuning: null,
  }

  it('refuses a whole setting whose tuning breaks a rule, as the agent would', () => {
    expect(controlProblems({ ...ok, tuning: DEFAULT_TUNING })).toEqual([])
    expect(controlProblems({ ...ok, tuning: { ...DEFAULT_TUNING, retryDays: 9 } }).join(' ')).toMatch(/Nedozvon kunlari/)
  })

  it('records each as its own change, only when it changed — an older row reads as none set', () => {
    expect(controlChanges(ok, { ...ok })).toEqual([])
    expect(controlChanges(ok, { ...ok, pauseUntil: '2026-11-04T16:30:00.000Z' })).toEqual([
      { field: 'pauseUntil', before: null, after: '2026-11-04T16:30:00.000Z' },
    ])
    expect(controlChanges(ok, { ...ok, linesOff: ['291'] })).toEqual([{ field: 'linesOff', before: [], after: ['291'] }])
    expect(controlChanges(ok, { ...ok, tuning: DEFAULT_TUNING })).toEqual([{ field: 'tuning', before: null, after: DEFAULT_TUNING }])
    expect(controlChanges({ ...ok, tuning: DEFAULT_TUNING }, { ...ok, tuning: { ...DEFAULT_TUNING } })).toEqual([])
    const { pauseUntil: _p, linesOff: _l, tuning: _t, ...older } = ok
    expect(controlChanges(older as ControlSettings, ok)).toEqual([])
    expect(controlChanges(null, ok).map((c) => c.field)).toEqual(expect.not.arrayContaining(['pauseUntil', 'linesOff', 'tuning']))
  })
})

describe('the columns and the press table (migration 20261104210000)', () => {
  it('adds columns and one new table only — nothing existing is changed or dropped', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('prisma/migrations/20261104210000_ai_registrator_control_more/migration.sql', 'utf8')
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join(' ')
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s !== '')
    expect(statements).toHaveLength(3)
    expect(statements[0]).toBe(
      'ALTER TABLE "ai_registrator_config" ADD COLUMN "linesOff" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "pauseUntil" TIMESTAMP(3), ADD COLUMN "tuning" JSONB, ADD COLUMN "workDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[]',
    )
    expect(statements[1]).toMatch(/^CREATE TABLE "ai_registrator_action"/)
    expect(statements[2]).toBe('CREATE INDEX "ai_registrator_action_requestedAt_idx" ON "ai_registrator_action"("requestedAt")')
    expect(sql).not.toMatch(/\b(DROP|RENAME|ALTER COLUMN|TRUNCATE|DELETE|UPDATE)\b/i)
  })
})

describe('the sealed password column (migration 20261106160000, T123)', () => {
  it('adds two columns only — nothing existing is changed or dropped', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('prisma/migrations/20261106160000_ai_registrator_action_line_add/migration.sql', 'utf8')
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join(' ')
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s !== '')
    expect(statements).toEqual(['ALTER TABLE "ai_registrator_action" ADD COLUMN "params" JSONB, ADD COLUMN "secret" TEXT'])
  })
})

describe('linePasswordProblem — what the agent takes as a SIP password (T123)', () => {
  it('takes printable ASCII up to 64, refuses a space, a non-Latin letter and « ; [ ] \\ »', () => {
    expect(linePasswordProblem('Ab3!x_-9')).toBeNull()
    expect(linePasswordProblem('')).toMatch(/kiriting/)
    expect(linePasswordProblem('a'.repeat(65))).toMatch(/64/)
    expect(linePasswordProblem('ab cd')).toMatch(/boʻsh joy/)
    expect(linePasswordProblem('parolь')).toMatch(/lotin/)
    for (const bad of ['a;b', 'a[b', 'a]b', 'a\\b']) expect(linePasswordProblem(bad)).toMatch(/AI serveri uni qabul qilmaydi/)
  })
})
