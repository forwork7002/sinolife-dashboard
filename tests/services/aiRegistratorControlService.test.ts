import { describe, expect, it } from 'vitest'

import type { ControlChange, ControlSettings } from '@/server/domain/aiRegistrator/control'
import { ApiError } from '@/server/http/errors'
import {
  type ActionAnswer,
  type AiRegistratorControlRepository,
  type StoredAction,
  type StoredChange,
  type StoredConfig,
  type StoredStatus,
  StaleVersionError,
} from '@/server/repositories/aiRegistratorControlRepository'
import { AiRegistratorControlService, changeLines } from '@/server/services/aiRegistratorControlService'

/**
 * «Toʻxtatish» / «Yoqish» (2026-11-04, the owner: «ai boshqaruvda ai
 * registratorni oʻchirib toʻxtatish funksiyasi ham boʻlsin»): the stop is its
 * own save — only `enabled` changes — and «Saqlash» never switches it back.
 */

const stored = (over: Partial<StoredConfig> = {}): StoredConfig => ({
  version: 7,
  sellers: ['122', '120'],
  parked: ['128'],
  maxCalls: 4,
  maxNew: 3,
  maxRetry: 1,
  saleHandoff: 'refer',
  enabled: true,
  hours: null,
  pauseUntil: null,
  linesOff: [],
  tuning: null,
  updatedAt: new Date('2026-11-04T09:00:00Z'),
  updatedBy: 'adminjon',
  ...over,
})

interface Written {
  readonly settings: ControlSettings
  readonly baseVersion: number
  readonly by: { label: string; userId: string }
  readonly changes: readonly ControlChange[]
}

function fake(
  config: StoredConfig | null,
  opts: { stale?: number; history?: StoredChange[]; status?: StoredStatus | null; actions?: StoredAction[] } = {},
) {
  const writes: Written[] = []
  const created: { kind: string; line: string | null; requestedAt: Date; by: { label: string; userId: string } }[] = []
  const answered: ActionAnswer[][] = []
  const actions = opts.actions ?? []
  const repository = {
    config: async () => config,
    status: async () => opts.status ?? null,
    changes: async () => opts.history ?? [],
    actions: async (limit: number) => actions.slice(0, limit),
    openActions: async (since: Date, limit: number) =>
      actions.filter((a) => a.requestedAt.getTime() >= since.getTime() && (a.state === null || a.state === 'pending')).slice(0, limit),
    createAction: async (a: { kind: string; line: string | null; requestedAt: Date; by: { label: string; userId: string } }): Promise<StoredAction> => {
      created.push(a)
      return { id: 41, kind: a.kind, line: a.line, requestedAt: a.requestedAt, requestedBy: a.by.label, state: null, text: null, answeredAt: null }
    },
    answerActions: async (answers: ActionAnswer[]) => {
      answered.push(answers)
    },
    putStatus: async () => {},
    save: async (
      settings: ControlSettings,
      baseVersion: number,
      by: { label: string; userId: string },
      changesOf: (before: ControlSettings | null) => readonly ControlChange[],
    ): Promise<StoredConfig> => {
      if (opts.stale !== undefined) throw new StaleVersionError(opts.stale)
      writes.push({ settings, baseVersion, by, changes: changesOf(config) })
      return { ...settings, version: baseVersion + 1, updatedAt: new Date('2026-11-04T10:30:00Z'), updatedBy: by.label }
    },
  } as unknown as AiRegistratorControlRepository
  return { service: new AiRegistratorControlService(repository, async () => []), writes, created, answered }
}

const by = { label: 'umida', userId: 'u-umida' }

const message = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return (error as ApiError).message
  }
  throw new Error('expected a refusal')
}

describe('setEnabled — the stop alone', () => {
  it('writes the next version with every other field as stored and only enabled changed', async () => {
    const { service, writes } = fake(stored())
    const result = await service.setEnabled({ baseVersion: 7, enabled: false }, by)
    expect(writes).toHaveLength(1)
    const { version: _v, updatedAt: _a, updatedBy: _b, ...rest } = stored()
    expect(writes[0]!.settings).toEqual({ ...rest, enabled: false })
    expect(writes[0]!.baseVersion).toBe(7)
    expect(writes[0]!.by).toEqual(by)
    expect(writes[0]!.changes).toEqual([{ field: 'enabled', before: true, after: false }])
    expect(result).toMatchObject({ version: 8, enabled: false, sellers: ['122', '120'], maxNew: 3, maxRetry: 1, updatedBy: 'umida' })
  })

  it('starts a stopped AI the same way', async () => {
    const { service, writes } = fake(stored({ enabled: false }))
    expect((await service.setEnabled({ baseVersion: 7, enabled: true }, by)).enabled).toBe(true)
    expect(writes[0]!.changes).toEqual([{ field: 'enabled', before: false, after: true }])
  })

  it('refuses a stop that changes nothing, before a first save, and over a newer version', async () => {
    expect(await message(fake(stored({ enabled: false })).service.setEnabled({ baseVersion: 7, enabled: false }, by))).toBe('AI allaqachon toʻxtatilgan.')
    expect(await message(fake(stored()).service.setEnabled({ baseVersion: 7, enabled: true }, by))).toBe('AI allaqachon yoqilgan.')
    expect(await message(fake(null).service.setEnabled({ baseVersion: 0, enabled: false }, by))).toMatch(/^Avval sozlamani saqlang/)
    expect(await message(fake(stored(), { stale: 9 }).service.setEnabled({ baseVersion: 7, enabled: false }, by))).toMatch(/boshqa oynada saqlangan \(hozir v9\)/)
  })
})

describe('save — «Saqlash» keeps the stop as stored', () => {
  const body = { baseVersion: 7, sellers: ['122', '120', '143'], parked: ['128'], maxCalls: 4, maxNew: 3, maxRetry: 1, saleHandoff: 'refer' as const }

  it('leaves a stopped AI stopped when a seller is added', async () => {
    const { service, writes } = fake(stored({ enabled: false }))
    const result = await service.save(body, by)
    expect(writes[0]!.settings.enabled).toBe(false)
    expect(writes[0]!.changes.map((c) => c.field)).toEqual(['sellers'])
    expect(result.enabled).toBe(false)
  })

  it('leaves a running AI running', async () => {
    const { service, writes } = fake(stored())
    await service.save(body, by)
    expect(writes[0]!.settings.enabled).toBe(true)
  })

  it('still refuses a save that changes nothing', async () => {
    const { service } = fake(stored({ enabled: false }))
    expect(await message(service.save({ ...body, sellers: ['122', '120'] }, by))).toBe('Hech narsa oʻzgarmadi — saqlash shart emas.')
  })
})

describe('what the agent and the panel read', () => {
  it('gives the agent enabled as a real boolean', async () => {
    expect((await fake(stored({ enabled: false })).service.agentConfig())?.enabled).toBe(false)
    expect((await fake(stored()).service.agentConfig())?.enabled).toBe(true)
    expect(await fake(null).service.agentConfig()).toBeNull()
  })

  it('names who last stopped or started it, from the audit', async () => {
    const change = (version: number, savedBy: string, changes: ControlChange[]): StoredChange => ({
      version,
      savedAt: new Date(`2026-11-04T0${version}:00:00Z`),
      savedBy,
      before: null,
      after: stored() as ControlSettings,
      changes,
    })
    const history = [
      change(9, 'adminjon', [{ field: 'maxNew', before: 2, after: 3 }]),
      change(8, 'umida', [{ field: 'enabled', before: true, after: false }]),
    ]
    const panel = await fake(stored({ version: 9, enabled: false }), { history }).service.panel(new Date('2026-11-04T10:00:00Z'))
    expect(panel.config?.enabled).toBe(false)
    expect(panel.switched).toEqual({ version: 8, savedAt: '2026-11-04T08:00:00.000Z', savedBy: 'umida' })
    expect(panel.history[1]!.lines).toEqual(['AI: ishlayapti → toʻxtatildi'])
    expect((await fake(stored(), { history: [history[0]!] }).service.panel(new Date())).switched).toBeNull()
  })
})

/*
  «Ish vaqti» (2026-11-04, the owner: «hohlagan vaqtim ish vaqtini
  oʻzgartiray»): the hours are their own save — only `hours` changes — and
  neither «Saqlash» nor the stop takes them back.
*/
describe('setHours — the hours alone', () => {
  const late = { start: '08:00', end: '23:00', lunchStart: null, lunchEnd: null }
  const day = { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30' }

  it('writes the next version with every other field as stored and only the hours changed', async () => {
    const { service, writes } = fake(stored({ enabled: false }))
    const result = await service.setHours({ baseVersion: 7, hours: day }, by)
    const { version: _v, updatedAt: _a, updatedBy: _b, ...rest } = stored({ enabled: false })
    expect(writes[0]!.settings).toEqual({ ...rest, hours: day })
    expect(writes[0]!.changes).toEqual([{ field: 'hours', before: null, after: day }])
    expect(result.hours).toEqual(day)
    expect(result.enabled).toBe(false)
  })

  it('names what changed in the audit: the day, the lunch, or both', async () => {
    const { service, writes } = fake(stored({ hours: day }))
    await service.setHours({ baseVersion: 7, hours: late }, by)
    expect(changeLines(writes[0]!.changes)).toEqual(['Ish vaqti: 09:00–22:00 → 08:00–23:00', 'Tushlik: 12:30–13:30 → yoʻq'])
    expect(changeLines([{ field: 'hours', before: null, after: day }])).toEqual(['Ish vaqti: 09:00–22:00', 'Tushlik: 12:30–13:30'])
    expect(changeLines([{ field: 'hours', before: day, after: { ...day, end: '21:00' } }])).toEqual(['Ish vaqti: 09:00–22:00 → 09:00–21:00'])
  })

  it('refuses hours the agent would refuse — every problem named, nothing written', async () => {
    const { service, writes } = fake(stored())
    expect(await message(service.setHours({ baseVersion: 7, hours: { ...day, start: '22:00', end: '09:00' } }, by))).toMatch(/bitta kun ichida/)
    expect(await message(service.setHours({ baseVersion: 7, hours: { ...day, lunchEnd: null } }, by))).toMatch(/Tushliksiz/)
    expect(await message(service.setHours({ baseVersion: 7, hours: { ...day, lunchStart: '08:30' } }, by))).toBe('Tushlik ish vaqti ichida boʻlsin (09:00–22:00).')
    expect(await message(service.setHours({ baseVersion: 7, hours: { ...day, start: '9:00', lunchEnd: '12:00' } }, by))).toBe(
      'Ish boshlanishi SS:DD koʻrinishida boʻlsin (masalan 09:00). Tushlik tugashi boshlanishidan keyin boʻlsin.',
    )
    expect(writes).toHaveLength(0)
  })

  it('refuses hours that change nothing, before a first save, and over a newer version', async () => {
    expect(await message(fake(stored({ hours: day })).service.setHours({ baseVersion: 7, hours: day }, by))).toBe('Ish vaqti oʻzgarmadi — saqlash shart emas.')
    expect(await message(fake(null).service.setHours({ baseVersion: 0, hours: day }, by))).toMatch(/^Avval sozlamani saqlang/)
    expect(await message(fake(stored(), { stale: 9 }).service.setHours({ baseVersion: 7, hours: day }, by))).toMatch(/boshqa oynada saqlangan \(hozir v9\)/)
  })

  it('is kept by «Saqlash» and by the stop', async () => {
    const save = fake(stored({ hours: late }))
    await save.service.save({ baseVersion: 7, sellers: ['122', '120', '143'], parked: ['128'], maxCalls: 4, maxNew: 3, maxRetry: 1, saleHandoff: 'refer' }, by)
    expect(save.writes[0]!.settings.hours).toEqual(late)
    expect(save.writes[0]!.changes.map((c) => c.field)).toEqual(['sellers'])

    const stop = fake(stored({ hours: late }))
    await stop.service.setEnabled({ baseVersion: 7, enabled: false }, by)
    expect(stop.writes[0]!.settings.hours).toEqual(late)
    expect(stop.writes[0]!.changes.map((c) => c.field)).toEqual(['enabled'])
  })

  it('goes to the agent only once saved, and to the panel always — null while not set', async () => {
    expect(await fake(stored()).service.agentConfig()).not.toHaveProperty('hours')
    expect((await fake(stored({ hours: late })).service.agentConfig())?.hours).toEqual(late)
    expect((await fake(stored()).service.panel(new Date())).config?.hours).toBeNull()

    const history: StoredChange[] = [
      { version: 9, savedAt: new Date('2026-11-04T14:00:00Z'), savedBy: 'umida', before: null, after: stored() as ControlSettings, changes: [{ field: 'maxNew', before: 2, after: 3 }] },
      { version: 8, savedAt: new Date('2026-11-04T13:00:00Z'), savedBy: 'adminjon', before: null, after: stored() as ControlSettings, changes: [{ field: 'hours', before: null, after: late }] },
    ]
    const panel = await fake(stored({ version: 9, hours: late }), { history }).service.panel(new Date())
    expect(panel.config?.hours).toEqual(late)
    expect(panel.hoursSet).toEqual({ version: 8, savedAt: '2026-11-04T13:00:00.000Z', savedBy: 'adminjon' })
    expect(panel.history[1]!.lines).toEqual(['Ish vaqti: 08:00–23:00', 'Tushlik: yoʻq'])
  })
})

/*
  The rest of the panel (2026-11-04, T144, the owner: «hamma narsani boshqara
  olsin … to'xtatib qo'yish funksiyalari, SIP bilan ishlash»): the pause, the
  lines switched off and the tuning — each its own save, only its field
  changed — and the presses, rows the agent does once. Fake lines only.
*/

const NOW = new Date('2026-11-04T15:00:00Z') // 20:00 Tashkent

const aiLine = (ext: string, over: Record<string, unknown> = {}) => ({
  ext,
  pool: 'main',
  transport: 'udp',
  state: 'free',
  registration: 'Registered',
  enabled: true,
  ...over,
})

const statusWith = (aiLines: unknown[] | undefined, receivedAt = new Date(NOW.getTime() - 5_000)): StoredStatus => ({
  receivedAt,
  payload: {
    at: receivedAt.toISOString(),
    appliedVersion: 7,
    applyError: null,
    limits: { calls: 4, maxNew: 3, maxRetry: 1, saleHandoff: 'refer' },
    lines: {},
    sellers: [],
    today: { calls: 0, answered: 0, transferred: 0, transferFailed: 0, atsRejected: 0 },
    ...(aiLines ? { aiLines } : {}),
  } as unknown as StoredStatus['payload'],
})

const LINES = [aiLine('178'), aiLine('290'), aiLine('296', { pool: 'zextra' })]
const TUNING = { attemptsPerDay: 5, retryDays: 2, transferOrder: 'random' as const, ringSec: 15, missedSec: 600, firstCallDelaySec: 60, whyUs: 'on' as const }

const rest = (over: Partial<StoredConfig> = {}) => {
  const { version: _v, updatedAt: _a, updatedBy: _b, ...settings } = stored(over)
  return settings
}

describe('setPause — the timed pause alone', () => {
  it('stores the instant (UTC) and only it, and names it in the audit', async () => {
    const { service, writes } = fake(stored({ enabled: true, hours: { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null } }))
    await service.setPause({ baseVersion: 7, pauseUntil: '2026-11-04T21:30:00+05:00' }, by, NOW)
    expect(writes[0]!.settings).toEqual({ ...rest({ hours: { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null } }), pauseUntil: '2026-11-04T16:30:00.000Z' })
    expect(writes[0]!.changes).toEqual([{ field: 'pauseUntil', before: null, after: '2026-11-04T16:30:00.000Z' }])
    expect(changeLines(writes[0]!.changes)).toEqual(['Pauza: 04.11 21:30 gacha'])
  })

  it('ends a running pause with null — «Davom ettirish»', async () => {
    const { service, writes } = fake(stored({ pauseUntil: '2026-11-04T16:30:00.000Z' }))
    await service.setPause({ baseVersion: 7, pauseUntil: null }, by, NOW)
    expect(writes[0]!.settings.pauseUntil).toBeNull()
    expect(changeLines(writes[0]!.changes)).toEqual(['Pauza: bekor qilindi — AI davom etadi'])
  })

  it('refuses a past time, one over seven days, a resume with none running, and before a first save', async () => {
    const { service, writes } = fake(stored())
    expect(await message(service.setPause({ baseVersion: 7, pauseUntil: '2026-11-04T19:00:00+05:00' }, by, NOW))).toMatch(/oʻtib ketgan/)
    expect(await message(service.setPause({ baseVersion: 7, pauseUntil: '2026-11-12T19:00:00+05:00' }, by, NOW))).toMatch(/7 kundan uzoq/)
    expect(await message(service.setPause({ baseVersion: 7, pauseUntil: null }, by, NOW))).toMatch(/Pauza yoʻq/)
    expect(await message(fake(stored({ pauseUntil: '2026-11-04T10:00:00.000Z' })).service.setPause({ baseVersion: 7, pauseUntil: null }, by, NOW))).toMatch(/Pauza yoʻq/)
    expect(await message(fake(null).service.setPause({ baseVersion: 0, pauseUntil: '2026-11-04T21:30:00+05:00' }, by, NOW))).toMatch(/^Avval sozlamani saqlang/)
    expect(writes).toHaveLength(0)
  })

  it('«Saqlash», the stop and the hours keep the pause, the lines and the tuning as stored', async () => {
    const kept = { pauseUntil: '2026-11-04T16:30:00.000Z', linesOff: ['290'], tuning: TUNING }
    const { service, writes } = fake(stored(kept))
    await service.save({ baseVersion: 7, sellers: ['122'], parked: ['128'], maxCalls: 4, maxNew: 3, maxRetry: 1, saleHandoff: 'refer' }, by)
    await service.setEnabled({ baseVersion: 7, enabled: false }, by)
    await service.setHours({ baseVersion: 7, hours: { start: '09:00', end: '21:00', lunchStart: null, lunchEnd: null } }, by)
    for (const w of writes) expect(w.settings).toMatchObject(kept)
  })
})

describe('setLinesOff — the AI lines switched off alone', () => {
  it('stores our lines only, by number, against what the agent last reported', async () => {
    const { service, writes } = fake(stored(), { status: statusWith(LINES) })
    await service.setLinesOff({ baseVersion: 7, linesOff: ['296', '999', '290'] }, by)
    expect(writes[0]!.settings).toEqual({ ...rest(), linesOff: ['290', '296'] })
    expect(changeLines(writes[0]!.changes)).toEqual(['Liniya 290: oʻchirildi', 'Liniya 296: oʻchirildi'])
    expect(changeLines([{ field: 'linesOff', before: ['290'], after: [] }])).toEqual(['Liniya 290: yoqildi'])
  })

  it('refuses every main line off, no change, and an agent that does not report its lines', async () => {
    expect(await message(fake(stored(), { status: statusWith(LINES) }).service.setLinesOff({ baseVersion: 7, linesOff: ['178', '290'] }, by))).toMatch(/asosiy \(Collagen\)/)
    expect(await message(fake(stored({ linesOff: ['290'] }), { status: statusWith(LINES) }).service.setLinesOff({ baseVersion: 7, linesOff: ['290'] }, by))).toMatch(
      /oʻzgarmadi/,
    )
    expect(await message(fake(stored(), { status: statusWith(undefined) }).service.setLinesOff({ baseVersion: 7, linesOff: ['290'] }, by))).toMatch(/hali yubormayapti/)
  })
})

describe('setTuning — «Qoʻshimcha sozlamalar» alone', () => {
  it('stores all seven and names each change', async () => {
    const { service, writes } = fake(stored())
    await service.setTuning({ baseVersion: 7, tuning: TUNING }, by)
    expect(writes[0]!.settings).toEqual({ ...rest(), tuning: TUNING })
    expect(changeLines(writes[0]!.changes)).toHaveLength(7)
    expect(changeLines([{ field: 'tuning', before: TUNING, after: { ...TUNING, attemptsPerDay: 3 } }])).toEqual(['Nedozvonga kuniga: 5 marta → 3 marta'])
  })

  it('refuses tuning the agent would refuse — every problem in one message — and one that changes nothing', async () => {
    const msg = await message(fake(stored()).service.setTuning({ baseVersion: 7, tuning: { ...TUNING, attemptsPerDay: 0, ringSec: 99 } }, by))
    expect(msg).toBe('Nedozvonga kuniga: 1–10 oraligʻida butun son boʻlsin. Sotuvchini jiringlatish: 10–40 oraligʻida butun son boʻlsin.')
    expect(await message(fake(stored({ tuning: TUNING })).service.setTuning({ baseVersion: 7, tuning: { ...TUNING } }, by))).toMatch(/oʻzgarmadi/)
  })
})

describe('requestAction — a press the agent does once', () => {
  it('asks «Qayta ulash» of a line that is not registered', async () => {
    const { service, created } = fake(stored(), { status: statusWith([...LINES, aiLine('291', { registration: 'Rejected', state: 'not_registered' })]) })
    const press = await service.requestAction({ action: { kind: 'reregister', line: '291' } }, by, NOW)
    expect(created).toEqual([{ kind: 'reregister', line: '291', requestedAt: NOW, by }])
    expect(press).toMatchObject({ id: 41, kind: 'reregister', line: '291', state: null, requestedBy: 'umida' })
  })

  it('refuses a registered line, not ours, a silent agent and one still waiting', async () => {
    const lines = [...LINES, aiLine('291', { registration: 'Rejected' })]
    expect(await message(fake(stored(), { status: statusWith(lines) }).service.requestAction({ action: { kind: 'reregister', line: '178' } }, by, NOW))).toMatch(
      /Registered.*kerak emas/,
    )
    expect(await message(fake(stored(), { status: statusWith(lines) }).service.requestAction({ action: { kind: 'reregister', line: '122' } }, by, NOW))).toMatch(
      /AI liniyasi emas/,
    )
    const old = statusWith(lines, new Date(NOW.getTime() - 120_000))
    expect(await message(fake(stored(), { status: old }).service.requestAction({ action: { kind: 'reregister', line: '291' } }, by, NOW))).toMatch(/AIdan yangi xabar yoʻq/)
    const waiting: StoredAction = { id: 40, kind: 'reregister', line: '291', requestedAt: new Date(NOW.getTime() - 60_000), requestedBy: 'umida', state: null, text: null, answeredAt: null }
    expect(
      await message(fake(stored(), { status: statusWith(lines), actions: [waiting] }).service.requestAction({ action: { kind: 'reregister', line: '291' } }, by, NOW)),
    ).toMatch(/javob kutmoqda/)
  })

  it('asks «TLSʼni yangilash» only with every TLS line down and none on a call', async () => {
    const tls = (registration: string, state = 'not_registered') => aiLine('292', { transport: 'tls', registration, state })
    const ask = (lines: unknown[]) => fake(stored(), { status: statusWith(lines) }).service.requestAction({ action: { kind: 'tls_reset' } }, by, NOW)
    expect(await ask([...LINES, tls('Rejected')])).toMatchObject({ kind: 'tls_reset', line: null })
    expect(await message(ask([...LINES, tls('Registered', 'free')]))).toMatch(/TLS ulanishi ishlayapti/)
    expect(await message(ask([...LINES, tls('Rejected', 'call')]))).toMatch(/qoʻngʻiroq bor/)
    expect(await message(ask(LINES))).toMatch(/TLS liniya yoʻq/)
  })
})

describe('the agent\'s config — every new field left out while not set', () => {
  it('reads as before with nothing set', async () => {
    const config = await fake(stored()).service.agentConfig(NOW)
    expect(config).not.toHaveProperty('pauseUntil')
    expect(config).not.toHaveProperty('linesOff')
    expect(config).not.toHaveProperty('tuning')
    expect(config).not.toHaveProperty('actions')
  })

  it('carries a pause only while it is ahead, Tashkent with the offset; days only when not every day', async () => {
    const hours = { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null, days: [1, 2, 3, 4, 5] }
    const config = await fake(stored({ pauseUntil: '2026-11-04T16:30:00.000Z', linesOff: ['290'], tuning: TUNING, hours })).service.agentConfig(NOW)
    expect(config).toMatchObject({ pauseUntil: '2026-11-04T21:30:00+05:00', linesOff: ['290'], tuning: TUNING, hours: { days: [1, 2, 3, 4, 5] } })
    expect(await fake(stored({ pauseUntil: '2026-11-04T14:00:00.000Z' })).service.agentConfig(NOW)).not.toHaveProperty('pauseUntil')
    expect((await fake(stored({ hours: { ...hours, days: null } })).service.agentConfig(NOW))?.hours).not.toHaveProperty('days')
  })

  it('carries the open presses — not answered or pending, under ten minutes old', async () => {
    const press = (id: number, minutesAgo: number, state: string | null): StoredAction => ({
      id,
      kind: 'reregister',
      line: '291',
      requestedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
      requestedBy: 'umida',
      state,
      text: null,
      answeredAt: null,
    })
    const config = await fake(stored(), { actions: [press(5, 1, null), press(4, 2, 'pending'), press(3, 3, 'done'), press(2, 11, null)] }).service.agentConfig(NOW)
    expect(config?.actions).toEqual([
      { id: 5, kind: 'reregister', line: '291', at: '2026-11-04T19:59:00+05:00', by: 'umida' },
      { id: 4, kind: 'reregister', line: '291', at: '2026-11-04T19:58:00+05:00', by: 'umida' },
    ])
  })

  it('writes the agent\'s answers from its report onto the presses', async () => {
    const { service, answered } = fake(stored())
    const status = statusWith(LINES).payload
    await service.putStatus({ ...status, actions: [{ id: 5, kind: 'reregister', line: '291', state: 'done', text: 'qayta ulandi', at: NOW.toISOString() }] }, NOW)
    expect(answered).toEqual([[{ id: 5, state: 'done', text: 'qayta ulandi', at: NOW }]])
  })
})
