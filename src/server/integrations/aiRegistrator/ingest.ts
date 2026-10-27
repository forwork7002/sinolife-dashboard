/**
 * What the AI registrator — the Sinolife voice agent, a separate service on the
 * Eskiz server — POSTs to `/api/ai-registrator/calls` once a call is over.
 *
 * THE CONTRACT, AS THE AGENT SENDS IT:
 *
 *   Authorization: Bearer <AI_REGISTRATOR_INGEST_TOKEN>
 *   { callId, dealId, phone, attempt, startedAt, answeredAt, endedAt,
 *     durationSec, outcome, transferredTo, transferAttempts, result, isTest }
 *
 * `dealId` is the Регистрация deal's portal id. `outcome` is validated as a
 * non-empty word, NOT against today's list: an outcome the agent learns
 * tomorrow must still be stored (the screen prints an unknown one as given)
 * rather than be refused and lost. `result` is whatever the agent wrote down,
 * bounded by the route's body cap.
 */

import { z } from 'zod'

import { TRANSFER_RESULTS } from '@/server/domain/aiRegistrator/aiRegistrator'

const instant = z.iso.datetime({ offset: true })

export const aiCallSchema = z.object({
  callId: z.string().trim().min(1).max(64),
  dealId: z.union([z.number().int().positive(), z.string().trim().regex(/^\d{1,12}$/)]).transform(String),
  phone: z.string().trim().max(32).default(''),
  attempt: z.number().int().min(0).max(1000).default(1),
  startedAt: instant,
  answeredAt: instant.nullable().default(null),
  endedAt: instant,
  durationSec: z.number().int().min(0).max(86_400).default(0),
  outcome: z.string().trim().regex(/^[a-z_]{1,40}$/),
  transferredTo: z.string().trim().max(20).nullable().default(null),
  transferAttempts: z
    .array(
      z.object({
        ext: z.string().trim().min(1).max(20),
        result: z.enum(TRANSFER_RESULTS),
        at: instant.nullable().optional(),
        ring_sec: z.number().min(0).max(3_600).nullable().optional(),
        note: z.string().trim().max(60).nullable().optional(),
        since: instant.nullable().optional(),
        freed_at: instant.nullable().optional(),
      }),
    )
    .max(20)
    .default([]),
  result: z.record(z.string(), z.unknown()).nullable().default(null),
  isTest: z.boolean().default(false),
})

export type AiCallPush = z.infer<typeof aiCallSchema>

/** The token of an «Authorization: Bearer …» header, or '' with none. */
export function bearerToken(header: string | null): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  return match?.[1] ?? ''
}
