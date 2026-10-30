import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import type { ControlChange, ControlSettings, SaleHandoff } from '@/server/domain/aiRegistrator/control'
import type { AiStatusPush } from '@/server/integrations/aiRegistrator/control'

export interface StoredConfig extends ControlSettings {
  readonly version: number
  readonly updatedAt: Date
  readonly updatedBy: string
}

export interface StoredStatus {
  readonly receivedAt: Date
  readonly payload: AiStatusPush
}

export interface StoredChange {
  readonly version: number
  readonly savedAt: Date
  readonly savedBy: string
  readonly before: ControlSettings | null
  readonly after: ControlSettings
  readonly changes: readonly ControlChange[]
}

/** A save that lost the race: someone saved `current` after the owner opened `baseVersion`. */
export class StaleVersionError extends Error {
  constructor(readonly current: number) {
    super(`config is at version ${current}`)
    this.name = 'StaleVersionError'
  }
}

const CURRENT = 1

function settingsOf(row: {
  sellers: string[]
  parked: string[]
  maxCalls: number
  maxNew: number
  maxRetry: number
  saleHandoff: string
}): ControlSettings {
  return {
    sellers: row.sellers,
    parked: row.parked,
    maxCalls: row.maxCalls,
    maxNew: row.maxNew,
    maxRetry: row.maxRetry,
    saleHandoff: row.saleHandoff as SaleHandoff,
  }
}

/**
 * «AI registrator → Boshqaruv»: the one current setting, its audit and the
 * agent's last report — see `domain/aiRegistrator/control.ts`.
 */
export class AiRegistratorControlRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async config(): Promise<StoredConfig | null> {
    const row = await this.prisma.aiRegistratorConfig.findUnique({ where: { id: CURRENT } })
    return row ? { ...settingsOf(row), version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : null
  }

  /**
   * Write the next version and its audit row in ONE transaction, the current
   * row locked first: two saves cannot both read version N and both write
   * N + 1, and an audit row cannot exist for a setting that was not stored.
   * `baseVersion` is what the saver was looking at — a newer one is refused.
   */
  async save(
    settings: ControlSettings,
    baseVersion: number,
    by: { readonly label: string; readonly userId: string },
    changesOf: (before: ControlSettings | null) => readonly ControlChange[],
  ): Promise<StoredConfig> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ version: number }[]>`
        SELECT "version" FROM "ai_registrator_config" WHERE "id" = ${CURRENT} FOR UPDATE`
      const current = locked[0]?.version ?? 0
      if (current !== baseVersion) throw new StaleVersionError(current)

      const beforeRow = current > 0 ? await tx.aiRegistratorConfig.findUnique({ where: { id: CURRENT } }) : null
      const before = beforeRow ? settingsOf(beforeRow) : null
      const version = current + 1
      const now = new Date()
      const data = {
        version,
        sellers: [...settings.sellers],
        parked: [...settings.parked],
        maxCalls: settings.maxCalls,
        maxNew: settings.maxNew,
        maxRetry: settings.maxRetry,
        saleHandoff: settings.saleHandoff,
        updatedAt: now,
        updatedBy: by.label,
        updatedById: by.userId,
      }
      await tx.aiRegistratorConfig.upsert({ where: { id: CURRENT }, create: { id: CURRENT, ...data }, update: data })
      await tx.aiRegistratorConfigChange.create({
        data: {
          version,
          savedAt: now,
          savedBy: by.label,
          savedById: by.userId,
          before: before ? (before as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          after: settingsOf(data) as unknown as Prisma.InputJsonValue,
          changes: changesOf(before) as unknown as Prisma.InputJsonValue,
        },
      })
      return { ...settingsOf(data), version, updatedAt: now, updatedBy: by.label }
    })
  }

  async changes(limit: number): Promise<StoredChange[]> {
    const rows = await this.prisma.aiRegistratorConfigChange.findMany({ orderBy: { version: 'desc' }, take: limit })
    return rows.map((r) => ({
      version: r.version,
      savedAt: r.savedAt,
      savedBy: r.savedBy,
      before: (r.before as ControlSettings | null) ?? null,
      after: r.after as unknown as ControlSettings,
      changes: (r.changes as unknown as ControlChange[]) ?? [],
    }))
  }

  /** Only the last report is kept: the panel shows what the agent runs NOW. */
  async putStatus(status: AiStatusPush, receivedAt: Date): Promise<void> {
    const data = {
      receivedAt,
      at: new Date(status.at),
      appliedVersion: status.appliedVersion,
      applyError: status.applyError,
      payload: status as unknown as Prisma.InputJsonValue,
    }
    await this.prisma.aiRegistratorStatus.upsert({ where: { id: CURRENT }, create: { id: CURRENT, ...data }, update: data })
  }

  async status(): Promise<StoredStatus | null> {
    const row = await this.prisma.aiRegistratorStatus.findUnique({ where: { id: CURRENT } })
    return row ? { receivedAt: row.receivedAt, payload: row.payload as unknown as AiStatusPush } : null
  }
}
