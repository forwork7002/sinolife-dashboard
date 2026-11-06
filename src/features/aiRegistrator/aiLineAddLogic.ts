import { ACTION_MAX_AGE_MS, LINE_PRODUCTS, type LineProduct, type LineTransport, NEVER_AI_LINES, linePasswordProblem } from '@/lib/aiControlRules'

import type { Press } from './aiControlMoreLogic'
import type { AiLine, AiLineKey, AiReport, Tone } from './aiLiveLogic'

/**
 * «AI registrator → Boshqaruv → AI liniya qoʻshish» (2026-11-06, T123): the
 * owner adds a MicroSIP line to the AI — its number, its password, Collagen
 * or Zextra — and removes one added here. The password is sealed IN THE
 * BROWSER with the AI server's public key (`lineKey`, RSA-OAEP-256), so ISH
 * stores, logs and answers only the sealed text — never the password.
 *
 * The shared ATS bans an IP after a few failed logins (29.10: one failure per
 * IP in all), so the AI server logs a new line in ONCE, one line at a time,
 * and never retries a refusal; the form says so before it sends. Pure, so
 * each sentence is pinned by a test.
 */

export const PRODUCT_LABEL: Readonly<Record<LineProduct, string>> = {
  Kollagen: 'Collagen',
  Zekstra: 'Zextra',
}

/** The pill's product of a line: its own word when the agent sends one, else its pool. */
export function lineProduct(line: Pick<AiLine, 'pool' | 'product'>): 'Collagen' | 'Zextra' {
  if (line.product === 'Zekstra') return 'Zextra'
  if (line.product === 'Kollagen') return 'Collagen'
  return line.pool === 'zextra' ? 'Zextra' : 'Collagen'
}

/** A panel line's step in the floor's words (pending / registered / rad / cooldown); null for a server line. */
export function lineStageLook(line: Pick<AiLine, 'stage' | 'source'>): { readonly label: string; readonly tone: Tone } | null {
  switch (line.stage) {
    case 'registering':
      return { label: 'ATSga ulanmoqda…', tone: 'warning' }
    case 'active':
      return { label: 'Qoʻshildi ✓', tone: 'good' }
    case 'bad_password':
      return { label: 'Rad etildi — parol', tone: 'critical' }
    case 'not_loaded':
      return { label: 'Yuklanmadi', tone: 'critical' }
    case 'removing':
      return { label: 'Olib tashlanmoqda…', tone: 'warning' }
    default:
      return line.source === 'panel' ? { label: 'Paneldan qoʻshilgan', tone: 'neutral' } : null
  }
}

/** The steps a line is out of Asterisk in, or on its way: no «Qayta ulash» for it. */
export const LINE_NOT_IN_USE = new Set(['registering', 'bad_password', 'not_loaded', 'removing'])

/** A guard word the agent refuses an add with, as the floor reads it — `busy`, `cooldown`, `bad_password` first. */
const REFUSAL_TITLE: Readonly<Record<string, string>> = {
  busy: 'Band — liniyalar bittadan qoʻshiladi',
  cooldown: 'Kutish — ATS yaqinda parolni rad etgan',
  too_soon: 'Kutish — ATSga ketma-ket ulanilmaydi',
  bad_password: 'ATS parolni qabul qilmadi — qayta urinilmaydi',
  ats_down: 'ATS bilan aloqa yoʻq',
  unknown: 'Liniyalar holati hali oʻqilmagan',
  too_many: 'Liniyalar soni chegarada',
  off: 'Bu serverda yoqilmagan',
}

/** «Band — liniyalar bittadan qoʻshiladi: 298 hali ATSga ulanmoqda …» — the agent's own sentence after the title. */
export function refusalText(code: string | null | undefined, text: string | null | undefined): string {
  const title = code ? REFUSAL_TITLE[code] : undefined
  const tail = text?.trim() || null
  if (title && tail) return `${title}: ${tail}`
  return title ?? tail ?? 'AI serveri ruxsat bermadi'
}

/** Whether the form may send now, and why not — read from the agent's last report and the open presses. */
export interface LineAddState {
  readonly allowed: boolean
  readonly why: string | null
  readonly key: AiLineKey | null
}

export function lineAddState(report: AiReport | null, fresh: boolean, presses: readonly Press[], now: Date): LineAddState {
  const no = (why: string): LineAddState => ({ allowed: false, why, key: null })
  if (!report || !fresh) return no('AIdan yangi xabar yoʻq — liniya AI serveri javob berib turganda qoʻshiladi.')
  if (report.lineKey === undefined || report.lineAdd === undefined) return no('AI serveri liniya qoʻshishni hali bilmaydi — u yangilangach shu yerda ishlaydi.')
  if (report.lineKey === null) return no('AI serverida parol kaliti yoʻq — liniya qoʻshib boʻlmaydi.')
  const open = presses.find((p) => p.kind === 'add_line' && (p.state === null || p.state === 'pending') && now.getTime() - new Date(p.requestedAt).getTime() <= ACTION_MAX_AGE_MS)
  if (open) return no(`${refusalText('busy', null)}: ${open.line ?? 'liniya'} hali qoʻshilmoqda — natijasini kuting.`)
  if (report.lineAdd && !report.lineAdd.allowed) return no(refusalText(report.lineAdd.code, report.lineAdd.text))
  return { allowed: true, why: null, key: report.lineKey }
}

export interface LineForm {
  readonly line: string
  readonly password: string
  readonly product: LineProduct
  readonly transport: LineTransport
}

/** The form's problems before anything is sealed: the number, the password, a line or seller already. */
export function lineFormProblems(form: LineForm, lines: readonly AiLine[], sellers: readonly string[]): string[] {
  const problems: string[] = []
  const ext = form.line.trim()
  if (!/^\d{2,6}$/.test(ext)) problems.push('Ichki raqam 2–6 ta raqam boʻlsin.')
  else if (NEVER_AI_LINES.includes(ext)) problems.push(`${ext} — egasining MicroSIPi, AI liniyasi boʻlmaydi.`)
  else if (lines.some((l) => l.ext === ext && l.stage !== 'bad_password' && l.stage !== 'not_loaded')) problems.push(`${ext} allaqachon AI liniyasi.`)
  else if (sellers.includes(ext)) problems.push(`${ext} — sotuvchi raqami (ulash roʻyxatida).`)
  const bad = linePasswordProblem(form.password)
  if (bad) problems.push(bad)
  if (!LINE_PRODUCTS.includes(form.product)) problems.push('Mahsulotni tanlang.')
  return problems
}

const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/**
 * The password sealed for the AI server: RSA-OAEP with SHA-256 of
 * `{"line","password"}` under its `lineKey`, base64 — what its
 * `LineKey.open` takes (the line inside, so a sealed text cannot be
 * replayed for another number). Only this leaves the browser.
 */
export async function sealLinePassword(key: AiLineKey, line: string, password: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const publicKey = await subtle.importKey('spki', fromBase64(key.spki), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const plain = new TextEncoder().encode(JSON.stringify({ line, password }))
  return toBase64(await subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, plain))
}

/** The note under the form when the line is Zextra and Zextra does not call yet. */
export function zextraNote(report: AiReport | null): string | null {
  const z = report?.zextra
  if (!z) return 'Zextra liniyasi Zextra sotuvchilari berilgunicha qoʻngʻiroq qilmaydi.'
  if (z.on) return null
  if (z.sellers.length === 0) return 'Zextra sotuvchilari hali berilmagan — Zextra liniyasi ular berilgunicha qoʻngʻiroq qilmaydi.'
  return 'Zextra qoʻngʻiroqlari hali yoqilmagan — liniya qoʻshiladi, qoʻngʻiroq qilmaydi.'
}
