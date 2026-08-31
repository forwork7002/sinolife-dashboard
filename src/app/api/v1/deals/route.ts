import { toMoneyDto, money } from '@/server/domain/money/money'
import { toPeriodDto } from '@/server/domain/period/period'
import { buildPagination } from '@/server/http/envelope'
import { getHandler, periodFrom } from '@/server/http/handler'
import { DEALS_READ } from '@/server/http/permissions'
import { dealsQuerySchema } from '@/server/http/queryParams'
import { dealRepository } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: DEALS_READ, section: 'sales' } as const

export const GET = getHandler(ACCESS, dealsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

  const { totalItems, rows } = await dealRepository.findPage({
    // Scope spread last: a SALES caller passing ?employeeIds=<someone else>
    // still gets their own restriction applied on top.
    filters: { ...ctx.query, ...ctx.scope },
    window: { start: period.start, end: period.end },
    page: ctx.query.page,
    pageSize: ctx.query.pageSize,
    sort: ctx.query.sort,
    order: ctx.query.order,
  })

  return {
    data: {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        amount: toMoneyDto(money(row.amountMinor, row.currency)),
        status: row.status,
        createdAt: row.createdAtSource.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        employee: row.employee,
        stage: row.stage,
        customer: row.customer,
        source: row.source,
        products: row.items.map((i) => i.product.name),
      })),
      pagination: buildPagination(ctx.query.page, ctx.query.pageSize, totalItems),
    },
    meta: { period: toPeriodDto(period) },
  }
})
