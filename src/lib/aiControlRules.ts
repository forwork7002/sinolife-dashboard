/**
 * «AI registrator → Boshqaruv», the rest of the panel (2026-11-04 20:36, T144,
 * the owner: «boshqaruv bo'limini yanada kuchaytir: hamma narsani boshqara
 * olsin. Hozirgi soatlarni to'xtatib qo'yish funksiyalari, SIP bilan ishlash
 * va boshqa ko'proq boshqaruv imkoniyatlarini qo'sh»): the timed pause, the AI
 * lines switched off, and «Qoʻshimcha sozlamalar» (the call tuning).
 *
 * Shared vocabulary, ONE copy, as `aiWorkHours.ts`: the server checks a save
 * with it (`services/aiRegistratorControlService.ts`), the page checks the form
 * before it offers the button. THE RULES ARE THE AGENT'S OWN (ai_registrator
 * 2bc906f, `app/control.py` `check_pause` / `check_lines_off` / `check_tuning`):
 * a config that breaks one is refused WHOLE — sellers, limits and hours with
 * it (`applyError`) — so nothing that breaks one is ever saved.
 */

/* ── «Vaqtincha toʻxtatish» — `pauseUntil` ─────────────────────────────────── */

/** Longer than this is a stop («Toʻxtatish»), not a pause — the agent's `PAUSE_MAX`. */
export const PAUSE_MAX_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Why the agent would refuse a pause till `untilIso`, in the owner's words —
 * empty when it is fine. A time gone by is no pause to the agent (not a
 * refusal); here it is refused, because the owner meant some other time.
 */
export function pauseProblems(untilIso: string, now: Date): string[] {
  const at = new Date(untilIso)
  if (Number.isNaN(at.getTime())) return ['Pauza vaqti notoʻgʻri.']
  if (at.getTime() <= now.getTime()) return ['Pauza vaqti oʻtib ketgan — keyingi vaqtni tanlang.']
  if (at.getTime() - now.getTime() > PAUSE_MAX_MS) return ['Pauza 7 kundan uzoq boʻlmasin — uzoqroqqa «Toʻxtatish».']
  return []
}

/**
 * «2026-11-04T21:30:00+05:00» — an instant as Tashkent writes it, the offset
 * spelt out: the agent refuses a time without a zone. Tashkent has kept +05:00
 * all year since 1992 (no daylight saving), so the offset is a constant.
 */
export function tashkentIso(at: Date): string {
  const local = new Date(at.getTime() + 5 * 60 * 60 * 1000)
  return `${local.toISOString().slice(0, 19)}+05:00`
}

/* ── AI lines switched off — `linesOff` ───────────────────────────────────── */

/** One AI line as the agent reports it (`aiLines[]`) — what the rule needs of it. */
export interface AiLineRef {
  readonly ext: string
  /** «main» (Collagen) | «zextra». */
  readonly pool: string
}

/**
 * The lines switched off as the agent will read them: its own lines only (a
 * number no longer its is dropped, as the agent drops it), each once, by number.
 */
export function normalLinesOff(linesOff: readonly string[], lines: readonly AiLineRef[]): string[] {
  const ours = new Set(lines.map((l) => l.ext))
  return [...new Set(linesOff.map((s) => s.trim()))].filter((s) => ours.has(s)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
}

/** The agent's `check_lines_off`: one main (Collagen) line at least stays on — none on is a stop, not a line. */
export function linesOffProblems(linesOff: readonly string[], lines: readonly AiLineRef[]): string[] {
  const off = new Set(linesOff)
  const main = lines.filter((l) => l.pool !== 'zextra')
  if (main.length > 0 && main.every((l) => off.has(l.ext))) {
    return ['Kamida bitta asosiy (Collagen) AI liniyasi yoqiq boʻlsin — AIni toʻxtatish uchun «Toʻxtatish».']
  }
  return []
}

/* ── «Qoʻshimcha sozlamalar» — `tuning` ───────────────────────────────────── */

export const TRANSFER_ORDERS = ['random', 'fewest'] as const
export type TransferOrder = (typeof TRANSFER_ORDERS)[number]
export const WHY_US_MODES = ['off', 'test', 'on'] as const
export type WhyUs = (typeof WHY_US_MODES)[number]

/** The agent's call tuning, all seven sent together once saved here. */
export interface AiTuning {
  /** Again-calls a day to a client who did not answer (1–10). */
  readonly attemptsPerDay: number
  /** On how many days (1–5); the agent's total is the product. */
  readonly retryDays: number
  /** «random» — a random free seller; «fewest» — the one put through to least today. */
  readonly transferOrder: TransferOrder
  /** How long each seller is rung, seconds (10–40). */
  readonly ringSec: number
  /** A seller who did not answer or refused goes to the end of the queue for this long, seconds (0–1800). */
  readonly missedSec: number
  /** From a new lead in Bitrix24 to its first call, seconds (0–600). */
  readonly firstCallDelaySec: number
  /** The «two reasons» before a put-through: off, test calls only, everyone. */
  readonly whyUs: WhyUs
}

export type TuningNumberKey = 'attemptsPerDay' | 'retryDays' | 'ringSec' | 'missedSec' | 'firstCallDelaySec'

/** Each number's bounds — the agent's `TUNING_NUMBERS` — and its name on the page and in the audit. */
export const TUNING_NUMBERS: Readonly<Record<TuningNumberKey, { readonly label: string; readonly min: number; readonly max: number }>> = {
  attemptsPerDay: { label: 'Nedozvonga kuniga', min: 1, max: 10 },
  retryDays: { label: 'Nedozvon kunlari', min: 1, max: 5 },
  ringSec: { label: 'Sotuvchini jiringlatish', min: 10, max: 40 },
  missedSec: { label: 'Koʻtarmagan sotuvchi navbat oxirida', min: 0, max: 1800 },
  firstCallDelaySec: { label: 'Yangi lidga birinchi qoʻngʻiroq', min: 0, max: 600 },
}

export const TUNING_KEYS = ['attemptsPerDay', 'retryDays', 'transferOrder', 'ringSec', 'missedSec', 'firstCallDelaySec', 'whyUs'] as const

export const TUNING_LABEL: Readonly<Record<keyof AiTuning, string>> = {
  ...Object.fromEntries(Object.entries(TUNING_NUMBERS).map(([k, v]) => [k, v.label])),
  transferOrder: 'Ulash tartibi',
  whyUs: 'Ikki sabab (WHY_US)',
} as Record<keyof AiTuning, string>

export const TRANSFER_ORDER_LABEL: Readonly<Record<TransferOrder, string>> = {
  random: 'tasodifiy boʻsh sotuvchi',
  fewest: 'bugun eng kam olgan birinchi',
}

export const WHY_US_LABEL: Readonly<Record<WhyUs, string>> = {
  off: 'oʻchiq',
  test: 'faqat sinov qoʻngʻiroqlarida',
  on: 'hammaga',
}

/** The AI server's .env on 2026-11-04 — the form's start when neither a save nor the agent says otherwise. */
export const DEFAULT_TUNING: AiTuning = {
  attemptsPerDay: 5,
  retryDays: 2,
  transferOrder: 'random',
  ringSec: 15,
  missedSec: 600,
  firstCallDelaySec: 60,
  whyUs: 'on',
}

/** Why the agent would refuse this tuning, every problem named — its `check_tuning`. */
export function tuningProblems(tuning: AiTuning): string[] {
  const problems: string[] = []
  for (const [key, { label, min, max }] of Object.entries(TUNING_NUMBERS) as [TuningNumberKey, (typeof TUNING_NUMBERS)[TuningNumberKey]][]) {
    const v = tuning[key]
    if (!Number.isInteger(v) || v < min || v > max) problems.push(`${label}: ${min}–${max} oraligʻida butun son boʻlsin.`)
  }
  if (!TRANSFER_ORDERS.includes(tuning.transferOrder)) problems.push('Ulash tartibi: random yoki fewest boʻlsin.')
  if (!WHY_US_MODES.includes(tuning.whyUs)) problems.push('Ikki sabab (WHY_US): off, test yoki on boʻlsin.')
  return problems
}

/** The keys whose values differ — what a save changed, or what the agent runs otherwise. */
export function tuningDiff(a: Partial<AiTuning> | null | undefined, b: Partial<AiTuning> | null | undefined): (keyof AiTuning)[] {
  return TUNING_KEYS.filter((k) => (a?.[k] ?? null) !== (b?.[k] ?? null))
}

/** «10 daq», «1 daq 30 s», «45 s», «0» — a number of seconds as the page and the audit print it. */
export function secondsText(sec: number): string {
  if (sec === 0) return '0'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s} s`
  return s === 0 ? `${m} daq` : `${m} daq ${s} s`
}

/** One tuning value in words — «5 marta», «15 s», «tasodifiy boʻsh sotuvchi». */
export function tuningValueText(key: keyof AiTuning, value: AiTuning[keyof AiTuning] | null | undefined): string {
  if (value === null || value === undefined) return '—'
  switch (key) {
    case 'attemptsPerDay':
      return `${value} marta`
    case 'retryDays':
      return `${value} kun`
    case 'ringSec':
    case 'missedSec':
    case 'firstCallDelaySec':
      return secondsText(value as number)
    case 'transferOrder':
      return TRANSFER_ORDER_LABEL[value as TransferOrder] ?? String(value)
    case 'whyUs':
      return WHY_US_LABEL[value as WhyUs] ?? String(value)
  }
}

/* ── One-off presses — `actions` ─────────────────────────────────────────── */

export const ACTION_KINDS = ['reregister', 'tls_reset', 'add_line', 'remove_line'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

/** The agent does not do a press older than this (its `ACTION_MAX_AGE_SEC`): one waiting longer is lost. */
export const ACTION_MAX_AGE_MS = 10 * 60 * 1000

/** The agent reads at most this many from one config (`MAX_ACTIONS`). */
export const MAX_ACTIONS = 20

export const ACTION_LABEL: Readonly<Record<ActionKind, string>> = {
  reregister: 'Qayta ulash',
  tls_reset: 'TLSʼni yangilash',
  add_line: 'Liniya qoʻshish',
  remove_line: 'Olib tashlash',
}

/* ── «AI liniya qoʻshish» (T123) ─────────────────────────────────────────── */

/** The products a new line calls for — the agent's words. */
export const LINE_PRODUCTS = ['Kollagen', 'Zekstra'] as const
export type LineProduct = (typeof LINE_PRODUCTS)[number]

export const LINE_TRANSPORTS = ['udp', 'tls'] as const
export type LineTransport = (typeof LINE_TRANSPORTS)[number]

/** The owner's own MicroSIP — never an AI line (29.10). */
export const NEVER_AI_LINES: readonly string[] = ['294']

/**
 * What the agent takes as a SIP password (its `password_problem`): 1–64
 * printable ASCII, no space, none of «; [ ] \» — they break Asterisk's
 * config. Checked in the browser before it is sealed; null when fine.
 */
export function linePasswordProblem(password: string): string | null {
  if (password.length === 0) return 'Parolni kiriting.'
  if (password.length > 64) return 'Parol 64 belgidan uzun boʻlmasin.'
  if (!/^[!-~]+$/.test(password)) return 'Parolda boʻsh joy yoki lotin boʻlmagan harf bor — ATS paroli faqat lotin harf, raqam va belgilar.'
  if (/[;[\]\\]/.test(password)) return 'Parolda «;», «[», «]» yoki «\\» boʻlmasin — AI serveri uni qabul qilmaydi.'
  return null
}
