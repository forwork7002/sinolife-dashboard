/**
 * The two bodies of the AI registrator's control contract — see
 * `domain/aiRegistrator/control.ts` for what the panel is.
 *
 *   GET  /api/ai-registrator/config  → { version, sellers, maxCalls, maxNew,
 *        maxRetry, saleHandoff, updatedAt, updatedBy }   (404 until saved)
 *   POST /api/ai-registrator/status  ← what the agent runs, every 30 s
 *
 * The STATUS is validated for shape and bounded in size, and kept as sent:
 * a line state or a seller state the agent learns tomorrow («seller_talk»
 * arrived before this was written) must still be stored and shown as given,
 * not refused — the same rule `ingest.ts` keeps for an outcome.
 */

import { z } from 'zod'

import { MAX_CALLS_LIMIT, MAX_SELLERS, SALE_HANDOFFS } from '@/server/domain/aiRegistrator/control'

const instant = z.iso.datetime({ offset: true })
const word = z.string().trim().regex(/^[a-z_]{1,32}$/)
const count = z.number().int().min(0).max(1_000_000)
const ext = z.string().trim().min(1).max(20)

export const aiStatusSchema = z.object({
  at: instant,
  appliedVersion: z.number().int().min(0).nullable().default(null),
  applyError: z.string().max(500).nullable().default(null),
  limits: z
    .object({
      calls: count.nullable().optional(),
      maxNew: count.nullable().optional(),
      maxRetry: count.nullable().optional(),
      saleHandoff: z.string().max(20).nullable().optional(),
      maxSipLegs: count.nullable().optional(),
      fused: z.boolean().nullable().optional(),
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
      }),
    )
    .max(200)
    .default([]),
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
