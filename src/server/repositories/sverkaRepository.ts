/**
 * «Sverka» — the reads that are not the queue cohort: MoySklad's orders, the
 * deals' product rows with their MoySklad code, and the few deals an orphan
 * MoySklad order points at. The cohort itself is `InsightsRepository
 * .sverkaCohort`, so FAKT 1 / FAKT 2 keep one definition.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { MoyskladSide, SverkaItem } from '@/server/domain/sverka/sverka'

export interface MoyskladOrderRow extends MoyskladSide {
  readonly bitrixDealId: string | null
}

export interface OrphanDealRow {
  readonly externalId: string
  /** The deal's latest arrival in Тасдиклаш (C4:NEW), null if it never arrived. */
  readonly queuedAt: Date | null
}

export interface MoyskladFreshness {
  readonly orders: number
  /** The import's last successful run — `moysklad_sync`, not the rows. */
  readonly lastSuccessAt: Date | null
  readonly lastError: string | null
  readonly lastErrorAt: Date | null
}

const ORDER_SELECT = {
  id: true,
  name: true,
  bitrixDealId: true,
  moment: true,
  stateName: true,
  sumMinor: true,
  sellerName: true,
  projectName: true,
  region: true,
  logistics: true,
  payedMinor: true,
  shippedMinor: true,
  items: { select: { productCode: true, productName: true, quantity: true, totalMinor: true } },
} as const

type OrderRecord = {
  id: string
  name: string
  bitrixDealId: string | null
  moment: Date
  stateName: string | null
  sumMinor: bigint
  sellerName: string | null
  projectName: string | null
  region: string | null
  logistics: string | null
  payedMinor: bigint
  shippedMinor: bigint
  items: { productCode: string | null; productName: string; quantity: number; totalMinor: bigint }[]
}

function toRow(o: OrderRecord): MoyskladOrderRow {
  return {
    orderId: o.id,
    orderName: o.name,
    bitrixDealId: o.bitrixDealId,
    moment: o.moment,
    stateName: o.stateName,
    sumMinor: o.sumMinor,
    seller: o.sellerName,
    project: o.projectName,
    region: o.region,
    logistics: o.logistics,
    payedMinor: o.payedMinor,
    shippedMinor: o.shippedMinor,
    items: o.items.map((i) => ({
      code: i.productCode,
      name: i.productName,
      quantity: i.quantity,
      totalMinor: i.totalMinor,
    })),
  }
}

export class SverkaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Every MoySklad order naming one of these deals, newest first. */
  async ordersForDeals(dealIds: readonly string[]): Promise<readonly MoyskladOrderRow[]> {
    if (dealIds.length === 0) return []
    const orders = await this.prisma.moyskladOrder.findMany({
      where: { bitrixDealId: { in: [...dealIds] } },
      select: ORDER_SELECT,
      orderBy: [{ moment: 'desc' }, { updatedAtSource: 'desc' }],
    })
    return orders.map(toRow)
  }

  /** MoySklad orders dated inside `[start, end)`, newest first. */
  async ordersInWindow(start: Date, end: Date): Promise<readonly MoyskladOrderRow[]> {
    const orders = await this.prisma.moyskladOrder.findMany({
      where: { moment: { gte: start, lt: end } },
      select: ORDER_SELECT,
      orderBy: [{ moment: 'desc' }, { updatedAtSource: 'desc' }],
    })
    return orders.map(toRow)
  }

  /**
   * The deals' product rows, each under the code MoySklad files it by: the
   * product's XML_ID, or — for a trade offer, which has none — its parent
   * product's (`product."parentExternalId"`).
   */
  async dealItems(dealIds: readonly string[]): Promise<ReadonlyMap<string, SverkaItem[]>> {
    const out = new Map<string, SverkaItem[]>()
    if (dealIds.length === 0) return out
    const rows = await this.prisma.$queryRawUnsafe<
      { deal_id: string; code: string | null; name: string; quantity: number; total: string }[]
    >(
      `SELECT i."dealId" AS deal_id,
              COALESCE(NULLIF(p."sku", ''), NULLIF(pp."sku", '')) AS code,
              COALESCE(pp."name", p."name") AS name,
              i."quantity" AS quantity,
              i."totalMinor"::text AS total
         FROM "deal_item" i
         JOIN "product" p ON p."id" = i."productId"
         LEFT JOIN "product" pp
           ON pp."externalSource" = p."externalSource"
          AND pp."externalId" = p."parentExternalId"
        WHERE i."dealId" = ANY($1::text[])`,
      [...dealIds],
    )
    for (const r of rows) {
      const list = out.get(r.deal_id) ?? []
      list.push({ code: r.code, name: r.name, quantity: Number(r.quantity), totalMinor: BigInt(r.total) })
      out.set(r.deal_id, list)
    }
    return out
  }

  /**
   * The deals these Bitrix24 ids name, with each one's latest arrival in the
   * queue — so an orphan MoySklad order can be told apart: a deal dated in
   * another window, a deal that never went through Тасдиклаш, or no deal.
   */
  async dealsByExternalId(externalIds: readonly string[]): Promise<readonly OrphanDealRow[]> {
    if (externalIds.length === 0) return []
    const rows = await this.prisma.$queryRawUnsafe<{ external_id: string; queued_at: Date | null }[]>(
      `SELECT d."externalId" AS external_id,
              (SELECT max(h."enteredAt")
                 FROM "deal_stage_history" h
                 JOIN "deal_stage" s ON s."id" = h."stageId"
                WHERE h."dealId" = d."id" AND s."confirmationSignal" = 'CONFIRM_NEW') AS queued_at
         FROM "deal" d
        WHERE d."externalSource" = 'BITRIX24' AND d."externalId" = ANY($1::text[])`,
      [...externalIds],
    )
    return rows.map((r) => ({ externalId: r.external_id, queuedAt: r.queued_at }))
  }

  async freshness(): Promise<MoyskladFreshness> {
    const [orders, sync] = await Promise.all([
      this.prisma.moyskladOrder.count(),
      this.prisma.moyskladSync.findUnique({ where: { id: 'orders' } }),
    ])
    return {
      orders,
      lastSuccessAt: sync?.lastSuccessAt ?? null,
      lastError: sync?.lastError ?? null,
      lastErrorAt: sync?.lastErrorAt ?? null,
    }
  }
}
