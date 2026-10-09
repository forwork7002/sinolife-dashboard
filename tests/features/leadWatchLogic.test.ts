import { describe, expect, it } from 'vitest'

import type { LeadWatchIssueDto, LeadWatchRowDto, WatchIssueKind, WatchSeverity } from '@/features/leads/leadWatchApi'
import {
  ROWS_PER_PAGE,
  WATCH_KINDS,
  channelChips,
  filterRows,
  formatAgo,
  formatWait,
  freshnessOf,
  hourRange,
  isOpenable,
  issueSubline,
  minutesSince,
  nextPageSize,
  orderIssues,
  toneOf,
  verdictOf,
  waitThresholds,
  waitTone,
  watchTitle,
} from '@/features/leads/leadWatchLogic'
import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'

/**
 * «Лид назорати» — the rules the block decides without drawing. Every number
 * a threshold depends on is read from `leadWatchSettings.ts`, as the block
 * reads it, so editing the settings file moves these with it.
 */

const NOW = Date.parse('2026-10-09T10:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function row(key: string, over: Partial<LeadWatchRowDto> = {}): LeadWatchRowDto {
  return {
    key,
    dealId: key,
    title: `Mijoz ${key}`,
    channel: 'generated',
    brand: null,
    owner: null,
    rop: null,
    since: ago(5),
    note: null,
    ...over,
  }
}

function issue(kind: WatchIssueKind, severity: WatchSeverity, over: Partial<LeadWatchIssueDto> = {}): LeadWatchIssueDto {
  return {
    kind,
    count: over.rows?.length ?? 0,
    severity,
    oldestSince: null,
    summary: null,
    byChannel: { generated: 0, smm: 0, inbound: 0, telegram: 0, other: 0 },
    rows: [],
    ...over,
  }
}

describe('a waiting time', () => {
  it('reads in minutes under an hour, then hours and minutes, then days', () => {
    expect(formatWait(0)).toBe('< 1 daq')
    expect(formatWait(1)).toBe('1 daq')
    expect(formatWait(47)).toBe('47 daq')
    expect(formatWait(59)).toBe('59 daq')
    expect(formatWait(60)).toBe('1 soat')
    expect(formatWait(72)).toBe('1 soat 12 daq')
    expect(formatWait(23 * 60 + 59)).toBe('23 soat 59 daq')
    expect(formatWait(24 * 60)).toBe('1 kun')
    expect(formatWait(27 * 60 + 30)).toBe('1 kun 3 soat')
  })

  it('is whole minutes from `since`, never negative, and unknown without a start or a clock', () => {
    expect(minutesSince(ago(47), NOW)).toBe(47)
    expect(minutesSince(new Date(NOW - 47 * 60_000 - 59_000).toISOString(), NOW)).toBe(47)
    // A server clock a few seconds ahead of the reader's must not print «-1 daq».
    expect(minutesSince(new Date(NOW + 30_000).toISOString(), NOW)).toBe(0)
    expect(minutesSince(null, NOW)).toBeNull()
    expect(minutesSince(ago(5), 0)).toBeNull()
    expect(minutesSince('not a date', NOW)).toBeNull()
  })

  it('says «hozirgina» under a minute and «N daq oldin» after', () => {
    expect(formatAgo(0)).toBe('hozirgina')
    expect(formatAgo(1)).toBe('1 daq oldin')
    expect(formatAgo(65)).toBe('1 soat 5 daq oldin')
  })

  it('turns amber and red at the problem’s own thresholds from the settings file', () => {
    for (const kind of ['unassigned', 'idle', 'chats', 'missedCalls'] as const) {
      const { warnMin, criticalMin } = LEAD_WATCH_SETTINGS[kind]
      expect(waitThresholds(kind)).toEqual({ warnMin, criticalMin })
      expect(waitTone(warnMin - 1, kind), kind).toBe('normal')
      expect(waitTone(warnMin, kind), kind).toBe('warning')
      expect(waitTone(criticalMin - 1, kind), kind).toBe('warning')
      expect(waitTone(criticalMin, kind), kind).toBe('critical')
    }
  })

  it('keeps the timer neutral for the problems that are not graded by a wait', () => {
    for (const kind of ['channelStop', 'uneven', 'noProject'] as const) {
      expect(waitThresholds(kind)).toBeNull()
      // However long: no pair of its own, and none borrowed from another card.
      for (const minutes of [0, LEAD_WATCH_SETTINGS.unassigned.warnMin, LEAD_WATCH_SETTINGS.unassigned.criticalMin, 24 * 60]) {
        expect(waitTone(minutes, kind), kind).toBe('normal')
      }
    }
  })
})

describe('the order of the cards', () => {
  it('puts critical first, then warnings, then the calm ones, each group in the client’s order', () => {
    const ordered = orderIssues([
      issue('unassigned', 'ok'),
      issue('idle', 'warn'),
      issue('chats', 'critical'),
      issue('missedCalls', 'ok'),
      issue('channelStop', 'critical'),
      issue('uneven', 'warn'),
      issue('noProject', 'ok'),
    ])
    expect(ordered.map((i) => i.kind)).toEqual([
      'chats',
      'channelStop',
      'idle',
      'uneven',
      'unassigned',
      'missedCalls',
      'noProject',
    ])
  })

  it('does not depend on the order the server sent them in', () => {
    const shuffled = orderIssues([issue('noProject', 'warn'), issue('idle', 'warn'), issue('unassigned', 'warn')])
    expect(shuffled.filter((i) => i.severity === 'warn').map((i) => i.kind)).toEqual(['unassigned', 'idle', 'noProject'])
  })

  it('always returns all seven: a kind the server left out is a calm card, not a hole', () => {
    const ordered = orderIssues([issue('chats', 'critical')])
    expect(ordered).toHaveLength(WATCH_KINDS.length)
    expect(ordered[0]!.kind).toBe('chats')
    expect(ordered.slice(1).every((i) => i.severity === 'ok' && i.count === 0)).toBe(true)
    expect(ordered.slice(1).map((i) => i.kind)).toEqual(WATCH_KINDS.filter((k) => k !== 'chats'))
  })
})

describe('a severity', () => {
  it('wears the status step that names it', () => {
    expect(toneOf('ok')).toBe('good')
    expect(toneOf('warn')).toBe('warning')
    expect(toneOf('critical')).toBe('critical')
  })

  it('makes the header chip count the worst kind on the board', () => {
    expect(verdictOf([issue('idle', 'critical'), issue('chats', 'critical'), issue('uneven', 'warn')])).toEqual({
      tone: 'critical',
      label: '2 ta muhim muammo',
    })
    expect(verdictOf([issue('idle', 'warn'), issue('chats', 'ok')])).toEqual({ tone: 'warning', label: '1 ta ogohlantirish' })
    expect(verdictOf([issue('idle', 'ok')])).toEqual({ tone: 'good', label: 'Hammasi joyida' })
    expect(verdictOf([])).toEqual({ tone: 'good', label: 'Hammasi joyida' })
  })
})

describe('a card', () => {
  it('prints the server’s own sub-line when there is one', () => {
    expect(issueSubline(issue('channelStop', 'critical', { summary: '1 forma', oldestSince: ago(90) }), NOW)).toBe('1 forma')
  })

  it('says «qayta qilinmagan» for missed calls and the longest wait for the rest', () => {
    expect(issueSubline(issue('missedCalls', 'warn', { oldestSince: ago(40) }), NOW)).toBe('qayta qilinmagan')
    expect(issueSubline(issue('unassigned', 'critical', { oldestSince: ago(47) }), NOW)).toBe('eng uzoq kutayotgan: 47 daq')
    expect(issueSubline(issue('idle', 'warn', { oldestSince: ago(72) }), NOW)).toBe('eng uzoq kutayotgan: 1 soat 12 daq')
    expect(issueSubline(issue('noProject', 'warn'), NOW)).toBeNull()
  })

  it('opens unless it is calm with nothing behind it', () => {
    expect(isOpenable(issue('idle', 'ok'))).toBe(false)
    expect(isOpenable(issue('idle', 'ok', { rows: [row('1')] }))).toBe(true)
    expect(isOpenable(issue('idle', 'warn'))).toBe(true)
  })
})

describe('the channel chips', () => {
  const rows = [
    row('1', { channel: 'generated' }),
    row('2', { channel: 'generated' }),
    row('3', { channel: 'inbound' }),
    row('4', { channel: 'other' }),
    row('5', { channel: null }),
  ]
  const mixed = issue('unassigned', 'critical', {
    rows,
    count: 5,
    byChannel: { generated: 2, smm: 0, inbound: 1, telegram: 0, other: 1 },
  })

  it('are Hammasi · Ген лид · СММ · Входящий · Телеграм, with no chip for «other»', () => {
    expect(channelChips(mixed).map((c) => c.label)).toEqual(['Hammasi', 'Ген лид', 'СММ', 'Входящий', 'Телеграм'])
  })

  it('count what the server counted and disable a channel with no rows', () => {
    expect(channelChips(mixed).map((c) => [c.value, c.count, c.disabled])).toEqual([
      ['all', 5, false],
      ['generated', 2, false],
      ['smm', 0, true],
      ['inbound', 1, false],
      ['telegram', 0, true],
    ])
  })

  it('keep the real count when the rows are capped, and stay pressable on the rows that were sent', () => {
    const capped = issue('idle', 'critical', {
      rows: [row('1', { channel: 'smm' })],
      count: 412,
      byChannel: { generated: 300, smm: 112, inbound: 0, telegram: 0, other: 0 },
    })
    const chips = channelChips(capped)
    expect(chips.find((c) => c.value === 'all')).toMatchObject({ count: 412, disabled: false })
    expect(chips.find((c) => c.value === 'smm')).toMatchObject({ count: 112, disabled: false })
    // Counted by the server, but none of them among the rows sent: nothing to show under the chip.
    expect(chips.find((c) => c.value === 'generated')).toMatchObject({ count: 300, disabled: true })
  })

  it('show «other» and channel-less rows under Hammasi only', () => {
    expect(filterRows(rows, 'all')).toHaveLength(5)
    expect(filterRows(rows, 'generated').map((r) => r.key)).toEqual(['1', '2'])
    expect(filterRows(rows, 'inbound').map((r) => r.key)).toEqual(['3'])
    expect(filterRows(rows, 'smm')).toEqual([])
  })

  it('keep the server’s order — longest waiting first — through a filter', () => {
    const ordered = [row('a', { channel: 'smm' }), row('b'), row('c', { channel: 'smm' })]
    expect(filterRows(ordered, 'smm').map((r) => r.key)).toEqual(['a', 'c'])
  })
})

describe('«Yana N ta»', () => {
  it('reveals fifty at a time and then what is left', () => {
    expect(ROWS_PER_PAGE).toBe(50)
    expect(nextPageSize(70, 50)).toBe(20)
    expect(nextPageSize(170, 50)).toBe(50)
    expect(nextPageSize(50, 50)).toBe(0)
    expect(nextPageSize(12, 50)).toBe(0)
  })
})

describe('«Jonli»', () => {
  const stale = LEAD_WATCH_SETTINGS.staleAfterMin

  it('dates the block by the oldest feed, falling back to when the answer was computed', () => {
    expect(freshnessOf({ dataAsOf: ago(1), generatedAt: ago(0) }, NOW, false)).toEqual({
      live: true,
      label: 'Jonli · 1 daq oldin yangilandi',
    })
    expect(freshnessOf({ dataAsOf: null, generatedAt: ago(0) }, NOW, false)).toEqual({
      live: true,
      label: 'Jonli · hozirgina yangilandi',
    })
  })

  it('goes grey once the data is older than the settings allow', () => {
    expect(freshnessOf({ dataAsOf: ago(stale), generatedAt: ago(0) }, NOW, false).live).toBe(true)
    const old = freshnessOf({ dataAsOf: ago(stale + 1), generatedAt: ago(0) }, NOW, false)
    expect(old.live).toBe(false)
    expect(old.label).toMatch(/^Yangilanmayapti/)
  })

  it('goes grey while the request is failing, however fresh the last answer', () => {
    const failing = freshnessOf({ dataAsOf: ago(1), generatedAt: ago(1) }, NOW, true)
    expect(failing.live).toBe(false)
    expect(failing.label).toMatch(/^Yangilanmayapti/)
  })

  it('claims no age before the clock is known', () => {
    expect(freshnessOf({ dataAsOf: ago(1), generatedAt: ago(1) }, 0, false)).toEqual({ live: true, label: 'Jonli' })
  })
})

describe('the small strings', () => {
  it('prefixes the tab title with the critical count, and leaves it alone at zero', () => {
    expect(watchTitle('Lidlar', 3)).toBe('(3) Lidlar')
    expect(watchTitle('Lidlar', 0)).toBe('Lidlar')
  })

  it('names an hour by the range its bar covers', () => {
    expect(hourRange(9)).toBe('09:00–10:00')
    expect(hourRange(20)).toBe('20:00–21:00')
    expect(hourRange(23)).toBe('23:00–00:00')
  })
})
