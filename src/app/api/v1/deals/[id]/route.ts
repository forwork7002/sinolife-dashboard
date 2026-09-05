import { requirePermission } from '@/server/auth/session'
import { getCrmProvider } from '@/server/config/providerFactory'
import { money, toMoneyDto } from '@/server/domain/money/money'
import { ApiError, toApiError } from '@/server/http/errors'
import { failure, serialise, success } from '@/server/http/envelope'
import { assertSection } from '@/server/http/handler'
import { DEALS_READ } from '@/server/http/permissions'
import { newCorrelationId } from '@/server/logging/logger'
import { dealRepository, scopeService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Deal drill-down.
 *
 * The caller's scope is passed into the repository query, so a salesperson
 * requesting a colleague's deal id simply finds no row — the restriction is a
 * WHERE clause, not a check performed after loading. Result: 404, which also
 * avoids confirming that the id exists.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const correlationId = newCorrelationId()
  const provider = getCrmProvider()

  const meta = {
    dataSource: provider.source,
    generatedAt: new Date().toISOString(),
    correlationId,
  }

  try {
    const principal = await requirePermission(request, DEALS_READ)
    assertSection(principal, 'sales')
    const { id } = await context.params

    const deal = await dealRepository.findById(id, await scopeService.resolve(principal))
    if (!deal) throw ApiError.notFound('Bitim topilmadi.')

    const paidMinor = deal.payments.reduce((sum, p) => sum + p.amountMinor, 0n)
    const outstandingMinor = deal.amountMinor - paidMinor

    const body = success(
      {
        id: deal.id,
        title: deal.title,
        amount: toMoneyDto(money(deal.amountMinor, deal.currency)),
        status: deal.status,
        createdAt: deal.createdAtSource.toISOString(),
        closedAt: deal.closedAt?.toISOString() ?? null,
        employee: deal.employee,
        stage: { id: deal.stage.id, name: deal.stage.name, category: deal.stage.category },
        customer: deal.customer
          ? {
              id: deal.customer.id,
              name: deal.customer.name,
              isCompany: deal.customer.isCompany,
              phone: deal.customer.phone,
              region: deal.customer.region,
            }
          : null,
        source: deal.source ? { id: deal.source.id, name: deal.source.name } : null,

        items: deal.items.map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          unitPrice: toMoneyDto(money(item.unitPriceMinor, deal.currency)),
          total: toMoneyDto(money(item.totalMinor, deal.currency)),
        })),

        payments: deal.payments.map((payment) => ({
          id: payment.id,
          amount: toMoneyDto(money(payment.amountMinor, payment.currency)),
          paidAt: payment.paidAt.toISOString(),
          method: payment.method,
        })),

        settlement: {
          paid: toMoneyDto(money(paidMinor, deal.currency)),
          // Clamped: a negative receivable is a credit note, which this model
          // does not represent.
          outstanding: toMoneyDto(
            money(outstandingMinor > 0n ? outstandingMinor : 0n, deal.currency),
          ),
          status:
            paidMinor <= 0n ? 'UNPAID' : paidMinor >= deal.amountMinor ? 'PAID' : 'PARTIAL',
        },
      },
      meta,
    )

    return new Response(serialise(body), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (error) {
    const apiError = toApiError(error)
    return new Response(serialise(failure(apiError, meta)), {
      status: apiError.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
