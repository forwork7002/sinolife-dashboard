import { OUTCOME_LABEL } from '@/features/aiRegistrator/AiCallsDrawer'
import { APP_TIME_ZONE, formatDateTime, formatTime, tashkentDay } from '@/lib/format'

/**
 * «AI registrator → Boshqaruv» as a live board (2026-10-31, the owner:
 * «qaysi SIP'lardan, kim kimga ulanayapti, real vaqtda … aniq koʻrsatilgan
 * tizim»): what the page says about the agent's last report — whether the AI
 * answers at all, what each of its lines does, which seller it rings, the last
 * put-throughs. Pure, so each sentence is pinned by a test.
 *
 * The report is `AiStatusPush` (`server/integrations/aiRegistrator/control.ts`)
 * — mirrored here by hand; nothing checks the mirror. `live`, `product` and
 * `aiRinging` are optional: a row stored before they existed reads without.
 */

export type Tone = 'good' | 'warning' | 'critical' | 'neutral'

export interface LiveCall {
  readonly line: string
  readonly deal: number | null
  readonly product: string | null
  readonly client: string
  readonly test: boolean
  readonly state: string
  readonly since: string
  readonly seller: string | null
  readonly connected?: boolean
}

export interface LiveEvent {
  readonly at: string
  readonly line: string
  readonly deal: number | null
  readonly product: string | null
  readonly client: string
  readonly test: boolean
  readonly what: string
  readonly seller: string | null
}

export interface ReportSeller {
  readonly ext: string
  readonly name: string | null
  readonly state: string
  readonly inList: boolean
  readonly transfersToday: number
  readonly product?: string | null
  readonly aiRinging?: boolean
}

export interface AiLimits {
  readonly calls?: number | null
  readonly maxNew?: number | null
  readonly maxRetry?: number | null
  readonly saleHandoff?: string | null
  readonly maxSipLegs?: number | null
  readonly fused?: boolean | null
}

export interface AiReport {
  readonly at: string
  readonly appliedVersion: number | null
  readonly applyError: string | null
  readonly limits: AiLimits
  readonly lines: Readonly<Record<string, string>>
  readonly sellers: readonly ReportSeller[]
  readonly live?: { readonly lines: readonly LiveCall[]; readonly recent: readonly LiveEvent[] } | null
  readonly today: {
    readonly calls: number
    readonly answered: number
    readonly transferred: number
    readonly transferFailed: number
    readonly atsRejected: number
  }
}

export interface AiStatus {
  readonly receivedAt: string
  readonly stale: boolean
  readonly report: AiReport
}

/* ── Work hours ─────────────────────────────────────────────────────────── */

/** The floor's day (the owner's spec, 2026-10-31): 09:00–18:30, lunch 12:30–13:30, Tashkent. */
export const WORK_HOURS = { from: 9 * 60, to: 18 * 60 + 30, lunchFrom: 12 * 60 + 30, lunchTo: 13 * 60 + 30 } as const

const TASHKENT_HM = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Minutes since Tashkent midnight. */
export function tashkentMinutes(at: Date): number {
  const parts = TASHKENT_HM.formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return value('hour') * 60 + value('minute')
}

export function workPhase(at: Date): 'work' | 'lunch' | 'off' {
  const m = tashkentMinutes(at)
  if (m < WORK_HOURS.from || m >= WORK_HOURS.to) return 'off'
  if (m >= WORK_HOURS.lunchFrom && m < WORK_HOURS.lunchTo) return 'lunch'
  return 'work'
}

/* ── «Hozir» ────────────────────────────────────────────────────────────── */

/** The report is the agent speaking now — not a picture of minutes ago. */
export function isFresh(status: AiStatus | null, now: Date, staleAfterSec: number): boolean {
  return status !== null && now.getTime() - new Date(status.receivedAt).getTime() <= staleAfterSec * 1000
}

/** «14:05» today, «30-okt, 18:31» another day — a stale report's time is read against today. */
function whenText(iso: string, now: Date): string {
  return tashkentDay(new Date(iso)) === tashkentDay(now) ? formatTime(iso) : formatDateTime(iso)
}

const IDLE_WORDS = new Set(['free', 'not_registered', 'unknown'])

/** Every AI line the report names — the line map and the live calls together — and how many are on a call. */
export function lineCount(report: AiReport): { readonly busy: number; readonly total: number } {
  const calls = new Set((report.live?.lines ?? []).map((c) => c.line))
  const all = new Set([...Object.keys(report.lines), ...calls])
  let busy = 0
  for (const line of all) if (calls.has(line) || !IDLE_WORDS.has(report.lines[line] ?? 'unknown')) busy += 1
  return { busy, total: all.size }
}

export interface NowRow {
  readonly tone: Tone
  readonly text: string
  readonly detail: string | null
}

/**
 * The first thing the page says. A fresh report: the AI works (green). No
 * fresh one: outside the day or at lunch that is expected (grey); within the
 * day it is the alarm (red) — the agent stopped or cannot reach the dashboard.
 */
export function nowRow(status: AiStatus | null, now: Date, staleAfterSec: number): NowRow {
  if (status && isFresh(status, now, staleAfterSec)) {
    const { busy, total } = lineCount(status.report)
    return { tone: 'good', text: total > 0 ? `AI ishlayapti · ${busy} liniya band / ${total}` : 'AI ishlayapti', detail: null }
  }
  const last = status ? `oxirgi xabar ${whenText(status.receivedAt, now)}` : null
  switch (workPhase(now)) {
    case 'off':
      return { tone: 'neutral', text: 'Ish vaqti emas (09:00–18:30)', detail: last }
    case 'lunch':
      return { tone: 'neutral', text: 'Tushlik (12:30–13:30)', detail: last }
    default:
      return { tone: 'critical', text: `AI javob bermayapti — ${last ?? 'hali xabar kelmagan'}`, detail: null }
  }
}

/** «Bir vaqtda 6 = 4 yangi lid + 2 nedozvon» — what the agent applies, not what was saved. */
export function limitsText(limits: AiLimits): string | null {
  if (limits.calls == null) return null
  const split = [
    limits.maxNew != null && limits.maxNew > 0 ? `${limits.maxNew} yangi lid` : null,
    limits.maxRetry != null && limits.maxRetry > 0 ? `${limits.maxRetry} nedozvon` : null,
  ].filter(Boolean)
  return split.length > 0 ? `Bir vaqtda ${limits.calls} = ${split.join(' + ')}` : `Bir vaqtda ${limits.calls}`
}

/**
 * «Saqlangan: 4/4/0 · AI qoʻllagani: 6/4/2 (v7)» when the saved form and the
 * applied limits differ — the agent still on its own setting, or on an older
 * version. Null when they agree, or before the agent says what it applies.
 */
export function limitsMismatch(
  saved: { readonly maxCalls: number; readonly maxNew: number; readonly maxRetry: number } | null,
  report: AiReport,
): string | null {
  const l = report.limits
  if (!saved || l.calls == null) return null
  const applied = [l.calls, l.maxNew ?? 0, l.maxRetry ?? 0]
  const form = [saved.maxCalls, saved.maxNew, saved.maxRetry]
  if (applied.every((v, i) => v === form[i])) return null
  const version = report.appliedVersion === null ? 'oʻz sozlamasi' : `v${report.appliedVersion}`
  return `Saqlangan: ${form.join('/')} · AI qoʻllagani: ${applied.join('/')} (${version})`
}

/* ── Lines ──────────────────────────────────────────────────────────────── */

/** «0:42», «12:03», «1:02:03» since an instant. */
export function elapsedText(sinceIso: string, now: Date): string {
  const total = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const PRODUCT_LABEL: Readonly<Record<string, string>> = { Kollagen: 'Kollagen', Zekstra: 'Zextra' }

export function productLabel(product: string | null | undefined): string | null {
  return product ? (PRODUCT_LABEL[product] ?? product) : null
}

/**
 * A seller's name without the extension it starts with: the roster spells
 * «122 Dilnoza …», and «Sotuvchi 122 (122 Dilnoza)» says the number twice.
 */
export function shortName(ext: string, name: string | null | undefined): string | null {
  const n = name?.trim() ?? ''
  const rest = n.startsWith(ext) ? n.slice(ext.length).replace(/^[\s.,:;\-–—]+/, '') : n
  return rest === '' ? null : rest
}

/** «120 (Dilnoza)», or «120» when nobody's name is known. */
export function sellerLabel(ext: string, nameOf: (ext: string) => string | null): string {
  const name = shortName(ext, nameOf(ext))
  return name ? `${ext} (${name})` : ext
}

/** The line map's words, for a line with no live call behind it (an agent before `live`, or between calls). */
const LINE_WORD: Readonly<Record<string, { readonly tone: Tone; readonly text: string }>> = {
  free: { tone: 'good', text: 'Boʻsh' },
  call: { tone: 'warning', text: 'Qoʻngʻiroqda' },
  seller_talk: { tone: 'warning', text: 'Mijoz sotuvchi bilan gaplashyapti' },
  not_registered: { tone: 'critical', text: 'ATSʼda roʻyxatda emas' },
  unknown: { tone: 'neutral', text: 'Nomaʼlum' },
}

export interface LineView {
  readonly line: string
  readonly tone: Tone
  readonly text: string
  readonly busy: boolean
  readonly product: string | null
  readonly deal: number | null
  readonly test: boolean
}

function callText(call: LiveCall, nameOf: (ext: string) => string | null, now: Date): { tone: Tone; text: string } {
  const t = elapsedText(call.since, now)
  const client = call.client || 'mijoz'
  const seller = call.seller ? sellerLabel(call.seller, nameOf) : null
  switch (call.state) {
    case 'dialing':
      return { tone: 'neutral', text: `Mijozga terilmoqda${call.client ? ` · ${call.client}` : ''} · ${t}` }
    case 'talking':
      return { tone: 'warning', text: [`AI ↔ ${client}`, productLabel(call.product), t].filter(Boolean).join(' · ') }
    case 'transfer':
      return { tone: 'warning', text: `Mijoz kutyapti — boʻsh sotuvchi qidirilmoqda · ${t}` }
    case 'ringing_seller':
      return { tone: 'warning', text: `Sotuvchi ${seller ?? '?'} ga jiringlayapti · ${t}` }
    case 'with_seller':
      return { tone: 'good', text: `Sotuvchi ${seller ?? '?'} bilan ulandi · ${t}` }
    default:
      return { tone: 'neutral', text: `${call.state} · ${t}` }
  }
}

/** One card per AI line — the line map and the live calls together, in number order. */
export function lineViews(report: AiReport, nameOf: (ext: string) => string | null, now: Date): LineView[] {
  const calls = new Map((report.live?.lines ?? []).map((c) => [c.line, c]))
  const lines = [...new Set([...Object.keys(report.lines), ...calls.keys()])].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  )
  return lines.map((line) => {
    const call = calls.get(line)
    if (call) {
      return { line, ...callText(call, nameOf, now), busy: true, product: call.product, deal: call.deal, test: call.test }
    }
    const word = report.lines[line] ?? 'unknown'
    const look = LINE_WORD[word] ?? { tone: 'neutral' as const, text: word }
    return { line, ...look, busy: !IDLE_WORDS.has(word), product: null, deal: null, test: false }
  })
}

/* ── Sellers ────────────────────────────────────────────────────────────── */

const SELLER_WORD: Readonly<Record<string, { readonly tone: Tone; readonly label: string }>> = {
  free: { tone: 'good', label: 'Boʻsh' },
  busy: { tone: 'critical', label: 'Gaplashyapti' },
  offline: { tone: 'neutral', label: 'Liniyada yoʻq' },
  unknown: { tone: 'neutral', label: 'Nomaʼlum' },
}

/** A seller now: one of the AI's calls ringing them comes first, then on a call, free, off the line. */
export function sellerLook(seller: Pick<ReportSeller, 'state' | 'aiRinging'>): { readonly tone: Tone; readonly label: string } {
  if (seller.aiRinging) return { tone: 'warning', label: 'AI jiringlatmoqda' }
  return SELLER_WORD[seller.state] ?? { tone: 'neutral', label: seller.state }
}

/* ── The feed ───────────────────────────────────────────────────────────── */

const WHAT_LABEL: Readonly<Record<string, string>> = { connected: 'ulandi', ended: 'tugadi', ...OUTCOME_LABEL }

export function whatLabel(what: string): string {
  const label = WHAT_LABEL[what]
  return label ? label.charAt(0).toLocaleLowerCase('uz') + label.slice(1) : what
}

export interface RecentView {
  readonly key: string
  readonly time: string
  readonly text: string
  readonly tone: Tone
  readonly deal: number | null
  readonly test: boolean
}

/** «10:42 · 291 → 120 (Dilnoza) · Kollagen · Aziz — ulandi», newest first as the agent keeps them. */
export function recentViews(report: AiReport, nameOf: (ext: string) => string | null): RecentView[] {
  return (report.live?.recent ?? []).map((e, i) => {
    const route = e.seller ? `${e.line} → ${sellerLabel(e.seller, nameOf)}` : e.line
    const text = [route, productLabel(e.product), e.client || null].filter(Boolean).join(' · ')
    const tone: Tone = e.what === 'connected' ? 'good' : e.what === 'transfer_failed' ? 'critical' : 'neutral'
    return { key: `${e.at}-${e.line}-${i}`, time: formatTime(e.at), text: `${text} — ${whatLabel(e.what)}`, tone, deal: e.deal, test: e.test }
  })
}
