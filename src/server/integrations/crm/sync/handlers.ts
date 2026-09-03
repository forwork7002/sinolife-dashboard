/**
 * Entity sync handlers.
 *
 * Each handler pairs a provider fetch with an idempotent write. Every write is
 * an upsert on `(externalSource, externalId)`, backed by the unique index — so
 * running a sync twice updates rather than duplicates.
 *
 * Created-versus-updated counts come from checking which external ids already
 * exist before writing. Prisma's `upsert` does not report which branch it took,
 * and the sync log is worth one extra indexed query per batch.
 *
 * TWO WRITE STRATEGIES
 * Reference data — departments, employees, products, stages, sources — is a few
 * hundred rows and uses `prisma.upsert` per record, which is readable and fast
 * enough. Transactional data — deals, customers, line items, stage history,
 * calls — runs into the hundreds of thousands and goes through `bulkUpsert`,
 * one statement per thousand rows. Same conflict target, same idempotence;
 * only the round-trip count differs.
 *
 * DATES
 * Bulk writes bind dates as UTC ISO strings cast to `timestamp`. Postgres
 * ignores the zone designator on that cast, so the stored value is the UTC
 * instant — the same thing Prisma's own writer stores. Binding a JS Date
 * instead would let the driver render it in the session timezone and shift
 * every timestamp by the offset, silently.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'
import type {
  CrmProvider,
  FetchOptions,
  RawCall,
  RawCustomer,
  RawDeal,
  RawDealItem,
  RawDepartment,
  RawEmployee,
  RawPayment,
  RawPipeline,
  RawProduct,
  RawProductCategory,
  RawSalesSource,
  RawStage,
  RawStageHistory,
  RawStockLevel,
  RawStore,
} from '@/server/integrations/crm/CrmProvider'

import { type ColumnSpec, bulkUpsert, rowId } from './bulkUpsert'
import { type Entity, IdResolver } from './idResolver'
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

/**
 * Resolve an optional foreign key, or null.
 *
 * Written out rather than inlined because the obvious inline form is subtly
 * wrong: `(id && map.get(id)) ?? null` returns the EMPTY STRING when `id` is
 * `''`, since `''` is falsy but not nullish. An empty string in a foreign key
 * column fails the constraint and takes the whole multi-row insert with it.
 */
function link(map: ReadonlyMap<string, string>, externalId: string | undefined): string | null {
  if (!externalId) return null
  return map.get(externalId) ?? null
}

/**
 * Teach the resolver about what a bulk write just produced.
 *
 * `bulkUpsert` cannot report the ids it wrote — `ON CONFLICT DO UPDATE` keeps
 * the existing one — so they are read back for this batch only. That is an
 * indexed lookup over a few thousand external ids, against a full reload of
 * the table, which for deals is 420 000 rows.
 *
 * When the map is not cached yet there is nothing to keep current, and the
 * next `map()` call will load it complete.
 */
async function rememberWritten(
  resolver: IdResolver,
  entity: Entity,
  rows: readonly { id: string; externalId: string | null }[],
): Promise<void> {
  if (resolver.isCached(entity)) resolver.merge(entity, rows)
}

/** UTC instant as a string Postgres reads back unchanged. See the header. */
function ts(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

const SOURCE_CAST = '"ExternalSource"'

/** Columns every externally-sourced table shares. */
function identityColumns(): ColumnSpec[] {
  return [
    /*
      INSERT-ONLY, or the row changes identity every time the portal touches it.

      `rowId()` mints a fresh id for every row in every batch, and the upsert
      conflicts on `(externalSource, externalId)` — so without this the update
      set carried `"id" = EXCLUDED."id"` and an ordinary re-import REPLACED the
      primary key of a row that already existed. Measured on production
      2026-09-03: of nineteen deals watched over a hundred seconds, the one the
      sync touched came back under a new id.

      Two things followed. Every child row was dragged along with it —
      `deal_item` and `deal_stage_history` relate to the deal with the default
      `onUpdate: Cascade`, so re-importing one deal rewrote the foreign key of
      each of its transitions, on a one-vCPU database. And every URL holding an
      internal id went stale within a minute: `/deals/[id]` and the
      confirmation queue's own trace panel both address a deal by this column,
      so a row opened after its deal had been re-synced asked for an id that no
      longer existed.

      The external key is the identity here. Ours is a local name for it, and a
      name is not something an import may change.
    */
    { name: 'id', insertOnly: true },
    { name: 'externalSource', cast: SOURCE_CAST },
    { name: 'externalId' },
  ]
}

/** `createdAt` must not move on re-import; `updatedAt` must. */
function lifecycleColumns(): ColumnSpec[] {
  return [
    { name: 'createdAt', cast: 'timestamp', insertOnly: true },
    { name: 'updatedAt', cast: 'timestamp' },
  ]
}

export function createSyncHandlers(
  prisma: PrismaClient,
  source: ExternalSourceValue,
  resolver: IdResolver = new IdResolver(prisma, source),
): EntitySyncHandler[] {
  const ids = (batch: readonly { externalId: string }[]) => batch.map((r) => r.externalId)

  /**
   * Department heads, waiting for their employee to exist.
   *
   * `department.get` names each head by user id, but departments are written
   * before employees — they have to be, since an employee points at a
   * department. So the link is parked here and drained at the end of the
   * employee pass, when both sides are present.
   */
  const pendingHeads = new Map<string, string>()

  // -------------------------------------------------------------------------
  // Organisation
  // -------------------------------------------------------------------------

  const departments: EntitySyncHandler<RawDepartment> = {
    entity: 'DEPARTMENTS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider: CrmProvider, options: FetchOptions) => provider.fetchDepartments(options),
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
        const data = {
          name: record.name,
          isActive: record.isActive,
          sortOrder: record.sortOrder ?? 0,
        }
        await prisma.department.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })

        if (record.headExternalId) pendingHeads.set(record.externalId, record.headExternalId)
      }

      resolver.invalidate('department')

      /**
       * Parents, in a second pass over the same batch.
       *
       * A department's parent is another department, and `department.get`
       * returns the tree in no guaranteed order — a child can arrive before
       * its parent. Linking after every row is written is the only way the
       * reference resolves for all of them.
       */
      for (const record of batch) {
        if (!record.parentExternalId) continue
        const parentId = await resolver.optional('department', record.parentExternalId)
        const selfId = await resolver.optional('department', record.externalId)
        if (!parentId || !selfId || parentId === selfId) continue

        await prisma.department.update({ where: { id: selfId }, data: { parentId } })
      }

      return { ...classify(batch, existing), skipped: 0 }
    },
  }

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
          departmentId: (await resolver.optional('department', record.departmentExternalId)) ?? null,
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

      // Drain the department heads parked during the department pass. Both
      // sides exist now, so every link that can resolve, resolves.
      for (const [departmentExternalId, headExternalId] of pendingHeads) {
        const departmentId = await resolver.optional('department', departmentExternalId)
        const headId = await resolver.optional('employee', headExternalId)
        if (!departmentId || !headId) continue
        await prisma.department.update({ where: { id: departmentId }, data: { headId } })
      }
      pendingHeads.clear()

      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------
  // Catalogue
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
          // Absent means unknown. Writing 0 would make every margin against
          // this product read as 100%.
          costMinor: record.costMinor ?? null,
          currency: record.currency,
          isActive: record.isActive,
          categoryId: (await resolver.optional('productCategory', record.categoryExternalId)) ?? null,
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
  // Pipeline structure
  // -------------------------------------------------------------------------

  const pipelines: EntitySyncHandler<RawPipeline> = {
    entity: 'PIPELINES',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchPipelines(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.pipeline.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = { name: record.name, role: record.role, sortOrder: record.sortOrder }
        await prisma.pipeline.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('pipeline')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

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
          logisticsRole: record.logisticsRole ?? null,
          confirmationSignal: record.confirmationSignal ?? null,
          pipelineId: (await resolver.optional('pipeline', record.pipelineExternalId)) ?? null,
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

  const stores: EntitySyncHandler<RawStore> = {
    entity: 'STORES',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchStores(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.store.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId!),
      )

      for (const record of batch) {
        const data = {
          name: record.name,
          address: record.address ?? null,
          isActive: record.isActive,
        }
        await prisma.store.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: { ...data, externalSource: source, externalId: record.externalId },
          update: data,
        })
      }

      resolver.invalidate('store')
      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------
  // Transactional data — bulk written
  // -------------------------------------------------------------------------

  const CUSTOMER_COLUMNS: ColumnSpec[] = [
    ...identityColumns(),
    { name: 'name' },
    { name: 'isCompany' },
    { name: 'email' },
    { name: 'phone' },
    { name: 'phones', cast: 'text[]' },
    { name: 'region' },
    ...lifecycleColumns(),
  ]

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

      const now = new Date().toISOString()
      await bulkUpsert({
        prisma,
        table: 'customer',
        columns: CUSTOMER_COLUMNS,
        conflict: ['externalSource', 'externalId'],
        rows: batch.map((r) => [
          rowId(),
          source,
          r.externalId,
          r.name,
          r.isCompany,
          r.email ?? null,
          r.phone ?? null,
          r.phones ? [...r.phones] : [],
          r.region ?? null,
          now,
          now,
        ]),
      })

      await rememberWritten(
        resolver,
        'customer',
        await prisma.customer.findMany({
          where: { externalSource: source, externalId: { in: ids(batch) } },
          select: { id: true, externalId: true },
        }),
      )

      return { ...classify(batch, existing), skipped: 0 }
    },

    /**
     * Close the deal → customer links the deal pass could not.
     *
     * Contacts are only worth fetching once the deals reveal which ones are
     * referenced, so deals are written first and land with `customerId` null.
     * The source contact id is kept in the deal's metadata precisely so this
     * can be one set-based UPDATE rather than a second 415 591-row read from
     * the portal.
     */
    async finalize() {
      await prisma.$executeRawUnsafe(
        `UPDATE "deal" AS d
         SET "customerId" = c."id"
         FROM "customer" AS c
         WHERE c."externalSource" = $1::"ExternalSource"
           AND d."externalSource" = $1::"ExternalSource"
           AND d."customerId" IS NULL
           AND c."externalId" = d."metadata"->>'contactId'`,
        source,
      )
    },
  }

  const DEAL_COLUMNS: ColumnSpec[] = [
    ...identityColumns(),
    { name: 'title' },
    { name: 'amountMinor', cast: 'bigint' },
    { name: 'currency' },
    { name: 'stageId' },
    { name: 'status', cast: '"DealStatus"' },
    { name: 'employeeId' },
    { name: 'customerId' },
    { name: 'sourceId' },
    { name: 'pipelineId' },
    { name: 'orderCode' },
    { name: 'countsAsRevenue' },
    { name: 'region' },
    { name: 'fulfilmentPoint' },
    { name: 'deliveryAddress' },
    { name: 'confirmStatus', cast: '"ConfirmStatus"' },
    { name: 'refusalReason' },
    { name: 'paymentMethodRaw' },
    { name: 'productLine' },
    { name: 'customerGrade' },
    { name: 'isReturnCustomer' },
    { name: 'createdAtSource', cast: 'timestamp' },
    { name: 'updatedAtSource', cast: 'timestamp' },
    { name: 'closedAt', cast: 'timestamp' },
    { name: 'metadata', cast: 'jsonb' },
    ...lifecycleColumns(),
  ]

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

      const stageMap = await resolver.map('dealStage')
      const employeeMap = await resolver.map('employee')
      // Batch-scoped: 322 000 customers do not fit in the worker's heap.
      const customerMap = await resolver.mapFor(
        'customer',
        batch.map((r) => r.customerExternalId),
      )
      const sourceMap = await resolver.map('salesSource')
      const pipelineMap = await resolver.map('pipeline')

      const now = new Date().toISOString()
      const rows: unknown[][] = []
      let skipped = 0

      for (const record of batch) {
        const stageId = stageMap.get(record.stageExternalId)
        const employeeId = employeeMap.get(record.employeeExternalId)

        /**
         * Both are required foreign keys, so a deal missing either is dropped
         * and counted rather than written as an orphan. The run then reports
         * PARTIAL, which is the visible signal that something upstream needs
         * looking at — a deal assigned to a user the portal no longer returns,
         * most often.
         */
        if (!stageId || !employeeId) {
          skipped++
          continue
        }

        rows.push([
          rowId(),
          source,
          record.externalId,
          record.title,
          record.amountMinor.toString(),
          record.currency,
          stageId,
          record.status,
          employeeId,
          link(customerMap, record.customerExternalId),
          link(sourceMap, record.sourceExternalId),
          link(pipelineMap, record.pipelineExternalId),
          record.orderCode ?? null,
          record.countsAsRevenue,
          record.region ?? null,
          record.fulfilmentPoint ?? null,
          record.deliveryAddress ?? null,
          record.confirmStatus ?? null,
          record.refusalReason ?? null,
          record.paymentMethodRaw ?? null,
          record.productLine ?? null,
          record.customerGrade ?? null,
          record.isReturnCustomer ?? false,
          ts(record.createdAtSource),
          ts(record.updatedAtSource),
          ts(record.closedAt),
          record.metadata ? JSON.stringify(record.metadata) : null,
          now,
          now,
        ])
      }

      await bulkUpsert({
        prisma,
        table: 'deal',
        columns: DEAL_COLUMNS,
        conflict: ['externalSource', 'externalId'],
        rows,
      })

      await rememberWritten(
        resolver,
        'deal',
        await prisma.deal.findMany({
          where: { externalSource: source, externalId: { in: ids(batch) } },
          select: { id: true, externalId: true },
        }),
      )

      const counts = classify(
        batch.filter((r) => stageMap.has(r.stageExternalId) && employeeMap.has(r.employeeExternalId)),
        existing,
      )
      return { ...counts, skipped }
    },
  }

  const DEAL_ITEM_COLUMNS: ColumnSpec[] = [
    ...identityColumns(),
    { name: 'dealId' },
    { name: 'productId' },
    { name: 'quantity' },
    { name: 'unitPriceMinor', cast: 'bigint' },
    { name: 'totalMinor', cast: 'bigint' },
    { name: 'discountMinor', cast: 'bigint' },
    { name: 'discountRateBp' },
    ...lifecycleColumns(),
  ]

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

      // Batch-scoped: 426 000 deals do not fit in the worker's heap.
      const dealMap = await resolver.mapFor('deal', batch.map((r) => r.dealExternalId))
      const productMap = await resolver.map('product')

      /**
       * Resurrect products the catalogue no longer has.
       *
       * Line items outlive the products they name. `catalog.product.get`
       * answers "product does not exist" for ids that appear on real, paid,
       * historical deals — someone deleted the catalogue entry and the sales
       * stayed. Skipping those lines would quietly remove their revenue from
       * every product figure while the deal total still counts it, so the
       * two would never reconcile.
       *
       * The line carries the name Bitrix24 recorded at the time, so the row is
       * rebuilt from that and marked inactive. It is honest about what it is:
       * a product that was sold and no longer exists.
       */
      const revived = new Map<string, string>()
      for (const record of batch) {
        if (productMap.has(record.productExternalId) || revived.has(record.productExternalId)) continue

        const name = record.productName?.trim()
        if (!name) continue

        const created = await prisma.product.upsert({
          where: {
            externalSource_externalId: {
              externalSource: source,
              externalId: record.productExternalId,
            },
          },
          create: {
            externalSource: source,
            externalId: record.productExternalId,
            name,
            isActive: false,
            currency: 'UZS',
          },
          update: {},
          select: { id: true },
        })
        revived.set(record.productExternalId, created.id)
      }
      if (revived.size > 0) resolver.invalidate('product')

      const now = new Date().toISOString()
      const rows: unknown[][] = []
      let skipped = 0
      let created = 0
      let updated = 0

      for (const record of batch) {
        const dealId = dealMap.get(record.dealExternalId)
        const productId = productMap.get(record.productExternalId) ?? revived.get(record.productExternalId)

        // A line whose deal is outside this import, or that names no product
        // at all, has nothing to attach to. Counted so the gap stays visible
        // in the sync log rather than passing as complete product analytics.
        if (!dealId || !productId) {
          skipped++
          continue
        }

        rows.push([
          rowId(),
          source,
          record.externalId,
          dealId,
          productId,
          record.quantity,
          record.unitPriceMinor.toString(),
          record.totalMinor.toString(),
          (record.discountMinor ?? 0n).toString(),
          record.discountRateBp ?? 0,
          now,
          now,
        ])

        if (existing.has(record.externalId)) updated++
        else created++
      }

      await bulkUpsert({
        prisma,
        table: 'deal_item',
        columns: DEAL_ITEM_COLUMNS,
        conflict: ['externalSource', 'externalId'],
        rows,
      })

      return { created, updated, skipped }
    },
  }

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

  // -------------------------------------------------------------------------
  // Stage history
  // -------------------------------------------------------------------------

  const HISTORY_COLUMNS: ColumnSpec[] = [
    ...identityColumns(),
    { name: 'dealId' },
    { name: 'stageId' },
    { name: 'enteredAt', cast: 'timestamp' },
    { name: 'createdAt', cast: 'timestamp', insertOnly: true },
  ]

  const stageHistory: EntitySyncHandler<RawStageHistory> = {
    entity: 'STAGE_HISTORY',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchStageHistory(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.dealStageHistory.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId),
      )

      // Batch-scoped: 426 000 deals do not fit in the worker's heap. This is
      // the call that killed the production sync worker.
      const dealMap = await resolver.mapFor('deal', batch.map((r) => r.dealExternalId))
      const stageMap = await resolver.map('dealStage')

      const now = new Date().toISOString()
      const rows: unknown[][] = []
      let skipped = 0

      for (const record of batch) {
        const dealId = dealMap.get(record.dealExternalId)
        const stageId = stageMap.get(record.stageExternalId)

        // A transition for a deal outside the imported pipelines, or into a
        // stage the portal has since deleted, has nothing to attach to.
        if (!dealId || !stageId) {
          skipped++
          continue
        }

        rows.push([rowId(), source, record.externalId, dealId, stageId, ts(record.enteredAt), now])
      }

      await bulkUpsert({
        prisma,
        table: 'deal_stage_history',
        columns: HISTORY_COLUMNS,
        conflict: ['externalSource', 'externalId'],
        rows,
      })

      const counts = classify(
        batch.filter((r) => dealMap.has(r.dealExternalId) && stageMap.has(r.stageExternalId)),
        existing,
      )
      return { ...counts, skipped }
    },

    /**
     * Close each transition with the start of the next one.
     *
     * The portal reports only when a deal ENTERED a stage. How long it stayed
     * there is the difference between consecutive entries, and that cannot be
     * computed while the rows are still arriving out of order across pages —
     * so it runs once, at the end, as a single set-based update.
     *
     * A row with `leftAt` still null after this is a deal sitting in that stage
     * right now, which is exactly what the in-transit figures count.
     */
    async finalize() {
      await prisma.$executeRawUnsafe(`
        UPDATE "deal_stage_history" AS h
        SET "leftAt" = next."enteredAt"
        FROM (
          SELECT
            "id",
            LEAD("enteredAt") OVER (PARTITION BY "dealId" ORDER BY "enteredAt", "id") AS "enteredAt"
          FROM "deal_stage_history"
        ) AS next
        WHERE h."id" = next."id"
          AND h."leftAt" IS DISTINCT FROM next."enteredAt"
      `)
    },
  }

  // -------------------------------------------------------------------------
  // Telephony
  // -------------------------------------------------------------------------

  const CALL_COLUMNS: ColumnSpec[] = [
    ...identityColumns(),
    { name: 'employeeId' },
    { name: 'customerId' },
    { name: 'dealId' },
    { name: 'direction', cast: '"CallDirection"' },
    { name: 'phoneNumber' },
    { name: 'startedAt', cast: 'timestamp' },
    { name: 'durationSec' },
    { name: 'connected' },
    { name: 'failedCode' },
    { name: 'recordUrl' },
    { name: 'createdAt', cast: 'timestamp', insertOnly: true },
  ]

  const calls: EntitySyncHandler<RawCall> = {
    entity: 'CALLS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchCalls(options),
    async persist(batch) {
      const existing = new Set(
        (
          await prisma.callRecord.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { externalId: true },
          })
        ).map((r) => r.externalId),
      )

      const employeeMap = await resolver.map('employee')
      const customerMap = await resolver.mapFor(
        'customer',
        batch.map((r) => r.customerExternalId),
      )
      const dealMap = await resolver.mapFor('deal', batch.map((r) => r.dealExternalId))

      const now = new Date().toISOString()

      /**
       * Every reference here is optional.
       *
       * A call to a number that never became a contact is still a call the
       * salesperson made, and dropping it would understate their activity. So
       * an unresolved link is written as null rather than skipping the row.
       */
      const rows = batch.map((record) => [
        rowId(),
        source,
        record.externalId,
        link(employeeMap, record.employeeExternalId),
        link(customerMap, record.customerExternalId),
        link(dealMap, record.dealExternalId),
        record.direction,
        record.phoneNumber ?? null,
        ts(record.startedAt),
        record.durationSec,
        record.connected,
        record.failedCode ?? null,
        record.recordUrl ?? null,
        now,
      ])

      await bulkUpsert({
        prisma,
        table: 'call_record',
        columns: CALL_COLUMNS,
        conflict: ['externalSource', 'externalId'],
        rows,
      })

      return { ...classify(batch, existing), skipped: 0 }
    },
  }

  // -------------------------------------------------------------------------
  // Warehouse
  // -------------------------------------------------------------------------

  const STOCK_COLUMNS: ColumnSpec[] = [
    // Insert-only for the same reason as `identityColumns` — this table's key
    // is (storeId, productId), so a fresh `rowId()` on a conflict would move
    // the row's id every time the shelf count is restated.
    { name: 'id', insertOnly: true },
    { name: 'storeId' },
    { name: 'productId' },
    { name: 'quantity', cast: 'decimal' },
    { name: 'reserved', cast: 'decimal' },
    { name: 'syncedAt', cast: 'timestamp' },
  ]

  const stock: EntitySyncHandler<RawStockLevel> = {
    entity: 'STOCK',
    // Stock has no external identity of its own — it is a fact about a
    // (store, product) pair, and that pair is the key it upserts on.
    externalIdOf: (record) => `${record.storeExternalId}:${record.productExternalId}`,
    fetch: (provider, options) => provider.fetchStockLevels(options),
    async persist(batch) {
      const storeMap = await resolver.map('store')
      const productMap = await resolver.map('product')

      const now = new Date().toISOString()
      const rows: unknown[][] = []
      let skipped = 0

      for (const record of batch) {
        const storeId = storeMap.get(record.storeExternalId)
        const productId = productMap.get(record.productExternalId)
        if (!storeId || !productId) {
          skipped++
          continue
        }
        rows.push([rowId(), storeId, productId, record.quantity, record.reserved, now])
      }

      const written = await bulkUpsert({
        prisma,
        table: 'stock_level',
        columns: STOCK_COLUMNS,
        conflict: ['storeId', 'productId'],
        rows,
      })

      // Stock is a snapshot, not a ledger: every row is a fresh statement of
      // what is on the shelf, so created-versus-updated carries no meaning
      // worth the extra query.
      return { created: written, updated: 0, skipped }
    },
  }

  // -------------------------------------------------------------------------
  // Sweepers
  // -------------------------------------------------------------------------

  /**
   * Remove rows whose source record no longer exists.
   *
   * Called by the engine ONLY after a completely clean FULL run, so a
   * transient fetch failure can never trigger a delete.
   *
   * Deleting a deal cascades to its items, payments and stage history, which
   * is why DEAL_ITEMS also sweeps on its own: an item can disappear from a
   * deal that still exists.
   *
   * The live-id set is staged in a temporary table and deleted by anti-join.
   * A `notIn` list was fine at demo scale; at 415 591 ids it produces a query
   * Postgres cannot plan.
   */
  const sweepByAntiJoin =
    (table: string, extraCondition = '') =>
    async (seen: ReadonlySet<string>): Promise<number> => {
      // An empty read means the source returned nothing at all. Deleting the
      // entire table on that basis would be catastrophic and is almost
      // certainly a misconfiguration rather than a real emptying.
      if (seen.size === 0) return 0

      const live = [...seen]

      /*
        ONE TRANSACTION, AND THIS IS NOT A STYLE CHOICE.

        Every `$executeRawUnsafe` outside a transaction is its own autocommit
        transaction, and `ON COMMIT DROP` means exactly what it says: the temp
        table was destroyed the instant the CREATE committed, so the TRUNCATE
        on the next line hit a table that no longer existed. Postgres raised
        42P01, SyncEngine caught it as a failed sweep and logged a warning
        nobody read — so for as long as this code has existed, NOTHING has ever
        been deleted. The dashboard kept showing deals removed in the portal,
        which is the very bug the sweep was written to fix.

        Holding one interactive transaction pins one connection, keeps the temp
        table alive across all the statements that need it, and lets ON COMMIT
        DROP finally do its job. The explicit DROP below is now belt-and-braces.

        The timeout is explicit because Prisma's interactive default is five
        seconds and this does roughly eighty chunked inserts of 400 000+ ids
        followed by an anti-join delete over the whole table.
      */
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE IF NOT EXISTS "sync_live_ids" ("externalId" TEXT PRIMARY KEY) ON COMMIT DROP`,
          )
          await tx.$executeRawUnsafe(`TRUNCATE "sync_live_ids"`)

          const CHUNK = 5_000
          for (let i = 0; i < live.length; i += CHUNK) {
            const chunk = live.slice(i, i + CHUNK)
            const placeholders = chunk.map((_, k) => `($${k + 1})`).join(', ')
            await tx.$executeRawUnsafe(
              `INSERT INTO "sync_live_ids" ("externalId") VALUES ${placeholders} ON CONFLICT DO NOTHING`,
              ...chunk,
            )
          }

          const deleted = await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" AS t
             WHERE t."externalSource" = $1::"ExternalSource"
               AND t."externalId" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM "sync_live_ids" l WHERE l."externalId" = t."externalId")
               ${extraCondition}`,
            source,
          )

          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "sync_live_ids"`)
          return deleted
        },
        { timeout: 600_000, maxWait: 30_000 },
      )
    }

  const sweepers: Partial<Record<string, (seen: ReadonlySet<string>) => Promise<number>>> = {
    // A customer with deals is never swept: the deals are the reason they are
    // in the database, and the portal may simply have stopped returning them.
    CUSTOMERS: sweepByAntiJoin(
      'customer',
      'AND NOT EXISTS (SELECT 1 FROM "deal" d WHERE d."customerId" = t."id")',
    ),
    DEALS: sweepByAntiJoin('deal'),
    DEAL_ITEMS: sweepByAntiJoin('deal_item'),
    PAYMENTS: sweepByAntiJoin('payment'),
  }

  // Order matters: this is the dependency order the engine runs them in.
  const handlers = [
    departments,
    employees,
    productCategories,
    products,
    pipelines,
    stages,
    sources,
    stores,
    customers,
    deals,
    dealItems,
    payments,
    stock,
    stageHistory,
    calls,
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
