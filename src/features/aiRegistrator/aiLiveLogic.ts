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
  /** The whole call's start (2026-11-02); `since` is when its current state began. */
  readonly started?: string
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
  readonly started?: string
}

export interface ReportSeller {
  readonly ext: string
  readonly name: string | null
  readonly state: string
  readonly inList: boolean
  readonly transfersToday: number
  readonly product?: string | null
  readonly aiRinging?: boolean
  /** The ATS presence word and since when (2026-11-02). */
  readonly word?: string | null
  readonly since?: string | null
}

export interface AiLimits {
  readonly calls?: number | null
  readonly maxNew?: number | null
  readonly maxRetry?: number | null
  readonly saleHandoff?: string | null
  readonly maxSipLegs?: number | null
  readonly fused?: boolean | null
  readonly transferOrder?: string | null
}

/** Why the agent is not dialling (2026-11-02) — each a yes / no. */
export interface AiFlags {
  readonly held?: boolean
  /** Stopped from the panel («Toʻxtatish», 2026-11-04). */
  readonly stopped?: boolean
  readonly ats_paused?: boolean
  readonly credits_out?: boolean
  readonly no_specialist?: boolean
  readonly no_free_specialist?: boolean
  readonly legs_full?: boolean
  readonly fused?: boolean
  readonly active_calls?: number
}

export interface AiReport {
  readonly at: string
  readonly appliedVersion: number | null
  readonly applyError: string | null
  /** What the agent applied: false = stopped. Absent — an agent older than the stop button. */
  readonly enabled?: boolean
  readonly limits: AiLimits
  readonly lines: Readonly<Record<string, string>>
  readonly sellers: readonly ReportSeller[]
  readonly live?: { readonly lines: readonly LiveCall[]; readonly recent: readonly LiveEvent[]; readonly events?: readonly LiveEvent[] } | null
  readonly flags?: AiFlags | null
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
  if (status && isFresh(status, now, staleAfterSec)) {
    return agentEnabled(status.report) === false
      ? { tone: 'critical', title: 'AI toʻxtatilgan', detail: 'Boshqaruvdan toʻxtatilgan — yangi lidlarga qoʻngʻiroq qilmaydi.' }
      : { tone: 'good', title: 'AI ishlayapti', detail: null }
  }
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

/** «limit 5 (4 yangi + 1 nedozvon)» — the status line's word for what the agent applies. */
export function limitShort(limits: AiLimits): string | null {
  if (limits.calls == null) return null
  const split = [
    limits.maxNew != null && limits.maxNew > 0 ? `${limits.maxNew} yangi` : null,
    limits.maxRetry != null && limits.maxRetry > 0 ? `${limits.maxRetry} nedozvon` : null,
  ].filter(Boolean)
  return split.length > 0 ? `limit ${limits.calls} (${split.join(' + ')})` : `limit ${limits.calls}`
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

export interface LineRow {
  readonly line: string
  /** busy: on a call (a live call, or `call` / `seller_talk` in the map); the rest one dim row each. */
  readonly kind: 'busy' | 'free' | 'unregistered' | 'other'
  /** True: the agent said who and whom; false: only the line map's word. */
  readonly live: boolean
  readonly state: string
  readonly label: string
  readonly tone: Tone
  readonly since: string | null
  /** The whole call's start when the agent sends it (2026-11-02) — the lane's timer; else `since`. */
  readonly started: string | null
  readonly client: string | null
  readonly deal: number | null
  /** The call's product, else the one this line was last seen with — its group. */
  readonly product: Product | null
  readonly test: boolean
  readonly seller: { readonly ext: string; readonly label: string } | null
}

const byNumber = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b)

/**
 * Which product each AI line serves, as far as the report shows: its live
 * call, else its newest put-through, else what was learnt before. Zextra's
 * lines are the agent's own setting (`ZEXTRA_EXTENSIONS`) and never sent, so
 * the panel learns them from the calls and keeps them — a row that found its
 * group stays there between polls.
 */
export function learnProducts(report: AiReport, known: ReadonlyMap<string, Product>): Map<string, Product> {
  const next = new Map(known)
  for (const e of [...(report.live?.recent ?? [])].reverse()) {
    const p = productOf(e.product)
    if (p) next.set(e.line, p)
  }
  for (const c of report.live?.lines ?? []) {
    const p = productOf(c.product)
    if (p) next.set(c.line, p)
  }
  return next
}

/**
 * Every AI line, one row each, in an order that stands still: Collagen's lines
 * (and any not yet known) by number, then Zextra's by number. A line on a call
 * says who, which seller and how long; the others one word.
 */
export function lineRows(report: AiReport, nameOf: (ext: string) => string | null, products: ReadonlyMap<string, Product>): LineRow[] {
  const calls = new Map((report.live?.lines ?? []).map((c) => [c.line, c]))
  const lines = [...new Set([...Object.keys(report.lines), ...calls.keys()])]
  const rows = lines.map((line): LineRow => {
    const call = calls.get(line)
    const product = productOf(call?.product) ?? products.get(line) ?? null
    if (call) {
      const look = CALL_STATE[call.state] ?? { label: call.state, tone: 'neutral' as const }
      return {
        line,
        kind: 'busy',
        live: true,
        state: call.state,
        ...look,
        since: call.since,
        started: call.started ?? null,
        client: call.client || null,
        deal: call.deal,
        product,
        test: call.test,
        seller: call.seller ? { ext: call.seller, label: sellerLabel(call.seller, nameOf) } : null,
      }
    }
    const word = report.lines[line] ?? 'unknown'
    const idle = { line, live: false, state: word, since: null, started: null, client: null, deal: null, product, test: false, seller: null }
    const mapped = MAP_STATE[word]
    if (mapped) return { ...idle, kind: 'busy', ...mapped }
    if (word === 'free') return { ...idle, kind: 'free', label: 'Boʻsh', tone: 'neutral' }
    if (word === 'not_registered') return { ...idle, kind: 'unregistered', label: 'ATSʼda roʻyxatda emas', tone: 'critical' }
    return { ...idle, kind: 'other', label: word, tone: 'neutral' }
  })
  const zextra = (r: LineRow) => (r.product === 'Zextra' ? 1 : 0)
  return rows.sort((a, b) => zextra(a) - zextra(b) || byNumber(a.line, b.line))
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
  /** Seconds from the call's start to the put-through, when the agent sends the start. */
  readonly waitedSec: number | null
}

const secondsBetween = (from: string | undefined, to: string): number | null => {
  if (!from) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null
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
    waitedSec: e.what === 'connected' ? secondsBetween(e.started, e.at) : null,
  }))
}

/* ── «Jonli lenta» — `live.events`, every step of every call (2026-11-02) ── */

/** The steps of a call that is still going; every other word is how a call ended (`OUTCOME_LABEL`). */
const STEP_LABEL: Readonly<Record<string, string>> = {
  dial: 'Terilmoqda',
  dialing: 'Terilmoqda',
  talking: 'AI gaplashyapti',
  transfer: 'Sotuvchi qidirilyapti',
  ringing_seller: 'Sotuvchiga ulanmoqda',
  connected: 'Ulandi',
}

/** What a step reads as: going (blue), put through (green), a dead end (orange), a refusal by the ATS (red). */
const FEED_TONE: Readonly<Record<string, Tone>> = {
  connected: 'good',
  interested_transferred: 'good',
  interested_callback: 'active',
  transfer_failed: 'caution',
  no_answer: 'caution',
  busy: 'caution',
  unreachable: 'caution',
  voicemail: 'caution',
  hung_up_early: 'caution',
  not_interested: 'neutral',
  ats_rejected: 'critical',
  error: 'critical',
}

export interface FeedRow {
  readonly key: string
  readonly time: string
  readonly line: string
  readonly client: string | null
  readonly deal: number | null
  readonly product: Product | null
  readonly test: boolean
  readonly seller: string | null
  readonly label: string
  readonly tone: Tone
}

/** The agent's last ≤50 events, newest first as it keeps them; empty from an agent that does not send them. */
export function feedRows(report: AiReport, nameOf: (ext: string) => string | null): FeedRow[] {
  return (report.live?.events ?? []).map((e, i) => ({
    key: `${e.at}-${e.line}-${e.what}-${i}`,
    time: formatTime(e.at),
    line: e.line,
    client: e.client || null,
    deal: e.deal,
    product: productOf(e.product),
    test: e.test,
    seller: e.seller ? sellerLabel(e.seller, nameOf) : null,
    label: STEP_LABEL[e.what] ?? whatLabel(e.what),
    tone: STEP_LABEL[e.what] && e.what !== 'connected' ? 'active' : (FEED_TONE[e.what] ?? 'neutral'),
  }))
}

/** «Koʻtarmadi» among the events the agent still keeps — the feed's own count, not the day's. */
export function feedNoAnswer(report: AiReport): number {
  return (report.live?.events ?? []).filter((e) => e.what === 'no_answer' && !e.test).length
}

/* ── Why the agent is not dialling — `flags` (2026-11-02) ───────────────── */

const FLAG_TEXT: readonly (readonly [keyof AiFlags, string])[] = [
  ['stopped', 'AI Boshqaruvdan toʻxtatilgan — «Yoqish» bilan qaytadi'],
  ['held', 'AI toʻxtatib qoʻyilgan'],
  ['ats_paused', 'ATS pauzada'],
  ['credits_out', 'Ovoz kreditlari tugagan'],
  ['no_specialist', 'Roʻyxatda ulanadigan sotuvchi yoʻq'],
  ['no_free_specialist', 'Hamma sotuvchi band — AI yangi qoʻngʻiroqni kutyapti'],
  ['legs_full', 'ATS liniyalari toʻla'],
  ['fused', 'Ehtiyot rejimi: ovoz yoʻqolgani uchun AI bittadan qoʻngʻiroq qilyapti'],
]

/** Each reason the agent gave for not dialling, in its words — empty when it gave none. */
export function flagReasons(flags: AiFlags | null | undefined): string[] {
  if (!flags) return []
  return FLAG_TEXT.filter(([key]) => flags[key] === true).map(([, text]) => text)
}

/** `limits.transferOrder` in words — shown only; the order is the agent's own setting. */
export function transferOrderText(order: string | null | undefined): string | null {
  if (!order) return null
  if (order === 'random') return 'tasodifiy tartibda'
  if (order === 'fewest') return 'bugun eng kam ulangan sotuvchidan boshlab'
  return order
}

/* ── «Hozir · jonli» — the lane each line draws (2026-11-02) ─────────────── */

/**
 * The owner's design canvas («Hisobot — jonli monitoring», 02.11: «koʻrinishi
 * menga yoqdi»): one lane per AI line — client, wire, AI, wire, seller — the
 * wires painted by what the line does. `.ai-lane[data-phase]` in globals.css.
 * Only what the agent reports: a line without a live call is free, on a call
 * by the map's word alone, or unknown to the ATS.
 */
export type LanePhase = 'idle' | 'dial' | 'ai' | 'queue' | 'xfer' | 'ok' | 'bad'

const LANE_OF_STATE: Readonly<Record<string, LanePhase>> = {
  dialing: 'dial',
  talking: 'ai',
  transfer: 'queue',
  ringing_seller: 'xfer',
  with_seller: 'ok',
  call: 'ai',
  seller_talk: 'ok',
  not_registered: 'bad',
}

export interface Lane {
  readonly phase: LanePhase
  /** The pill — the state in two or three words. */
  readonly label: string
  /** The sentence beside it: who, doing what, with whom. */
  readonly sentence: string
}

/** The seller's first name, else the extension — «Dilshoda», «122». */
const sellerShort = (seller: LineRow['seller']) => (seller ? (seller.label.split(' ').slice(1).join(' ') || seller.ext) : 'sotuvchi')

export function laneOf(row: LineRow): Lane {
  const phase = LANE_OF_STATE[row.state] ?? 'idle'
  const who = row.client ?? 'Mijoz'
  if (!row.live) {
    if (row.kind === 'free') return { phase, label: 'Boʻsh', sentence: 'Navbatdagi lidni kutyapti' }
    if (row.kind === 'unregistered') return { phase, label: 'ATS bilmaydi', sentence: 'Liniya ATSʼda roʻyxatda emas — MicroSIP ulanmagan' }
    if (row.kind === 'busy') return { phase, label: row.label, sentence: 'AI qoʻngʻiroqda — kim bilanligini yubormadi (sinov qoʻngʻirogʻi ham shunday koʻrinadi)' }
    return { phase, label: row.label, sentence: '' }
  }
  switch (row.state) {
    case 'dialing':
      return { phase, label: 'Terilmoqda', sentence: `AI ${who}ga qoʻngʻiroq qilyapti` }
    case 'talking':
      return { phase, label: 'AI gaplashyapti', sentence: `AI ${who} bilan suhbatlashyapti` }
    case 'transfer':
      return { phase, label: 'Sotuvchi kutilmoqda', sentence: `${who} tayyor — boʻsh sotuvchi qidirilyapti` }
    case 'ringing_seller':
      return { phase, label: 'Ulanmoqda', sentence: `${who}ni ${sellerShort(row.seller)}ga ulayapti` }
    case 'with_seller':
      return { phase, label: 'Ulandi', sentence: `${sellerShort(row.seller)} ${who} bilan gaplashyapti` }
    default:
      return { phase, label: row.label, sentence: '' }
  }
}

/**
 * The panel's one sentence: «2 ta terilmoqda · AI 1 kishi bilan gaplashyapti ·
 * 1 ta ulanmoqda · 1 ta sotuvchida», or that it is quiet. Counted from the
 * lanes, so the sentence and the lanes never disagree.
 */
export function liveHeadline(lanes: readonly Lane[]): string {
  const n = (p: LanePhase) => lanes.filter((l) => l.phase === p).length
  const parts = [
    n('dial') ? `${n('dial')} ta terilmoqda` : null,
    n('ai') ? `AI ${n('ai')} kishi bilan gaplashyapti` : null,
    n('queue') + n('xfer') ? `${n('queue') + n('xfer')} ta ulanmoqda` : null,
    n('ok') ? `${n('ok')} ta sotuvchida` : null,
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : 'Hozir jimjit — AI navbatdagi lidni kutyapti'
}

export interface SellerChip {
  readonly ext: string
  readonly first: string | null
  readonly state: SellerGroup['key']
  readonly note: string
  readonly transfersToday: number
  readonly product: Product | null
  /** Since when the ATS has the seller in this state (2026-11-02) — the chip's timer. */
  readonly since: string | null
}

/** A put-through counts as «this busy» when it landed within this of the seller's `since`. */
const WITH_AI_CLIENT_MS = 90_000

const CHIP_NOTE: Readonly<Record<SellerGroup['key'], string>> = {
  ringing: 'jiringlayapti',
  busy: 'band',
  free: 'boʻsh',
  offline: 'oflayn',
  unknown: 'nomaʼlum',
}

/**
 * Whom a busy seller talks to: the AI's client when one of its lines is with
 * them now, or a put-through to them landed around the moment their «busy»
 * began; else their own call. Only with `since` — without it, just «band».
 */
function busyNote(seller: ReportSeller, live: AiReport['live']): string {
  if (!seller.since) return CHIP_NOTE.busy
  if ((live?.lines ?? []).some((c) => c.seller === seller.ext && c.state === 'with_seller')) return 'AI mijozi bilan'
  const since = new Date(seller.since).getTime()
  const near = (live?.recent ?? []).some((e) => e.what === 'connected' && e.seller === seller.ext && Math.abs(new Date(e.at).getTime() - since) <= WITH_AI_CLIENT_MS)
  return near ? 'AI mijozi bilan' : 'oʻz qoʻngʻirogʻida'
}

/** The sellers in the agent's list as one row of chips, the AI-ringing one first, the offline ones last. */
export function sellerChips(sellers: readonly ReportSeller[], fresh: boolean, live: AiReport['live'] = null): SellerChip[] {
  const byExt = new Map(sellers.map((s) => [s.ext, s]))
  return sellerGroups(sellers, fresh).flatMap((g) =>
    g.sellers.map((s) => {
      const raw = byExt.get(s.ext)
      return {
        ext: s.ext,
        first: s.first,
        state: g.key,
        note: g.key === 'busy' && raw ? busyNote(raw, live) : CHIP_NOTE[g.key],
        transfersToday: s.transfersToday,
        product: s.product,
        since: fresh ? (raw?.since ?? null) : null,
      }
    }),
  )
}

/**
 * «Yangi» 0 and «nedozvon» 0 together is NOT a stop (the agent, ai_registrator
 * 164f2c1, 2026-11-02): to the agent it means «no split» — it dials ANY lead,
 * at the full «bir vaqtda». An owner who sets both to 0 to pause it would get
 * the opposite, so the agent refuses it and the panel does not let it be
 * saved. Mirrors `controlProblems` in `@/server/domain/aiRegistrator/control`
 * (the client may not import it) — edit both.
 */
export const BOTH_ZERO_PROBLEM =
  'Yangi lid va nedozvon ikkalasi birga 0 boʻlmaydi: bu AIni toʻxtatmaydi, aksincha boʻlinmasdan istalgan lidga teradi. Kamida bittasi 1 yoki koʻp boʻlsin.'

export function limitsProblem(maxNew: number, maxRetry: number): string | null {
  return maxNew === 0 && maxRetry === 0 ? BOTH_ZERO_PROBLEM : null
}

/**
 * The calls the agent can actually have at a time: the two shares are caps,
 * so when together they fall short of «bir vaqtda» the rest stand idle —
 * 4 / 0 / 2 is 2 calls, not 4 (the owner, 2026-11-02). Both 0 is refused, and
 * shown as 0 here rather than as the any-lead it would mean to the agent.
 */
export function effectiveCalls(maxCalls: number, maxNew: number, maxRetry: number): number {
  return Math.max(0, Math.min(maxCalls, maxNew + maxRetry))
}

/**
 * Did the agent take the SAVED version — `appliedVersion` against the
 * config's, `applyError` in red when it refused it. One reading for the status
 * card and the limits section, so the two never disagree.
 */
export function appliedAck(
  status: AiStatus | null,
  savedVersion: number,
): { readonly tone: 'good' | 'warning' | 'critical'; readonly text: string; readonly reason: string | null } {
  const report = status?.report
  if (!status || !report) return { tone: 'warning', text: 'AIʼdan hali xabar kelmagan', reason: null }
  if (report.applyError && report.appliedVersion !== savedVersion) {
    return { tone: 'critical', text: `AI rad etdi v${savedVersion}`, reason: report.applyError }
  }
  if (report.appliedVersion === savedVersion) return { tone: 'good', text: `AI qoʻlladi ✓ v${savedVersion}`, reason: null }
  return {
    tone: 'warning',
    text: `AI hali qoʻllamadi — hozir ${report.appliedVersion === null ? 'oʻz sozlamasi' : `v${report.appliedVersion}`} ishlayapti`,
    reason: null,
  }
}

/* ── «Toʻxtatish» / «Yoqish» (2026-11-04) ───────────────────────────────── */

/**
 * The state the agent says it applied: `enabled` (top level), and
 * `flags.stopped` beside it — stopped if either says so. Null when it sends
 * neither: an agent older than the button, which ignores `enabled` in the
 * config and keeps dialling.
 */
export function agentEnabled(report: AiReport | null | undefined): boolean | null {
  if (!report) return null
  const stopped = report.flags?.stopped
  if (typeof report.enabled === 'boolean') return report.enabled && stopped !== true
  if (typeof stopped === 'boolean') return !stopped
  return null
}

export interface SwitchState {
  /** `on` / `off` — saved = applied; `applying` — not yet; `old` — the agent cannot; `refused`; `silent` — no fresh report. */
  readonly kind: 'on' | 'off' | 'applying' | 'old' | 'refused' | 'silent'
  readonly tone: 'good' | 'warning' | 'critical' | 'neutral'
  readonly title: string
  readonly detail: string | null
}

const stateWord = (enabled: boolean) => (enabled ? 'ishlayapti' : 'toʻxtatilgan')

/**
 * What the stop card says — the SAVED state against what the agent APPLIED,
 * never one shown as the other:
 *  · no fresh report — the page's «AI javob bermayapti» rule (grey out of
 *    hours), with the saved state named as saved only;
 *  · the agent sends no `enabled` — it predates the button: a warning, the
 *    saved state not shown as applied (a stopped one keeps dialling there);
 *  · the agent refused the saved version — red, with its reason;
 *  · applied ≠ saved, or the saved version not taken yet — «qoʻllanmoqda…»;
 *  · else «Ishlayapti» (green) or «Toʻxtatilgan» (red).
 */
export function switchState(
  saved: { readonly enabled: boolean; readonly version: number },
  status: AiStatus | null,
  now: Date,
  staleAfterSec: number,
): SwitchState {
  const savedText = `Saqlangan: ${stateWord(saved.enabled)}`
  if (!status || !isFresh(status, now, staleAfterSec)) {
    const head = nowRow(status, now, staleAfterSec)
    const tone = head.tone === 'critical' ? 'critical' : 'neutral'
    return { kind: 'silent', tone, title: head.title, detail: `${savedText} — AI qoʻllaganini bilib boʻlmaydi.` }
  }
  const report = status.report
  const applied = agentEnabled(report)
  if (applied === null) {
    return {
      kind: 'old',
      tone: 'warning',
      title: 'AI bu tugmani hali qoʻllamaydi',
      detail: saved.enabled
        ? `${savedText}. AI serveri yangilanmaguncha toʻxtatish ishlamaydi.`
        : `${savedText}, lekin AI serveri buni bilmaydi va qoʻngʻiroq qilishda davom etadi.`,
    }
  }
  const taken = report.appliedVersion !== null && report.appliedVersion >= saved.version
  if (!taken && report.applyError) {
    return { kind: 'refused', tone: 'critical', title: `AI rad etdi v${saved.version}`, detail: `${report.applyError} — AIda hozir: ${stateWord(applied)}.` }
  }
  if (!taken || applied !== saved.enabled) {
    return { kind: 'applying', tone: 'warning', title: 'qoʻllanmoqda…', detail: `${savedText}, AIda hozir: ${stateWord(applied)}. AI 20 soniya ichida oʻqiydi.` }
  }
  return applied
    ? { kind: 'on', tone: 'good', title: 'Ishlayapti', detail: null }
    : { kind: 'off', tone: 'critical', title: 'Toʻxtatilgan', detail: 'Yangi lidlarga qoʻngʻiroq qilmaydi. 09:00 da ham oʻzi yonmaydi — faqat «Yoqish» bilan.' }
}
