/**
 * Entity sync handlers.
 *
 * Each handler pairs a provider fetch with an idempotent write. Every write is
 * an upsert on `(externalSource, externalId)`, backed by the unique index â€” so
 * running a sync twice updates rather than duplicates.
 *
 * Created-versus-updated counts come from checking which external ids already
 * exist before writing. Prisma's `upsert` does not report which branch it took,
 * and the sync log is worth one extra indexed query per batch.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'
import type {
  CrmProvider,
  FetchOptions,
  RawCustomer,
  RawDeal,
  RawDealItem,
  RawDepartment,
  RawEmployee,
  RawPayment,
  RawProduct,
  RawProductCategory,
  RawSalesSource,
  RawStage,
} from '@/server/integrations/crm/CrmProvider'

import { IdResolver } from './idResolver'
import type { BatchOutcome, EntitySyncHandler } from './SyncEngine'

/** Split a batch into ids that already exist and ids that do not. */
function classify(
  batch: readonly { externalId: string }[],
  existing: ReadonlySet<string>,
): { created: number; updated: number } {
  let created = 0
  let updated = 0
  for (const record of batch) {
    if (existing.has(record.externalId)) updated++
    else created++
  }
  return { created, updated }
}

export function createSyncHandlers(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  resolver: IdResolver = new IdResolver(prisma, source),
): EntitySyncHandler[] {
  const ids = (batch: readonly { externalId: string }[]) =>
    batch.map((r) => r.externalId)

  // -------------------------------------------------------------------------

  const departments: EntitySyncHandler<RawDepartment> = {
    entity: 'DEPARTMENTS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider: CrmProvider, options: FetchOptions) =>
      provider.fetchDepartments(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.department.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = { name: record.name, isActive: record.isActive }
        await prisma.department.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('department')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const employees: EntitySyncHandler<RawEmployee> = {
    entity: 'EMPLOYEES',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchEmployees(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.employee.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = {
          fullName: record.fullName,
          email: record.email ?? null,
          phone: record.phone ?? null,
          position: record.position ?? null,
          avatarUrl: record.avatarUrl ?? null,
          isActive: record.isActive,
          hiredAt: record.hiredAt ?? null,
          departmentId:
            (await resolver.optional('department', record.departmentExternalId)) ?? null,
        }

        await prisma.employee.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('employee')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const productCategories: EntitySyncHandler<RawProductCategory> = {
    entity: 'PRODUCT_CATEGORIES',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchProductCategories(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.productCategory.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = { name: record.name, isActive: record.isActive }
        await prisma.productCategory.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('productCategory')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const products: EntitySyncHandler<RawProduct> = {
    entity: 'PRODUCTS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchProducts(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.product.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = {
          name: record.name,
          sku: record.sku ?? null,
          priceMinor: record.priceMinor ?? null,
          currency: record.currency,
          isActive: record.isActive,
          categoryId:
            (await resolver.optional('productCategory', record.categoryExternalId)) ?? null,
        }

        await prisma.product.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('product')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const stages: EntitySyncHandler<RawStage> = {
    entity: 'STAGES',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchStages(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.dealStage.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = {
          name: record.name,
          category: record.category,
          sortOrder: record.sortOrder,
          isActive: record.isActive,
        }

        await prisma.dealStage.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('dealStage')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const sources: EntitySyncHandler<RawSalesSource> = {
    entity: 'SOURCES',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchSources(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.salesSource.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = { name: record.name, isActive: record.isActive }
        await prisma.salesSource.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('salesSource')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const customers: EntitySyncHandler<RawCustomer> = {
    entity: 'CUSTOMERS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchCustomers(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.customer.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = {
          name: record.name,
          isCompany: record.isCompany,
          email: record.email ?? null,
          phone: record.phone ?? null,
          region: record.region ?? null,
        }

        await prisma.customer.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('customer')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const deals: EntitySyncHandler<RawDeal> = {
    entity: 'DEALS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchDeals(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.deal.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        // These two are required foreign keys. `require` throws when the
        // reference cannot be resolved, so the engine isolates this record
        // and marks the run PARTIAL rather than writing an orphan.
        const stageId = await resolver.require('dealStage', record.stageExternalId)
        const employeeId = await resolver.require('employee', record.employeeExternalId)

        const data = {
          title: record.title,
          amountMinor: record.amountMinor,
          currency: record.currency,
          status: record.status,
          stageId,
          employeeId,
          customerId: (await resolver.optional('customer', record.customerExternalId)) ?? null,
          sourceId: (await resolver.optional('salesSource', record.sourceExternalId)) ?? null,
          createdAtSource: record.createdAtSource,
          updatedAtSource: record.updatedAtSource ?? null,
          closedAt: record.closedAt ?? null,
          metadata: record.metadata ? (record.metadata as object) : undefined,
        }

        await prisma.deal.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('deal')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------

  const dealItems: EntitySyncHandler<RawDealItem> = {
    entity: 'DEAL_ITEMS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchDealItems(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.dealItem.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      let skipped = 0
      let created = 0
      let updated = 0

      for (const record of batch) {
        const dealId = await resolver.optional('deal', record.dealExternalId)
        const productId = await resolver.optional('product', record.productExternalId)

        // A line item whose deal or product is missing is dropped rather than
        // failed: the parent may legitimately be out of scope for this sync.
        // It is counted, so the run reports PARTIAL and the gap is visible.
        if (!dealId || !productId) {
          skipped++
          continue
        }

        const data = {
          dealId,
          productId,
          quantity: record.quantity,
          unitPriceMinor: record.unitPriceMinor,
          totalMinor: record.totalMinor,
        }

        await prisma.dealItem.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })

        if (existing.has(record.externalId)) updated++
        else created++
      }

      return { created, updated, skipped }
    },
  }

  // -------------------------------------------------------------------------

  const payments: EntitySyncHandler<RawPayment> = {
    entity: 'PAYMENTS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchPayments(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.payment.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      let skipped = 0
      let created = 0
      let updated = 0

      for (const record of batch) {
        const dealId = await resolver.optional('deal', record.dealExternalId)
        if (!dealId) {
          skipped++
          continue
        }

        const data = {
          dealId,
          amountMinor: record.amountMinor,
          currency: record.currency,
          paidAt: record.paidAt,
          method: record.method,
          note: record.note ?? null,
        }

        await prisma.payment.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })

        if (existing.has(record.externalId)) updated++
        else created++
      }

      return { created, updated, skipped }
    },
  }

  /**
   * Sweepers: remove rows whose source record no longer exists.
   *
   * Called by the engine ONLY after a completely clean FULL run, so a
   * transient fetch failure can never trigger a delete.
   *
   * Deleting a deal cascades to its items and payments, which is why
   * DEAL_ITEMS and PAYMENTS also sweep on their own: an item can disappear
   * from a deal that still exists.
   *
   * The `notIn` list is the full set of live ids — a few thousand at this
   * scale, which Postgres handles comfortably. If the dataset grows past
   * roughly 100k rows per entity, switch to staging the seen ids in a temp
   * table and deleting by anti-join.
   */
  const sweep =
    (deleteMany: (ids: string[]) => Promise<{ count: number }>) =>
    async (seen: ReadonlySet<string>) => {
      // An empty read means the source returned nothing at all. Deleting the
      // entire table on that basis would be catastrophic and is almost
      // certainly a misconfiguration rather than a real emptying.
      if (seen.size === 0) return 0
      return (await deleteMany([...seen])).count
    }

  const sweepers: Partial<
    Record<string, (seen: ReadonlySet<string>) => Promise<number>>
  > = {
    CUSTOMERS: sweep((live) =>
      prisma.customer.deleteMany({
        where: { externalSource: source, externalId: { notIn: live }, deals: { none: {} } },
      }),
    ),
    DEALS: sweep((live) =>
      prisma.deal.deleteMany({
        where: { externalSource: source, externalId: { notIn: live } },
      }),
    ),
    DEAL_ITEMS: sweep((live) =>
      prisma.dealItem.deleteMany({
        where: { externalSource: source, externalId: { notIn: live } },
      }),
    ),
    PAYMENTS: sweep((live) =>
      prisma.payment.deleteMany({
        where: { externalSource: source, externalId: { notIn: live } },
      }),
    ),
  }

  // Order matters: this is the dependency order the engine runs them in.
  const handlers = [
    departments,
    employees,
    productCategories,
    products,
    stages,
    sources,
    customers,
    deals,
    dealItems,
    payments,
  ] as EntitySyncHandler[]

  return handlers.map((handler) => {
    const deleteMissing = sweepers[handler.entity]
    return deleteMissing ? { ...handler, deleteMissing } : handler
  })
}

/** Re-exported so callers do not need to import the resolver separately. */
export { IdResolver }

/** Satisfies the unused-parameter contract for handlers that ignore batch typing. */
export type { BatchOutcome }
