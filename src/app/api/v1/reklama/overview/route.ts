import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { reklamaOverviewQuerySchema } from '@/server/http/queryParams'
import { logger } from '@/server/logging/logger'
import { leadSourcesService, reklamaService } from '@/server/services/container'
import { withFormKval } from '@/server/services/reklamaService'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE. Meta rows have no employee on them at all, and a Регистрация
 * lead belongs to the registrar who picked it up rather than to a seller's
 * team, so there is no honest narrowing — a ROP is refused, as on «Target
 * tahlili», rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'marketing' } as const

/**
 * «Reklama samarasi» — the client's «DM», «Отчёт Т» and lead-quality sheets
 * over the dashboard period, one row per Tashkent day, narrowed by the
 * Collagen / Zextra switch (`brand`). See reklamaService.ts. «Отчёт Т» also
 * carries each targetolog's kval, read off «Lidlar»'s `forms` block
 * (`withFormKval`).
 */
export const GET = getHandler(ACCESS, reklamaOverviewQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const [overview, forms] = await Promise.all([
    reklamaService.overview(period, ctx.timeZone, ctx.query.brand),
    // «Отчёт Т»'s kval is «Lidlar»'s `forms` block. An addition to the sheets, never their price: a failed scan
    // is logged and the table draws without the column's figures.
    leadSourcesService.targetologForms(period, ctx.timeZone, ctx.query.brand).then(
      (answer) => answer.forms,
      (error: unknown) => {
        logger.warn({ err: error }, '«Отчёт Т» kval scan failed; the targetolog table draws without it')
        return null
      },
    ),
  ])
  return { data: withFormKval(overview, forms), meta: { period: toPeriodDto(period) } }
})
