import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { sverkaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE. Every team's orders are set against MoySklad's side by side,
 * with customers' sums and sellers' names, and MoySklad's half carries no
 * employee of ours to narrow by — so a narrowed account is refused rather
 * than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'sverka' } as const

/**
 * «Sverka» — the window's queue cohort (FAKT 1 / FAKT 2 as Savdo dinamikasi
 * counts them) against MoySklad's orders for the same deals, plus MoySklad's
 * orders dated in the window that no cohort deal accounts for.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await sverkaService.overview(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
