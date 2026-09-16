import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'cohort' } as const

/**
 * Cohorts ignore the period filter on purpose.
 *
 * A retention matrix is a statement about the whole customer history — asking
 * "how many of March's buyers came back" only means something if you can see
 * every month since. `months` bounds how far back the ROWS start, not which
 * purchases count.
 */
const schema = z.object({
  months: z.coerce.number().int().min(3).max(36).default(18),
  /**
   * Cut the matrix to the customers ONE team first sold to. Absent = everyone.
   *
   * A DIMENSION, NOT A SCOPE. This route still declares `analytics:read:all`
   * and still refuses a narrowed account outright — nothing here reads
   * `ctx.scope`, and a ROP asking to see their own team is the reader choosing
   * a question, not the server restricting them to one. `routeAccess.test.ts`
   * keeps this endpoint in the refusing list; it belongs there either way,
   * because a customer's purchases are spread across whoever answered the
   * phone and there is no correct per-seller narrowing of retention.
   *
   * The value is a team NAME, because that is what the portal gives us —
   * «Организация сотрудника» is a string on the deal and not a foreign
   * key — and the strings come from this same endpoint's `?include=rops`, so
   * a caller never has to spell one itself.
   */
  rop: z.string().min(1).max(200).optional(),
  /**
   * Also list the teams and their sizes, for the picker.
   *
   * A QUERY PARAMETER AND NOT A SECOND ENDPOINT, the same choice `/users`
   * made for its department heads and for the same reason: there is nothing
   * new to say about who may read this, and `routeAccess.test.ts` pins the
   * ungated list by route. It is opt-in because the arm that answers it costs
   * a grouping and two joins on the slowest statement in the product, and the
   * default view never needs it.
   */
  include: z.literal('rops').optional(),
})

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const data = await insightsService.cohorts(ctx.currency, ctx.query.months, {
    rop: ctx.query.rop ?? null,
    includeRops: ctx.query.include === 'rops',
  })
  return { data }
})
