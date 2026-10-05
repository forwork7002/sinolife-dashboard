import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { adSalesDaysService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE. Meta money carries no employee, so ad spend beside a team's
 * FAKT 1 would set the company's money beside a part of its sales. A ROP is
 * refused rather than answered with the company; the screen hides the block
 * for a narrowed account.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'sales' } as const

/**
 * «Kunlar boʻyicha» on Savdo dinamikasi: per Tashkent day, the Meta ad budget
 * and FAKT 1 split into Первичка / База. The window only — the page's
 * employee, department and source filters do not reach Meta money.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await adSalesDaysService.days(period, ctx.now)
  return { data, meta: { period: toPeriodDto(period) } }
})
