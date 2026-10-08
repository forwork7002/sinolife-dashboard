import { can } from '@/server/auth/rbac'
import { toPeriodDto, zonedDateKey } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { reklamaOverviewQuerySchema } from '@/server/http/queryParams'
import { leadSourcesService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Lidlar»: Meta rows carry no employee and a
 * Регистрация lead belongs to no seller's team, so a ROP is refused rather
 * than answered with the company. The screen is «Lidlar»'s since 2026-10-08
 * (its own tab, moved off «Reklama samarasi»), so the gate is its section.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/**
 * «Targetologlar · kunlik», a tab of «Lidlar» — the client's per-targetolog
 * sheet (2026-10-05): each day's lead-form spend, the Регистрация leads the
 * targetolog's CRM forms opened, and their kval. The same `forms` block
 * «Lid manbalari» reads, so the two tabs cannot disagree — built from its
 * two scans only, never waiting on the rest of «Lidlar». Narrowed by the
 * page's brand switch on the server, by «Lidlar»'s rules. With it: the
 * hand-typed «Telegram» card and the «HR · Kosmetika» card, so the strip
 * asks once.
 */
export const GET = getHandler(ACCESS, reklamaOverviewQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const { forms, importedAt, manual, side } = await leadSourcesService.targetologForms(period, ctx.timeZone, ctx.query.brand)
  // Who may type the «Telegram» card's days — as RNP's typed cells: `kpi:manage`, and not on a widened read.
  const canEdit = can(ctx.principal, 'kpi:manage') && !ctx.principal.widened
  return { data: { forms, importedAt, manual, side, canEdit, today: zonedDateKey(ctx.now, ctx.timeZone) }, meta: { period: toPeriodDto(period) } }
})
