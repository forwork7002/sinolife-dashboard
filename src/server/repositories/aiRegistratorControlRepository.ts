import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import type { AiTuning, ControlChange, ControlSettings, SaleHandoff, WorkHours } from '@/server/domain/aiRegistrator/control'
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

/** One press on the panel and the agent's answer to it — `AiRegistratorAction`. */
export interface StoredAction {
  readonly id: number
  readonly kind: string
  readonly line: string | null
  readonly requestedAt: Date
  readonly requestedBy: string
  /** null — sent, no answer yet; "pending" | "done" | "refused". */
  readonly state: string | null
  readonly text: string | null
  readonly answeredAt: Date | null
}

/** The agent's answer to one press, as its status carries it. */
export interface ActionAnswer {
  readonly id: number
  readonly state: string
  readonly text: string
  readonly at: Date
}

/** A save that lost the race: someone saved `current` after the owner opened `baseVersion`. */
export class StaleVersionError extends Error {
  constructor(readonly current: number) {
    super(`config is at version ${current}`)
    this.name = 'StaleVersionError'
  }
}

const CURRENT = 1

interface HoursColumns {
  hoursStart: string | null
  hoursEnd: string | null
  lunchStart: string | null
  lunchEnd: string | null
}

/** The four columns as one value: both day ends null — not set; both lunch ends null — no lunch. */
interface MoreColumns {
  /** [] — every day. */
  workDays: number[]
  pauseUntil: Date | null
  linesOff: string[]
  tuning: unknown
}

/** The four columns as one value (and the days beside them): both day ends null — not set; both lunch ends null — no lunch. */
function hoursOf(row: HoursColumns & Pick<MoreColumns, 'workDays'>): WorkHours | null {
  if (row.hoursStart === null || row.hoursEnd === null) return null
  const lunch = row.lunchStart !== null && row.lunchEnd !== null
  return {
    start: row.hoursStart,
    end: row.hoursEnd,
    lunchStart: lunch ? row.lunchStart : null,
    lunchEnd: lunch ? row.lunchEnd : null,
    days: row.workDays.length > 0 ? [...row.workDays] : null,
  }
}

function hoursColumns(hours: WorkHours | null): HoursColumns & Pick<MoreColumns, 'workDays'> {
  return {
    hoursStart: hours?.start ?? null,
    hoursEnd: hours?.end ?? null,
    lunchStart: hours?.lunchStart ?? null,
    lunchEnd: hours?.lunchEnd ?? null,
    workDays: hours?.days ? [...hours.days] : [],
  }
}

/** The stored tuning, or null — a value that is not one (hand-edited, half) reads as none set. */
function tuningOf(value: unknown): AiTuning | null {
  if (value === null || typeof value !== 'object') return null
  const t = value as Record<string, unknown>
  const keys = ['attemptsPerDay', 'retryDays', 'transferOrder', 'ringSec', 'missedSec', 'firstCallDelaySec', 'whyUs']
  return keys.every((k) => t[k] !== undefined && t[k] !== null) ? (t as unknown as AiTuning) : null
}

function settingsOf(
  row: {
    sellers: string[]
    parked: string[]
    maxCalls: number
    maxNew: number
    maxRetry: number
    saleHandoff: string
    enabled: boolean
  } & HoursColumns &
    MoreColumns,
): ControlSettings {
  return {
    sellers: row.sellers,
    parked: row.parked,
    maxCalls: row.maxCalls,
    maxNew: row.maxNew,
    maxRetry: row.maxRetry,
    saleHandoff: row.saleHandoff as SaleHandoff,
    enabled: row.enabled,
    hours: hoursOf(row),
    pauseUntil: row.pauseUntil ? row.pauseUntil.toISOString() : null,
    linesOff: row.linesOff,
    tuning: tuningOf(row.tuning),
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
        enabled: settings.enabled,
        ...hoursColumns(settings.hours),
        pauseUntil: settings.pauseUntil ? new Date(settings.pauseUntil) : null,
        linesOff: [...settings.linesOff],
        tuning: settings.tuning ? (settings.tuning as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
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
          after: settings as unknown as Prisma.InputJsonValue,
          changes: changesOf(before) as unknown as Prisma.InputJsonValue,
        },
      })
      return { ...settings, version, updatedAt: now, updatedBy: by.label }
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

  /* ── One-off presses (T144) ─────────────────────────────────────────── */

  /** The newest presses, answered or not — the panel's last answers and its history. */
  async actions(limit: number): Promise<StoredAction[]> {
    return this.prisma.aiRegistratorAction.findMany({ orderBy: { id: 'desc' }, take: limit })
  }

  /**
   * The presses the agent may still do: not answered, or answered «pending»
   * (a TLS renewal under way), asked since `since` — newest first, at most `limit`.
   */
  async openActions(since: Date, limit: number): Promise<StoredAction[]> {
    return this.prisma.aiRegistratorAction.findMany({
      where: { requestedAt: { gte: since }, OR: [{ state: null }, { state: 'pending' }] },
      orderBy: { id: 'desc' },
      take: limit,
    })
  }

  async createAction(action: { readonly kind: string; readonly line: string | null; readonly requestedAt: Date; readonly by: { readonly label: string; readonly userId: string } }): Promise<StoredAction> {
    return this.prisma.aiRegistratorAction.create({
      data: { kind: action.kind, line: action.line, requestedAt: action.requestedAt, requestedBy: action.by.label, requestedById: action.by.userId },
    })
  }

  /**
   * The agent's answers, written onto the presses still open — a press once
   * «done» or «refused» is never rewritten by a later report. One read of the
   * few rows the answers name; a write only where something changed.
   */
  async answerActions(answers: readonly ActionAnswer[]): Promise<void> {
    if (answers.length === 0) return
    const open = await this.prisma.aiRegistratorAction.findMany({
      where: { id: { in: answers.map((a) => a.id) }, OR: [{ state: null }, { state: 'pending' }] },
      select: { id: true, state: true, text: true },
    })
    for (const row of open) {
      const answer = answers.find((a) => a.id === row.id)
      if (!answer || (answer.state === row.state && answer.text === row.text)) continue
      await this.prisma.aiRegistratorAction.update({ where: { id: row.id }, data: { state: answer.state, text: answer.text, answeredAt: answer.at } })
    }
  }
}
