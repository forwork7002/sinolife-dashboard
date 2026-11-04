import { describe, expect, it } from 'vitest'

import {
  type Press,
  clockChoice,
  leftText,
  lineControlRows,
  lineToggleProblem,
  linesAck,
  mergePresses,
  nextWorkStart,
  pauseChoices,
  pauseState,
  pressText,
  registrationLook,
  tlsResetState,
  totalAttempts,
  tuningAck,
  tuningStart,
} from '@/features/aiRegistrator/aiControlMoreLogic'
import { type AiLine, type AiReport, type AiStatus, flagReasons, laneOf, lineRows, nowRow, workPhase } from '@/features/aiRegistrator/aiLiveLogic'
import { DEFAULT_TUNING } from '@/lib/aiControlRules'

/**
 * «AI registrator → Boshqaruv», the rest of the panel (2026-11-04, T144): what
 * the page says about the pause, the working days, the lines and their
 * presses, and «Qoʻshimcha sozlamalar» — always the saved value against the
 * one the agent runs. Fake lines only. Tashkent is UTC+5; 04.11 is a Wednesday.
 */

const at = (day: string, hhmm: string) => new Date(`2026-11-${day}T${hhmm}:00+05:00`)
const NOW = at('04', '20:00')

const line = (ext: string, over: Partial<AiLine> = {}): AiLine => ({
  ext,
  pool: 'main',
  transport: 'udp',
  state: 'free',
  registration: 'Registered',
  enabled: true,
  ...over,
})

const report = (over: Partial<AiReport> = {}): AiReport => ({
  at: NOW.toISOString(),
  appliedVersion: 9,
  applyError: null,
  limits: { calls: 4, maxNew: 3, maxRetry: 1 },
  lines: { '178': 'free', '290': 'free' },
  sellers: [],
  today: { calls: 0, answered: 0, transferred: 0, transferFailed: 0, atsRejected: 0 },
  ...over,
})

const status = (over: Partial<AiReport> = {}, receivedAt = new Date(NOW.getTime() - 5_000)): AiStatus => ({
  receivedAt: receivedAt.toISOString(),
  stale: false,
  report: report(over),
})

const press = (over: Partial<Press> = {}): Press => ({
  id: 5,
  kind: 'reregister',
  line: '291',
  requestedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  requestedBy: 'umida',
  state: null,
  text: null,
  answeredAt: null,
  ...over,
})

describe('the header — a pause and a day off are the owner\'s choice, not an alarm', () => {
  it('says the pause and till when, then the day off', () => {
    expect(nowRow(status({ flags: { paused: true }, pausedUntil: '2026-11-04T16:30:00+00:00' }), NOW, 90)).toMatchObject({
      tone: 'warning',
      title: 'Pauza (21:30 gacha)',
    })
    expect(nowRow(status({ flags: { day_off: true }, hours: { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null, days: [1, 2, 3, 4, 5] } }), NOW, 90)).toEqual({
      tone: 'neutral',
      title: 'Bugun dam olish kuni',
      detail: 'Ish kunlari: Du–Ju.',
    })
    // A stop outranks a pause.
    expect(nowRow(status({ enabled: false, flags: { paused: true } }), NOW, 90).title).toBe('AI toʻxtatilgan')
  })

  it('reads a silent agent on a day off as a day off, not «AI javob bermayapti»', () => {
    const saturday = at('07', '11:00')
    const weekdays = { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null, days: [1, 2, 3, 4, 5] }
    expect(nowRow(null, saturday, 90, weekdays)).toMatchObject({ tone: 'neutral', title: 'Bugun dam olish kuni' })
    expect(workPhase(saturday, weekdays)).toBe('off')
    expect(workPhase(at('06', '11:00'), weekdays)).toBe('work')
  })

  it('names the two flags among the reasons, and a switched-off line as off', () => {
    expect(flagReasons({ paused: true, day_off: true })).toEqual([
      'Vaqtincha toʻxtatilgan (pauza) — vaqti tugagach oʻzi davom etadi',
      'Bugun dam olish kuni — Boshqaruvdagi ish kunlaridan emas',
    ])
    const rows = lineRows(report({ lines: { '291': 'off' } }), () => null, new Map())
    expect(rows[0]).toMatchObject({ kind: 'other', label: 'Oʻchiq (Boshqaruvdan)' })
    expect(laneOf(rows[0]!).sentence).toMatch(/Boshqaruvdan oʻchirilgan/)
  })
})

describe('«Vaqtincha toʻxtatish»', () => {
  const saved = { pauseUntil: '2026-11-04T16:30:00.000Z', version: 9 }

  it('says till when and how long is left, beside the agent\'s answer', () => {
    const running = pauseState(saved, status({ pausedUntil: '2026-11-04T16:30:00+00:00' }, at('04', '20:44')), at('04', '20:45'), 90)
    expect(running.title).toBe('Pauza: 21:30 gacha · 45 daq qoldi')
    expect(running.ack).toMatchObject({ kind: 'applied', text: 'AI qoʻlladi ✓' })
    expect(pauseState(saved, status({ pausedUntil: null }), NOW, 90).ack).toMatchObject({ kind: 'applying', text: 'qoʻllanmoqda…' })
    expect(pauseState(saved, status({ appliedVersion: 8, applyError: 'pauza 7 kundan uzoq' }), NOW, 90).ack).toMatchObject({ kind: 'refused', reason: 'pauza 7 kundan uzoq' })
    expect(pauseState(saved, status(), NOW, 90).ack?.kind).toBe('old')
  })

  it('shows nothing once the pause ran out and the agent left it too, nor before any', () => {
    expect(pauseState(saved, status({ pausedUntil: null }, at('04', '21:59')), at('04', '22:00'), 90)).toEqual({ until: null, title: null, ack: null })
    expect(pauseState({ pauseUntil: null, version: 9 }, status(), NOW, 90)).toEqual({ until: null, title: null, ack: null })
  })

  it('offers 15 daq · 30 daq · 1 soat · 2 soat · Bugungacha — to the next working day\'s start', () => {
    const hours = { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null }
    const choices = pauseChoices(NOW, hours)
    expect(choices.map((c) => c.label)).toEqual(['15 daq', '30 daq', '1 soat', '2 soat', 'Bugungacha'])
    expect(choices[0]!.until).toBe('2026-11-04T15:15:00.000Z')
    expect(choices[4]!.until).toBe('2026-11-05T04:00:00.000Z')
    // Friday evening with Monday to Friday: Bugungacha runs to Monday 09:00.
    expect(nextWorkStart(at('06', '20:00'), { ...hours, days: [1, 2, 3, 4, 5] })).toBe('2026-11-09T04:00:00.000Z')
  })

  it('reads «… gacha» as today while ahead, else tomorrow', () => {
    expect(clockChoice('21:30', NOW)).toEqual({ until: '2026-11-04T16:30:00.000Z', label: 'bugun 21:30' })
    expect(clockChoice('09:00', NOW)).toEqual({ until: '2026-11-05T04:00:00.000Z', label: 'ertaga 09:00' })
    expect(leftText('2026-11-06T16:30:00.000Z', NOW)).toBe('2 kun 1 soat qoldi')
    expect(leftText('2026-11-04T16:00:00.000Z', NOW)).toBe('1 soat qoldi')
  })
})

describe('AI liniyalari (SIP)', () => {
  const lines = [line('290'), line('178'), line('296', { pool: 'zextra' }), line('291', { registration: 'Rejected', state: 'not_registered' })]

  it('one row a line — Collagen then Zextra by number — with its registration and «Qayta ulash» only when it is down', () => {
    const rows = lineControlRows(lines, ['290'], [], NOW)
    expect(rows.map((r) => r.ext)).toEqual(['178', '290', '291', '296'])
    expect(rows[1]).toMatchObject({ on: false, appliedOn: true, canReregister: false, reregisterWhy: 'ATSda roʻyxatda — qayta ulash kerak emas' })
    expect(rows[2]).toMatchObject({ registration: { label: 'Rejected ✗', tone: 'critical' }, canReregister: true, product: 'Collagen', transport: 'UDP' })
    expect(rows[3]!.product).toBe('Zextra')
    expect(registrationLook('Registered')).toEqual({ label: 'Registered ✓', tone: 'good' })
    expect(registrationLook('Request Sent')).toEqual({ label: 'Request Sent', tone: 'warning' })
  })

  it('holds «Qayta ulash» while a press waits, and says its answer', () => {
    const rows = lineControlRows(lines, [], [press()], NOW)
    expect(rows.find((r) => r.ext === '291')).toMatchObject({ canReregister: false, reregisterWhy: 'Soʻrov yuborilgan — AI javobini kuting' })
    expect(pressText(press(), NOW).text).toBe('Yuborildi — AI 20 soniya ichida oʻqiydi · 19:59')
    expect(pressText(press({ state: 'refused', text: 'ATS bloklamasin', answeredAt: NOW.toISOString() }), NOW)).toEqual({
      tone: 'critical',
      text: '✗ Rad etildi · ATS bloklamasin · 20:00',
    })
    expect(pressText(press({ requestedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() }), NOW).text).toMatch(/^AI oʻqimadi — 10 daqiqadan eskirdi/)
  })

  it('takes the agent\'s newer answer from the 5 s report over the stored row', () => {
    const merged = mergePresses([press(), press({ id: 4, state: 'done', text: 'ok' })], [
      { id: 5, kind: 'reregister', line: '291', state: 'done', text: 'qayta ulandi', at: NOW.toISOString() },
      { id: 4, kind: 'reregister', line: '291', state: 'refused', text: 'kech', at: NOW.toISOString() },
    ])
    expect(merged.map((p) => [p.id, p.state, p.text])).toEqual([
      [5, 'done', 'qayta ulandi'],
      [4, 'done', 'ok'],
    ])
  })

  it('refuses switching off the last main line before it is sent', () => {
    expect(lineToggleProblem(lines, ['290', '291'], '178')).toMatch(/asosiy \(Collagen\)/)
    expect(lineToggleProblem(lines, ['290'], '290')).toBeNull()
  })

  it('offers «TLSʼni yangilash» only with every TLS line down and none on a call', () => {
    const tls = (registration: string, state = 'not_registered') => line('292', { transport: 'tls', registration, state })
    expect(tlsResetState(lines, [], NOW).shown).toBe(false)
    expect(tlsResetState([...lines, tls('Registered', 'free')], [], NOW)).toMatchObject({ shown: true, enabled: false })
    expect(tlsResetState([...lines, tls('Rejected', 'call')], [], NOW).why).toMatch(/qoʻngʻiroq bor/)
    expect(tlsResetState([...lines, tls('Rejected')], [], NOW)).toMatchObject({ enabled: true })
    expect(tlsResetState([...lines, tls('Rejected')], [press({ kind: 'tls_reset', line: null })], NOW).enabled).toBe(false)
  })

  it('reads the switches as applied once the agent runs them', () => {
    const saved = { linesOff: ['290'], version: 9 }
    expect(linesAck(saved, status({ aiLines: [line('178'), line('290', { enabled: false })] }), NOW, 90).kind).toBe('applied')
    expect(linesAck(saved, status({ aiLines: [line('178'), line('290')] }), NOW, 90).kind).toBe('applying')
    expect(linesAck(saved, status(), NOW, 90).kind).toBe('old')
    expect(linesAck(saved, status({}, new Date(NOW.getTime() - 120_000)), NOW, 90).kind).toBe('silent')
  })
})

describe('«Qoʻshimcha sozlamalar»', () => {
  it('starts from the saved tuning, else what the agent runs, else the server\'s .env', () => {
    expect(tuningStart(null, report({ tuning: { attemptsPerDay: 3, ringSec: 99, whyUs: 'test', maxAttempts: 6 } }))).toEqual({
      ...DEFAULT_TUNING,
      attemptsPerDay: 3,
      whyUs: 'test',
    })
    expect(tuningStart({ ...DEFAULT_TUNING, retryDays: 4 }, report({ tuning: { retryDays: 1 } })).retryDays).toBe(4)
    expect(totalAttempts({ attemptsPerDay: 5, retryDays: 2 })).toBe(10)
  })

  it('says whether the agent runs the saved values', () => {
    const saved = { tuning: DEFAULT_TUNING, version: 9 }
    expect(tuningAck(saved, status({ tuning: { ...DEFAULT_TUNING, maxAttempts: 10 } }), NOW, 90)?.kind).toBe('applied')
    expect(tuningAck(saved, status({ tuning: { ...DEFAULT_TUNING, ringSec: 20 } }), NOW, 90)?.kind).toBe('applying')
    expect(tuningAck(saved, status(), NOW, 90)?.kind).toBe('old')
    expect(tuningAck({ tuning: null, version: 9 }, status(), NOW, 90)).toBeNull()
  })
})
