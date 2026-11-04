import {
  ACTION_LABEL,
  ACTION_MAX_AGE_MS,
  type ActionKind,
  type AiTuning,
  DEFAULT_TUNING,
  TRANSFER_ORDERS,
  TUNING_KEYS,
  TUNING_NUMBERS,
  type TuningNumberKey,
  WHY_US_MODES,
  linesOffProblems,
  pauseProblems,
  tashkentIso,
  tuningDiff,
  tuningProblems,
} from '@/lib/aiControlRules'
import { type WorkHours, clockMinutes, worksOn } from '@/lib/aiWorkHours'
import { formatDateTime, formatTime, tashkentDay } from '@/lib/format'

import { type AiActionAnswer, type AiLine, type AiReport, type AiStatus, type ReportTuning, type Tone, isFresh, tashkentWeekday } from './aiLiveLogic'

/**
 * «AI registrator → Boshqaruv», the rest of the panel (2026-11-04, T144, the
 * owner: «hamma narsani boshqara olsin … to'xtatib qo'yish funksiyalari, SIP
 * bilan ishlash»): what the page says about the timed pause, the AI lines
 * switched on and off, the one-off presses and «Qoʻshimcha sozlamalar». Pure,
 * so each sentence is pinned by a test. Every state is the SAVED value against
 * the one the agent says it RUNS — never the saved one shown as applied.
 */

/* ── Saved against applied — one reading for every section ─────────────── */

export interface Ack {
  /** `applied` — saved = applied; `applying` — not yet; `refused`; `old` — the agent sends nothing for it; `silent` — no fresh report. */
  readonly kind: 'applied' | 'applying' | 'refused' | 'old' | 'silent'
  readonly tone: 'good' | 'warning' | 'critical' | 'neutral'
  readonly text: string
  readonly reason: string | null
}

/**
 * «AI qoʻlladi ✓» / «qoʻllanmoqda…» / «AI rad etdi vN» for one setting —
 * `matches` says whether the report runs the saved value: null when the report
 * has nothing for it (an agent older than the setting).
 */
export function ackOf(savedVersion: number, status: AiStatus | null, now: Date, staleAfterSec: number, matches: (report: AiReport) => boolean | null): Ack {
  if (!status || !isFresh(status, now, staleAfterSec)) {
    return {
      kind: 'silent',
      tone: 'neutral',
      text: 'AIdan yangi xabar yoʻq',
      reason: 'AI qoʻllaganini bilib boʻlmaydi.',
    }
  }
  const report = status.report
  // A refusal first: whatever the agent knows, a refused version runs nowhere.
  const taken = report.appliedVersion !== null && report.appliedVersion >= savedVersion
  if (!taken && report.applyError) return { kind: 'refused', tone: 'critical', text: `AI rad etdi v${savedVersion}`, reason: report.applyError }
  const same = matches(report)
  if (same === null) return { kind: 'old', tone: 'warning', text: 'AI serveri buni hali bilmaydi', reason: 'AI serveri yangilanmaguncha bu sozlama ishlamaydi.' }
  if (!taken || !same) return { kind: 'applying', tone: 'warning', text: 'qoʻllanmoqda…', reason: 'AI 20 soniya ichida oʻqiydi.' }
  return { kind: 'applied', tone: 'good', text: 'AI qoʻlladi ✓', reason: null }
}

/* ── «Vaqtincha toʻxtatish» ─────────────────────────────────────────────── */

const MINUTE = 60_000

/** «45 daq qoldi», «1 soat 15 daq qoldi», «2 kun 3 soat qoldi». */
export function leftText(untilIso: string, now: Date): string {
  const ms = new Date(untilIso).getTime() - now.getTime()
  if (!(ms > 0)) return 'tugadi'
  const minutes = Math.ceil(ms / MINUTE)
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days} kun ${hours} soat qoldi` : `${days} kun qoldi`
  if (hours > 0) return mins > 0 ? `${hours} soat ${mins} daq qoldi` : `${hours} soat qoldi`
  return `${mins} daq qoldi`
}

/** «21:30» today, «5-noy, 09:00» another day. */
export function untilText(iso: string, now: Date): string {
  return tashkentDay(new Date(iso)) === tashkentDay(now) ? formatTime(iso) : formatDateTime(iso)
}

/** The saved pause while it is ahead, else null — one that ran out is no pause. */
export function runningPause(pauseUntil: string | null | undefined, now: Date): string | null {
  return pauseUntil && new Date(pauseUntil).getTime() > now.getTime() ? pauseUntil : null
}

const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : Math.abs(new Date(a!).getTime() - new Date(b!).getTime()) < 1000

export interface PauseState {
  /** The saved pause still ahead, else null. */
  readonly until: string | null
  /** «Pauza: 21:30 gacha · 45 daq qoldi», or null with none running. */
  readonly title: string | null
  readonly ack: Ack | null
}

/** The pause card's words: the saved pause and whether the agent runs it. */
export function pauseState(saved: { readonly pauseUntil: string | null; readonly version: number }, status: AiStatus | null, now: Date, staleAfterSec: number): PauseState {
  const until = runningPause(saved.pauseUntil, now)
  // Nothing was ever paused: nothing to say about the agent either.
  if (until === null && saved.pauseUntil === null) return { until: null, title: null, ack: null }
  const ack = ackOf(saved.version, status, now, staleAfterSec, (report) => (report.pausedUntil === undefined ? null : sameInstant(runningPause(report.pausedUntil, now), until)))
  // A pause that ran out by the clock and that the agent also left — nothing to show.
  if (until === null && ack.kind === 'applied') return { until: null, title: null, ack: null }
  return {
    until,
    title: until ? `Pauza: ${untilText(until, now)} gacha · ${leftText(until, now)}` : null,
    ack,
  }
}

export interface PauseChoice {
  readonly key: string
  readonly label: string
  readonly until: string
}

/**
 * When the next working day begins — the first day after today the panel
 * works on, at its start: «Bugungacha» pauses the rest of today. Null when
 * the hours have no readable start.
 */
export function nextWorkStart(now: Date, hours: WorkHours): string | null {
  const start = clockMinutes(hours.start)
  if (start === null) return null
  const midnight = Date.parse(`${tashkentDay(now)}T00:00:00+05:00`)
  for (let d = 1; d <= 7; d += 1) {
    const at = new Date(midnight + d * 24 * 60 * MINUTE + start * MINUTE)
    if (worksOn(tashkentWeekday(at), hours)) return at.toISOString()
  }
  return null
}

/** The pause's quick choices — 15 daq · 30 daq · 1 soat · 2 soat · Bugungacha. */
export function pauseChoices(now: Date, hours: WorkHours): PauseChoice[] {
  const after = (minutes: number) => new Date(now.getTime() + minutes * MINUTE).toISOString()
  const choices: PauseChoice[] = [
    { key: '15', label: '15 daq', until: after(15) },
    { key: '30', label: '30 daq', until: after(30) },
    { key: '60', label: '1 soat', until: after(60) },
    { key: '120', label: '2 soat', until: after(120) },
  ]
  const tomorrow = nextWorkStart(now, hours)
  if (tomorrow && pauseProblems(tomorrow, now).length === 0) choices.push({ key: 'today', label: 'Bugungacha', until: tomorrow })
  return choices
}

/**
 * «… gacha»: a clock time today, or tomorrow when today's is gone — the
 * instant, and how the button says it («bugun 21:30», «ertaga 09:00»).
 */
export function clockChoice(clock: string, now: Date): { readonly until: string; readonly label: string } | null {
  const m = clockMinutes(clock)
  if (m === null) return null
  const midnight = Date.parse(`${tashkentDay(now)}T00:00:00+05:00`)
  const today = midnight + m * MINUTE
  return today > now.getTime()
    ? { until: new Date(today).toISOString(), label: `bugun ${clock}` }
    : {
        until: new Date(today + 24 * 60 * MINUTE).toISOString(),
        label: `ertaga ${clock}`,
      }
}

/** The pause as the server is sent it — Tashkent with the offset, as the agent reads it. */
export const pauseBody = (until: string | null) => (until === null ? null : tashkentIso(new Date(until)))

/* ── AI lines (SIP) ─────────────────────────────────────────────────────── */

/** The ATS registration in the floor's words — ✓ in green, a refusal in red. */
export function registrationLook(word: string): {
  readonly label: string
  readonly tone: Tone
} {
  if (word === 'Registered') return { label: 'Registered ✓', tone: 'good' }
  if (word === 'Rejected') return { label: 'Rejected ✗', tone: 'critical' }
  if (word === 'missing') return { label: 'ATSda yoʻq', tone: 'critical' }
  if (word === 'unknown' || word === '') return { label: 'nomaʼlum', tone: 'neutral' }
  return { label: word, tone: 'warning' }
}

/** What the line does now — the line map's word. */
export function lineNowLook(state: string): {
  readonly label: string
  readonly tone: Tone
} {
  switch (state) {
    case 'free':
      return { label: 'Boʻsh', tone: 'neutral' }
    case 'call':
      return { label: 'Qoʻngʻiroqda', tone: 'active' }
    case 'seller_talk':
      return { label: 'Mijoz sotuvchi bilan', tone: 'good' }
    case 'not_registered':
      return { label: 'Ishlamayapti', tone: 'critical' }
    case 'off':
      return { label: 'Oʻchiq', tone: 'neutral' }
    case 'unknown':
      return { label: 'nomaʼlum', tone: 'neutral' }
    default:
      return { label: state, tone: 'neutral' }
  }
}

/** The SIP words for a line on a call — closing its socket or re-registering would cut it. */
const ON_A_CALL = new Set(['call', 'seller_talk'])

/** One press and its answer, as the panel keeps it (`ActionDto`). */
export interface Press {
  readonly id: number
  readonly kind: string
  readonly line: string | null
  readonly requestedAt: string
  readonly requestedBy: string
  readonly state: string | null
  readonly text: string | null
  readonly answeredAt: string | null
}

/**
 * The presses with the newest answers: the stored ones, each overwritten by
 * the agent's answer in the 5 s report when it says more (the row is written
 * by the same report, a minute's read may lag it). Newest first.
 */
export function mergePresses(stored: readonly Press[], live: readonly AiActionAnswer[] | undefined): Press[] {
  const answers = new Map((live ?? []).map((a) => [a.id, a]))
  return [...stored]
    .map((p) => {
      const a = answers.get(p.id)
      if (!a || p.state === 'done' || p.state === 'refused') return p
      if (a.state === p.state && a.text === p.text) return p
      return { ...p, state: a.state, text: a.text, answeredAt: a.at }
    })
    .sort((a, b) => b.id - a.id)
}

/** The newest press of this kind (and line). */
export function lastPress(presses: readonly Press[], kind: ActionKind, line: string | null): Press | null {
  return presses.find((p) => p.kind === kind && (p.line ?? null) === line) ?? null
}

/** A press still waiting: not answered, or «pending», under ten minutes old. */
export function pressOpen(press: Press | null, now: Date): boolean {
  if (!press) return false
  if (press.state !== null && press.state !== 'pending') return false
  return now.getTime() - new Date(press.requestedAt).getTime() <= ACTION_MAX_AGE_MS
}

/** «✓ Bajarildi · liniya qayta ulandi · 14:05» — a press's answer in a line. */
export function pressText(press: Press, now: Date): { readonly tone: Tone; readonly text: string } {
  const when = untilText(press.answeredAt ?? press.requestedAt, now)
  const tail = press.text ? ` · ${press.text}` : ''
  if (press.state === 'done') return { tone: 'good', text: `✓ Bajarildi${tail} · ${when}` }
  if (press.state === 'refused') return { tone: 'critical', text: `✗ Rad etildi${tail} · ${when}` }
  if (!pressOpen(press, now))
    return {
      tone: 'neutral',
      text: `AI oʻqimadi — 10 daqiqadan eskirdi · ${when}`,
    }
  if (press.state === 'pending') return { tone: 'warning', text: `Bajarilmoqda…${tail} · ${when}` }
  return {
    tone: 'warning',
    text: `Yuborildi — AI 20 soniya ichida oʻqiydi · ${when}`,
  }
}

export interface LineControlRow {
  readonly ext: string
  readonly product: 'Collagen' | 'Zextra'
  readonly transport: 'TLS' | 'UDP'
  readonly registration: { readonly label: string; readonly tone: Tone }
  readonly now: { readonly label: string; readonly tone: Tone }
  /** On as saved (not in `linesOff`). */
  readonly on: boolean
  /** On as the agent runs it. */
  readonly appliedOn: boolean
  /** «Qayta ulash» is offered: not registered, no press waiting. */
  readonly canReregister: boolean
  readonly reregisterWhy: string | null
  readonly press: Press | null
}

const byNumber = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b)

/** Every AI line the agent reports, Collagen first then Zextra, each by number. */
export function lineControlRows(lines: readonly AiLine[], linesOff: readonly string[], presses: readonly Press[], now: Date): LineControlRow[] {
  const off = new Set(linesOff)
  return [...lines]
    .sort((a, b) => (a.pool === 'zextra' ? 1 : 0) - (b.pool === 'zextra' ? 1 : 0) || byNumber(a.ext, b.ext))
    .map((l) => {
      const press = lastPress(presses, 'reregister', l.ext)
      const registered = l.registration === 'Registered'
      const waiting = pressOpen(press, now)
      return {
        ext: l.ext,
        product: l.pool === 'zextra' ? 'Zextra' : 'Collagen',
        transport: l.transport === 'tls' ? 'TLS' : 'UDP',
        registration: registrationLook(l.registration),
        now: lineNowLook(l.state),
        on: !off.has(l.ext),
        appliedOn: l.enabled,
        canReregister: !registered && !waiting,
        reregisterWhy: registered ? 'ATSda roʻyxatda — qayta ulash kerak emas' : waiting ? 'Soʻrov yuborilgan — AI javobini kuting' : null,
        press,
      }
    })
}

/** Would switching `ext` flip leave the agent's rule kept — one main line at least on? The reason when not. */
export function lineToggleProblem(lines: readonly AiLine[], linesOff: readonly string[], ext: string): string | null {
  const next = linesOff.includes(ext) ? linesOff.filter((l) => l !== ext) : [...linesOff, ext]
  return linesOffProblems(next, lines)[0] ?? null
}

export interface TlsResetState {
  /** Any TLS line at all — else the button is not drawn. */
  readonly shown: boolean
  readonly enabled: boolean
  /** Why it is greyed, or what it will do. */
  readonly why: string
  readonly press: Press | null
}

/**
 * «TLSʼni yangilash» — closes the TLS socket and opens it again. Only when
 * every TLS line is down (one registered means the socket works: re-register
 * the fallen line instead) and none is on a call (it would be cut). The agent
 * keeps its own guard (ten minutes between, its own reading) and says why it
 * refuses.
 */
export function tlsResetState(lines: readonly AiLine[], presses: readonly Press[], now: Date): TlsResetState {
  const tls = lines.filter((l) => l.transport === 'tls')
  const press = lastPress(presses, 'tls_reset', null)
  if (tls.length === 0) return { shown: false, enabled: false, why: '', press }
  const up = tls.filter((l) => l.registration === 'Registered').map((l) => l.ext)
  if (up.length > 0)
    return {
      shown: true,
      enabled: false,
      why: `TLS ulanishi ishlayapti (${up.join(', ')} Registered) — kerak emas.`,
      press,
    }
  const busy = tls.filter((l) => ON_A_CALL.has(l.state)).map((l) => l.ext)
  if (busy.length > 0)
    return {
      shown: true,
      enabled: false,
      why: `${busy.join(', ')} liniyasida qoʻngʻiroq bor — tugagach bosing.`,
      press,
    }
  if (pressOpen(press, now))
    return {
      shown: true,
      enabled: false,
      why: 'Soʻrov yuborilgan — AI javobini kuting.',
      press,
    }
  return {
    shown: true,
    enabled: true,
    why: `Hamma TLS liniyalar (${tls.map((l) => l.ext).join(', ')}) tushgan — AI TLS ulanishini yopib, qayta ochadi va liniyalarni qayta roʻyxatdan oʻtkazadi.`,
    press,
  }
}

/** Saved `linesOff` against the agent's own `enabled` per line. */
export function linesAck(saved: { readonly linesOff: readonly string[]; readonly version: number }, status: AiStatus | null, now: Date, staleAfterSec: number): Ack {
  return ackOf(saved.version, status, now, staleAfterSec, (report) => {
    if (!report.aiLines) return null
    const off = new Set(saved.linesOff)
    return report.aiLines.every((l) => l.enabled === !off.has(l.ext))
  })
}

/* ── «Qoʻshimcha sozlamalar» ───────────────────────────────────────────── */

/** The tuning the agent reports, only the values it may hold — null when it sends none. */
export function reportedTuning(report: AiReport | null | undefined): Partial<AiTuning> | null {
  const t: ReportTuning | null | undefined = report?.tuning
  if (!t) return null
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(TUNING_NUMBERS) as TuningNumberKey[]) {
    const v = t[k]
    const { min, max } = TUNING_NUMBERS[k]
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) out[k] = v
  }
  if (t.transferOrder && (TRANSFER_ORDERS as readonly string[]).includes(t.transferOrder)) out.transferOrder = t.transferOrder
  if (t.whyUs && (WHY_US_MODES as readonly string[]).includes(t.whyUs)) out.whyUs = t.whyUs
  return out as Partial<AiTuning>
}

/** Where the form starts: the saved tuning; else what the agent runs; else the server's .env of 2026-11-04. */
export function tuningStart(saved: AiTuning | null, report: AiReport | null | undefined): AiTuning {
  if (saved) return saved
  return { ...DEFAULT_TUNING, ...(reportedTuning(report) ?? {}) }
}

/** «jami 10 marta» — again-calls a day times the days. */
export const totalAttempts = (t: Pick<AiTuning, 'attemptsPerDay' | 'retryDays'>) => t.attemptsPerDay * t.retryDays

/** Saved tuning against what the agent runs — null saved: nothing to compare. */
export function tuningAck(saved: { readonly tuning: AiTuning | null; readonly version: number }, status: AiStatus | null, now: Date, staleAfterSec: number): Ack | null {
  if (saved.tuning === null) return null
  const tuning = saved.tuning
  return ackOf(saved.version, status, now, staleAfterSec, (report) => {
    const runs = reportedTuning(report)
    if (runs === null) return null
    return tuningDiff(tuning, { ...tuning, ...runs }).length === 0
  })
}

/** The form's problems, every one — the agent refuses the whole config over one. */
export const tuningFormProblems = (t: AiTuning) => tuningProblems(t)

export { ACTION_LABEL, TUNING_KEYS }
