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
import { floorNumberOf, indexByFloorNumber } from '@/server/domain/employees/floorNumber'
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

/**
 * The «Ответственный» changes a deals batch carries: a deal already stored
 * whose portal owner now resolves to another employee. A new deal is no
 * change — who opened it is `createdByEmployeeId` — and an owner we cannot
 * resolve is skipped with the deal itself. See DealOwnerChange.
 */
export function ownerChangesOf(
  before: readonly { id: string; externalId: string | null; employeeId: string }[],
  batch: readonly Pick<RawDeal, 'externalId' | 'employeeExternalId' | 'updatedAtSource'>[],
  employeeMap: ReadonlyMap<string, string>,
  now: Date = new Date(),
): { dealId: string; fromEmployeeId: string; toEmployeeId: string; changedAt: Date }[] {
  const stored = new Map(before.map((r) => [r.externalId, r]))
  const out: { dealId: string; fromEmployeeId: string; toEmployeeId: string; changedAt: Date }[] = []
  for (const record of batch) {
    const row = stored.get(record.externalId)
    const to = employeeMap.get(record.employeeExternalId)
    if (!row || !to || to === row.employeeId) continue
    out.push({ dealId: row.id, fromEmployeeId: row.employeeId, toEmployeeId: to, changedAt: record.updatedAtSource ?? now })
  }
  return out
}

/**
 * Close each transition with the start of the next one.
 *
 * The portal reports only when a deal ENTERED a stage. How long it stayed
 * there is the difference between consecutive entries, and that cannot be
 * computed while rows are still arriving out of order across pages — so it
 * runs once, at the end of the run, as one set-based update. A row with
 * `leftAt` still null afterwards is a deal sitting in that stage right now,
 * which is exactly what the in-transit figures count.
 *
 * SCOPED TO THE DEALS THE RUN ACTUALLY TOUCHED, and that is not a
 * micro-optimisation. Unscoped, this was the most expensive statement on the
 * production database by a factor of four: 21.6% of all execution time,
 * 7 472 calls at a mean of 1 745 ms and a worst case of 67 SECONDS, for a
 * lifetime total of 178 379 updated rows — twenty-four rows per call. It ran
 * every minute, computing a window function over all 222 600 history rows to
 * close about two dozen of them, on the one vCPU that also has to answer every
 * page the dashboard serves. That is most of what "the dashboard is slow" was.
 *
 * Scoping by DEAL is exactly right rather than merely cheaper: `leftAt` on a
 * row is decided by the next row OF THE SAME DEAL, so a deal whose history did
 * not change this run cannot have a new answer. Deals nobody touched are
 * skipped because there is nothing to recompute, not because it is faster.
 */
export function historyLeftAtSql(scoped: boolean): string {
  return `
        UPDATE "deal_stage_history" AS h
        SET "leftAt" = next."enteredAt"
        FROM (
          SELECT
            "id",
            LEAD("enteredAt") OVER (PARTITION BY "dealId" ORDER BY "enteredAt", "id") AS "enteredAt"
          FROM "deal_stage_history"
          ${scoped ? 'WHERE "dealId" = ANY($1::text[])' : ''}
        ) AS next
        WHERE h."id" = next."id"
          AND h."leftAt" IS DISTINCT FROM next."enteredAt"
      `
}

/**
 * The most one deletion sweep may remove: 500 rows, or 1% of the table if that
 * is more.
 *
 * A day's real deletions are test and duplicate orders — a handful. Thousands
 * «gone» at once is far likelier to be the webhook losing sight of a pipeline:
 * Bitrix24 applies a role change silently, so the walk comes back complete and
 * error-free with one pipeline's 184 000 deals missing, and the delete would
 * cascade to their stage history, line items and owner changes, which the
 * incremental sync never reads again. `goneLimit` in recentDeletions.ts defers
 * to «the daily sweep, which has its own guards»; this is them. Past it the
 * sweep deletes NOTHING and throws `SweepRefusedError`.
 */
export function sweepLimit(stored: number): number {
  return Math.max(500, Math.ceil(stored * 0.01))
}

/**
 * A deletion sweep `sweepLimit` refused. Nothing was deleted.
 *
 * It carries the figures because the worker records them and somebody has to
 * decide from them: a pipeline that dropped out of the webhook's sight, or a
 * portal that really lost that many records.
 */
export class SweepRefusedError extends Error {
  constructor(
    readonly table: string,
    readonly seen: number,
    readonly stored: number,
    readonly gone: number,
    readonly limit: number,
  ) {
    super(
      `${table}: portal ${seen} ta qaytardi, bazada ${stored} ta, ${gone} tasi portalda yoʻq — ` +
        `bu juda koʻp (chegara ${limit}), hech narsa oʻchirilmadi`,
    )
    this.name = 'SweepRefusedError'
  }
}

/**
 * The most units one DEPARTMENTS pass may retire: half the active ones, never
 * fewer than two.
 *
 * The client removes a ROP unit or two at a time. Most of the tree «gone» from
 * one answer is a misread, and retiring on it would take the org chart's cards
 * and RNP's teams away at once.
 */
export function retireLimit(active: number): number {
  return Math.max(2, Math.floor(active / 2))
}

/**
 * The most one line-item reconciliation may delete: 25 lines, or 5% of the
 * lines stored for the deals it read if that is more.
 *
 * A real edit takes a line or two off an order. Most of a run's lines «gone»
 * at once is far likelier to be the portal answering product rows empty than
 * a morning of edits — so a pass like that deletes nothing and says so, as
 * `goneLimit` and `relinkLimit` do.
 */
export function surplusLineLimit(stored: number): number {
  return Math.max(25, Math.ceil(stored * 0.05))
}

/**
 * Above this many deals, close the whole table in one pass instead.
 *
 * A FULL run touches every deal there is, and handing a hundred thousand ids
 * to `= ANY($1)` is slower than the sequential pass it was trying to avoid —
 * the unscoped form is the right shape for that case and always was. The cap
 * is what keeps an incremental tick cheap without making a full import worse.
 */
const FINALIZE_SCOPE_MAX = 20_000

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
   * Floor badge to employee, read once and kept until the roster changes.
   *
   * The roster is ~290 rows and every DEALS batch needs the same map, so
   * fetching it per batch would be 175 identical queries on a full pass. It
   * must NOT outlive a hiring change: the EMPLOYEES pass drops it, so the next
   * deals batch reads the roster it just wrote.
   *
   * It used to say «not cached across runs» and was in fact cached for the
   * PROCESS — the worker builds these handlers once and nothing reset it. A
   * seller imported by the three-hourly reference pass then had every order
   * written with `operatorEmployeeId` NULL until the next deploy, and the
   * readers' COALESCE credited those orders to whoever owned the deal: the
   * sellers board, the queue, payroll and the ROP's TEAM rows.
   */
  let operatorIndex: Map<number, string> | null = null
  const floorNumberIndex = async (): Promise<Map<number, string>> => {
    if (operatorIndex) return operatorIndex
    const roster = await prisma.employee.findMany({ select: { id: true, fullName: true } })
    operatorIndex = indexByFloorNumber(roster, (person) => person)
    return operatorIndex
  }

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

  /**
   * Every unit the portal returned in this DEPARTMENTS run, for `finalize`.
   *
   * Taken from the fetched pages, not from what was written: a unit the
   * portal still lists is alive even if its own upsert failed.
   */
  const departmentsSeen = new Set<string>()

  const departments: EntitySyncHandler<RawDepartment> = {
    entity: 'DEPARTMENTS',
    externalIdOf: (record) => record.externalId,
    async fetch(provider: CrmProvider, options: FetchOptions) {
      const page = await provider.fetchDepartments(options)
      for (const record of page.items) departmentsSeen.add(record.externalId)
      return page
    },
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
          /*
            A HEAD THE PORTAL NO LONGER NAMES IS CLEARED HERE; one it names is
            linked after the employee pass, below. It used to be only ever set:
            «Saida(ROP)» kept Shohjaxon as its head after the portal cleared
            UF_HEAD, and every lead naming him went to «Саида РОП» on /rnp and
            «Lidlar» (2026-10-02) — and the stale head kept its row scope.
          */
          update: record.headExternalId ? data : { ...data, headId: null },
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
       *
       * A UNIT THE PORTAL PUTS AT THE TOP LOSES ITS PARENT here, as a head the
       * portal stops naming loses it above; it used to stay drawn under the
       * old one. Only when the batch names a parent for some unit: one that
       * names none (the engine's one-record retry, or an answer missing the
       * field) proves nothing about the tree.
       */
      const namesParents = batch.some((record) => record.parentExternalId)
      for (const record of batch) {
        if (!record.parentExternalId) {
          if (namesParents) {
            await prisma.department.updateMany({
              where: { externalSource: source, externalId: record.externalId, parentId: { not: null } },
              data: { parentId: null },
            })
          }
          continue
        }
        const parentId = await resolver.optional('department', record.parentExternalId)
        const selfId = await resolver.optional('department', record.externalId)
        if (!parentId || !selfId || parentId === selfId) continue

        await prisma.department.update({ where: { id: selfId }, data: { parentId } })
      }

      return { ...classify(batch, existing), skipped: 0 }
    },

    /**
     * Retire the units the portal no longer returns — deactivated, never
     * deleted.
     *
     * The pass only ever upserted what came back and nothing set `isActive`
     * false, so a unit deleted in Bitrix24 (the client does remove ROP units —
     * Husniddin(ROP)) kept its card on /structure, its place in RNP's ROP list
     * and the «Boʻlim» filter, and its head: every `isActive` filter in the
     * repositories was a no-op. Kept as a row because employees, members and
     * deals reference it and history must still resolve; its head is cleared
     * so nobody's TEAM scope anchors on a unit that is gone. A unit the portal
     * returns again is active again — the upsert above writes `isActive`.
     *
     * `department.get` answers with the whole tree on every pass, so a unit it
     * leaves out is a deleted one — unless it left out everything (the
     * provider's «scope yoʻq» path) or most of the tree at once, which is a
     * misread rather than a reorganisation: past `retireLimit` nothing changes
     * and the run says why.
     */
    async finalize() {
      const seen = [...departmentsSeen]
      departmentsSeen.clear()
      if (seen.length === 0) return

      const gone = await prisma.department.findMany({
        where: { externalSource: source, isActive: true, externalId: { notIn: seen } },
        select: { id: true },
      })
      if (gone.length === 0) return

      const active = await prisma.department.count({ where: { externalSource: source, isActive: true } })
      const limit = retireLimit(active)
      if (gone.length > limit) {
        throw new Error(
          `${active} ta faol boʻlimdan ${gone.length} tasini portal qaytarmadi — ` +
            `bu juda koʻp (chegara ${limit}), hech biri nofaol qilinmadi`,
        )
      }
      await prisma.department.updateMany({
        where: { id: { in: gone.map((d) => d.id) } },
        data: { isActive: false, headId: null },
      })
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
      // A hire, a rename or a reused badge is in the roster now; see `operatorIndex`.
      operatorIndex = null

      /*
        MEMBERSHIP IS MANY-TO-MANY, AND ONLY THE ORG CHART READS IT.

        `departmentId` above is the person's PRIMARY unit and is what every
        analytic credits them to — rolling a two-unit person up both branches
        would count their headcount and their money twice. But Bitrix24's
        `UF_DEPARTMENT` is an array and its own company-structure screen counts
        a person once in each entry, so the screen we reproduce needs the full
        set. Nine of this portal's 208 active people have two.

        Replace rather than merge: a person moved out of a unit has no record
        left saying so, so anything not in this pass's list is gone. Scoped to
        the batch's own employees, which on an incremental run is the handful
        that changed.
      */
      const employeeMap = await resolver.map('employee')
      const departmentMap = await resolver.map('department')

      const memberships: { departmentId: string; employeeId: string; isPrimary: boolean }[] = []
      const touched: string[] = []

      for (const record of batch) {
        const employeeId = employeeMap.get(record.externalId)
        if (!employeeId) continue
        touched.push(employeeId)

        // A provider with no multi-unit concept says so by leaving the array
        // undefined; its single unit is the same answer, not a lesser one.
        const externalIds =
          record.departmentExternalIds ??
          (record.departmentExternalId ? [record.departmentExternalId] : [])

        const seen = new Set<string>()
        for (const [index, externalId] of externalIds.entries()) {
          const departmentId = departmentMap.get(externalId)
          // A unit we never imported is dropped rather than guessed at. The FK
          // would refuse the row anyway, and refusing it takes the whole
          // multi-row insert with it.
          if (!departmentId || seen.has(departmentId)) continue
          seen.add(departmentId)
          memberships.push({ departmentId, employeeId, isPrimary: index === 0 })
        }
      }

      /*
        ONE TRANSACTION, because the delete is the whole table.

        `fetchEmployees` returns every user in a single page, so `touched` is
        the entire roster and the delete empties `department_member` before the
        insert puts it back. Run as two statements that is a 20-150 ms window —
        measured at 1.6 ms + 15.5 ms locally on 298 rows, plus round trips —
        during which every card on the org chart reads zero members, once every
        thirty worker ticks and again on every restart and redeploy. Nothing
        errors and nothing logs it; a reader simply catches the screen mid-blink.
      */
      if (touched.length > 0 || memberships.length > 0) {
        await prisma.$transaction([
          prisma.departmentMember.deleteMany({ where: { employeeId: { in: touched } } }),
          prisma.departmentMember.createMany({ data: memberships, skipDuplicates: true }),
        ])
      }

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
          parentExternalId: record.parentExternalId ?? null,
          priceMinor: record.priceMinor ?? null,
          currency: record.currency,
          isActive: record.isActive,
          categoryId: (await resolver.optional('productCategory', record.categoryExternalId)) ?? null,
        }

        /*
          UNDEFINED IS «I COULD NOT READ IT», AND IT MUST NOT OVERWRITE.

          `costMinor: record.costMinor ?? null` sat in this object, so both
          branches wrote it — and the catalogue methods that supply the cost are
          a DIFFERENT set from `crm.product.list` that supplies the row. Bitrix24
          blocks individual methods (`OPERATION_TIME_LIMIT`) while answering
          others, so a pass could read every product and no cost at all, write
          null over each one, and finish SUCCESS. Every margin figure on the
          dashboard then reads «no cost» — correctly, because that is what the
          column now says — until a reference tick up to thirty ticks away
          repairs it.

          On INSERT, absent still means unknown: writing 0 would make every
          margin against a new product read as 100%. On UPDATE, absent now means
          «leave yesterday's answer alone», which Prisma does for an omitted
          field. An explicit `null` from the provider still clears it.
        */
        await prisma.product.upsert({
          where: {
            externalSource_externalId: { externalSource: source, externalId: record.externalId },
          },
          create: {
            ...data,
            costMinor: record.costMinor ?? null,
            externalSource: source,
            externalId: record.externalId,
          },
          update: {
            ...data,
            ...(record.costMinor === undefined ? {} : { costMinor: record.costMinor }),
          },
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
    { name: 'createdAtSource', cast: 'timestamp' },
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
          ts(r.createdAtSource),
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
    { name: 'operatorNameSource' },
    { name: 'operatorTeamSource' },
    { name: 'operatorEmployeeId' },
    { name: 'targetolog' },
    { name: 'registrar' },
    { name: 'creative' },
    { name: 'primarySource' },
    { name: 'leadArrivedAt', cast: 'timestamp' },
    { name: 'leadDistributedOn', cast: 'date' },
    { name: 'aiQualifiedAt', cast: 'timestamp' },
    { name: 'leadRopEmployeeId' },
    { name: 'createdByEmployeeId' },
    { name: 'repeatLead' },
    { name: 'isReturnCustomer' },
    { name: 'createdAtSource', cast: 'timestamp' },
    { name: 'updatedAtSource', cast: 'timestamp' },
    { name: 'closedAt', cast: 'timestamp' },
    { name: 'metadata', cast: 'jsonb' },
    ...lifecycleColumns(),
  ]

  /**
   * Deals a deals batch saw lose ALL their money, for the next line-item read.
   *
   * The provider reads line items only for deals that carry money, so an order
   * whose every product was removed — its amount falls to zero with them —
   * was never read again and kept the lines it no longer has. The deals pass
   * is the one place that sees both amounts, so it names them; DEAL_ITEMS
   * hands them to the provider (`dealExternalIds`) and its reconciliation
   * drops what the portal no longer lists.
   */
  const emptiedDeals = new Set<string>()

  const deals: EntitySyncHandler<RawDeal> = {
    entity: 'DEALS',
    externalIdOf: (record) => record.externalId,
    fetch: (provider, options) => provider.fetchDeals(options),
    async persist(batch) {
      const stageMap = await resolver.map('dealStage')
      const employeeMap = await resolver.map('employee')
      const operatorMap = await floorNumberIndex()
      // Batch-scoped: 322 000 customers do not fit in the worker's heap.
      const customerMap = await resolver.mapFor(
        'customer',
        batch.map((r) => r.customerExternalId),
      )
      const sourceMap = await resolver.map('salesSource')
      const pipelineMap = await resolver.map('pipeline')
      // Owner changes are kept for Регистрация only — «Безквал» is their one reader.
      const leadPipelines = new Set(
        (await prisma.pipeline.findMany({ where: { role: 'LEAD' }, select: { id: true } })).map((p) => p.id),
      )

      const now = new Date().toISOString()
      const rows: unknown[][] = []
      const written: RawDeal[] = []
      let skipped = 0

      for (const record of batch) {
        const stageId = stageMap.get(record.stageExternalId)
        const employeeId = employeeMap.get(record.employeeExternalId)

        /*
          WHO ACTUALLY SOLD IT, when the portal recorded it.

          `employeeId` above is ASSIGNED_BY_ID — the deal's owner today — and
          this portal moves deals to back office while they are processed. In
          July 2026 that put 556 orders on the head of Операцион and made him
          the sellers board's number one. The portal's own snapshot names the
          real seller, and the only thing the two spellings share is the floor
          badge, so resolution happens here rather than in every query.

          Null is normal, not an error: the field was added in May 2026, so
          older cohorts are 20% empty and August is 10%. Readers COALESCE onto
          `employeeId`, which is why this is resolved but not required.
        */
        const operatorBadge = record.operatorNameSource
          ? floorNumberOf(record.operatorNameSource)
          : null
        const operatorEmployeeId =
          operatorBadge === null ? null : (operatorMap.get(operatorBadge) ?? null)

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

        written.push(record)
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
          record.operatorNameSource ?? null,
          record.operatorTeamSource ?? null,
          operatorEmployeeId,
          record.targetolog ?? null,
          record.registrar ?? null,
          record.creative ?? null,
          record.primarySource ?? null,
          ts(record.leadArrivedAt),
          record.leadDistributedOn ?? null,
          ts(record.aiQualifiedAt),
          // A ROP the roster does not know yet is null, not a skipped deal:
          // the lead still counts, under «ROP koʻrsatilmagan».
          record.leadRopExternalId ? (employeeMap.get(record.leadRopExternalId) ?? null) : null,
          record.createdByExternalId ? (employeeMap.get(record.createdByExternalId) ?? null) : null,
          record.repeatLead ?? null,
          record.isReturnCustomer ?? false,
          ts(record.createdAtSource),
          ts(record.updatedAtSource),
          ts(record.closedAt),
          record.metadata ? JSON.stringify(record.metadata) : null,
          now,
          now,
        ])
      }

      /*
        One transaction: the owner before, the write, and the changes it made.
        Apart, a failed insert sent the engine to its record-by-record retry,
        which read the NEW owner as "before" and lost the change for good.
      */
      const stored = await prisma.$transaction(
        async (tx) => {
          const before = await tx.deal.findMany({
            where: { externalSource: source, externalId: { in: ids(batch) } },
            select: { id: true, externalId: true, employeeId: true, amountMinor: true },
          })
          await bulkUpsert({
            prisma: tx,
            table: 'deal',
            columns: DEAL_COLUMNS,
            conflict: ['externalSource', 'externalId'],
            rows,
          })
          const inRegistration = written.filter((r) => leadPipelines.has(link(pipelineMap, r.pipelineExternalId) ?? ''))
          const changes = ownerChangesOf(before, inRegistration, employeeMap)
          if (changes.length > 0) await tx.dealOwnerChange.createMany({ data: changes })
          return before
        },
        { maxWait: 10_000, timeout: 60_000 },
      )
      const existing = new Set(stored.map((r) => r.externalId!))

      // An order that lost all its money lost its lines with it — see `emptiedDeals`.
      const paidBefore = new Set(stored.filter((r) => (r.amountMinor ?? 0n) > 0n).map((r) => r.externalId))
      for (const record of written) {
        if (record.amountMinor === 0n && paidBefore.has(record.externalId)) emptiedDeals.add(record.externalId)
      }

      await rememberWritten(
        resolver,
        'deal',
        await prisma.deal.findMany({
          where: { externalSource: source, externalId: { in: ids(batch) } },
          select: { id: true, externalId: true },
        }),
      )

      const counts = classify(written, existing)
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

  /**
   * The line keys each deal came back with in this run, for `finalize`.
   *
   * Only the deals the provider says it read IN FULL (`dealsRead`), a deal with
   * no lines left included. In-process like `touchedDeals` below, and cleared
   * by `finalize`: a run that fails before it leaves them for the next run,
   * whose newer read of a deal replaces the older one.
   */
  const linesRead = new Map<string, Set<string>>()

  const dealItems: EntitySyncHandler<RawDealItem> = {
    entity: 'DEAL_ITEMS',
    externalIdOf: (record) => record.externalId,
    async fetch(provider, options) {
      const emptied = options.cursor === undefined ? [...emptiedDeals] : []
      if (options.cursor === undefined) emptiedDeals.clear()
      // Cleared before the read on purpose: the Bitrix24 provider keeps what a
      // failed read did not settle (`itemDealsOwed`), these deals included.
      const page = await provider.fetchDealItems(
        emptied.length > 0 ? { ...options, dealExternalIds: emptied } : options,
      )
      for (const dealId of page.dealsRead ?? []) linesRead.set(dealId, new Set())
      for (const item of page.items) linesRead.get(item.dealExternalId)?.add(item.externalId)
      return page
    },
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

    /**
     * Drop the lines the portal no longer lists — per deal, never per batch.
     *
     * A line's key is its POSITION (`${dealId}-${index}`: the portal gives
     * product rows no id of their own), and the upsert only ever wrote what
     * came back. So an order that went from [Collagen, Zextra] to [Zextra]
     * kept a second Zextra at position 1 for good: its lines summed past its
     * amount, margin counted that revenue and its cost twice, and the brand
     * rule, Sverka and the queue's Продукт column read a product the order no
     * longer had.
     *
     * Here, not in `persist`: the engine retries a failed batch one record at
     * a time, and a delete scoped to the batch would then take every line's
     * siblings with it. Only deals the provider read in full are touched, and
     * past `surplusLineLimit` nothing is deleted — the run says PARTIAL and the
     * reason.
     */
    async finalize() {
      const read = [...linesRead]
      linesRead.clear()
      if (read.length === 0) return

      const dealIds = read.map(([dealId]) => dealId)
      const kept = read.flatMap(([, keys]) => [...keys])
      // ONE population for the count and the delete, so the guard measures
      // exactly what would go.
      const scope = `FROM "deal_item" AS t
          JOIN "deal" AS d ON d."id" = t."dealId"
         WHERE d."externalSource" = $1::"ExternalSource"
           AND d."externalId" = ANY($2::text[])
           AND t."externalSource" = $1::"ExternalSource"
           AND t."externalId" IS NOT NULL`
      const surplus = `AND NOT EXISTS (
            SELECT 1 FROM unnest($3::text[]) AS k("externalId") WHERE k."externalId" = t."externalId"
          )`

      await prisma.$transaction(
        async (tx) => {
          const [counted] = await tx.$queryRawUnsafe<{ stored: bigint; surplus: bigint }[]>(
            `SELECT (SELECT count(*) ${scope})::bigint AS stored,
                    (SELECT count(*) ${scope} ${surplus})::bigint AS surplus`,
            source,
            dealIds,
            kept,
          )
          const stored = Number(counted?.stored ?? 0)
          const extra = Number(counted?.surplus ?? 0)
          if (extra === 0) return

          const limit = surplusLineLimit(stored)
          if (extra > limit) {
            throw new Error(
              `${dealIds.length} ta bitimning ${stored} ta qatoridan ${extra} tasini portal endi koʻrsatmaydi — ` +
                `bu juda koʻp (chegara ${limit}), hech narsa oʻchirilmadi`,
            )
          }
          await tx.$executeRawUnsafe(
            `DELETE FROM "deal_item" WHERE "id" IN (SELECT t."id" ${scope} ${surplus})`,
            source,
            dealIds,
            kept,
          )
        },
        { maxWait: 10_000, timeout: 120_000 },
      )
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

  /**
   * The deals whose transitions this run wrote, for `finalize` to close.
   *
   * In-process and per handler set, like the DEAL_ITEMS pass above: the engine
   * has no seam for "state that lives for one run", and inventing one for a
   * single string set would be a larger change than the thing it carries.
   */
  const touchedDeals = new Set<string>()

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
        /*
          Remembered for `finalize` below, which closes only these deals'
          transitions. Accumulated across the run's pages, cleared when the
          run ends — a run that fails before finalizing leaves them here, and
          the next run closes them, which is what should happen.
        */
        touchedDeals.add(dealId)
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

    /** See `historyLeftAtSql` — why it closes these deals and not the table. */
    async finalize() {
      const ids = [...touchedDeals]
      touchedDeals.clear()

      // Nothing arrived, so nothing can have a new neighbour. The old form
      // still recomputed the entire table on a tick that wrote no rows at all.
      if (ids.length === 0) return

      const scoped = ids.length <= FINALIZE_SCOPE_MAX
      await prisma.$executeRawUnsafe(historyLeftAtSql(scoped), ...(scoped ? [ids] : []))
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
    (table: string, extraCondition = '', limit?: (stored: number) => number) =>
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

          const stored = `FROM "${table}" AS t
             WHERE t."externalSource" = $1::"ExternalSource"
               AND t."externalId" IS NOT NULL`
          const gone = `${stored}
               AND NOT EXISTS (SELECT 1 FROM "sync_live_ids" l WHERE l."externalId" = t."externalId")
               ${extraCondition}`

          /*
            COUNTED BEFORE ANYTHING IS DELETED, against the very population the
            DELETE below removes — see `sweepLimit`. A sweep within the limit
            deletes exactly what it did before the guard existed.
          */
          if (limit) {
            const [counted] = await tx.$queryRawUnsafe<{ stored: bigint; gone: bigint }[]>(
              `SELECT (SELECT count(*) ${stored} ${extraCondition})::bigint AS stored,
                      (SELECT count(*) ${gone})::bigint AS gone`,
              source,
            )
            const total = Number(counted?.stored ?? 0)
            const missing = Number(counted?.gone ?? 0)
            if (missing > limit(total)) {
              throw new SweepRefusedError(table, live.length, total, missing, limit(total))
            }
          }

          const deleted = await tx.$executeRawUnsafe(`DELETE ${gone}`, source)

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
    // Guarded: the daily sweep feeds this from a walk a permission change can
    // shorten without an error. See `sweepLimit`.
    DEALS: sweepByAntiJoin('deal', '', sweepLimit),
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

/** Satisfies the unused-parameter contract for handlers that ignore batch typing. */
export type { BatchOutcome }
