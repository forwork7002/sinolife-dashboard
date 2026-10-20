import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { sverkaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Sverka» whose product rows these are: MoySklad's half
 * carries no employee of ours to narrow by, so a narrowed account is refused
 * rather than answered with the company — and the card is not drawn for it.
 *
 * Gated on «Sverka»'s section, as `/kpi/sverka` is and for its reason: the
 * pieces and soʻm per product are `/sverka/overview`'s product table cut by
 * brand (and, for FAKT 2, read over the delivered deals of that same cohort),
 * so they reach exactly the accounts that endpoint already answers.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'sverka' } as const

/**
 * «Tovarlar · Bitrix24 ↔ MoySklad» — the window's Collagen and Zextra pieces
 * per product, FAKT 1 and FAKT 2, in Bitrix24 and in MoySklad.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await sverkaService.products(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
