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
import { type AiStatusPush, type ControlEnabled, type ControlSave, aiStatusSchema } from '@/server/integrations/aiRegistrator/control'
import {
  type AiRegistratorControlRepository,
  type StoredConfig,
  type StoredStatus,
  StaleVersionError,
} from '@/server/repositories/aiRegistratorControlRepository'

/** What the AI server reads — the contract's exact shape, no envelope. */
export interface AgentConfigDto {
  readonly version: number
  /** Always a real boolean — the agent refuses the whole config over one that is not. */
  readonly enabled: boolean
  readonly sellers: readonly string[]
  readonly maxCalls: number
  readonly maxNew: number
  readonly maxRetry: number
  readonly saleHandoff: string
  readonly updatedAt: string
  readonly updatedBy: string
}

/** Mirrored by `AiControlDto` in `src/features/aiRegistrator/AiControlPage.tsx` — nothing checks the mirror. */
export interface AiStatusDto {
  readonly receivedAt: string
  readonly stale: boolean
  readonly report: AiStatusPush
}

export interface AiControlDto {
  readonly config: (AgentConfigDto & { readonly parked: readonly string[] }) | null
  readonly status: AiStatusDto | null
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
  /**
   * The last save that stopped or started the AI — who and when, for «Toʻxtatilgan ·
   * umida, 04.11 15:30». Null when the history shown has none (never switched).
   */
  readonly switched: { readonly version: number; readonly savedAt: string; readonly savedBy: string } | null
}

/** The 5 s read of «Boshqaruv» — the agent's last report and nothing else. Mirrored in `AiControlPage.tsx`. */
export interface AiLiveDto {
  readonly status: AiStatusDto | null
  readonly staleAfterSec: number
}

const HISTORY = 20

/**
 * A report stored before the panel knew a field (`live`, a seller's product)
 * reads as the agent sends it now — `live: null`, `aiRinging: false` — so the
 * page never meets a half-shaped row. One that no longer parses at all is
 * passed on as stored, as before.
 */
function statusDto(status: StoredStatus | null, now: Date): AiStatusDto | null {
  if (!status) return null
  const parsed = aiStatusSchema.safeParse(status.payload)
  return {
    receivedAt: status.receivedAt.toISOString(),
    stale: statusIsStale(status.receivedAt, now),
    report: parsed.success ? parsed.data : status.payload,
  }
}

/** «AI: ishlayapti → toʻxtatildi» — the stop in the audit, in the owner's words. */
function enabledLine(before: unknown, after: unknown): string {
  if (before === null || before === undefined) return `AI: ${after === false ? 'toʻxtatilgan' : 'ishlayapti'}`
  return after === false ? 'AI: ishlayapti → toʻxtatildi' : 'AI: toʻxtatildi → yoqildi'
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  maxCalls: 'Bir vaqtda',
  maxNew: 'Yangi lidlarga',
  maxRetry: 'Nedozvonga',
  saleHandoff: 'Sotuvni ATSga topshirish',
}

function agentConfig(config: StoredConfig): AgentConfigDto {
  return {
    version: config.version,
    enabled: config.enabled,
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
    if (c.field === 'enabled') return [enabledLine(c.before, c.after)]
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

  /**
   * What the page polls every 5 s: the one status row by its key. The panel's
   * other reads (settings, audit, the roster for names) stay on its slower
   * cadence — the database has one core (2026-10-31).
   */
  async live(now: Date): Promise<AiLiveDto> {
    return { status: statusDto(await this.repository.status(), now), staleAfterSec: STATUS_STALE_MS / 1000 }
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

    const switched = changes.find((c) => c.changes.some((f) => f.field === 'enabled'))
    return {
      config: config ? { ...agentConfig(config), parked: config.parked } : null,
      status: statusDto(status, now),
      names,
      rules: { aiLines: AI_OWN_LINES, maxCalls: MAX_CALLS_LIMIT, maxSellers: MAX_SELLERS, staleAfterSec: STATUS_STALE_MS / 1000 },
      history: changes.map((c) => ({
        version: c.version,
        savedAt: c.savedAt.toISOString(),
        savedBy: c.savedBy,
        lines: changeLines(c.changes),
      })),
      switched: switched ? { version: switched.version, savedAt: switched.savedAt.toISOString(), savedBy: switched.savedBy } : null,
    }
  }

  /**
   * «Saqlash». Every rule the agent applies is checked here first and ALL the
   * problems are named in one refusal; nothing is written unless the whole
   * setting passes. A save that changes nothing is refused too — a version
   * the agent would re-apply for nothing, and an audit line that says nothing.
   */
  async save(body: ControlSave, by: { readonly label: string; readonly userId: string }): Promise<AgentConfigDto> {
    const current = await this.repository.config()
    const settings: ControlSettings = {
      sellers: normaliseSellers(body.sellers),
      parked: normaliseSellers(body.parked),
      maxCalls: body.maxCalls,
      maxNew: body.maxNew,
      maxRetry: body.maxRetry,
      saleHandoff: body.saleHandoff,
      // «Saqlash» never switches the AI: the stored state stays. A stopped AI
      // whose seller list is changed stays stopped. The row's version lock
      // makes this read safe — a stop saved after it fails the save as stale.
      enabled: current?.enabled ?? true,
    }
    const raw = (list: readonly string[]) => list.map((s) => s.trim()).filter((s) => s !== '')
    const problems = controlProblems({ ...settings, sellers: raw(body.sellers), parked: raw(body.parked) })
    if (problems.length > 0) {
      throw ApiError.validation(
        problems.join(' '),
        problems.map((message) => ({ path: 'settings', message })),
      )
    }

    if (current && current.version === body.baseVersion && controlChanges(current, settings).length === 0) {
      throw ApiError.validation('Hech narsa oʻzgarmadi — saqlash shart emas.')
    }

    return this.write(settings, body.baseVersion, by)
  }

  /**
   * «Toʻxtatish» / «Yoqish»: the next version with ONLY `enabled` changed —
   * sellers, parked, limits and hand-off exactly as stored. Refused before a
   * first save (there is nothing for the agent to read the stop from), when it
   * changes nothing, and over a newer version, like any save.
   */
  async setEnabled(body: ControlEnabled, by: { readonly label: string; readonly userId: string }): Promise<AgentConfigDto> {
    const current = await this.repository.config()
    if (!current) throw ApiError.validation('Avval sozlamani saqlang — AI toʻxtatish buyrugʻini sozlama bilan oʻqiydi.')

    const { version: _version, updatedAt: _at, updatedBy: _by, ...stored } = current
    const settings: ControlSettings = { ...stored, enabled: body.enabled }
    if (current.version === body.baseVersion && controlChanges(current, settings).length === 0) {
      throw ApiError.validation(body.enabled ? 'AI allaqachon yoqilgan.' : 'AI allaqachon toʻxtatilgan.')
    }

    return this.write(settings, body.baseVersion, by)
  }

  private async write(
    settings: ControlSettings,
    baseVersion: number,
    by: { readonly label: string; readonly userId: string },
  ): Promise<AgentConfigDto> {
    try {
      const saved = await this.repository.save(settings, baseVersion, by, (before) => controlChanges(before, settings))
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
