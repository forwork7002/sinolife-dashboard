import { describe, expect, it } from 'vitest'

import type { BezkvalClientDto } from '@/server/domain/registration/bezkval'
import {
  BEZKVAL_DAYS_PER_PASS,
  BEZKVAL_LIVE_MS,
  BEZKVAL_WEEK_MS,
  type BezkvalStore,
  bezkvalDaysDue,
  refreshBezkval,
} from '@/server/integrations/crm/sync/bezkvalRefresh'

/**
 * «Безквал» is counted by the worker and stored (2026-10-24): today and
 * yesterday every ten minutes, the week before every three hours, every older
 * day once — the spec's own schedule, and no month computed on a request.
 */

const NOW = new Date('2026-10-24T05:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('bezkvalDaysDue', () => {
  it('a first run: today first, then back day by day, a few a pass', () => {
    expect(bezkvalDaysDue({ today: '2026-10-24', computed: new Map(), now: NOW })).toEqual([
      '2026-10-24',
      '2026-10-23',
      '2026-10-22',
      '2026-10-21',
      '2026-10-20',
      '2026-10-19',
    ])
    expect(bezkvalDaysDue({ today: '2026-10-24', computed: new Map(), now: NOW, limit: 100 }).at(-1)).toBe('2026-09-01')
  })

  it('today and yesterday again after ten minutes, the week after three hours, an older day never again', () => {
    const computed = new Map<string, Date>()
    for (let d = 1; d <= 24; d++) computed.set(`2026-10-${String(d).padStart(2, '0')}`, ago(BEZKVAL_LIVE_MS - 1))
    for (let d = 1; d <= 30; d++) computed.set(`2026-09-${String(d).padStart(2, '0')}`, ago(30 * BEZKVAL_WEEK_MS))
    expect(bezkvalDaysDue({ today: '2026-10-24', computed, now: NOW })).toEqual([])

    computed.set('2026-10-24', ago(BEZKVAL_LIVE_MS))
    computed.set('2026-10-23', ago(BEZKVAL_LIVE_MS + 1))
    computed.set('2026-10-20', ago(BEZKVAL_WEEK_MS))
    computed.set('2026-10-16', ago(BEZKVAL_WEEK_MS)) // eight days back — the last of the week
    computed.set('2026-10-15', ago(BEZKVAL_WEEK_MS)) // nine: counted, so never again
    computed.delete('2026-09-12')
    expect(bezkvalDaysDue({ today: '2026-10-24', computed, now: NOW })).toEqual(['2026-10-24', '2026-10-23', '2026-10-20', '2026-10-16', '2026-09-12'])
  })

  it('never reaches before the first day', () => {
    expect(bezkvalDaysDue({ today: '2026-09-02', computed: new Map(), now: NOW, limit: 100 })).toEqual(['2026-09-02', '2026-09-01'])
  })
})

describe('refreshBezkval', () => {
  const client = (rop: string | null): BezkvalClientDto => ({
    phone: '+998 90 ***-45-67',
    kind: 'phone',
    rop,
    source: 'Ген лид',
    hour: 10,
    new30: true,
    newEver: true,
    multiRop: false,
    previous: null,
    deals: [{ id: '1', pipeline: 'Регистрация', stage: 'Лид новый', source: 'Ген лид', rop, at: NOW.toISOString(), leadGuard: false, born: 0 }],
  })

  it('counts the due days, stores each with the instant its count started, and stops when the worker stops', async () => {
    const stored: string[] = []
    let clock = NOW.getTime()
    let stop = false
    const store: BezkvalStore = {
      bezkvalComputedDays: async () => new Map(),
      computeBezkvalDay: async (day) => {
        clock += 2_000
        return [{ key: `p:${day}`, client: client('Sevinch') }]
      },
      storeBezkvalDay: async (day, rows, at) => {
        stored.push(`${day}:${rows.length}:${at.toISOString()}`)
        if (stored.length === 2) stop = true
      },
    }
    const r = await refreshBezkval({ store, today: '2026-10-24', timeZone: 'Asia/Tashkent', now: () => new Date(clock), stopping: () => stop })
    expect(stored).toEqual(['2026-10-24:1:2026-10-24T05:00:00.000Z', '2026-10-23:1:2026-10-24T05:00:02.000Z'])
    expect(r.days.map((d) => [d.day, d.clients, d.ms])).toEqual([
      ['2026-10-24', 1, 2_000],
      ['2026-10-23', 1, 2_000],
    ])
    expect(BEZKVAL_DAYS_PER_PASS).toBeGreaterThan(2)
  })
})
