import { toPeriodDto } from '@/server/domain/period/period'
import { buildPagination } from '@/server/http/envelope'
import { getHandler, periodFrom } from '@/server/http/handler'
import { targetLeadsQuerySchema } from '@/server/http/queryParams'
import { targetService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Company-wide, for the reason `/target/overview` gives. */
const ACCESS = { permission: 'analytics:read:all', section: 'target' } as const

/**
 * One page of leads, newest first — the contact, the source, the targetolog,
 * where the registrar left it, and the first sales deal the same contact
 * opened on or after it (stage, seller, amount).
 *
 * Carries the customer's name and first phone number, as «Tasdiqlash navbati»
 * does: the screen is refused to every account that is not company-wide.
 */
export const GET = getHandler(ACCESS, targetLeadsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const { items, totalItems } = await targetService.leads(period, ctx.query)
  return {
    data: {
      items,
      pagination: buildPagination(ctx.query.page, ctx.query.pageSize, totalItems),
    },
    meta: { period: toPeriodDto(period) },
  }
})
