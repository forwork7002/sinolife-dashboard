import {
  AI_OWN_LINES,
  MAX_CALLS_LIMIT,
  MAX_SELLERS,
  STATUS_STALE_MS,
  type ControlChange,
  type ControlSettings,
  controlChanges,
  controlProblems,
  normaliseSellers,
  sellersDelta,
  statusIsStale,
} from '@/server/domain/aiRegistrator/control'
import { floorNumberOf, indexByFloorNumber } from '@/server/domain/employees/floorNumber'
import { ApiError } from '@/server/http/errors'
import type { AiStatusPush, ControlSave } from '@/server/integrations/aiRegistrator/control'
import {
  type AiRegistratorControlRepository,
  type StoredConfig,
  StaleVersionError,
} from '@/server/repositories/aiRegistratorControlRepository'

/** What the AI server reads — the contract's exact shape, no envelope. */
export interface AgentConfigDto {
  readonly version: number
  readonly sellers: readonly string[]
  readonly maxCalls: number
  readonly maxNew: number
  readonly maxRetry: number
  readonly saleHandoff: string
  readonly updatedAt: string
  readonly updatedBy: string
}

/** Mirrored by `AiControlDto` in `src/features/aiRegistrator/AiControlPage.tsx` — nothing checks the mirror. */
export interface AiControlDto {
  readonly config: (AgentConfigDto & { readonly parked: readonly string[] }) | null
  readonly status: {
    readonly receivedAt: string
    readonly stale: boolean
    readonly report: AiStatusPush
  } | null
  /** Every extension the panel shows, to the employee whose name carries it («122» → «122 Dilnoza …»). */
  readonly names: Readonly<Record<string, string>>
  readonly rules: {
    readonly aiLines: readonly string[]
    readonly maxCalls: number
    readonly maxSellers: number
    readonly staleAfterSec: number
  }
  readonly history: readonly {
    readonly version: number
    readonly savedAt: string
    readonly savedBy: string
    readonly lines: readonly string[]
  }[]
}

const HISTORY = 20

const FIELD_LABEL: Readonly<Record<string, string>> = {
  maxCalls: 'Bir vaqtda',
  maxNew: 'Yangi lidlarga',
  maxRetry: 'Nedozvonga',
  saleHandoff: 'Sotuvni ATSga topshirish',
}

function agentConfig(config: StoredConfig): AgentConfigDto {
  return {
    version: config.version,
    sellers: config.sellers,
    maxCalls: config.maxCalls,
    maxNew: config.maxNew,
    maxRetry: config.maxRetry,
    saleHandoff: config.saleHandoff,
    updatedAt: config.updatedAt.toISOString(),
    updatedBy: config.updatedBy,
  }
}

/** One save in the owner's words: «+143, −117», «Bir vaqtda: 4 → 6». */
export function changeLines(changes: readonly ControlChange[]): string[] {
  return changes.flatMap((c) => {
    if (c.field === 'sellers' || c.field === 'parked') {
      const title = c.field === 'sellers' ? 'Sotuvchilar (AIga)' : 'Oʻchirib qoʻyilgan'
      if (c.before === null) return (c.after as string[]).length > 0 ? [`${title}: ${(c.after as string[]).join(', ')}`] : []
      const { added, removed } = sellersDelta(c.before as string[], c.after as string[])
      const parts = [...added.map((s) => `+${s}`), ...removed.map((s) => `−${s}`)]
      return [parts.length > 0 ? `${title}: ${parts.join(', ')}` : `${title}: tartib oʻzgardi`]
    }
    const label = FIELD_LABEL[c.field] ?? c.field
    return [c.before === null ? `${label}: ${String(c.after)}` : `${label}: ${String(c.before)} → ${String(c.after)}`]
  })
}

export class AiRegistratorControlService {
  constructor(
    private readonly repository: AiRegistratorControlRepository,
    private readonly roster: () => Promise<{ id: string; fullName: string }[]>,
  ) {}

  /** For the agent: the current setting, or null before the first save. */
  async agentConfig(): Promise<AgentConfigDto | null> {
    const config = await this.repository.config()
    return config ? agentConfig(config) : null
  }

  async putStatus(status: AiStatusPush, now: Date): Promise<void> {
    await this.repository.putStatus(status, now)
  }

  async panel(now: Date): Promise<AiControlDto> {
    const [config, status, changes, roster] = await Promise.all([
      this.repository.config(),
      this.repository.status(),
      this.repository.changes(HISTORY),
      this.roster(),
    ])

    const exts = new Set<string>([...(config?.sellers ?? []), ...(config?.parked ?? []), ...(status?.payload.sellers ?? []).map((s) => s.ext)])
    const badge = indexByFloorNumber(roster, (p) => p)
    const nameOf = new Map(roster.map((p) => [p.id, p.fullName]))
    const names: Record<string, string> = {}
    for (const ext of exts) {
      const n = floorNumberOf(ext)
      const id = n === null ? undefined : badge.get(n)
      const name = id ? nameOf.get(id) : undefined
      if (name) names[ext] = name
    }

    return {
      config: config ? { ...agentConfig(config), parked: config.parked } : null,
      status: status
        ? { receivedAt: status.receivedAt.toISOString(), stale: statusIsStale(status.receivedAt, now), report: status.payload }
        : null,
      names,
      rules: { aiLines: AI_OWN_LINES, maxCalls: MAX_CALLS_LIMIT, maxSellers: MAX_SELLERS, staleAfterSec: STATUS_STALE_MS / 1000 },
      history: changes.map((c) => ({
        version: c.version,
        savedAt: c.savedAt.toISOString(),
        savedBy: c.savedBy,
        lines: changeLines(c.changes),
      })),
    }
  }

  /**
   * «Saqlash». Every rule the agent applies is checked here first and ALL the
   * problems are named in one refusal; nothing is written unless the whole
   * setting passes. A save that changes nothing is refused too — a version
   * the agent would re-apply for nothing, and an audit line that says nothing.
   */
  async save(body: ControlSave, by: { readonly label: string; readonly userId: string }): Promise<AgentConfigDto> {
    const settings: ControlSettings = {
      sellers: normaliseSellers(body.sellers),
      parked: normaliseSellers(body.parked),
      maxCalls: body.maxCalls,
      maxNew: body.maxNew,
      maxRetry: body.maxRetry,
      saleHandoff: body.saleHandoff,
    }
    const raw = (list: readonly string[]) => list.map((s) => s.trim()).filter((s) => s !== '')
    const problems = controlProblems({ ...settings, sellers: raw(body.sellers), parked: raw(body.parked) })
    if (problems.length > 0) {
      throw ApiError.validation(
        problems.join(' '),
        problems.map((message) => ({ path: 'settings', message })),
      )
    }

    const current = await this.repository.config()
    if (current && current.version === body.baseVersion && controlChanges(current, settings).length === 0) {
      throw ApiError.validation('Hech narsa oʻzgarmadi — saqlash shart emas.')
    }

    try {
      const saved = await this.repository.save(settings, body.baseVersion, by, (before) => controlChanges(before, settings))
      return agentConfig(saved)
    } catch (error) {
      if (error instanceof StaleVersionError) {
        throw ApiError.validation(
          `Sozlama boshqa oynada saqlangan (hozir v${error.current}). Sahifani yangilab, qaytadan oʻzgartiring.`,
        )
      }
      throw error
    }
  }
}
