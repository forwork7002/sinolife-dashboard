import { describe, expect, it } from 'vitest'

import {
  type AiReport,
  type AiStatus,
  type LiveCall,
  type ReportSeller,
  boardOf,
  elapsedText,
  limitsMismatch,
  limitsSplit,
  limitsText,
  lineCount,
  nowRow,
  percent,
  productOf,
  recentRows,
  sellerGroups,
  sellerLook,
  sellerName,
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

const NAMES: Record<string, string> = { '120': '120 Malika Karimova 120', '122': 'Sevara', '131': '131 Bobur -131 Aliyev' }
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

describe('the hero', () => {
  it('is green while the report is fresh — at any hour', () => {
    expect(nowRow(status(at('10:00')), at('10:01', '30'), 90)).toEqual({ tone: 'good', title: 'AI ishlayapti', detail: null })
    expect(nowRow(status(at('21:00')), at('21:00', '20'), 90).tone).toBe('good')
  })

  it('is grey outside the day and at lunch when the AI is silent', () => {
    expect(nowRow(status(at('18:31')), at('20:00'), 90)).toEqual({ tone: 'neutral', title: 'Ish vaqti emas (09:00–18:30)', detail: 'oxirgi xabar 18:31' })
    expect(nowRow(status(at('12:31')), at('12:45'), 90)).toMatchObject({ tone: 'neutral', title: 'Tushlik 12:30–13:30' })
    expect(nowRow(null, at('07:00'), 90)).toEqual({ tone: 'neutral', title: 'Ish vaqti emas (09:00–18:30)', detail: null })
  })

  it('is red within the day when the AI is silent', () => {
    expect(nowRow(status(at('10:00')), at('10:01', '31'), 90)).toEqual({ tone: 'critical', title: 'AI javob bermayapti — oxirgi xabar 10:00', detail: null })
    expect(nowRow(null, at('10:00'), 90).title).toBe('AI javob bermayapti — hali xabar kelmagan')
    // Yesterday's last word carries its day.
    expect(nowRow(status(new Date('2026-10-30T18:00:00+05:00')), at('09:30'), 90).title).toBe('AI javob bermayapti — oxirgi xabar 30-okt, 18:00')
  })

  it('counts a line busy on a live call or on a call in the map — free, unregistered and unknown words not', () => {
    expect(lineCount(report())).toEqual({ busy: 3, total: 8 })
    expect(lineCount(report({ live: null, lines: { '290': 'free', '291': 'call', '292': 'odd_word' } }))).toEqual({ busy: 1, total: 3 })
  })

  it('says the applied limits and where they differ from the saved form', () => {
    expect(limitsText(report().limits)).toBe('Bir vaqtda 6 = 4 yangi lid + 2 nedozvon')
    expect(limitsSplit(report().limits)).toBe('4 yangi lid + 2 nedozvon')
    expect(limitsText({ calls: 4, maxNew: 4, maxRetry: 0 })).toBe('Bir vaqtda 4 = 4 yangi lid')
    expect(limitsText({ calls: null })).toBeNull()
    expect(limitsSplit({ calls: 3 })).toBeNull()
    expect(limitsMismatch({ maxCalls: 4, maxNew: 4, maxRetry: 0 }, report())).toBe('Saqlangan: 4/4/0 · AI qoʻllagani: 6/4/2 (v3)')
    expect(limitsMismatch({ maxCalls: 4, maxNew: 4, maxRetry: 0 }, report({ appliedVersion: null }))).toMatch(/\(oʻz sozlamasi\)$/)
    expect(limitsMismatch({ maxCalls: 6, maxNew: 4, maxRetry: 2 }, report())).toBeNull()
  })

  it('gives the funnel its percentages, «—» over nothing', () => {
    expect(percent(148, 472)).toBe('31%')
    expect(percent(44, 148)).toBe('30%')
    expect(percent(0, 0)).toBe('—')
  })
})

describe('the board', () => {
  const one = (c: Partial<LiveCall>) => boardOf(report({ lines: {}, live: { lines: [call(c)], recent: [] } }), nameOf).busy[0]!

  it('says each live state in the floor\'s words', () => {
    expect(one({ state: 'dialing' })).toMatchObject({ label: 'Mijozga terilmoqda', tone: 'neutral', live: true })
    expect(one({ state: 'talking' })).toMatchObject({ label: 'Mijoz bilan gaplashyapti', tone: 'active', client: 'Aziz', deal: 1001, product: 'Collagen' })
    expect(one({ state: 'transfer' })).toMatchObject({ label: 'Mijoz kutyapti — boʻsh sotuvchi qidirilmoqda', tone: 'warning' })
    expect(one({ state: 'ringing_seller', seller: '122' })).toMatchObject({ label: 'Sotuvchiga ulanyapti', seller: { ext: '122', label: '122 Sevara' } })
    expect(one({ state: 'with_seller', seller: '120' })).toMatchObject({ label: 'Sotuvchi bilan', tone: 'good', seller: { label: '120 Malika' } })
    expect(one({ state: 'with_seller', seller: '141' }).seller?.label).toBe('141')
    expect(one({ state: 'parked_music' })).toMatchObject({ label: 'parked_music', tone: 'neutral' })
    expect(one({ product: 'Zekstra', client: '', test: true })).toMatchObject({ product: 'Zextra', client: null, test: true })
  })

  it('sorts the lines: busy cards, the free row, the unregistered in red, an unknown word raw — in number order', () => {
    const board = boardOf(report({ lines: { ...report().lines, '294': 'odd_word' } }), nameOf)
    expect(board.busy.map((l) => [l.line, l.label])).toEqual([
      ['291', 'Mijoz bilan gaplashyapti'],
      ['292', 'Mijozga terilmoqda'],
      ['295', 'Mijoz sotuvchi bilan'],
    ])
    expect(board.busy[2]).toMatchObject({ live: false, since: null, client: null })
    expect(board.free).toEqual(['178', '290', '293', '297'])
    expect(board.unregistered).toEqual(['296'])
    expect(board.other).toEqual([{ line: '294', word: 'odd_word' }])
  })

  it('reads an agent before live: a line on a call is a card that says so', () => {
    const board = boardOf(report({ live: null }), nameOf)
    expect(board.busy.map((l) => [l.line, l.label, l.live])).toEqual([
      ['291', 'Qoʻngʻiroqda', false],
      ['292', 'Qoʻngʻiroqda', false],
      ['295', 'Mijoz sotuvchi bilan', false],
    ])
  })

  it('counts the timer in minutes and seconds, hours when it runs that long', () => {
    expect(elapsedText(at('10:00').toISOString(), at('10:00', '08'))).toBe('00:08')
    expect(elapsedText(at('10:00').toISOString(), at('10:12', '03'))).toBe('12:03')
    expect(elapsedText(at('10:00').toISOString(), at('11:02', '03'))).toBe('1:02:03')
    expect(elapsedText(at('10:00').toISOString(), at('09:59'))).toBe('00:00')
  })
})

describe('sellers', () => {
  const seller = (over: Partial<ReportSeller>): ReportSeller => ({ ext: '120', name: 'Malika', state: 'free', inList: true, transfersToday: 0, product: 'Kollagen', aiRinging: false, ...over })

  it('puts the AI ringing first, then on a call, free, off the line — red never for a call', () => {
    expect(sellerLook({ state: 'free', aiRinging: true })).toEqual({ tone: 'warning', label: 'AI jiringlatmoqda' })
    expect(sellerLook({ state: 'busy', aiRinging: true }).label).toBe('AI jiringlatmoqda')
    expect(sellerLook({ state: 'busy' })).toEqual({ tone: 'active', label: 'Gaplashyapti' })
    expect(sellerLook({ state: 'free', aiRinging: false })).toEqual({ tone: 'good', label: 'Boʻsh' })
    expect(sellerLook({ state: 'offline' })).toEqual({ tone: 'neutral', label: 'Liniyada yoʻq' })
    expect(sellerLook({ state: 'away' })).toEqual({ tone: 'neutral', label: 'away' })
  })

  it('groups them in four columns that stand still, ringing first, with their counts', () => {
    const groups = sellerGroups(
      [
        seller({ ext: '120', state: 'busy', aiRinging: true }),
        seller({ ext: '122', state: 'busy' }),
        seller({ ext: '123', state: 'free', product: 'Zekstra' }),
        seller({ ext: '124', state: 'offline' }),
        seller({ ext: '125', state: 'busy', inList: false }),
      ],
      true,
    )
    expect(groups.map((g) => [g.label, g.sellers.map((s) => s.ext)])).toEqual([
      ['Jiringlamoqda (AI)', ['120']],
      ['Gaplashyapti', ['122']],
      ['Boʻsh', ['123']],
      ['Liniyada yoʻq', ['124']],
    ])
    expect(groups[2]?.sellers[0]?.product).toBe('Zextra')
    expect(sellerGroups([seller({ state: 'away' })], true).at(-1)).toMatchObject({ key: 'unknown', label: 'Nomaʼlum' })
    expect(sellerGroups([seller({ state: 'free' })], true).map((g) => g.key)).toEqual(['ringing', 'busy', 'free', 'offline'])
  })

  it('says nothing about now from a stale report', () => {
    expect(sellerGroups([seller({ ext: '120', aiRinging: true }), seller({ ext: '122', state: 'busy' })], false)).toEqual([
      expect.objectContaining({ key: 'unknown', label: 'Holat nomaʼlum', sellers: [expect.objectContaining({ ext: '120' }), expect.objectContaining({ ext: '122' })] }),
    ])
  })

  it('drops the extension and its dashes from a Bitrix24 name, wherever they stand', () => {
    expect(sellerName('122', '122 Malika Karimova 122')).toEqual({ first: 'Malika', last: 'Karimova' })
    expect(sellerName('131', '131 Bobur -131 Aliyev')).toEqual({ first: 'Bobur', last: 'Aliyev' })
    expect(sellerName('111', 'Oʻgʻiloy Nasriddinova 111')).toEqual({ first: 'Oʻgʻiloy', last: 'Nasriddinova' })
    expect(sellerName('120', 'Sevara')).toEqual({ first: 'Sevara', last: null })
    expect(sellerName('120', '120')).toEqual({ first: null, last: null })
    expect(sellerName('120', null)).toEqual({ first: null, last: null })
  })

  it('names the products as the dashboard does', () => {
    expect(productOf('Kollagen')).toBe('Collagen')
    expect(productOf('Zekstra')).toBe('Zextra')
    expect(productOf('Omega')).toBeNull()
    expect(productOf(null)).toBeNull()
  })
})

describe('the feed', () => {
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
    expect(recentRows(r, nameOf).map(({ key: _k, ...row }) => row)).toEqual([
      { time: '10:42', line: '291', client: 'Aziz', deal: 1001, product: 'Collagen', test: false, seller: '120 Malika', ok: true, result: 'Ulandi' },
      { time: '10:40', line: '293', client: 'Bobur', deal: 1002, product: null, test: true, seller: null, ok: false, result: 'Gaplashmay qoʻydi' },
      { time: '10:39', line: '290', client: null, deal: null, product: 'Zextra', test: false, seller: '122 Sevara', ok: false, result: 'Qiziqdi, sotuvchi javob bermadi' },
      { time: '10:38', line: '178', client: null, deal: null, product: null, test: false, seller: null, ok: false, result: 'brand_new' },
    ])
  })

  it('is empty for an agent before live', () => {
    expect(recentRows(report({ live: null }), nameOf)).toEqual([])
    expect(recentRows(report({ live: undefined }), nameOf)).toEqual([])
  })
})
