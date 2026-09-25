import { z } from 'zod'

import { LEAD_PIPELINES } from '@/server/domain/leadCohort/leadCohort'
import { getHandler } from '@/server/http/handler'
import { leadCohortService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Lidlar»: every ROP's leads side
 * by side. A ROP given TEAM scope is refused rather than handed the company —
 * the «ROP» filter here is a dimension the reader picks, not a scope.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

const querySchema = z.object({
  /** First arrival day, `YYYY-MM-DD`. Defaults to 13 days before `to`. */
  from: day.optional(),
  /** Last arrival day, `YYYY-MM-DD`. Defaults to today; never later. */
  to: day.optional(),
  /** Comma-separated CATEGORY_IDs out of 12, 4, 6. Defaults to all three. */
  pipelines: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return [...LEAD_PIPELINES]
      const ids = v.split(',').map(Number)
      if (ids.some((id) => !(LEAD_PIPELINES as readonly number[]).includes(id))) {
        ctx.addIssue({ code: 'custom', message: `pipelines: only ${LEAD_PIPELINES.join(', ')}` })
        return z.NEVER
      }
      return [...new Set(ids)]
    }),
  /** An employee id — the ROP the leads were routed to. */
  rop: z.string().min(1).max(64).optional(),
})

/**
 * «Lid kogortasi» — leads by the Tashkent day they arrived, against how many
 * days later they were handed to a seller. See leadCohortService.ts.
 */
export const GET = getHandler(ACCESS, querySchema, async (ctx) => {
  const data = await leadCohortService.overview({
    from: ctx.query.from,
    to: ctx.query.to,
    pipelines: ctx.query.pipelines,
    rop: ctx.query.rop ?? null,
    timeZone: ctx.timeZone,
    now: ctx.now,
  })
  return { data }
})
