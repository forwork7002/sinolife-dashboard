/**
 * Finance access.
 *
 * Loads won deals and their payments for a window. Scoping is applied here in
 * SQL, exactly as in DealRepository, so a SALES caller can only ever settle
 * their own deals.
 */

import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { FinanceDeal, FinancePayment } from '@/server/domain/analytics/finance'
import type { DealFilters } from './dealRepository'

export class FinanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private where(filters: DealFilters, window: { start: Date; end: Date }): Prisma.DealWhereInput {
    const and: Prisma.DealWhereInput[] = [
      /*
        The duplicate guard, first and non-negotiable.
    
        The portal records the same physical order twice — once in Доставка,
        then again in База about ten days later with the same orderCode and the
        same amount, 97% of the time. Both copies are status WON with a
        closedAt, so a receivables query that names only those two conditions
        counts every debt twice: invoiced, collected, outstanding, the ageing
        buckets and the debtors table all roughly double, and each customer
        appears twice at full balance.
    
        This is currently masked — /finance/overview answers 501 because the
        Bitrix24 provider supplies no payments — which is exactly why it had to
        be fixed now rather than on the day payments are switched on.
      */
      { countsAsRevenue: true },
      // Only WON deals are receivables. An open deal is a hope, not money owed.
      { status: 'WON' },
      { closedAt: { gte: window.start, lt: window.end } },
    ]

    if (filters.restrictToEmployeeIds?.length) {
      and.push({ employeeId: { in: [...filters.restrictToEmployeeIds] } })
    }
    if (filters.employeeIds?.length) and.push({ employeeId: { in: [...filters.employeeIds] } })
    if (filters.departmentIds?.length) {
      and.push({ employee: { departmentId: { in: [...filters.departmentIds] } } })
    }
    if (filters.sourceIds?.length) and.push({ sourceId: { in: [...filters.sourceIds] } })
    if (filters.productIds?.length) {
      and.push({ items: { some: { productId: { in: [...filters.productIds] } } } })
    }

    return { AND: and }
  }

  /**
   * Load won deals plus every payment against them.
   *
   * Payments are fetched by deal id rather than by date: a deal won inside the
   * window may well have been paid after it, and excluding those payments
   * would report the balance as outstanding when it has already been settled.
   */
  async findSettlementData(
    window: { start: Date; end: Date },
    filters: DealFilters = {},
  ): Promise<{ deals: FinanceDeal[]; payments: FinancePayment[] }> {
    const rows = await this.prisma.deal.findMany({
      where: this.where(filters, window),
      select: {
        id: true,
        employeeId: true,
        amountMinor: true,
        currency: true,
        closedAt: true,
      },
    })

    const deals: FinanceDeal[] = rows
      .filter((row): row is typeof row & { closedAt: Date } => row.closedAt !== null)
      .map((row) => ({
        dealId: row.id,
        employeeId: row.employeeId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        closedAt: row.closedAt,
      }))

    if (deals.length === 0) return { deals, payments: [] }

    const paymentRows = await this.prisma.payment.findMany({
      where: { dealId: { in: deals.map((d) => d.dealId) } },
      select: {
        dealId: true,
        amountMinor: true,
        currency: true,
        paidAt: true,
        method: true,
      },
    })

    return { deals, payments: paymentRows }
  }

  /** Deals with an outstanding balance, for the debtors table. */
  async findOutstandingDeals(
    window: { start: Date; end: Date },
    filters: DealFilters = {},
    limit = 50,
  ) {
    return this.prisma.deal.findMany({
      where: this.where(filters, window),
      orderBy: { amountMinor: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        amountMinor: true,
        currency: true,
        closedAt: true,
        employee: { select: { id: true, fullName: true } },
        customer: { select: { id: true, name: true } },
        payments: { select: { amountMinor: true } },
      },
    })
  }
}
