import { z } from 'zod'

import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { aiRegistratorService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * The same as `/leads/ai-registrator`, whose numbers these calls are: the
 * AI's calls belong to no sales team, so a narrowed account is refused.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'airegistrator' } as const

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

const querySchema = periodQuerySchema.and(
  z.object({
    /** Which number was opened — see `selectCalls`; «ordered» is «Buyurtma (AI lidlari)». */
    kind: z.enum(['all', 'unique', 'answered', 'outcome', 'ext', 'seller', 'ordered']).default('all'),
    outcome: text(40),
    ext: text(20),
    seller: text(80),
    /** A phone (any part of its digits) or a deal id. */
    q: text(40),
    /** The first rows in full; the drawer asks for more as it is read. */
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
)

/** «AI registrator» — the calls behind one of its numbers. See aiRegistratorService.calls. */
export const GET = getHandler(ACCESS, querySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const { kind, outcome, ext, seller, q, limit } = ctx.query
  const data = await aiRegistratorService.calls(period, { kind, outcome, ext, seller, q, limit }, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
