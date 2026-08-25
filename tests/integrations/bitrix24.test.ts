import { describe, expect, it } from 'vitest'

import {
  Bitrix24CrmProvider,
  encodeParams,
  isoLocal,
  nonEmpty,
  nestedIn,
  startOfUtcDay,
} from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import {
  dealStatus,
  categoryFromSemantic,
  logisticsRole,
  pipelineRole,
  toMinorUnits,
} from '@/server/integrations/crm/bitrix24/mapping'

/**
 * Regressions for the things that were actually wrong.
 *
 * Every case here corresponds to a defect found against the live portal, not
 * to a hypothetical. They are cheap to keep and each one cost real time to
 * diagnose the first time.
 */

describe('encodeParams', () => {
  /**
   * The bug: `FILTER[>=CALL_START_DATE]=...` splits on its FIRST `=`, so the
   * portal received the key `FILTER[>` and silently dropped the filter —
   * answering with the whole table instead of the requested day. Nothing
   * errored; a day-windowed read simply returned last year's calls, and 20 750
   * fetched rows held 12 800 distinct ones.
   */
  it('encodes comparison operators inside filter keys', () => {
    const query = encodeParams({ FILTER: { '>=CALL_START_DATE': '2026-08-20T00:00:00+00:00' } })

    expect(query).not.toContain('[>=')
    expect(query).toContain('FILTER[%3E%3DCALL_START_DATE]')
  })

  it('serialises arrays and nested objects the way the portal expects', () => {
    expect(encodeParams({ filter: { CATEGORY_ID: [6, 14] } })).toBe(
      'filter[CATEGORY_ID][0]=6&filter[CATEGORY_ID][1]=14',
    )
  })

  it('drops null and undefined rather than sending them as text', () => {
    expect(encodeParams({ a: 1, b: null, c: undefined })).toBe('a=1')
  })
})

describe('response shapes', () => {
  /**
   * The bug: `catalog.store.list` nests under `result.stores` while every
   * `crm.*` method returns a bare array. Spreading the object threw
   * "Spread syntax requires ...iterable", which reads like a code fault rather
   * than a response-shape difference.
   */
  it('unwraps rows nested under a named key', () => {
    expect(nestedIn('stores')({ stores: [{ id: 1 }] })).toEqual([{ id: 1 }])
    expect(nestedIn('items')({ items: [{ ID: 5 }] })).toEqual([{ ID: 5 }])
  })

  it('still accepts a bare array, so one helper covers both conventions', () => {
    expect(nestedIn('stores')([{ id: 1 }])).toEqual([{ id: 1 }])
  })

  it('returns an empty array for anything else rather than throwing', () => {
    expect(nestedIn('stores')(undefined)).toEqual([])
    expect(nestedIn('stores')({ nothing: true })).toEqual([])
  })
})

describe('nonEmpty', () => {
  /**
   * The bug: `('' && map.get('')) ?? null` evaluates to the EMPTY STRING —
   * falsy but not nullish — which reached a foreign key column and failed the
   * constraint, taking the whole 2 500-row insert with it.
   */
  it('treats blank as absent', () => {
    expect(nonEmpty('')).toBeUndefined()
    expect(nonEmpty('   ')).toBeUndefined()
    expect(nonEmpty(null)).toBeUndefined()
    expect(nonEmpty(undefined)).toBeUndefined()
  })

  it('keeps a real id, including "0"', () => {
    expect(nonEmpty('0')).toBe('0')
    expect(nonEmpty(6992)).toBe('6992')
  })
})

describe('deal status', () => {
  it('uses the portal classification when it has one', () => {
    expect(dealStatus('S', 'C6:WON')).toBe('WON')
    expect(dealStatus('F', 'C6:LOSE')).toBe('LOST')
    expect(dealStatus('P', 'C6:UC_4UD7I9')).toBe('OPEN')
  })

  /**
   * `Отказ предварительно` carries semantic P, so the portal reports it as
   * still in progress. Of the 359 deals that ever entered it, 331 are still
   * there and 21 were delivered — a 6% revival rate. Left OPEN it is excluded
   * from the conversion denominator, and the dashboard reported a 100%
   * conversion rate for a month with 803 wins and 328 cancellations.
   */
  it('treats a pre-dispatch cancellation as lost', () => {
    expect(dealStatus('P', 'C6:UC_3U7025')).toBe('LOST')
    expect(categoryFromSemantic(undefined, false, 'C6:UC_3U7025')).toBe('LOST')
  })

  it('leaves the chase queue open — those are still being worked', () => {
    expect(dealStatus('P', 'C6:UC_AL40O1')).toBe('OPEN')
    expect(dealStatus('P', 'C6:UC_06YLAO')).toBe('OPEN')
  })
})

describe('pipeline and stage classification', () => {
  it('counts only the two sales pipelines as revenue', () => {
    expect(pipelineRole(6)).toBe('REVENUE')
    expect(pipelineRole(14)).toBe('REVENUE')
    expect(pipelineRole(10)).toBe('RETENTION')
    expect(pipelineRole(0)).toBe('LEAD')
  })

  /**
   * A pipeline someone creates next month must not start counting as revenue
   * on its own.
   */
  it('defaults an unknown pipeline to IGNORED', () => {
    expect(pipelineRole(99)).toBe('IGNORED')
  })

  it('separates a refusal in transit from a cancellation before dispatch', () => {
    expect(logisticsRole('C6:LOSE')).toBe('REFUSED')
    expect(logisticsRole('C6:UC_3U7025')).toBe('CANCELLED_EARLY')
  })

  it('classifies the terminal stages from the id when semantics are absent', () => {
    // The portal returns SEMANTICS only for WON and LOSE; everything else is
    // null, which once put "Доставлено" and "Отказ" both in IN_PROGRESS.
    expect(categoryFromSemantic(undefined, false, 'C6:WON')).toBe('WON')
    expect(categoryFromSemantic(undefined, false, 'C14:APOLOGY')).toBe('LOST')
  })
})

describe('money parsing', () => {
  it('parses the portal decimal string without touching a float', () => {
    expect(toMinorUnits('1600000.00000000')).toBe(160000000n)
    expect(toMinorUnits('0.10')).toBe(10n)
    expect(toMinorUnits('')).toBe(0n)
    expect(toMinorUnits(null)).toBe(0n)
  })

  it('rounds at the minor unit rather than truncating', () => {
    expect(toMinorUnits('1.005')).toBe(101n)
    expect(toMinorUnits('1.004')).toBe(100n)
  })
})

describe('time helpers', () => {
  it('spells out the offset so the portal cannot reinterpret it', () => {
    expect(isoLocal(new Date('2026-08-20T00:00:00.000Z'))).toBe('2026-08-20T00:00:00+00:00')
  })

  it('floors to midnight UTC', () => {
    expect(startOfUtcDay(new Date('2026-08-20T18:42:11.000Z')).toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    )
  })
})

describe('provider construction', () => {
  it('refuses a webhook URL that is not https', () => {
    // The URL carries an access token in its path.
    expect(() => new Bitrix24CrmProvider({ webhookUrl: 'http://portal/rest/1/tok/' })).toThrow(
      /https/,
    )
  })

  it('reports warehouse data as unavailable until the scope is confirmed', () => {
    const provider = new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/' })

    // Not false-because-empty: the API distinguishes "no stock" from "we have
    // not been granted permission to know".
    expect(provider.capabilities.STORES).toBe(false)
    expect(provider.capabilities.PAYMENTS).toBe(false)
    expect(provider.capabilities.DEALS).toBe(true)
  })
})
