import { can } from '@/server/auth/rbac'
import { toPeriodDto, zonedDateKey } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { reklamaOverviewQuerySchema } from '@/server/http/queryParams'
import { leadSourcesService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Reklama samarasi»: Meta rows carry no
 * employee and a Регистрация lead belongs to no seller's team, so a ROP is
 * refused rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'marketing' } as const

/**
 * «Targetologlar · kunlik» on «Reklama samarasi» — the client's per-targetolog
 * sheet (2026-10-05): each day's lead-form spend, the Регистрация leads the
 * targetolog's CRM forms opened, and their kval. The same `forms` block
 * «Lidlar» → «Lid manbalari» reads, so the two screens cannot disagree —
 * built from its two scans only, never waiting on the rest of «Lidlar».
 * Narrowed by the page's brand switch on the server, by «Lidlar»'s rules.
 */
export const GET = getHandler(ACCESS, reklamaOverviewQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const { forms, importedAt, manual } = await leadSourcesService.targetologForms(period, ctx.timeZone, ctx.query.brand)
  // Who may type the «Telegram» card's days — as RNP's typed cells: `kpi:manage`, and not on a widened read.
  const canEdit = can(ctx.principal, 'kpi:manage') && !ctx.principal.widened
  return { data: { forms, importedAt, manual, canEdit, today: zonedDateKey(ctx.now, ctx.timeZone) }, meta: { period: toPeriodDto(period) } }
})
