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

/**
 * The board's colours, by meaning. Red is for a real problem only (a line the
 * ATS does not know) — a seller on a call is the floor working, `active`
 * (the owner, 31.10: «qizil — faqat haqiqiy muammo uchun»); a failed put-
 * through is a warning in orange, `caution`, not an alarm.
 */
export type Tone = 'good' | 'warning' | 'critical' | 'neutral' | 'active' | 'caution'

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

/** The line map's words for a line on a call — the AI's own, or handed to a seller over a bridge. */
const BUSY_WORDS = new Set(['call', 'seller_talk'])

/** Every AI line the report names — the line map and the live calls together — and how many are on a call. */
export function lineCount(report: AiReport): { readonly busy: number; readonly total: number } {
  const calls = new Set((report.live?.lines ?? []).map((c) => c.line))
  const all = new Set([...Object.keys(report.lines), ...calls])
  let busy = 0
  for (const line of all) if (calls.has(line) || BUSY_WORDS.has(report.lines[line] ?? '')) busy += 1
  return { busy, total: all.size }
}

/** «31%» of a whole, «—» of nothing. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'
}

export interface NowRow {
  readonly tone: Tone
  readonly title: string
  readonly detail: string | null
}

/**
 * The first thing the page says. A fresh report: the AI works (green). No
 * fresh one: outside the day or at lunch that is expected (grey); within the
 * day it is the alarm (red) — the agent stopped or cannot reach the dashboard.
 */
export function nowRow(status: AiStatus | null, now: Date, staleAfterSec: number): NowRow {
  if (status && isFresh(status, now, staleAfterSec)) return { tone: 'good', title: 'AI ishlayapti', detail: null }
  const last = status ? `oxirgi xabar ${whenText(status.receivedAt, now)}` : null
  switch (workPhase(now)) {
    case 'off':
      return { tone: 'neutral', title: 'Ish vaqti emas (09:00–18:30)', detail: last }
    case 'lunch':
      return { tone: 'neutral', title: 'Tushlik 12:30–13:30', detail: last }
    default:
      return { tone: 'critical', title: `AI javob bermayapti — ${last ?? 'hali xabar kelmagan'}`, detail: null }
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

/** «4 yangi lid + 2 nedozvon» — how the calls at a time split, or null when they do not. */
export function limitsSplit(limits: AiLimits): string | null {
  const text = limitsText(limits)
  const i = text?.indexOf(' = ') ?? -1
  return text && i >= 0 ? text.slice(i + 3) : null
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

/* ── Lines ──────────────────────────────────────────────────────────── */

/** «00:42», «12:03», «1:02:03» since an instant — the board's big timer. */
export function elapsedText(sinceIso: string, now: Date): string {
  const total = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

export type Product = 'Collagen' | 'Zextra'

/** The agent says «Kollagen» / «Zekstra»; the dashboard's names are Collagen and Zextra (`targetTheme.ts`). */
const PRODUCT_OF: Readonly<Record<string, Product>> = { Kollagen: 'Collagen', Collagen: 'Collagen', Zekstra: 'Zextra', Zextra: 'Zextra' }

export function productOf(product: string | null | undefined): Product | null {
  return product ? (PRODUCT_OF[product] ?? null) : null
}

/**
 * A seller's name as the floor says it: «Dilshoda», surname apart. Bitrix24
 * spells them «122 Dilshoda Quldosheva 122», «131 Namozjon -131 Shamsiyev» —
 * the extension and its dashes are dropped wherever they stand, and any other
 * bare number with them.
 */
export function sellerName(ext: string, raw: string | null | undefined): { readonly first: string | null; readonly last: string | null } {
  const words = (raw ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^[-–—.,:;]+|[-–—.,:;]+$/g, ''))
    .filter((w) => w !== '' && w !== ext && !/^\d+$/.test(w))
  return { first: words[0] ?? null, last: words.length > 1 ? words.slice(1).join(' ') : null }
}

/** «122 Dilshoda», or «122» when nobody's name is known. */
export function sellerLabel(ext: string, nameOf: (ext: string) => string | null): string {
  const { first } = sellerName(ext, nameOf(ext))
  return first ? `${ext} ${first}` : ext
}

/** What a busy line does, in the floor's words. */
const CALL_STATE: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  dialing: { label: 'Mijozga terilmoqda', tone: 'neutral' },
  talking: { label: 'Mijoz bilan gaplashyapti', tone: 'active' },
  transfer: { label: 'Mijoz kutyapti — boʻsh sotuvchi qidirilmoqda', tone: 'warning' },
  ringing_seller: { label: 'Sotuvchiga ulanyapti', tone: 'warning' },
  with_seller: { label: 'Sotuvchi bilan', tone: 'good' },
}

/** The line map alone, for an agent before `live` (ai_registrator e07df24 reaches the server after 18:30, 31.10). */
const MAP_STATE: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  call: { label: 'Qoʻngʻiroqda', tone: 'active' },
  seller_talk: { label: 'Mijoz sotuvchi bilan', tone: 'good' },
}

export interface BusyLine {
  readonly line: string
  /** True: the agent said who and whom; false: only that the line is on a call. */
  readonly live: boolean
  readonly state: string
  readonly label: string
  readonly tone: Tone
  readonly since: string | null
  readonly client: string | null
  readonly deal: number | null
  readonly product: Product | null
  readonly test: boolean
  readonly seller: { readonly ext: string; readonly label: string } | null
}

export interface Board {
  /** On a call, in number order — the big cards. */
  readonly busy: readonly BusyLine[]
  /** Free, in number order — one dim row. */
  readonly free: readonly string[]
  /** Not registered on the ATS — the one real problem a line has. */
  readonly unregistered: readonly string[]
  /** A word the panel does not know yet, raw. */
  readonly other: readonly { readonly line: string; readonly word: string }[]
}

const byNumber = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b)

/** Every AI line — the line map and the live calls together — sorted into the board. */
export function boardOf(report: AiReport, nameOf: (ext: string) => string | null): Board {
  const calls = new Map((report.live?.lines ?? []).map((c) => [c.line, c]))
  const lines = [...new Set([...Object.keys(report.lines), ...calls.keys()])].sort(byNumber)
  const busy: BusyLine[] = []
  const free: string[] = []
  const unregistered: string[] = []
  const other: { line: string; word: string }[] = []
  for (const line of lines) {
    const call = calls.get(line)
    if (call) {
      const look = CALL_STATE[call.state] ?? { label: call.state, tone: 'neutral' as const }
      busy.push({
        line,
        live: true,
        state: call.state,
        ...look,
        since: call.since,
        client: call.client || null,
        deal: call.deal,
        product: productOf(call.product),
        test: call.test,
        seller: call.seller ? { ext: call.seller, label: sellerLabel(call.seller, nameOf) } : null,
      })
      continue
    }
    const word = report.lines[line] ?? 'unknown'
    const mapped = MAP_STATE[word]
    if (mapped) busy.push({ line, live: false, state: word, ...mapped, since: null, client: null, deal: null, product: null, test: false, seller: null })
    else if (word === 'free') free.push(line)
    else if (word === 'not_registered') unregistered.push(line)
    else other.push({ line, word })
  }
  return { busy, free, unregistered, other }
}

/* ── Sellers ──────────────────────────────────────────────────────────── */

const SELLER_WORD: Readonly<Record<string, { readonly tone: Tone; readonly label: string }>> = {
  free: { tone: 'good', label: 'Boʻsh' },
  busy: { tone: 'active', label: 'Gaplashyapti' },
  offline: { tone: 'neutral', label: 'Liniyada yoʻq' },
  unknown: { tone: 'neutral', label: 'Nomaʼlum' },
}

/** A seller now: one of the AI's calls ringing them comes first, then on a call, free, off the line. */
export function sellerLook(seller: Pick<ReportSeller, 'state' | 'aiRinging'>): { readonly tone: Tone; readonly label: string } {
  if (seller.aiRinging) return { tone: 'warning', label: 'AI jiringlatmoqda' }
  return SELLER_WORD[seller.state] ?? { tone: 'neutral', label: seller.state }
}

export interface SellerItem {
  readonly ext: string
  readonly first: string | null
  readonly last: string | null
  readonly transfersToday: number
  readonly product: Product | null
}

export interface SellerGroup {
  readonly key: 'ringing' | 'busy' | 'free' | 'offline' | 'unknown'
  readonly label: string
  readonly tone: Tone
  readonly sellers: readonly SellerItem[]
}

/**
 * The sellers by what they do now, in the order the eye needs them: the AI
 * ringing one, on a call, free, off the line — every group drawn even when
 * empty, so the columns stand still between polls. A report that is no
 * longer fresh says nothing about now: every seller is «holat nomaʼlum».
 */
export function sellerGroups(sellers: readonly ReportSeller[], fresh: boolean): SellerGroup[] {
  const item = (s: ReportSeller): SellerItem => ({ ext: s.ext, ...sellerName(s.ext, s.name), transfersToday: s.transfersToday, product: productOf(s.product) })
  const listed = sellers.filter((s) => s.inList)
  if (!fresh) return [{ key: 'unknown', label: 'Holat nomaʼlum', tone: 'neutral', sellers: listed.map(item) }]
  const keyOf = (s: ReportSeller): SellerGroup['key'] =>
    s.aiRinging ? 'ringing' : s.state === 'busy' ? 'busy' : s.state === 'free' ? 'free' : s.state === 'offline' ? 'offline' : 'unknown'
  const groups: SellerGroup[] = [
    { key: 'ringing', label: 'Jiringlamoqda (AI)', tone: 'warning', sellers: [] },
    { key: 'busy', label: 'Gaplashyapti', tone: 'active', sellers: [] },
    { key: 'free', label: 'Boʻsh', tone: 'good', sellers: [] },
    { key: 'offline', label: 'Liniyada yoʻq', tone: 'neutral', sellers: [] },
  ]
  const unknown = listed.filter((s) => keyOf(s) === 'unknown')
  const filled = groups.map((g) => ({ ...g, sellers: listed.filter((s) => keyOf(s) === g.key).map(item) }))
  return unknown.length > 0 ? [...filled, { key: 'unknown', label: 'Nomaʼlum', tone: 'neutral', sellers: unknown.map(item) }] : filled
}

/* ── The feed ───────────────────────────────────────────────────────── */

const WHAT_LABEL: Readonly<Record<string, string>> = { connected: 'Ulandi', ended: 'Tugadi', ...OUTCOME_LABEL }

/** The agent's word for how a call ended, as the call drawer says it; a new word raw. */
export function whatLabel(what: string): string {
  return WHAT_LABEL[what] ?? what
}

export interface RecentRow {
  readonly key: string
  readonly time: string
  readonly line: string
  readonly client: string | null
  readonly deal: number | null
  readonly product: Product | null
  readonly test: boolean
  readonly seller: string | null
  /** Put through to a seller — the one green row. */
  readonly ok: boolean
  readonly result: string
}

/** The last put-throughs and the ends after an answer, newest first as the agent keeps them. */
export function recentRows(report: AiReport, nameOf: (ext: string) => string | null): RecentRow[] {
  return (report.live?.recent ?? []).map((e, i) => ({
    key: `${e.at}-${e.line}-${i}`,
    time: formatTime(e.at),
    line: e.line,
    client: e.client || null,
    deal: e.deal,
    product: productOf(e.product),
    test: e.test,
    seller: e.seller ? sellerLabel(e.seller, nameOf) : null,
    ok: e.what === 'connected',
    result: whatLabel(e.what),
  }))
}
