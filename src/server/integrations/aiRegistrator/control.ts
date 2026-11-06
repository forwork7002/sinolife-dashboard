/**
 * The two bodies of the AI registrator's control contract — see
 * `domain/aiRegistrator/control.ts` for what the panel is.
 *
 *   GET  /api/ai-registrator/config  → { version, enabled, sellers, maxCalls,
 *        maxNew, maxRetry, saleHandoff, hours?, updatedAt, updatedBy }   (404 until saved)
 *   POST /api/ai-registrator/status  ← what the agent runs, every 5 s while a
 *        line is busy, else every 30 s
 *
 * The STATUS is validated for shape and bounded in size, and kept as sent:
 * a line state or a seller state the agent learns tomorrow («seller_talk»
 * arrived before this was written) must still be stored and shown as given,
 * not refused — the same rule `ingest.ts` keeps for an outcome.
 *
 * `live` (2026-10-31, the owner: «qaysi SIP'lardan, kim kimga ulanayapti,
 * real vaqtda») is who each AI line talks to now and the last put-throughs —
 * `ai_registrator/app/telephony/live.py`. It is the newest part of the
 * report, so it is the part that may not fail it: an element the agent got
 * wrong is dropped, a `live` that is not one at all reads as null, and the
 * limits, lines and sellers beside it are stored as ever.
 *
 * 2026-11-02 (ai_registrator ca9c52a) — all OPTIONAL, each falling back on its
 * own: `live.lines[].started` (the whole call's start, the lane's timer),
 * `live.events[]` (the last ≤50 things that happened, newest first — the live
 * feed), `sellers[].word` / `since` (the ATS presence word and since when),
 * `flags` (why the agent is not dialling) and `limits.transferOrder`.
 *
 * 2026-11-04 (the stop button) — `enabled` in the CONFIG is always a real
 * boolean: the agent refuses the whole config over one that is not
 * (`applyError`), so ISH never sends it missing or null. Back in the STATUS,
 * both optional: top-level `enabled` (the state the agent applied) and
 * `flags.stopped`. An agent that sends neither predates the button — it
 * ignores `enabled` and keeps dialling, and the panel says so.
 *
 * 2026-11-04 (ai_registrator d0abf97, «Ish vaqti») — `hours` in the CONFIG:
 * `{ start, end, lunchStart, lunchEnd }`, «HH:MM», the lunch both null for
 * none; LEFT OUT while not set here (the agent keeps its own .env hours). The
 * agent refuses the whole config over hours that break `check_hours`, so they
 * are checked before a save (`@/lib/aiWorkHours`). Back in the STATUS,
 * optional: top-level `hours` — `{ start, end, lunchStart, lunchEnd,
 * sellersStart, sellersEnd }`, what the agent runs NOW (its .env ones while
 * none is set). Each value on its own: one that is not a clock reads as null,
 * a `hours` that is not an object as absent — never a refused report.
 *
 * 2026-11-04 (ai_registrator 2bc906f, T144 — «hamma narsani boshqara olsin»),
 * all OPTIONAL in the CONFIG, each left out while not set here: `pauseUntil`
 * (ISO with the offset, «2026-11-04T21:30:00+05:00»; only while ahead),
 * `hours.days` (ISO weekdays; left out = every day), `linesOff` (left out =
 * all on), `tuning` (all seven keys; left out = the agent's own) and
 * `actions` — the open one-off presses `[{ id, kind, line?, at, by }]`, read
 * by the agent on EVERY poll (not a version). Back in the STATUS, optional and
 * each on its own: `pausedUntil`, `flags.paused` / `flags.day_off`,
 * `hours.days`, `aiLines[]` (each line's pool, transport, state, ATS
 * registration, on/off), `tuning` (what it runs) and `actions[]` (its answers,
 * newest first). One the agent got wrong is dropped alone, the report stored.
 */

import { z } from 'zod'

import { LINE_PRODUCTS, LINE_TRANSPORTS, MAX_ACTIONS } from '@/lib/aiControlRules'
import { CLOCK_PATTERN } from '@/lib/aiWorkHours'
import { EXTENSION_PATTERN, MAX_CALLS_LIMIT, MAX_SELLERS, SALE_HANDOFFS } from '@/server/domain/aiRegistrator/control'

const instant = z.iso.datetime({ offset: true })
const word = z.string().trim().regex(/^[a-z_]{1,32}$/)
const count = z.number().int().min(0).max(1_000_000)
const ext = z.string().trim().min(1).max(20)

/** A line state or an outcome the agent may coin later — shown raw until the panel learns it. */
const liveWord = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/)
const deal = z.number().int().min(0).nullable().default(null)
const product = z.string().trim().max(40).nullable().default(null)

/**
 * The client's first name, as the agent takes it from Bitrix24 — with every
 * digit dropped: the repo is public and a phone number never reaches the
 * panel, even one typed into a name field.
 */
const clientName = z.string().transform((s) => s.replace(/[\d+]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60))

/** One AI line's call now: dialing → talking → transfer → ringing_seller → with_seller. */
const liveCall = z.object({
  line: ext,
  deal,
  product,
  client: clientName.default(''),
  test: z.boolean().default(false),
  state: liveWord,
  since: instant,
  seller: ext.nullable().default(null),
  connected: z.boolean().optional(),
  started: instant.optional().catch(undefined),
})

/** A call put through to a seller («connected»), or one that ended after the client answered. */
const liveEvent = z.object({
  at: instant,
  line: ext,
  deal,
  product,
  client: clientName.default(''),
  test: z.boolean().default(false),
  what: liveWord,
  seller: ext.nullable().default(null),
  started: instant.optional().catch(undefined),
})

/** Each element on its own, at most `max` of them: one that is wrong is dropped, never the report it came in. */
function each<T extends z.ZodType>(schema: T, max: number) {
  return z.array(z.unknown()).transform((items) =>
    items.slice(0, max).flatMap((item) => {
      const parsed = schema.safeParse(item)
      return parsed.success ? [parsed.data as z.output<T>] : []
    }),
  )
}

const liveSchema = z.object({
  lines: each(liveCall, 32).default([]),
  recent: each(liveEvent, 50).default([]),
  events: each(liveEvent, 50).default([]),
})

const flag = z.boolean().optional().catch(undefined)

/** Why the agent is not dialling now — each a yes / no; `active_calls` a count. */
const flagsSchema = z.object({
  held: flag,
  /** Stopped from the panel («Toʻxtatish») — `enabled: false` applied. */
  stopped: flag,
  ats_paused: flag,
  credits_out: flag,
  no_specialist: flag,
  no_free_specialist: flag,
  legs_full: flag,
  fused: flag,
  /** «Vaqtincha toʻxtatish» running (T144). */
  paused: flag,
  /** Today is not one of the panel's working days (T144). */
  day_off: flag,
  active_calls: count.optional().catch(undefined),
})

/** «HH:MM» in a report, or null — anything else the agent sends reads as null, never a refusal. */
const reportedClock = z.string().trim().regex(CLOCK_PATTERN).nullable().catch(null)

/** The hours the agent runs now: the calling window, the lunch, the sellers' day. */
const hoursReportSchema = z.object({
  start: reportedClock,
  end: reportedClock,
  lunchStart: reportedClock,
  lunchEnd: reportedClock,
  sellersStart: reportedClock,
  sellersEnd: reportedClock,
  /** The working days the agent runs (T144), ISO weekdays; null every day. */
  days: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional().catch(undefined),
})

/** A short word the agent writes as it is («Registered», «Rejected», «missing») — shown raw, never a refusal. */
const rawWord = z.string().trim().max(40)

/** One AI line (T144): its pool, transport, what it does now, its ATS registration, on or off on the panel. */
const aiLineSchema = z.object({
  // A line the panel can switch and press for — a real extension, or the element is dropped.
  ext: z.string().trim().regex(EXTENSION_PATTERN),
  pool: rawWord.default('main').catch('main'),
  transport: rawWord.default('udp').catch('udp'),
  state: rawWord.default('unknown').catch('unknown'),
  registration: rawWord.default('unknown').catch('unknown'),
  enabled: z.boolean().default(true).catch(true),
  // «AI liniya qoʻshish» (T123) — each a nicety: an agent older than the form sends none.
  /** «Kollagen» | «Zekstra». */
  product: rawWord.nullable().optional().catch(undefined),
  /** «server» — in its .env, the panel cannot remove it; «panel» — added from here. */
  source: rawWord.nullable().optional().catch(undefined),
  /** A panel line's step: registering, active, bad_password, not_loaded, removing. */
  stage: rawWord.nullable().optional().catch(undefined),
  /** Why a Zextra line does not call yet (`no_zextra_sellers` …). */
  waiting: rawWord.nullable().optional().catch(undefined),
  /** The agent's own sentence about the line. */
  note: z.string().trim().max(300).nullable().optional().catch(undefined),
  /** Whether the server holds its password — only that, never the password. */
  hasPassword: z.boolean().optional().catch(undefined),
  /** «Olib tashlash» is offered: a panel line, not the main one. */
  removable: z.boolean().optional().catch(undefined),
  addedAt: instant.nullable().optional().catch(undefined),
  addedBy: z.string().trim().max(60).nullable().optional().catch(undefined),
})

/** The AI server's public key a new line's password is sealed with in the browser (T123). */
const lineKeySchema = z.object({
  alg: z.literal('RSA-OAEP-256'),
  spki: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(2000),
  id: z.string().trim().max(40),
})

/** May a line be added now, and if not, why (T123) — the agent's ATS guard: one at a time, the cooldowns. */
const lineAddSchema = z.object({
  allowed: z.boolean(),
  code: z.string().trim().max(30).nullable().default(null).catch(null),
  text: z.string().trim().max(300).nullable().default(null).catch(null),
})

/** Zextra's calls (T123): on only with its own lines, its sellers and its calls at a time. */
const zextraSchema = z.object({
  on: z.boolean().default(false).catch(false),
  lines: z.array(z.string().trim().regex(EXTENSION_PATTERN)).max(32).default([]).catch([]),
  sellers: z.array(z.string().trim().regex(EXTENSION_PATTERN)).max(200).default([]).catch([]),
  maxCalls: count.nullable().default(null).catch(null),
  waiting: rawWord.nullable().default(null).catch(null),
})

/** One value of the tuning the agent runs — absent when it is not one. */
const tuned = count.optional().catch(undefined)
const tunedWord = z.string().trim().max(20).optional().catch(undefined)

/** «Qoʻshimcha sozlamalar» as the agent runs them (T144), `maxAttempts` its product. */
const tuningReportSchema = z.object({
  attemptsPerDay: tuned,
  retryDays: tuned,
  maxAttempts: tuned,
  transferOrder: tunedWord,
  ringSec: tuned,
  missedSec: tuned,
  firstCallDelaySec: tuned,
  whyUs: tunedWord,
})

/** The agent's answer to one press (T144): done, refused, or pending (a TLS renewal under way). */
const actionAnswerSchema = z.object({
  id: z.number().int().min(1),
  kind: z.string().trim().max(20),
  line: ext.nullable().default(null).catch(null),
  state: z.enum(['done', 'refused', 'pending']),
  text: z.string().max(300).default(''),
  at: instant,
  /** The answer's word (T123: registered, bad_password, busy, cooldown …) — a nicety. */
  code: z.string().trim().max(30).nullable().optional().catch(undefined),
})

export const aiStatusSchema = z.object({
  at: instant,
  appliedVersion: z.number().int().min(0).nullable().default(null),
  applyError: z.string().max(500).nullable().default(null),
  /** What the agent applied: false = stopped. Absent — an agent older than the button. */
  enabled: z.boolean().optional().catch(undefined),
  /** The hours the agent applied (its .env ones while none is saved). Absent — an agent older than «Ish vaqti». */
  hours: hoursReportSchema.nullable().optional().catch(undefined),
  /** The pause running, till when (T144); null none. Absent — an agent older than the pause. */
  pausedUntil: instant.nullable().optional().catch(undefined),
  /** Each AI line (T144). Absent — an agent older than the lines' controls. */
  aiLines: each(aiLineSchema, 32).optional().catch(undefined),
  /** «AI liniya qoʻshish» (T123): the key to seal a password with; null — the server has none. Absent — an agent older than the form. */
  lineKey: lineKeySchema.nullable().optional().catch(undefined),
  /** Whether a line may be added now (T123). */
  lineAdd: lineAddSchema.nullable().optional().catch(undefined),
  /** Zextra's calls (T123). */
  zextra: zextraSchema.nullable().optional().catch(undefined),
  /** The tuning it runs (T144). */
  tuning: tuningReportSchema.nullable().optional().catch(undefined),
  /** Its answers to the panel's presses, newest first (T144). */
  actions: each(actionAnswerSchema, MAX_ACTIONS).optional().catch(undefined),
  limits: z
    .object({
      calls: count.nullable().optional(),
      maxNew: count.nullable().optional(),
      maxRetry: count.nullable().optional(),
      saleHandoff: z.string().max(20).nullable().optional(),
      maxSipLegs: count.nullable().optional(),
      fused: z.boolean().nullable().optional(),
      transferOrder: z.string().trim().max(20).nullable().optional().catch(undefined),
    })
    .default({}),
  lines: z.record(ext, word).default({}),
  sellers: z
    .array(
      z.object({
        ext,
        name: z.string().trim().max(120).nullable().default(''),
        state: word.default('unknown'),
        inList: z.boolean().default(true),
        transfersToday: count.default(0),
        // Whose seller this is, and whether one of the AI's calls rings them now — a nicety, never a refusal.
        product: product.catch(null),
        aiRinging: z.boolean().default(false).catch(false),
        // The ATS presence word («On the phone», «Ringing») and since when — the seller's timer.
        word: z.string().trim().max(40).nullable().optional().catch(undefined),
        since: instant.nullable().optional().catch(undefined),
      }),
    )
    .max(200)
    .default([]),
  live: liveSchema.nullable().default(null).catch(null),
  flags: flagsSchema.nullable().default(null).catch(null),
  today: z
    .object({
      calls: count.default(0),
      answered: count.default(0),
      transferred: count.default(0),
      transferFailed: count.default(0),
      atsRejected: count.default(0),
    })
    .default({ calls: 0, answered: 0, transferred: 0, transferFailed: 0, atsRejected: 0 }),
})

export type AiStatusPush = z.infer<typeof aiStatusSchema>

/**
 * What «Saqlash» sends. `baseVersion` is the version the owner was looking
 * at: a save over a newer one (a second tab) is refused rather than silently
 * undoing it. The rules beyond the shape — no AI line, no repeat, new / retry
 * under the total — are `controlProblems`, applied by the service so the
 * owner reads them all in one message.
 */
export const controlSaveSchema = z.object({
  baseVersion: z.number().int().min(0),
  sellers: z.array(z.string().trim().max(20)).max(MAX_SELLERS * 2),
  parked: z.array(z.string().trim().max(20)).max(MAX_SELLERS * 2).default([]),
  maxCalls: z.number().int().min(1).max(MAX_CALLS_LIMIT),
  maxNew: z.number().int().min(0).max(MAX_CALLS_LIMIT),
  maxRetry: z.number().int().min(0).max(MAX_CALLS_LIMIT),
  saleHandoff: z.enum(SALE_HANDOFFS),
})

export type ControlSave = z.infer<typeof controlSaveSchema>

/**
 * «Toʻxtatish» / «Yoqish» — the stop alone. Its own body, and strict, so it
 * can never be mistaken for a «Saqlash»: the service writes the next version
 * with every other field as stored and only `enabled` changed. «Saqlash»
 * (`controlSaveSchema`) carries no `enabled` at all — the stored one stays.
 */
export const controlEnabledSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  enabled: z.boolean(),
})

export type ControlEnabled = z.infer<typeof controlEnabledSchema>

/** A form's «HH:MM»; an empty lunch end is «no lunch», as null. */
const formClock = z.string().trim().max(5)
const formLunch = z
  .string()
  .trim()
  .max(5)
  .nullable()
  .transform((v) => (v === '' ? null : v))

/**
 * «Ish vaqti → Saqlash» — the hours alone, its own strict body like the stop:
 * the next version with only `hours` changed. Shape only here; the agent's
 * rules (`workHoursProblems`) are applied by the service, every problem named.
 */
export const controlHoursSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  hours: z.strictObject({
    start: formClock,
    end: formClock,
    lunchStart: formLunch,
    lunchEnd: formLunch,
    /** The working days (T144), ISO weekdays — absent or null every day. */
    days: z.array(z.number().int()).max(7).nullable().optional(),
  }),
})

export type ControlHours = z.infer<typeof controlHoursSchema>

/**
 * «Vaqtincha toʻxtatish» — the pause alone (T144): `pauseUntil` an instant with
 * its offset, or null for «Davom ettirish». The seven-day rule and «not gone
 * by» are the service's (`pauseProblems`), named in Uzbek.
 */
export const controlPauseSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  pauseUntil: z.iso.datetime({ offset: true }).nullable(),
})

export type ControlPause = z.infer<typeof controlPauseSchema>

/** The AI lines switched off — the whole list (T144). The agent's lines and the main-line rule are the service's. */
export const controlLinesSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  linesOff: z.array(z.string().trim().regex(EXTENSION_PATTERN)).max(32),
})

export type ControlLines = z.infer<typeof controlLinesSchema>

/** «Qoʻshimcha sozlamalar» — all seven together (T144). Bounds are the service's (`tuningProblems`), every problem named. */
export const controlTuningSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  tuning: z.strictObject({
    attemptsPerDay: z.number().int(),
    retryDays: z.number().int(),
    transferOrder: z.string().trim().max(20),
    ringSec: z.number().int(),
    missedSec: z.number().int(),
    firstCallDelaySec: z.number().int(),
    whyUs: z.string().trim().max(20),
  }),
})

export type ControlTuning = z.infer<typeof controlTuningSchema>

/**
 * A one-off press (T144): «Qayta ulash» of one line, or «TLSʼni yangilash». Not
 * a version — no `baseVersion`; the agent reads it with its next config.
 */
export const controlActionSchema = z.strictObject({
  action: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('reregister'), line: z.string().trim().regex(EXTENSION_PATTERN) }),
    z.strictObject({ kind: z.literal('tls_reset') }),
    // «AI liniya qoʻshish» (T123): the password comes SEALED by the browser with the agent's
    // public key (RSA-OAEP-256 of {"line","password"}, base64) — ISH never sees it in the clear.
    z.strictObject({
      kind: z.literal('add_line'),
      line: z.string().trim().regex(EXTENSION_PATTERN),
      product: z.enum(LINE_PRODUCTS),
      transport: z.enum(LINE_TRANSPORTS),
      secret: z
        .string()
        .regex(/^[A-Za-z0-9+/]+={0,2}$/)
        .min(16)
        .max(2048),
    }),
    z.strictObject({ kind: z.literal('remove_line'), line: z.string().trim().regex(EXTENSION_PATTERN) }),
  ]),
})

export type ControlAction = z.infer<typeof controlActionSchema>

/**
 * What the control POST takes: a whole save, or one of the small writes alone
 * — the stop, the hours, the pause, the lines, the tuning, a press. The small
 * ones are strict, so «Saqlash» (`controlSaveSchema`, last) never carries one:
 * a body with sellers and a pause is a «Saqlash» with the pause stripped.
 */
export const controlWriteSchema = z.union([
  controlEnabledSchema,
  controlHoursSchema,
  controlPauseSchema,
  controlLinesSchema,
  controlTuningSchema,
  controlActionSchema,
  controlSaveSchema,
])

export type ControlWrite = z.infer<typeof controlWriteSchema>
