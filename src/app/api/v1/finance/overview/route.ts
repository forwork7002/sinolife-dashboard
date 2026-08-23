import { getCrmProvider } from '@/server/config/providerFactory'
import { supports } from '@/server/integrations/crm/CrmProvider'
import { ApiError } from '@/server/http/errors'
import { getHandler, periodFrom } from '@/server/http/handler'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { AnalyticsService } from '@/server/services/analyticsService'
import { financeService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Financial overview.
 *
 * Gated on the provider's PAYMENTS capability. The demo provider supplies
 * payments; the Bitrix24 provider deliberately does not, because whether that
 * portal exposes a payment ledger is still an open question
 * (docs/BITRIX24.md §7).
 *
 * When payments are unavailable this returns 501 INTEGRATION_PENDING rather
 * than a page of zeros. "Nothing is outstanding" and "we cannot see what is
 * outstanding" are very different claims to put in front of a finance team,
 * and only one of them is true.
 */
export const GET = getHandler('finance:read', analyticsQuerySchema, async (ctx) => {
  const provider = getCrmProvider()

  if (!supports(provider.capabilities, 'PAYMENTS')) {
    throw ApiError.integrationPending('Toʻlov maʼlumotlari')
  }

  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )

  const [overview, debtors] = await Promise.all([
    financeService.overview(context),
    financeService.debtors(context),
  ])

  return {
    data: { ...overview, debtors },
    meta: AnalyticsService.periodMeta(context),
  }
})
