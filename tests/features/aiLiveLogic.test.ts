import { describe, expect, it } from 'vitest'

import {
  type AiReport,
  type AiStatus,
  type LiveCall,
  elapsedText,
  limitsMismatch,
  limitsText,
  lineCount,
  lineViews,
  nowRow,
  recentViews,
  sellerLook,
  shortName,
  workPhase,
} from '@/features/aiRegistrator/aiLiveLogic'

/**
 * «AI registrator → Boshqaruv» as a live board (2026-10-31): what the page
 * says — the AI there or not, each line's call, the sellers, the feed.
 * Fake names and deals only. Tashkent is UTC+5: 10:00 there is 05:00Z.
 */

const at = (hhmm: string, s = '00') => new Date(`2026-10-31T${hhmm}:${s}+05:00`)

const call = (over: Partial<LiveCall> = {}): LiveCall => ({
  line: '291',
  deal: 1001,
  product: 'Kollagen',
  client: 'Aziz',
  test: false,
  state: 'talking',
  since: at('10:00').toISOString(),
  seller: null,
  ...over,
})

const report = (over: Partial<AiReport> = {}): AiReport => ({
  at: at('10:00').toISOString(),
  appliedVersion: 3,
  applyError: null,
  limits: { calls: 6, maxNew: 4, maxRetry: 2, saleHandoff: 'refer', maxSipLegs: 10, fused: false },
  lines: { '178': 'free', '290': 'free', '291': 'call', '292': 'call', '293': 'free', '295': 'seller_talk', '296': 'not_registered', '297': 'free' },
  sellers: [],
  live: { lines: [call(), call({ line: '292', state: 'dialing' })], recent: [] },
  today: { calls: 10, answered: 6, transferred: 2, transferFailed: 1, atsRejected: 0 },
  ...over,
})

const status = (receivedAt: Date, over: Partial<AiReport> = {}): AiStatus => ({ receivedAt: receivedAt.toISOString(), stale: false, report: report(over) })

const NAMES: Record<string, string> = { '120': '120 Dilnoza', '122': 'Malika' }
const nameOf = (ext: string) => NAMES[ext] ?? null

describe('work hours, Tashkent', () => {
  it('is the day 09:00–18:30 with lunch 12:30–13:30', () => {
    expect(workPhase(at('08:59'))).toBe('off')
    expect(workPhase(at('09:00'))).toBe('work')
    expect(workPhase(at('12:29'))).toBe('work')
    expect(workPhase(at('12:30'))).toBe('lunch')
    expect(workPhase(at('13:29'))).toBe('lunch')
    expect(workPhase(at('13:30'))).toBe('work')
    expect(workPhase(at('18:29'))).toBe('work')
    expect(workPhase(at('18:30'))).toBe('off')
    expect(workPhase(at('23:00'))).toBe('off')
  })
})

describe('«Hozir»', () => {
  it('is green with the busy lines while the report is fresh — at any hour', () => {
    expect(nowRow(status(at('10:00')), at('10:01', '30'), 90)).toEqual({ tone: 'good', text: 'AI ishlayapti · 3 liniya band / 8', detail: null })
    expect(nowRow(status(at('21:00')), at('21:00', '20'), 90).tone).toBe('good')
  })

  it('is grey outside the day and at lunch when the AI is silent', () => {
    expect(nowRow(status(at('18:31')), at('20:00'), 90)).toEqual({ tone: 'neutral', text: 'Ish vaqti emas (09:00–18:30)', detail: 'oxirgi xabar 18:31' })
    expect(nowRow(status(at('12:31')), at('12:45'), 90)).toMatchObject({ tone: 'neutral', text: 'Tushlik (12:30–13:30)' })
    expect(nowRow(null, at('07:00'), 90)).toEqual({ tone: 'neutral', text: 'Ish vaqti emas (09:00–18:30)', detail: null })
  })

  it('is red within the day when the AI is silent', () => {
    expect(nowRow(status(at('10:00')), at('10:01', '31'), 90)).toEqual({ tone: 'critical', text: 'AI javob bermayapti — oxirgi xabar 10:00', detail: null })
    expect(nowRow(null, at('10:00'), 90).text).toBe('AI javob bermayapti — hali xabar kelmagan')
    // Yesterday's last word carries its day.
    expect(nowRow(status(new Date('2026-10-30T18:00:00+05:00')), at('09:30'), 90).text).toBe('AI javob bermayapti — oxirgi xabar 30-okt, 18:00')
  })

  it('counts a line busy on a live call or on the map, free and unregistered not', () => {
    expect(lineCount(report())).toEqual({ busy: 3, total: 8 })
    expect(lineCount(report({ live: null, lines: { '290': 'free', '291': 'call' } }))).toEqual({ busy: 1, total: 2 })
  })

  it('says the applied limits and where they differ from the saved form', () => {
    expect(limitsText(report().limits)).toBe('Bir vaqtda 6 = 4 yangi lid + 2 nedozvon')
    expect(limitsText({ calls: 4, maxNew: 4, maxRetry: 0 })).toBe('Bir vaqtda 4 = 4 yangi lid')
    expect(limitsText({ calls: null })).toBeNull()
    expect(limitsMismatch({ maxCalls: 4, maxNew: 4, maxRetry: 0 }, report())).toBe('Saqlangan: 4/4/0 · AI qoʻllagani: 6/4/2 (v3)')
    expect(limitsMismatch({ maxCalls: 4, maxNew: 4, maxRetry: 0 }, report({ appliedVersion: null }))).toMatch(/\(oʻz sozlamasi\)$/)
    expect(limitsMismatch({ maxCalls: 6, maxNew: 4, maxRetry: 2 }, report())).toBeNull()
  })
})

describe('line cards', () => {
  const now = at('10:00', '42')
  const one = (c: Partial<LiveCall>, lines: Record<string, string> = {}) =>
    lineViews(report({ lines, live: { lines: [call(c)], recent: [] } }), nameOf, now)[0]!

  it('says each live state in the floor\'s words, with the time in it', () => {
    expect(one({ state: 'dialing' }).text).toBe('Mijozga terilmoqda · Aziz · 0:42')
    expect(one({ state: 'talking' })).toMatchObject({ text: 'AI ↔ Aziz · Kollagen · 0:42', tone: 'warning', deal: 1001 })
    expect(one({ state: 'transfer' }).text).toBe('Mijoz kutyapti — boʻsh sotuvchi qidirilmoqda · 0:42')
    expect(one({ state: 'ringing_seller', seller: '122' }).text).toBe('Sotuvchi 122 (Malika) ga jiringlayapti · 0:42')
    expect(one({ state: 'with_seller', seller: '120' })).toMatchObject({ text: 'Sotuvchi 120 (Dilnoza) bilan ulandi · 0:42', tone: 'good' })
    expect(one({ state: 'with_seller', seller: '131' }).text).toBe('Sotuvchi 131 bilan ulandi · 0:42')
    expect(one({ state: 'parked_music' }).text).toBe('parked_music · 0:42')
    expect(one({ state: 'talking', product: 'Zekstra', client: '' }).text).toBe('AI ↔ mijoz · Zextra · 0:42')
    expect(one({ test: true }).test).toBe(true)
  })

  it('reads the line map where no live call stands behind it', () => {
    const views = lineViews(report({ live: null }), nameOf, now)
    const text = Object.fromEntries(views.map((v) => [v.line, v.text]))
    expect(text).toMatchObject({ '178': 'Boʻsh', '291': 'Qoʻngʻiroqda', '295': 'Mijoz sotuvchi bilan gaplashyapti', '296': 'ATSʼda roʻyxatda emas' })
    expect(views.find((v) => v.line === '296')?.tone).toBe('critical')
    expect(lineViews(report({ live: null, lines: { '290': 'odd_word' } }), nameOf, now)[0]?.text).toBe('odd_word')
  })

  it('shows every line of either, in number order', () => {
    const views = lineViews(report({ lines: { '297': 'free', '178': 'free' }, live: { lines: [call({ line: '290' })], recent: [] } }), nameOf, now)
    expect(views.map((v) => v.line)).toEqual(['178', '290', '297'])
  })

  it('counts minutes and hours', () => {
    expect(elapsedText(at('10:00').toISOString(), at('10:00', '08'))).toBe('0:08')
    expect(elapsedText(at('10:00').toISOString(), at('10:12', '03'))).toBe('12:03')
    expect(elapsedText(at('10:00').toISOString(), at('11:02', '03'))).toBe('1:02:03')
    expect(elapsedText(at('10:00').toISOString(), at('09:59'))).toBe('0:00')
  })
})

describe('sellers', () => {
  it('puts the AI ringing first, then on a call, free, off the line', () => {
    expect(sellerLook({ state: 'free', aiRinging: true })).toEqual({ tone: 'warning', label: 'AI jiringlatmoqda' })
    expect(sellerLook({ state: 'busy', aiRinging: true }).label).toBe('AI jiringlatmoqda')
    expect(sellerLook({ state: 'busy' })).toEqual({ tone: 'critical', label: 'Gaplashyapti' })
    expect(sellerLook({ state: 'free', aiRinging: false })).toEqual({ tone: 'good', label: 'Boʻsh' })
    expect(sellerLook({ state: 'offline' })).toEqual({ tone: 'neutral', label: 'Liniyada yoʻq' })
    expect(sellerLook({ state: 'away' })).toEqual({ tone: 'neutral', label: 'away' })
  })

  it('drops the extension a roster name starts with', () => {
    expect(shortName('120', '120 Dilnoza')).toBe('Dilnoza')
    expect(shortName('120', '120')).toBeNull()
    expect(shortName('120', 'Malika')).toBe('Malika')
    expect(shortName('120', null)).toBeNull()
  })
})

describe('«Soʻnggi ulanishlar»', () => {
  it('says who was put through to whom, and how the others ended', () => {
    const r = report({
      live: {
        lines: [],
        recent: [
          { at: at('10:42').toISOString(), line: '291', deal: 1001, product: 'Kollagen', client: 'Aziz', test: false, what: 'connected', seller: '120' },
          { at: at('10:40').toISOString(), line: '293', deal: 1002, product: null, client: 'Bobur', test: true, what: 'hung_up_early', seller: null },
          { at: at('10:39').toISOString(), line: '290', deal: null, product: 'Zekstra', client: '', test: false, what: 'transfer_failed', seller: '122' },
          { at: at('10:38').toISOString(), line: '178', deal: null, product: null, client: '', test: false, what: 'brand_new', seller: null },
        ],
      },
    })
    const rows = recentViews(r, nameOf)
    expect(rows.map((x) => `${x.time} · ${x.text}`)).toEqual([
      '10:42 · 291 → 120 (Dilnoza) · Kollagen · Aziz — ulandi',
      '10:40 · 293 · Bobur — gaplashmay qoʻydi',
      '10:39 · 290 → 122 (Malika) · Zextra — qiziqdi, sotuvchi javob bermadi',
      '10:38 · 178 — brand_new',
    ])
    expect(rows.map((x) => x.tone)).toEqual(['good', 'neutral', 'critical', 'neutral'])
    expect(rows[1]).toMatchObject({ test: true, deal: 1002 })
  })

  it('is empty for an agent before live', () => {
    expect(recentViews(report({ live: null }), nameOf)).toEqual([])
    expect(recentViews(report({ live: undefined }), nameOf)).toEqual([])
  })
})
