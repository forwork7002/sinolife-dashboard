import { webcrypto } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { Press } from '@/features/aiRegistrator/aiControlMoreLogic'
import { lineControlRows } from '@/features/aiRegistrator/aiControlMoreLogic'
import {
  lineAddState,
  lineFormProblems,
  lineProduct,
  lineStageLook,
  refusalText,
  sealLinePassword,
  zextraNote,
} from '@/features/aiRegistrator/aiLineAddLogic'
import type { AiLine, AiReport } from '@/features/aiRegistrator/aiLiveLogic'

/**
 * «AI liniya qoʻshish» (2026-11-06, T123): the form's sentences, its checks,
 * and the seal — a throwaway key made here, never the AI server's, and no ATS
 * anywhere (29.10: one failed login per IP in all).
 */

const NOW = new Date('2026-11-06T11:00:00Z')

const line = (ext: string, over: Partial<AiLine> = {}): AiLine => ({
  ext,
  pool: 'main',
  transport: 'udp',
  state: 'free',
  registration: 'Registered',
  enabled: true,
  ...over,
})

const KEY = { alg: 'RSA-OAEP-256' as const, spki: 'AAAA', id: 'k1' }

const report = (over: Partial<AiReport> = {}): AiReport =>
  ({
    at: NOW.toISOString(),
    appliedVersion: 1,
    applyError: null,
    limits: {},
    lines: {},
    sellers: [],
    today: { calls: 0, answered: 0, transferred: 0, transferFailed: 0, atsRejected: 0 },
    aiLines: [line('178'), line('290')],
    lineKey: KEY,
    lineAdd: { allowed: true, code: null, text: null },
    ...over,
  }) as AiReport

const press = (over: Partial<Press> = {}): Press => ({
  id: 9,
  kind: 'add_line',
  line: '298',
  requestedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  requestedBy: 'adminjon',
  state: null,
  text: null,
  answeredAt: null,
  ...over,
})

describe('lineAddState — may the form send now', () => {
  it('sends with a fresh report, the key and the agent\'s yes', () => {
    expect(lineAddState(report(), true, [], NOW)).toEqual({ allowed: true, why: null, key: KEY })
  })

  it('says why not: silent, older agent, no key, busy (one at a time), cooldown, bad password', () => {
    expect(lineAddState(report(), false, [], NOW).why).toMatch(/AIdan yangi xabar yoʻq/)
    expect(lineAddState(report({ lineKey: undefined }), true, [], NOW).why).toMatch(/hali bilmaydi/)
    expect(lineAddState(report({ lineKey: null }), true, [], NOW).why).toMatch(/kaliti yoʻq/)
    expect(lineAddState(report(), true, [press({ state: 'pending' })], NOW).why).toBe('Band — liniyalar bittadan qoʻshiladi: 298 hali qoʻshilmoqda — natijasini kuting.')
    const cooldown = report({ lineAdd: { allowed: false, code: 'cooldown', text: '12 daqiqadan keyin qoʻshing' } })
    expect(lineAddState(cooldown, true, [], NOW).why).toBe('Kutish — ATS yaqinda parolni rad etgan: 12 daqiqadan keyin qoʻshing')
    // an answered or stale press holds nothing
    expect(lineAddState(report(), true, [press({ state: 'refused' })], NOW).allowed).toBe(true)
    expect(lineAddState(report(), true, [press({ requestedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() })], NOW).allowed).toBe(true)
  })

  it('names the refusals in the floor\'s words, the agent\'s sentence after', () => {
    expect(refusalText('bad_password', 'qayta urinilmaydi')).toBe('ATS parolni qabul qilmadi — qayta urinilmaydi: qayta urinilmaydi')
    expect(refusalText('busy', null)).toBe('Band — liniyalar bittadan qoʻshiladi')
    expect(refusalText('new_word', 'shu sabab')).toBe('shu sabab')
    expect(refusalText(null, null)).toBe('AI serveri ruxsat bermadi')
  })
})

describe('lineFormProblems — before anything is sealed', () => {
  const form = { line: '298', password: 'Ab3!x_-9', product: 'Kollagen' as const, transport: 'udp' as const }
  const lines = [line('178'), line('290'), line('299', { stage: 'bad_password' })]
  it('takes a new number with a fine password, and a refused line again', () => {
    expect(lineFormProblems(form, lines, ['122'])).toEqual([])
    expect(lineFormProblems({ ...form, line: '299' }, lines, ['122'])).toEqual([])
  })

  it('refuses a bad number, 294, an AI line already, a seller, and a bad password', () => {
    expect(lineFormProblems({ ...form, line: '1' }, lines, [])).toEqual(['Ichki raqam 2–6 ta raqam boʻlsin.'])
    expect(lineFormProblems({ ...form, line: '294' }, lines, [])[0]).toMatch(/MicroSIPi/)
    expect(lineFormProblems({ ...form, line: '290' }, lines, [])[0]).toMatch(/allaqachon AI liniyasi/)
    expect(lineFormProblems({ ...form, line: '122' }, lines, ['122'])[0]).toMatch(/sotuvchi raqami/)
    expect(lineFormProblems({ ...form, password: 'a;b' }, lines, [])[0]).toMatch(/qabul qilmaydi/)
  })
})

describe('the lines\' list — each line\'s step and «Olib tashlash»', () => {
  it('reads pending / registered / rad / removing, and the product from the agent\'s word', () => {
    expect(lineStageLook({ stage: 'registering', source: 'panel' })).toEqual({ label: 'ATSga ulanmoqda…', tone: 'warning' })
    expect(lineStageLook({ stage: 'active', source: 'panel' })).toEqual({ label: 'Qoʻshildi ✓', tone: 'good' })
    expect(lineStageLook({ stage: 'bad_password', source: 'panel' })).toEqual({ label: 'Rad etildi — parol', tone: 'critical' })
    expect(lineStageLook({ stage: null, source: 'server' })).toBeNull()
    expect(lineProduct({ pool: 'zextra', product: 'Zekstra' })).toBe('Zextra')
    expect(lineProduct({ pool: 'main' })).toBe('Collagen')
  })

  it('offers removal of a panel line only, and no «Qayta ulash» for one the ATS refused', () => {
    const rows = lineControlRows(
      [line('178', { source: 'server', removable: false }), line('298', { source: 'panel', stage: 'bad_password', registration: 'none', state: 'off', removable: true })],
      [],
      [],
      NOW,
    )
    expect(rows[0]).toMatchObject({ removable: false, stage: null })
    expect(rows[1]).toMatchObject({ removable: true, canReregister: false, registration: { label: 'Ulanmagan', tone: 'neutral' } })
    const waiting = lineControlRows([line('298', { removable: true })], [], [press({ kind: 'remove_line' })], NOW)
    expect(waiting[0]!.removable).toBe(false)
  })

  it('says Zextra waits for its sellers', () => {
    expect(zextraNote(report({ zextra: { on: false, lines: [], sellers: [], maxCalls: null, waiting: 'no_zextra_lines' } }))).toMatch(/sotuvchilari hali berilmagan/)
    expect(zextraNote(report({ zextra: { on: true, lines: ['298'], sellers: ['150'], maxCalls: 1, waiting: null } }))).toBeNull()
  })
})

describe('sealLinePassword — only the sealed text leaves the browser', () => {
  it('seals {"line","password"} with RSA-OAEP-256 the way the AI server opens it', async () => {
    const subtle = webcrypto.subtle as unknown as SubtleCrypto
    const pair = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])
    const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64')
    const sealed = await sealLinePassword({ alg: 'RSA-OAEP-256', spki, id: 'test' }, '298', 'Ab3!x_-9', subtle)
    expect(sealed).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(sealed).not.toContain('Ab3!x_-9')
    const plain = await subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, Buffer.from(sealed, 'base64'))
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({ line: '298', password: 'Ab3!x_-9' })
  })
})
