import { describe, expect, it } from 'vitest'

import type { ControlChange, ControlSettings } from '@/server/domain/aiRegistrator/control'
import { ApiError } from '@/server/http/errors'
import {
  type AiRegistratorControlRepository,
  type StoredChange,
  type StoredConfig,
  StaleVersionError,
} from '@/server/repositories/aiRegistratorControlRepository'
import { AiRegistratorControlService } from '@/server/services/aiRegistratorControlService'

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

function fake(config: StoredConfig | null, opts: { stale?: number; history?: StoredChange[] } = {}) {
  const writes: Written[] = []
  const repository = {
    config: async () => config,
    status: async () => null,
    changes: async () => opts.history ?? [],
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
  return { service: new AiRegistratorControlService(repository, async () => []), writes }
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
