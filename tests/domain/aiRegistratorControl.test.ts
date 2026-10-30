import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  AI_OWN_LINES,
  type ControlSettings,
  controlChanges,
  controlProblems,
  normaliseSellers,
  statusIsStale,
} from '@/server/domain/aiRegistrator/control'
import { isAiControlAccount } from '@/server/auth/aiControl'
import { changeLines } from '@/server/services/aiRegistratorControlService'

/**
 * «AI registrator → Boshqaruv» (2026-10-30): the rules the agent applies
 * (`ai_registrator/app/control.py` `check_config`), checked before a save.
 */

/** The owner's eighteen, 30.10 14:4x — «129 va 125 ni ulamaysan»; 139 and 143 not in it either. */
const OWNER_18 = ['122', '120', '128', '123', '131', '127', '111', '112', '108', '109', '107', '114', '115', '117', '134', '136', '135', '141']

const ok: ControlSettings = { sellers: OWNER_18, parked: [], maxCalls: 4, maxNew: 4, maxRetry: 0, saleHandoff: 'refer' }

describe('controlProblems', () => {
  it('passes the starting setting', () => {
    expect(controlProblems(ok)).toEqual([])
  })

  it('refuses an empty list, a malformed extension, a repeat and every AI line', () => {
    expect(controlProblems({ ...ok, sellers: [] })[0]).toMatch(/boʻsh/)
    expect(controlProblems({ ...ok, sellers: ['1'] }).join(' ')).toMatch(/2–6/)
    expect(controlProblems({ ...ok, sellers: ['12a'] }).join(' ')).toMatch(/2–6/)
    expect(controlProblems({ ...ok, sellers: ['1234567'] }).join(' ')).toMatch(/2–6/)
    expect(controlProblems({ ...ok, sellers: ['122', '122'] }).join(' ')).toMatch(/takrorlangan: 122/)
    for (const line of ['178', '290', '294', '297']) {
      expect(controlProblems({ ...ok, sellers: [...OWNER_18, line] }).join(' ')).toMatch(/AI liniyasi/)
    }
    expect(AI_OWN_LINES).toContain('294')
  })

  it('keeps calls 1–8 and new / retry within the calls', () => {
    expect(controlProblems({ ...ok, maxCalls: 0, maxNew: 0 }).length).toBeGreaterThan(0)
    expect(controlProblems({ ...ok, maxCalls: 9 }).length).toBeGreaterThan(0)
    expect(controlProblems({ ...ok, maxCalls: 8, maxNew: 8, maxRetry: 8 })).toEqual([])
    expect(controlProblems({ ...ok, maxCalls: 2, maxNew: 3 }).join(' ')).toMatch(/Yangi/)
    expect(controlProblems({ ...ok, maxRetry: 5 }).join(' ')).toMatch(/Nedozvon/)
    expect(controlProblems({ ...ok, saleHandoff: 'x' as 'refer' }).join(' ')).toMatch(/refer yoki bridge/)
  })

  it('refuses an extension both on and off', () => {
    expect(controlProblems({ ...ok, parked: ['122'] }).join(' ')).toMatch(/ham yoqiq, ham oʻchiq/)
    expect(controlProblems({ ...ok, parked: ['125', '129'] })).toEqual([])
  })

  it('normalises without reordering', () => {
    expect(normaliseSellers([' 122', '120', '122', ''])).toEqual(['122', '120'])
  })
})

describe('controlChanges — the audit', () => {
  it('names only what changed, and the seller delta in words', () => {
    const after: ControlSettings = { ...ok, sellers: [...OWNER_18.filter((s) => s !== '117'), '143'], maxCalls: 6 }
    const changes = controlChanges(ok, after)
    expect(changes.map((c) => c.field)).toEqual(['sellers', 'maxCalls'])
    expect(changeLines(changes)).toEqual(['Sotuvchilar (AIga): +143, −117', 'Bir vaqtda: 4 → 6'])
    expect(controlChanges(ok, ok)).toEqual([])
  })
})

describe('statusIsStale', () => {
  it('is stale after two minutes and with no report at all', () => {
    const now = new Date('2026-10-30T10:00:00Z')
    expect(statusIsStale(new Date('2026-10-30T09:58:30Z'), now)).toBe(false)
    expect(statusIsStale(new Date('2026-10-30T09:57:59Z'), now)).toBe(true)
    expect(statusIsStale(null, now)).toBe(true)
  })
})

describe('who runs it', () => {
  it('is the login adminjon or the founding administrator — nobody else', () => {
    expect(isAiControlAccount({ username: 'adminjon', email: 'x@sinolife.local' }, undefined)).toBe(true)
    expect(isAiControlAccount({ username: 'AdminJon', email: null }, undefined)).toBe(true)
    expect(isAiControlAccount({ username: null, email: 'Owner@Example.com' }, 'owner@example.com')).toBe(true)
    expect(isAiControlAccount({ username: 'umida', email: 'umida@sinolife.local' }, 'owner@example.com')).toBe(false)
    expect(isAiControlAccount({ username: null, email: '' }, '')).toBe(false)
    expect(isAiControlAccount({ username: 'admin', email: 'a@b.c' }, undefined)).toBe(false)
  })
})

describe('the starting row the migration writes', () => {
  const sql = readFileSync('prisma/migrations/20261030150000_ai_registrator_control/migration.sql', 'utf8')

  it('is the owner\'s eighteen — never 125, 129, 139 or 143, which the agent would ring within 20 s', () => {
    const array = /ARRAY\[([^\]]+)\]/.exec(sql)![1]!.split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(array).toEqual(OWNER_18)
    const after = JSON.parse(/'(\{"sellers".*?\})'::jsonb/.exec(sql)![1]!)
    expect(after.sellers).toEqual(OWNER_18)
    for (const never of ['125', '129', '139', '143']) {
      expect(array).not.toContain(never)
      expect(after.sellers).not.toContain(never)
    }
    expect(sql).toMatch(/4, 4, 0, 'refer'/)
    expect(controlProblems({ ...ok, sellers: array })).toEqual([])
  })

  it('only adds: no ALTER, DROP, UPDATE or DELETE', () => {
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE|TRUNCATE)\b/i)
  })
})
