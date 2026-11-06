import {
  ACTION_LABEL,
  ACTION_MAX_AGE_MS,
  type ActionKind,
  type AiTuning,
  MAX_ACTIONS,
  NEVER_AI_LINES,
  TUNING_LABEL,
  type TransferOrder,
  type WhyUs,
  linesOffProblems,
  normalLinesOff,
  pauseProblems,
  tashkentIso,
  tuningDiff,
  tuningProblems,
  tuningValueText,
} from '@/lib/aiControlRules'
import { type WorkHours, daysText, lunchText, normalDays, sameHours, workHoursProblems, workText } from '@/lib/aiWorkHours'
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
import {
  type AiStatusPush,
  type ControlAction,
  type ControlEnabled,
  type ControlHours,
  type ControlLines,
  type ControlPause,
  type ControlSave,
  type ControlTuning,
  aiStatusSchema,
} from '@/server/integrations/aiRegistrator/control'
import {
  type AiRegistratorControlRepository,
  type StoredAction,
  type StoredConfig,
  type StoredStatus,
  StaleVersionError,
} from '@/server/repositories/aiRegistratorControlRepository'

type By = { readonly label: string; readonly userId: string }

/** A press as the agent reads it in its config — `check_action`. */
export interface AgentActionDto {
  readonly id: number
  readonly kind: string
  /** The line, for «reregister», «add_line», «remove_line». */
  readonly line?: string
  /** When it was pressed, Tashkent with the offset — the agent does none older than ten minutes. */
  readonly at: string
  readonly by: string
  /** add_line (T123): «Kollagen» | «Zekstra». */
  readonly product?: string
  /** add_line (T123): «udp» | «tls». */
  readonly transport?: string
  /** add_line (T123): the password sealed in the browser with the agent's key — never the password. */
  readonly secret?: string
}

/** An add_line press's `params` as stored — anything else reads as none. */
function lineParams(params: unknown): { product: string; transport: string } | null {
  if (typeof params !== 'object' || params === null) return null
  const { product, transport } = params as Record<string, unknown>
  return typeof product === 'string' && typeof transport === 'string' ? { product, transport } : null
}

/**
 * One open press as the agent reads it — null for an add_line whose sealed
 * password is gone (answered, or stale): the agent has done it, or never will.
 */
function agentAction(a: StoredAction): AgentActionDto | null {
  const base = { id: a.id, kind: a.kind, ...(a.line ? { line: a.line } : {}), at: tashkentIso(a.requestedAt), by: a.requestedBy }
  if (a.kind !== 'add_line') return base
  const params = lineParams(a.params)
  if (a.state !== null || !a.secret || !params) return null
  return { ...base, product: params.product, transport: params.transport, secret: a.secret }
}

/** A press and its answer, for the panel — mirrored in `AiControlPage.tsx`. */
export interface ActionDto {
  readonly id: number
  readonly kind: string
  readonly line: string | null
  readonly requestedAt: string
  readonly requestedBy: string
  readonly state: string | null
  readonly text: string | null
  readonly answeredAt: string | null
}

const actionDto = (a: StoredAction): ActionDto => ({
  id: a.id,
  kind: a.kind,
  line: a.line,
  requestedAt: a.requestedAt.toISOString(),
  requestedBy: a.requestedBy,
  state: a.state,
  text: a.text,
  answeredAt: a.answeredAt ? a.answeredAt.toISOString() : null,
})

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
  /**
   * «Ish vaqti» — present only once saved here. Left out, the agent keeps its
   * own .env hours (its `cfg.get("hours")` reads a missing key as «not set»).
   * `days` only when not every day — an empty list would be refused.
   */
  readonly hours?: { readonly start: string; readonly end: string; readonly lunchStart: string | null; readonly lunchEnd: string | null; readonly days?: readonly number[] }
  /** «Vaqtincha toʻxtatish» (T144) — only while it is ahead, Tashkent with the offset. */
  readonly pauseUntil?: string
  /** AI lines switched off (T144) — only when any. */
  readonly linesOff?: readonly string[]
  /** «Qoʻshimcha sozlamalar» (T144) — only once saved, all seven. */
  readonly tuning?: AiTuning
  /** The open presses (T144) — not a version: the agent reads them on every poll. */
  readonly actions?: readonly AgentActionDto[]
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
  /** `hours`, `pauseUntil`, `linesOff`, `tuning` always present here — null / [] while not set. */
  readonly config:
    | (Omit<AgentConfigDto, 'hours' | 'pauseUntil' | 'linesOff' | 'tuning' | 'actions'> & {
        readonly parked: readonly string[]
        readonly hours: WorkHours | null
        /** The saved pause (ISO, UTC) — kept after it ran out; the page reads it against the clock. */
        readonly pauseUntil: string | null
        readonly linesOff: readonly string[]
        readonly tuning: AiTuning | null
      })
    | null
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
  /** The last save that changed «Ish vaqti» — who and when. Null when the history shown has none. */
  readonly hoursSet: { readonly version: number; readonly savedAt: string; readonly savedBy: string } | null
  /** The last save that paused or went on (T144). */
  readonly pauseSet: { readonly version: number; readonly savedAt: string; readonly savedBy: string } | null
  /** The last save of «Qoʻshimcha sozlamalar» (T144). */
  readonly tuningSet: { readonly version: number; readonly savedAt: string; readonly savedBy: string } | null
  /** The newest presses and their answers (T144), newest first. */
  readonly actions: readonly ActionDto[]
  /** «AI liniya qoʻshish» / «Olib tashlash» shown (T123): the owner's administrator account only. */
  readonly canManageLines: boolean
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

/**
 * «Ish vaqti: 09:00–22:00 → 08:00–23:00», «Tushlik: 12:30–13:30 → yoʻq» — only
 * the half that changed. The first hours ever set read without an arrow, as
 * every field of a first save does: what ran before was the agent's own.
 */
function hoursLines(before: WorkHours | null, after: WorkHours | null): string[] {
  if (after === null) return before === null ? [] : ['Ish vaqti: AI serverining oʻz vaqtiga qaytdi']
  if (before === null) {
    const first = [`Ish vaqti: ${workText(after)}`, `Tushlik: ${lunchText(after)}`]
    return normalDays(after.days) === null ? first : [...first, `Ish kunlari: ${daysText(after.days)}`]
  }
  const out: string[] = []
  if (workText(before) !== workText(after)) out.push(`Ish vaqti: ${workText(before)} → ${workText(after)}`)
  if (lunchText(before) !== lunchText(after)) out.push(`Tushlik: ${lunchText(before)} → ${lunchText(after)}`)
  if (daysText(before.days) !== daysText(after.days)) out.push(`Ish kunlari: ${daysText(before.days)} → ${daysText(after.days)}`)
  return out
}

/** «21:30» today, «05.11 09:00» another day — a pause's end as the audit prints it. */
function pauseEndText(iso: string): string {
  const local = tashkentIso(new Date(iso))
  return `${local.slice(8, 10)}.${local.slice(5, 7)} ${local.slice(11, 16)}`
}

/** «Pauza: 05.11 21:30 gacha», «Pauza: bekor qilindi». */
function pauseLines(before: string | null, after: string | null): string[] {
  if (after !== null) return [`Pauza: ${pauseEndText(after)} gacha`]
  return before === null ? [] : ['Pauza: bekor qilindi — AI davom etadi']
}

/** «Liniya 291: oʻchirildi», «Liniya 291: yoqildi». */
function linesLines(before: readonly string[], after: readonly string[]): string[] {
  return [
    ...after.filter((l) => !before.includes(l)).map((l) => `Liniya ${l}: oʻchirildi`),
    ...before.filter((l) => !after.includes(l)).map((l) => `Liniya ${l}: yoqildi`),
  ]
}

/** «Nedozvonga kuniga: 5 marta → 3 marta» — only the keys that changed; the first save names all seven. */
function tuningLines(before: AiTuning | null, after: AiTuning | null): string[] {
  if (after === null) return before === null ? [] : ['Qoʻshimcha sozlamalar: AI serverining oʻz qiymatlariga qaytdi']
  return tuningDiff(before, after).map((k) =>
    before === null ? `${TUNING_LABEL[k]}: ${tuningValueText(k, after[k])}` : `${TUNING_LABEL[k]}: ${tuningValueText(k, before[k])} → ${tuningValueText(k, after[k])}`,
  )
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  maxCalls: 'Bir vaqtda',
  maxNew: 'Yangi lidlarga',
  maxRetry: 'Nedozvonga',
  saleHandoff: 'Sotuvni ATSga topshirish',
}

/** The hours as the agent reads them: `days` only when not every day. */
function agentHours(hours: WorkHours): NonNullable<AgentConfigDto['hours']> {
  const days = normalDays(hours.days)
  return { start: hours.start, end: hours.end, lunchStart: hours.lunchStart, lunchEnd: hours.lunchEnd, ...(days ? { days } : {}) }
}

/**
 * What the agent reads. Every field of 2026-11-04 is left out while not set
 * here, so an agent that does not know it reads the config as before and one
 * that does keeps its own value: a pause only while it is ahead, the lines
 * only when any is off, the tuning only once saved, the presses only when open.
 */
function agentConfig(config: StoredConfig, now: Date = new Date(), open: readonly StoredAction[] = []): AgentConfigDto {
  const actions = open.map(agentAction).filter((a): a is AgentActionDto => a !== null)
  const pause = config.pauseUntil !== null && new Date(config.pauseUntil).getTime() > now.getTime() ? config.pauseUntil : null
  return {
    version: config.version,
    enabled: config.enabled,
    sellers: config.sellers,
    maxCalls: config.maxCalls,
    maxNew: config.maxNew,
    maxRetry: config.maxRetry,
    saleHandoff: config.saleHandoff,
    ...(config.hours ? { hours: agentHours(config.hours) } : {}),
    ...(pause ? { pauseUntil: tashkentIso(new Date(pause)) } : {}),
    ...(config.linesOff.length > 0 ? { linesOff: config.linesOff } : {}),
    ...(config.tuning ? { tuning: config.tuning } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    updatedAt: config.updatedAt.toISOString(),
    updatedBy: config.updatedBy,
  }
}

/** The AI lines the agent last reported (T144) — empty from an agent older than them. */
function reportedLines(status: StoredStatus | null): NonNullable<AiStatusPush['aiLines']> {
  const parsed = status ? aiStatusSchema.safeParse(status.payload) : null
  return parsed?.success ? (parsed.data.aiLines ?? []) : []
}

/** The agent's last word on adding a line (T123) — absent from an agent older than the form. */
function reportedLineAdd(status: StoredStatus | null): Pick<AiStatusPush, 'lineKey' | 'lineAdd'> {
  const parsed = status ? aiStatusSchema.safeParse(status.payload) : null
  return parsed?.success ? { lineKey: parsed.data.lineKey, lineAdd: parsed.data.lineAdd } : {}
}

/** A panel line the ATS refused or Asterisk never loaded — out of Asterisk, may be added again. */
const LINE_DOWN = new Set(['bad_password', 'not_loaded'])

/** The SIP words for a line on a call — closing its socket or re-registering would cut it. */
const ON_A_CALL = new Set(['call', 'seller_talk'])

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
    if (c.field === 'hours') return hoursLines((c.before as WorkHours | null) ?? null, (c.after as WorkHours | null) ?? null)
    if (c.field === 'pauseUntil') return pauseLines((c.before as string | null) ?? null, (c.after as string | null) ?? null)
    if (c.field === 'linesOff') return linesLines((c.before as string[] | null) ?? [], (c.after as string[] | null) ?? [])
    if (c.field === 'tuning') return tuningLines((c.before as AiTuning | null) ?? null, (c.after as AiTuning | null) ?? null)
    const label = FIELD_LABEL[c.field] ?? c.field
    return [c.before === null ? `${label}: ${String(c.after)}` : `${label}: ${String(c.before)} → ${String(c.after)}`]
  })
}

export class AiRegistratorControlService {
  constructor(
    private readonly repository: AiRegistratorControlRepository,
    private readonly roster: () => Promise<{ id: string; fullName: string }[]>,
  ) {}

  /** For the agent: the current setting with the open presses, or null before the first save. */
  async agentConfig(now: Date = new Date()): Promise<AgentConfigDto | null> {
    const config = await this.repository.config()
    if (!config) return null
    const since = new Date(now.getTime() - ACTION_MAX_AGE_MS)
    // a sealed password the agent will never read again is not kept (T123)
    await this.repository.dropSecrets(since)
    const open = await this.repository.openActions(since, MAX_ACTIONS)
    return agentConfig(config, now, open)
  }

  /** The last report, and the answers it carries written onto the presses still open (T144). */
  async putStatus(status: AiStatusPush, now: Date): Promise<void> {
    await this.repository.putStatus(status, now)
    const answers = (status.actions ?? []).map((a) => ({ id: a.id, state: a.state, text: a.text, at: new Date(a.at) }))
    if (answers.length > 0) await this.repository.answerActions(answers)
  }

  /**
   * What the page polls every 5 s: the one status row by its key. The panel's
   * other reads (settings, audit, the roster for names) stay on its slower
   * cadence — the database has one core (2026-10-31).
   */
  async live(now: Date): Promise<AiLiveDto> {
    return { status: statusDto(await this.repository.status(), now), staleAfterSec: STATUS_STALE_MS / 1000 }
  }

  async panel(now: Date, canManageLines = false): Promise<AiControlDto> {
    const [config, status, changes, roster, actions] = await Promise.all([
      this.repository.config(),
      this.repository.status(),
      this.repository.changes(HISTORY),
      this.roster(),
      this.repository.actions(HISTORY),
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
    const hoursSet = changes.find((c) => c.changes.some((f) => f.field === 'hours'))
    const pauseSet = changes.find((c) => c.changes.some((f) => f.field === 'pauseUntil'))
    const tuningSet = changes.find((c) => c.changes.some((f) => f.field === 'tuning'))
    const who = (c: (typeof changes)[number] | undefined) => (c ? { version: c.version, savedAt: c.savedAt.toISOString(), savedBy: c.savedBy } : null)
    const agent = config ? agentConfig(config, now) : null
    return {
      config:
        config && agent
          ? {
              version: agent.version,
              enabled: agent.enabled,
              sellers: agent.sellers,
              maxCalls: agent.maxCalls,
              maxNew: agent.maxNew,
              maxRetry: agent.maxRetry,
              saleHandoff: agent.saleHandoff,
              updatedAt: agent.updatedAt,
              updatedBy: agent.updatedBy,
              parked: config.parked,
              hours: config.hours,
              pauseUntil: config.pauseUntil,
              linesOff: config.linesOff,
              tuning: config.tuning,
            }
          : null,
      status: statusDto(status, now),
      names,
      rules: { aiLines: AI_OWN_LINES, maxCalls: MAX_CALLS_LIMIT, maxSellers: MAX_SELLERS, staleAfterSec: STATUS_STALE_MS / 1000 },
      history: changes.map((c) => ({
        version: c.version,
        savedAt: c.savedAt.toISOString(),
        savedBy: c.savedBy,
        lines: changeLines(c.changes),
      })),
      switched: who(switched),
      hoursSet: who(hoursSet),
      pauseSet: who(pauseSet),
      tuningSet: who(tuningSet),
      actions: actions.map(actionDto),
      canManageLines,
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
      // Nor does it carry the hours: they stay as stored («Ish vaqti» saves them alone).
      hours: current?.hours ?? null,
      // Nor the pause, the lines switched off or the tuning (T144) — each saved alone.
      pauseUntil: current?.pauseUntil ?? null,
      linesOff: current?.linesOff ?? [],
      tuning: current?.tuning ?? null,
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

  /**
   * «Ish vaqti → Saqlash»: the next version with ONLY `hours` changed. The
   * agent's rules first, every problem named — it would refuse the whole
   * config over one, the sellers and limits with it. Refused before a first
   * save, when nothing changed, and over a newer version, like any save.
   */
  async setHours(body: ControlHours, by: { readonly label: string; readonly userId: string }): Promise<AgentConfigDto> {
    const current = await this.repository.config()
    if (!current) throw ApiError.validation('Avval sozlamani saqlang — AI ish vaqtini sozlama bilan oʻqiydi.')

    const raw: WorkHours = { start: body.hours.start, end: body.hours.end, lunchStart: body.hours.lunchStart, lunchEnd: body.hours.lunchEnd, days: body.hours.days ?? null }
    const problems = workHoursProblems(raw)
    if (problems.length > 0) {
      throw ApiError.validation(
        problems.join(' '),
        problems.map((message) => ({ path: 'hours', message })),
      )
    }

    // Stored as the agent reads them: the days sorted, once each — left out for all seven.
    const days = normalDays(raw.days)
    const hours: WorkHours = { start: raw.start, end: raw.end, lunchStart: raw.lunchStart, lunchEnd: raw.lunchEnd, ...(days ? { days } : {}) }
    const { version: _version, updatedAt: _at, updatedBy: _by, ...stored } = current
    if (current.version === body.baseVersion && sameHours(current.hours, hours)) {
      throw ApiError.validation('Ish vaqti oʻzgarmadi — saqlash shart emas.')
    }

    return this.write({ ...stored, hours }, body.baseVersion, by)
  }

  /**
   * «Vaqtincha toʻxtatish» / «Davom ettirish» (T144): the next version with
   * ONLY `pauseUntil` changed. A pause is ahead of now and at most seven days
   * away (the agent's rule); null ends one that is running. Refused before a
   * first save, when it changes nothing, and over a newer version.
   */
  async setPause(body: ControlPause, by: By, now: Date): Promise<AgentConfigDto> {
    const current = await this.repository.config()
    if (!current) throw ApiError.validation('Avval sozlamani saqlang — AI pauzani sozlama bilan oʻqiydi.')
    const running = current.pauseUntil !== null && new Date(current.pauseUntil).getTime() > now.getTime()
    if (body.pauseUntil === null) {
      if (!running) throw ApiError.validation('Pauza yoʻq — davom ettirish shart emas.')
    } else {
      const problems = pauseProblems(body.pauseUntil, now)
      if (problems.length > 0) {
        throw ApiError.validation(
          problems.join(' '),
          problems.map((message) => ({ path: 'pauseUntil', message })),
        )
      }
    }
    const pauseUntil = body.pauseUntil === null ? null : new Date(body.pauseUntil).toISOString()
    if (pauseUntil !== null && pauseUntil === current.pauseUntil) throw ApiError.validation('Pauza shu vaqtgacha allaqachon qoʻyilgan.')
    const { version: _version, updatedAt: _at, updatedBy: _by, ...stored } = current
    return this.write({ ...stored, pauseUntil }, body.baseVersion, by)
  }

  /**
   * The AI lines switched off (T144): the next version with ONLY `linesOff`
   * changed. Read against the lines the agent last reported — a number not its
   * own is dropped, as the agent drops it — and one main line at least stays on.
   * An agent that does not report its lines yet cannot be told which to leave.
   */
  async setLinesOff(body: ControlLines, by: By): Promise<AgentConfigDto> {
    const [current, status] = await Promise.all([this.repository.config(), this.repository.status()])
    if (!current) throw ApiError.validation('Avval sozlamani saqlang — AI liniyalarni sozlama bilan oʻqiydi.')
    const lines = reportedLines(status)
    if (lines.length === 0) throw ApiError.validation('AI serveri liniyalar roʻyxatini hali yubormayapti — liniya oʻchirish u yangilangach ishlaydi.')
    const linesOff = normalLinesOff(body.linesOff, lines)
    const problems = linesOffProblems(linesOff, lines)
    if (problems.length > 0) {
      throw ApiError.validation(
        problems.join(' '),
        problems.map((message) => ({ path: 'linesOff', message })),
      )
    }
    if (current.version === body.baseVersion && linesOff.join(',') === current.linesOff.join(',')) {
      throw ApiError.validation('Liniyalar oʻzgarmadi — saqlash shart emas.')
    }
    const { version: _version, updatedAt: _at, updatedBy: _by, ...stored } = current
    return this.write({ ...stored, linesOff }, body.baseVersion, by)
  }

  /**
   * «Qoʻshimcha sozlamalar → Saqlash» (T144): the next version with ONLY
   * `tuning` changed — all seven together. The agent's bounds first, every
   * problem named; it would refuse the whole config over one.
   */
  async setTuning(body: ControlTuning, by: By): Promise<AgentConfigDto> {
    const current = await this.repository.config()
    if (!current) throw ApiError.validation('Avval sozlamani saqlang — AI qoʻshimcha sozlamalarni sozlama bilan oʻqiydi.')
    const tuning: AiTuning = { ...body.tuning, transferOrder: body.tuning.transferOrder as TransferOrder, whyUs: body.tuning.whyUs as WhyUs }
    const problems = tuningProblems(tuning)
    if (problems.length > 0) {
      throw ApiError.validation(
        problems.join(' '),
        problems.map((message) => ({ path: 'tuning', message })),
      )
    }
    if (current.version === body.baseVersion && current.tuning !== null && tuningDiff(current.tuning, tuning).length === 0) {
      throw ApiError.validation('Qoʻshimcha sozlamalar oʻzgarmadi — saqlash shart emas.')
    }
    const { version: _version, updatedAt: _at, updatedBy: _by, ...stored } = current
    return this.write({ ...stored, tuning }, body.baseVersion, by)
  }

  /**
   * A one-off press (T144) — «Qayta ulash» of one AI line, or «TLSʼni
   * yangilash». Not a version: a row the agent reads with its next config and
   * does once. Asked only while the agent speaks (a fresh report) and of what
   * its last report shows needs it — a line not registered; every TLS line
   * down with no call on one — and never twice while one is still open. The
   * agent keeps its own guard (the ATS ban rule, its intervals) and says why
   * when it refuses.
   */
  async requestAction(body: ControlAction, by: By, now: Date): Promise<ActionDto> {
    const [current, status] = await Promise.all([this.repository.config(), this.repository.status()])
    if (!current) throw ApiError.validation('Avval sozlamani saqlang — AI tugmalarni sozlama bilan oʻqiydi.')
    if (!status || statusIsStale(status.receivedAt, now)) {
      throw ApiError.validation('AIdan yangi xabar yoʻq — bu tugma AI javob berib turganda ishlaydi.')
    }
    const lines = reportedLines(status)
    if (lines.length === 0) throw ApiError.validation('AI serveri liniyalar holatini hali yubormayapti — tugma u yangilangach ishlaydi.')
    const action = body.action
    const kind: ActionKind = action.kind
    const line = action.kind === 'tls_reset' ? null : action.line
    const open = await this.repository.openActions(new Date(now.getTime() - ACTION_MAX_AGE_MS), MAX_ACTIONS)

    if (action.kind === 'add_line') {
      // One line at a time, the agent's ATS guard first (29.10: one failure per IP in all).
      const { lineKey, lineAdd } = reportedLineAdd(status)
      if (lineKey === undefined || lineAdd === undefined) throw ApiError.validation('AI serveri liniya qoʻshishni hali bilmaydi — u yangilangach ishlaydi.')
      if (lineKey === null) throw ApiError.validation('AI serverida parol kaliti yoʻq — liniya qoʻshib boʻlmaydi.')
      if (lineAdd && !lineAdd.allowed) throw ApiError.validation(`Hozir qoʻshib boʻlmaydi: ${lineAdd.text ?? 'AI serveri ruxsat bermadi'}.`)
      const busy = open.find((a) => a.kind === 'add_line')
      if (busy) throw ApiError.validation(`${busy.line ?? 'Liniya'} hali qoʻshilmoqda — liniyalar bittadan qoʻshiladi, natijasini kuting.`)
      if (NEVER_AI_LINES.includes(action.line)) throw ApiError.validation(`${action.line} — egasining MicroSIPi, AI liniyasi boʻlmaydi.`)
      const it = lines.find((l) => l.ext === action.line)
      if (it && !LINE_DOWN.has(it.stage ?? '')) throw ApiError.validation(`${action.line} allaqachon AI liniyasi.`)
      if (current.sellers.includes(action.line) || current.parked.includes(action.line)) {
        throw ApiError.validation(`${action.line} — sotuvchi raqami (ulash roʻyxatida), AI liniyasi boʻlmaydi.`)
      }
      return actionDto(
        await this.repository.createAction({
          kind,
          line: action.line,
          requestedAt: now,
          by,
          params: { product: action.product, transport: action.transport },
          secret: action.secret,
        }),
      )
    }

    if (action.kind === 'remove_line') {
      const it = lines.find((l) => l.ext === action.line)
      if (!it) throw ApiError.validation(`${action.line} — AI liniyasi emas.`)
      if (it.removable !== true) throw ApiError.validation(`${action.line} AI serverining oʻz liniyasi — paneldan olib tashlanmaydi.`)
    } else if (line !== null) {
      const it = lines.find((l) => l.ext === line)
      // a line the agent reports is its own — a panel-added one too (T123)
      if (!it) throw ApiError.validation(`${line} — AI liniyasi emas.`)
      if (it.registration === 'Registered') throw ApiError.validation(`${line} ATSda roʻyxatda (Registered) — qayta ulash kerak emas.`)
    } else {
      const tls = lines.filter((l) => l.transport === 'tls')
      if (tls.length === 0) throw ApiError.validation('TLS liniya yoʻq — yangilash kerak emas.')
      const up = tls.filter((l) => l.registration === 'Registered').map((l) => l.ext)
      if (up.length > 0) throw ApiError.validation(`TLS ulanishi ishlayapti (${up.join(', ')} Registered) — tushgan liniyani «Qayta ulash» bilan ulang.`)
      const busy = tls.filter((l) => ON_A_CALL.has(l.state)).map((l) => l.ext)
      if (busy.length > 0) throw ApiError.validation(`${busy.join(', ')} liniyasida qoʻngʻiroq bor — tugagach bosing.`)
    }

    const waiting = open.find((a) => a.kind === kind && a.line === line)
    if (waiting) {
      const what = line ? `${line} uchun «${ACTION_LABEL[kind]}»` : `«${ACTION_LABEL[kind]}»`
      throw ApiError.validation(`${what} soʻrovi hali javob kutmoqda — AI javobini kuting.`)
    }
    return actionDto(await this.repository.createAction({ kind, line, requestedAt: now, by }))
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
