/**
 * Bitrix24 CRM provider.
 *
 * Implements the same `CrmProvider` interface as the demo provider, so nothing
 * downstream — sync engine, database, analytics, API, dashboard — changes when
 * this becomes the active source.
 *
 * The field mapping in `mapping.ts` was read from the live portal, not guessed.
 *
 * THROUGHPUT
 * The portal holds 415 591 deals, 317 674 contacts and 3.8 million stage
 * transitions. A list method returns at most 50 rows per call and the portal
 * allows ~2 calls a second, so read sequentially that is over three hours
 * before anything else runs.
 *
 * Every bulk read therefore goes through `batchWalk`: fifty id-chained seeks
 * packed into one HTTP request, 2 500 rows in well under a second. See that
 * method for why it walks by id rather than by offset — the short version is
 * that offsets work until the portal blocks the method, and then they do not
 * work at all.
 */

import {
  type CrmProvider,
  type FetchOptions,
  type Page,
  type ProviderCapabilities,
  type ProviderHealth,
  type RawCall,
  type RawCustomer,
  type RawDeal,
  type RawDealItem,
  type RawDepartment,
  type RawEmployee,
  type RawPayment,
  type RawPipeline,
  type RawProduct,
  type RawProductCategory,
  type RawSalesSource,
  type RawStage,
  type RawStageHistory,
  type RawStockLevel,
  type RawStore,
} from '@/server/integrations/crm/CrmProvider'
import type { ExternalSourceValue } from '@/server/domain/types'

import {
  ALL_PIPELINES,
  DELIVERY_ROUTE_NAMES,
  PIPELINE_NAMES,
  UF,
  UF_FIELDS,
  callDirection,
  categoryFromSemantic,
  confirmStatusFromLabel,
  dealStatus,
  extractOrderCode,
  logisticsRole,
  pipelineRole,
  toDate,
  toMinorUnits,
} from './mapping'
import { RateLimiter, backoffDelayMs, sleep } from './rateLimiter'

export interface Bitrix24ProviderOptions {
  readonly webhookUrl: string
  readonly rateLimitRps?: number
  readonly requestTimeoutMs?: number
  readonly maxRetries?: number
  readonly fetchImpl?: typeof fetch
  /** Override which pipelines are imported. Defaults to all nine. */
  readonly pipelines?: readonly number[]
  /**
   * Pipelines whose stage history is worth the read. Defaults to the four the
   * duration modules actually measure; the lead and triage funnels between
   * them account for most of the 3.8 million transitions and nothing looks at
   * how long a registration record sat in a stage.
   */
  readonly historyPipelines?: readonly number[]
  /**
   * How far back to read telephony. Defaults to 1 month.
   *
   * The portal logs roughly 12 400 calls a DAY — measured, not estimated. A
   * year of that is four and a half million rows for a question nobody asks:
   * call activity is judged against this month, not against last spring.
   *
   * One month is ~370 000 rows. The first import pays for that once; after it,
   * incremental syncs add a day at a time. Raise it with BITRIX24_CALL_MONTHS
   * when a longer window is genuinely wanted, and expect the initial run to
   * grow in proportion.
   */
  readonly callHistoryMonths?: number
  readonly onProgress?: (message: string) => void
}

interface Bitrix24Response<T> {
  readonly result?: T
  readonly next?: number
  readonly total?: number
  readonly error?: string
  readonly error_description?: string
}

export class Bitrix24Error extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message)
    this.name = 'Bitrix24Error'
  }
}

/** Rows a single list call returns. Fixed by the portal, not configurable. */
const LIST_PAGE = 50
/** Commands per batch request. The portal's hard limit. */
const BATCH_SIZE = 50
const DEAL_SELECT = [
  'ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
  'OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID', 'CONTACT_ID',
  'SOURCE_ID', 'DATE_CREATE', 'DATE_MODIFY', 'CLOSEDATE', 'CLOSED',
  'IS_RETURN_CUSTOMER',
  ...UF_FIELDS,
]

export class Bitrix24CrmProvider implements CrmProvider {
  readonly source: ExternalSourceValue = 'BITRIX24'

  /**
   * What this portal can actually supply.
   *
   * PRODUCT_CATEGORIES and PAYMENTS are false because the portal has none —
   * verified, not assumed. STORES and STOCK start false and are switched on by
   * `detectScopes()` when the webhook turns out to carry the `catalog` scope.
   *
   * A capability left false makes the API report the data as unavailable
   * rather than as zero. That distinction is the point: a warehouse page
   * showing 0 units in stock is a false statement, not an empty state.
   */
  capabilities: ProviderCapabilities = {
    DEPARTMENTS: true,
    EMPLOYEES: true,
    PRODUCT_CATEGORIES: false,
    PRODUCTS: true,
    PIPELINES: true,
    STAGES: true,
    SOURCES: true,
    CUSTOMERS: true,
    DEALS: true,
    DEAL_ITEMS: true,
    PAYMENTS: false,
    STAGE_HISTORY: true,
    CALLS: true,
    STORES: false,
    STOCK: false,
  }

  private readonly webhookUrl: string
  private readonly limiter: RateLimiter
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch
  private readonly pipelines: readonly number[]
  private readonly historyPipelines: readonly number[]
  private readonly callHistoryMonths: number
  private readonly progress: (m: string) => void

  /** Deals in a REVENUE pipeline — the only ones whose line items are read. */
  private revenueDealIds: string[] = []

  // Running totals, for progress output only. The walk is stateless — every
  // page is addressed by the id it starts after — so these carry no meaning
  // the sync depends on.
  private dealsRead = 0
  private customersRead = 0
  private historyRead = 0
  private callsRead = 0

  /** Resolved once from `crm.deal.fields`: field name → item id → label. */
  private enumLabels: Map<string, Map<string, string>> | undefined
  private grantedScopes: Set<string> | undefined

  constructor(options: Bitrix24ProviderOptions) {
    if (!options.webhookUrl) throw new Bitrix24Error('Bitrix24CrmProvider requires a webhook URL')
    if (!/^https:\/\//i.test(options.webhookUrl)) {
      throw new Bitrix24Error('Bitrix24 webhook URL must use https; it embeds an access token')
    }

    this.webhookUrl = options.webhookUrl.replace(/\/+$/, '') + '/'
    this.limiter = new RateLimiter(options.rateLimitRps ?? 2)
    this.timeoutMs = options.requestTimeoutMs ?? 30_000
    this.maxRetries = options.maxRetries ?? 3
    this.fetchImpl = options.fetchImpl ?? fetch
    this.pipelines = options.pipelines ?? ALL_PIPELINES
    this.historyPipelines = options.historyPipelines ?? [6, 14, 10, 4]
    this.callHistoryMonths = options.callHistoryMonths ?? 1
    this.progress = options.onProgress ?? (() => {})
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async call<T>(method: string, params: Record<string, unknown>): Promise<Bitrix24Response<T>> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire()
      const controller = new AbortController()
      /**
       * A batch is fifty queries in one request, so it deserves fifty times
       * the patience. Holding it to the single-call timeout aborts work the
       * portal is still doing and then retries it, which is how a slow read
       * turns into a rate-limit block.
       */
      const timeout = method === 'batch' ? this.timeoutMs * 6 : this.timeoutMs
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await this.fetchImpl(`${this.webhookUrl}${method}.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal: controller.signal,
        })

        if (response.status === 429 || response.status >= 500) {
          throw new Bitrix24Error(`Bitrix24 responded ${response.status}`, response.status, true)
        }
        if (!response.ok) {
          throw new Bitrix24Error(`Bitrix24 responded ${response.status}`, response.status, false)
        }

        const payload = (await response.json()) as Bitrix24Response<T>
        if (payload.error) {
          throw new Bitrix24Error(
            `Bitrix24 error: ${payload.error}${payload.error_description ? ` (${payload.error_description})` : ''}`,
            response.status,
            // The portal throttles with this code rather than a 429.
            payload.error === 'QUERY_LIMIT_EXCEEDED',
          )
        }
        return payload
      } catch (error) {
        lastError = error
        const retryable = error instanceof Bitrix24Error ? error.retryable : true
        if (!retryable || attempt === this.maxRetries) break
        await sleep(backoffDelayMs(attempt))
      } finally {
        clearTimeout(timer)
      }
    }

    throw new Bitrix24Error(
      `Bitrix24 call "${method}" failed after ${this.maxRetries + 1} attempts: ${redact(lastError)}`,
    )
  }

  /**
   * Read every page of a small list method, sequentially.
   *
   * `unwrap` exists because the portal is not consistent about response shape.
   * `crm.*` list methods return a bare array; `crm.stagehistory.list` nests
   * under `result.items`; every `catalog.*` method nests under a key named
   * after the entity (`result.stores`, `result.products`). Spreading the
   * object as if it were an array throws, so the shape is stated per call
   * rather than assumed.
   */
  private async listAll<T>(
    method: string,
    params: Record<string, unknown>,
    label: string,
    unwrap: (value: unknown) => T[] = asArray,
  ): Promise<T[]> {
    const rows: T[] = []
    let start = 0

    for (let guard = 0; guard < 20_000; guard++) {
      const payload = await this.call<unknown>(method, { ...params, start })
      const batch = unwrap(payload.result)
      rows.push(...batch)

      if (rows.length > 0 && rows.length % 500 === 0) {
        this.progress(`  ${label}: ${rows.length}${payload.total ? `/${payload.total}` : ''}`)
      }
      if (payload.next === undefined) break
      start = payload.next
    }

    return rows
  }

  /**
   * Read up to 2 500 rows in ONE round trip, walking by id.
   *
   * WHY NOT OFFSETS
   * The obvious approach — fifty `start=` offsets packed into a batch — works
   * and is fast, right up until the portal cuts you off. Bitrix24 meters
   * "operating time" per method, and `start=400000` makes the database count
   * past four hundred thousand rows before returning fifty. Measured: the
   * contact import ran for twenty-five minutes and then every
   * `crm.contact.list` call in the account began answering
   * `OPERATION_TIME_LIMIT`, including cheap ones, for the next ten minutes.
   *
   * WHAT THIS DOES INSTEAD
   * Each command filters `>ID` and sets `start=-1`, which is an indexed seek
   * and skips the row count entirely. Commands are CHAINED inside the batch:
   * command N filters on the last id command N-1 returned, using Bitrix24's
   * `$result` reference. Fifty chained seeks cost about a second and no
   * measurable operating time.
   *
   * Measured against the old path: 2 500 deals in 0.4s instead of 6s, with no
   * block. It is also strictly ordered, so no row can be returned twice or
   * skipped — which offset paging could not guarantee once the underlying
   * table was being written to during the read.
   *
   * TERMINATION
   * A command returning fewer than 50 rows is the end of the data. Everything
   * after it in the same batch is discarded: its `$result` reference points at
   * a row that does not exist, the filter comes back empty, and the portal
   * would answer from the beginning of the table.
   */
  private async batchWalk<T>(
    method: string,
    params: Record<string, unknown>,
    afterId: string,
    options: {
      unwrap?: (value: unknown) => T[]
      /** Where the last row's id sits in a command's result. */
      refPath?: string
      /** `filter` for crm.*, `FILTER` for voximplant. */
      filterKey?: string
      /** Sort clause that makes the walk monotonic. */
      orderQuery?: string
      idOf?: (row: T) => string
    } = {},
  ): Promise<{ rows: T[]; done: boolean }> {
    const {
      unwrap = asArray as (value: unknown) => T[],
      refPath = '[49][ID]',
      filterKey = 'filter',
      orderQuery = 'order[ID]=ASC',
      idOf = (row: T) => String((row as { ID?: unknown }).ID ?? ''),
    } = options

    const base = encodeParams(params)
    const prefix = `${method}?${base ? `${base}&` : ''}${orderQuery}`

    const cmd: Record<string, string> = {
      // `>ID` needs no encoding: it contains no `=`, which is the character
      // that would otherwise split the key from the value.
      c0: `${prefix}&${filterKey}[>ID]=${encodeURIComponent(afterId)}&start=-1`,
    }
    for (let i = 1; i < BATCH_SIZE; i++) {
      cmd[`c${i}`] = `${prefix}&${filterKey}[>ID]=$result[c${i - 1}]${refPath}&start=-1`
    }

    const payload = await this.call<{ result?: Record<string, unknown>; result_error?: unknown }>(
      'batch',
      { halt: 0, cmd },
    )

    const errors = (payload.result?.result_error ?? {}) as Record<
      string,
      { error?: string } | undefined
    >
    const results = payload.result?.result as Record<string, unknown> | undefined

    const rows: T[] = []
    const seen = new Set<string>()

    for (let i = 0; i < BATCH_SIZE; i++) {
      const error = errors[`c${i}`]

      if (error) {
        /**
         * A chain that ran dry is not a failure.
         *
         * Every command references the 50th row of the one before it. Once a
         * command returns fewer than 50 rows — the end of the data — the next
         * reference resolves to nothing, the filter arrives empty, and the
         * portal answers INVALID_ARG_VALUE. That is the batch telling us it
         * reached the end, which is exactly what we asked it to find out.
         *
         * Anything else — a rate limit, a bad field, a blocked method — is a
         * real failure and must not be swallowed, because silently returning
         * a short page here would look identical to "no more data" and would
         * truncate the import without a word.
         */
        if (i > 0 && error.error === 'INVALID_ARG_VALUE') return { rows, done: true }

        throw new Bitrix24Error(
          `Bitrix24 batch of ${method} failed at command ${i}: ${JSON.stringify(error).slice(0, 200)}`,
        )
      }

      const batch = unwrap(results?.[`c${i}`])

      for (const row of batch) {
        // A wrapped page would repeat ids already collected. Cheap insurance
        // against the one failure mode that corrupts data silently.
        const id = idOf(row)
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        rows.push(row)
      }

      if (batch.length < LIST_PAGE) return { rows, done: true }
    }

    return { rows, done: false }
  }

  /**
   * Bitrix24's batch endpoint for many DIFFERENT commands.
   *
   * Product rows are per-deal, and 16 500 sequential calls at 2/second is over
   * two hours. Batched it is a few minutes — the difference between usable
   * product analytics and none.
   */
  private async batch<T>(commands: Record<string, string>, label = 'batch'): Promise<Record<string, T>> {
    const entries = Object.entries(commands)
    const results: Record<string, T> = {}

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = Object.fromEntries(entries.slice(i, i + BATCH_SIZE))
      const payload = await this.call<{ result?: Record<string, T> }>('batch', { halt: 0, cmd: chunk })
      Object.assign(results, payload.result?.result ?? {})
      if (i % (BATCH_SIZE * 20) === 0) this.progress(`  ${label}: ${i}/${entries.length}`)
    }

    return results
  }

  /** Everything is fetched in one pass; the sync engine gets a single page. */
  private page<T>(items: T[]): Page<T> {
    return { items }
  }

  // -------------------------------------------------------------------------
  // Portal capabilities
  // -------------------------------------------------------------------------

  /**
   * Ask the portal which scopes the webhook actually carries.
   *
   * Capabilities are derived from the answer rather than assumed, so granting
   * `catalog` later switches the warehouse and margin modules on with no code
   * change — and NOT granting it leaves them explicitly unavailable instead of
   * quietly empty.
   */
  async detectScopes(): Promise<ReadonlySet<string>> {
    if (this.grantedScopes) return this.grantedScopes

    try {
      const payload = await this.call<string[]>('scope', {})
      this.grantedScopes = new Set(payload.result ?? [])
    } catch {
      this.grantedScopes = new Set()
    }

    const hasCatalog = this.grantedScopes.has('catalog')
    this.capabilities = {
      ...this.capabilities,
      STORES: hasCatalog,
      STOCK: hasCatalog,
    }

    if (!hasCatalog) {
      this.progress('  catalog scope yoʻq — sklad va tannarx ulanmagan')
    }

    return this.grantedScopes
  }

  /**
   * Enumeration item ids → labels, from `crm.deal.fields`.
   *
   * The custom fields arrive as numeric item ids ("98"), not text. Resolving
   * them from the portal rather than a hardcoded table means an operator who
   * adds a region next month gets the right name without a redeploy.
   */
  private async loadEnumLabels(): Promise<Map<string, Map<string, string>>> {
    if (this.enumLabels) return this.enumLabels

    const payload = await this.call<Record<string, { items?: { ID: string; VALUE: string }[] }>>(
      'crm.deal.fields',
      {},
    )

    const map = new Map<string, Map<string, string>>()
    for (const field of UF_FIELDS) {
      const items = payload.result?.[field]?.items ?? []
      map.set(field, new Map(items.map((i) => [String(i.ID), i.VALUE])))
    }

    this.enumLabels = map
    return map
  }

  private label(field: string, value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') return undefined
    return this.enumLabels?.get(field)?.get(String(value)) ?? undefined
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const profile = await this.call<{ ID: string; NAME?: string }>('profile', {})
      const scopes = await this.detectScopes()
      const names = this.pipelines.map((p) => PIPELINE_NAMES[p] ?? p).join(', ')
      return {
        ok: true,
        detail: `Bitrix24 ulandi (user #${profile.result?.ID}). Voronkalar: ${names}. Ruxsatlar: ${[...scopes].join(', ')}.`,
      }
    } catch (error) {
      return { ok: false, detail: `Bitrix24 unreachable: ${redact(error)}` }
    }
  }

  // -------------------------------------------------------------------------
  // Organisation
  // -------------------------------------------------------------------------

  /**
   * The company tree.
   *
   * `UF_HEAD` names the employee who runs each department. It is carried
   * through as `headExternalId` and resolved to an internal id by the sync
   * handler, which runs after employees — a head cannot be linked while the
   * person is still unknown.
   */
  async fetchDepartments(_o?: FetchOptions): Promise<Page<RawDepartment>> {
    try {
      const rows = await this.listAll<{
        ID: string
        NAME: string
        SORT?: number
        PARENT?: string
        UF_HEAD?: string
      }>('department.get', {}, 'departments')

      return this.page(
        rows.map((d) => ({
          externalId: String(d.ID),
          name: d.NAME.trim(),
          parentExternalId: d.PARENT ? String(d.PARENT) : undefined,
          headExternalId: d.UF_HEAD ? String(d.UF_HEAD) : undefined,
          sortOrder: Number(d.SORT ?? 0),
          isActive: true,
        })),
      )
    } catch {
      this.progress('  departments: scope yoʻq, oʻtkazib yuborildi')
      return this.page([])
    }
  }

  async fetchEmployees(_o?: FetchOptions): Promise<Page<RawEmployee>> {
    const rows = await this.listAll<{
      ID: string
      NAME?: string
      LAST_NAME?: string
      SECOND_NAME?: string
      EMAIL?: string
      PERSONAL_MOBILE?: string
      WORK_PHONE?: string
      WORK_POSITION?: string
      ACTIVE?: boolean
      PERSONAL_PHOTO?: string
      DATE_REGISTER?: string
      UF_DEPARTMENT?: number[]
    }>('user.get', {}, 'employees')

    return this.page(
      rows.map((u) => ({
        externalId: String(u.ID),
        fullName:
          [u.LAST_NAME, u.NAME, u.SECOND_NAME].filter(Boolean).join(' ').trim() || `User ${u.ID}`,
        email: u.EMAIL || undefined,
        phone: u.PERSONAL_MOBILE || u.WORK_PHONE || undefined,
        position: u.WORK_POSITION || undefined,
        departmentExternalId: u.UF_DEPARTMENT?.[0] ? String(u.UF_DEPARTMENT[0]) : undefined,
        avatarUrl: u.PERSONAL_PHOTO || undefined,
        hiredAt: toDate(u.DATE_REGISTER),
        isActive: u.ACTIVE !== false,
      })),
    )
  }

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  async fetchProductCategories(_o?: FetchOptions): Promise<Page<RawProductCategory>> {
    return this.page([])
  }

  /**
   * Products, merged from two views of the same catalogue.
   *
   * `crm.product.list` returns the 57 items the CRM knows about and their sale
   * price. It is not the whole catalogue: deal product rows reference ids it
   * never returns, which is why 77% of line items had nothing to attach to
   * before the `catalog` scope existed.
   *
   * `catalog.product.list` covers both catalogue blocks — 57 products and 103
   * trade offers — and carries `purchasingPrice`, the entire basis of gross
   * margin. It requires `iblockId` in BOTH the filter and the select, so the
   * blocks are read from `catalog.catalog.list` rather than hardcoded.
   *
   * Purchase price is left undefined when the portal has none. Twenty-two of
   * the 57 products carry one and no offer does, so margin coverage is partial
   * and the margin module has to say so rather than quietly treating an
   * unpriced product as free.
   */
  async fetchProducts(_o?: FetchOptions): Promise<Page<RawProduct>> {
    const crmRows = await this.listAll<{
      ID: string
      NAME: string
      PRICE?: string
      CURRENCY_ID?: string
      ACTIVE?: string
      SECTION_ID?: string
      XML_ID?: string
    }>(
      'crm.product.list',
      { select: ['ID', 'NAME', 'PRICE', 'CURRENCY_ID', 'ACTIVE', 'SECTION_ID', 'XML_ID'] },
      'products',
    )

    const products = new Map<string, RawProduct>()

    for (const p of crmRows) {
      products.set(String(p.ID), {
        externalId: String(p.ID),
        name: p.NAME,
        sku: p.XML_ID || undefined,
        priceMinor: p.PRICE ? toMinorUnits(p.PRICE) : undefined,
        currency: p.CURRENCY_ID || 'UZS',
        isActive: p.ACTIVE !== 'N',
      })
    }

    for (const c of await this.fetchCatalogueProducts()) {
      const existing = products.get(c.externalId)
      products.set(c.externalId, existing ? { ...existing, costMinor: c.costMinor } : c)
    }

    const withCost = [...products.values()].filter((p) => p.costMinor !== undefined).length
    this.progress(`  mahsulotlar: ${products.size}, tannarxi bor: ${withCost}`)

    return this.page([...products.values()])
  }

  /** The trade catalogue, across every catalogue block. Empty without scope. */
  private async fetchCatalogueProducts(): Promise<RawProduct[]> {
    const scopes = await this.detectScopes()
    if (!scopes.has('catalog')) return []

    try {
      const catalogues = await this.listAll<{ iblockId: number }>(
        'catalog.catalog.list',
        {},
        'catalogues',
        nestedIn('catalogs'),
      )

      const rows: RawProduct[] = []

      for (const catalogue of catalogues) {
        const products = await this.listAll<{
          id: number
          iblockId: number
          name: string
          purchasingPrice?: string | number | null
          active?: string
        }>(
          'catalog.product.list',
          {
            // iblockId is mandatory in the select as well as the filter — the
            // portal rejects the call outright without it.
            select: ['id', 'iblockId', 'name', 'purchasingPrice', 'active'],
            filter: { iblockId: catalogue.iblockId },
            order: { id: 'ASC' },
          },
          `catalogue ${catalogue.iblockId}`,
          nestedIn('products'),
        )

        for (const p of products) {
          rows.push({
            externalId: String(p.id),
            name: p.name,
            // Null means the portal has no purchase price for this item. It
            // must stay undefined: a zero cost reports as 100% margin.
            costMinor:
              p.purchasingPrice === null || p.purchasingPrice === undefined
                ? undefined
                : toMinorUnits(p.purchasingPrice),
            currency: 'UZS',
            isActive: p.active !== 'N',
          })
        }
      }

      return rows
    } catch (error) {
      this.progress(`  katalog oʻqilmadi: ${redact(error)}`)
      return []
    }
  }

  // -------------------------------------------------------------------------
  // Pipelines and stages
  // -------------------------------------------------------------------------

  async fetchPipelines(_o?: FetchOptions): Promise<Page<RawPipeline>> {
    const rows = await this.listAll<{ ID: string; NAME: string; SORT?: number }>(
      'crm.dealcategory.list',
      { order: { SORT: 'ASC' } },
      'pipelines',
    )

    // The default pipeline (#0 Регистрация) is not returned by
    // crm.dealcategory.list — Bitrix24 treats it as "no category". It holds
    // 179 842 deals, so it is added explicitly rather than lost.
    const known = new Set(rows.map((r) => Number(r.ID)))
    const pipelines: RawPipeline[] = rows.map((r) => ({
      externalId: String(r.ID),
      name: r.NAME,
      role: pipelineRole(Number(r.ID)),
      sortOrder: Number(r.SORT ?? 0),
    }))

    if (!known.has(0)) {
      pipelines.unshift({
        externalId: '0',
        name: PIPELINE_NAMES[0] ?? 'Umumiy',
        role: pipelineRole(0),
        sortOrder: 0,
      })
    }

    this.progress(`  pipelines: ${pipelines.length}`)
    return this.page(pipelines)
  }

  /**
   * Stages, for every imported pipeline.
   *
   * Stage ids repeat across pipelines (`C6:WON`, `C14:WON`), so each stage
   * carries its pipeline. `crm.dealcategory.stage.list` returns SEMANTICS only
   * for the terminal stages on this portal, which is why `categoryFromSemantic`
   * falls back to the id suffix — without it "Доставлено" and "Отказ" both land
   * in IN_PROGRESS and the funnel shows nothing ever finishing.
   */
  async fetchStages(_o?: FetchOptions): Promise<Page<RawStage>> {
    const stages: RawStage[] = []

    for (const pipelineId of this.pipelines) {
      const payload = await this.call<
        { STATUS_ID: string; NAME: string; SORT?: string; SEMANTICS?: string }[]
      >('crm.dealcategory.stage.list', { id: pipelineId })

      const rows = payload.result ?? []
      rows.forEach((s, index) => {
        stages.push({
          externalId: s.STATUS_ID,
          name: `${PIPELINE_NAMES[pipelineId] ?? pipelineId} · ${DELIVERY_ROUTE_NAMES[s.STATUS_ID] ?? s.NAME}`,
          pipelineExternalId: String(pipelineId),
          category: categoryFromSemantic(s.SEMANTICS, index === 0, s.STATUS_ID),
          logisticsRole: logisticsRole(s.STATUS_ID),
          sortOrder: pipelineId * 1000 + Number(s.SORT ?? index),
          isActive: true,
        })
      })
    }

    this.progress(`  stages: ${stages.length}`)
    return this.page(stages)
  }

  async fetchSources(_o?: FetchOptions): Promise<Page<RawSalesSource>> {
    const rows = await this.listAll<{ STATUS_ID: string; NAME: string }>(
      'crm.status.list',
      { filter: { ENTITY_ID: 'SOURCE' } },
      'sources',
    )
    return this.page(rows.map((s) => ({ externalId: s.STATUS_ID, name: s.NAME, isActive: true })))
  }

  // -------------------------------------------------------------------------
  // Deals
  // -------------------------------------------------------------------------

  /**
   * Deals, 2 500 per page.
   *
   * The cursor is the row offset. `pageSize` from the sync engine is ignored on
   * purpose: the page size here is dictated by the portal's batch limit, and
   * honouring a smaller request would multiply the number of round trips by an
   * order of magnitude for no benefit.
   */
  async fetchDeals(options: FetchOptions = {}): Promise<Page<RawDeal>> {
    await this.loadEnumLabels()

    const afterId = options.cursor ?? '0'
    if (afterId === '0') this.revenueDealIds = []

    const filter: Record<string, unknown> = { CATEGORY_ID: [...this.pipelines] }
    if (options.updatedSince) {
      filter['>=DATE_MODIFY'] = isoLocal(options.updatedSince)
    }

    const { rows, done } = await this.batchWalk<Record<string, string>>(
      'crm.deal.list',
      { filter, select: DEAL_SELECT },
      afterId,
    )

    const deals: RawDeal[] = []

    for (const d of rows) {
      const id = String(d.ID)
      const categoryId = Number(d.CATEGORY_ID ?? 0)
      const role = pipelineRole(categoryId)
      const status = dealStatus(d.STAGE_SEMANTIC_ID, d.STAGE_ID)

      if (role === 'REVENUE') this.revenueDealIds.push(id)

      deals.push({
        externalId: id,
        title: d.TITLE || `Bitim ${id}`,
        amountMinor: toMinorUnits(d.OPPORTUNITY),
        currency: d.CURRENCY_ID || 'UZS',
        stageExternalId: d.STAGE_ID!,
        status,
        employeeExternalId: String(d.ASSIGNED_BY_ID ?? ''),
        customerExternalId: d.CONTACT_ID ? String(d.CONTACT_ID) : undefined,
        sourceExternalId: d.SOURCE_ID || undefined,
        pipelineExternalId: String(categoryId),
        orderCode: extractOrderCode(d.TITLE),
        // The single flag every revenue query filters on. Set from the
        // pipeline's role so a retention copy of a delivered order can never
        // reach a total, whatever else goes wrong downstream.
        countsAsRevenue: role === 'REVENUE',
        region: this.label(UF.REGION, d[UF.REGION]),
        fulfilmentPoint: this.label(UF.FULFILMENT_POINT, d[UF.FULFILMENT_POINT]),
        confirmStatus: confirmStatusFromLabel(this.label(UF.CONFIRM_STATUS, d[UF.CONFIRM_STATUS])),
        refusalReason: this.label(UF.REFUSAL_REASON, d[UF.REFUSAL_REASON]),
        paymentMethodRaw: this.label(UF.PAYMENT_METHOD, d[UF.PAYMENT_METHOD]),
        productLine: this.label(UF.PRODUCT_LINE, d[UF.PRODUCT_LINE]),
        customerGrade: this.label(UF.CUSTOMER_GRADE, d[UF.CUSTOMER_GRADE]),
        isReturnCustomer: d.IS_RETURN_CUSTOMER === 'Y',
        createdAtSource: toDate(d.DATE_CREATE) ?? new Date(),
        updatedAtSource: toDate(d.DATE_MODIFY),
        /**
         * Only trust CLOSEDATE when Bitrix24 says the deal is actually closed.
         *
         * A pre-dispatch cancellation has none — the portal still thinks the
         * deal is open — so it falls back to when the deal last moved, which
         * is when someone put it in that stage. Without a date it would be
         * absent from every period-scoped loss figure while still counting in
         * the totals, and the two would never reconcile.
         */
        closedAt:
          status === 'OPEN' ? undefined : (toDate(d.CLOSEDATE) ?? toDate(d.DATE_MODIFY)),
        metadata: {
          pipelineId: categoryId,
          pipelineName: PIPELINE_NAMES[categoryId] ?? null,
          pipelineRole: role,
          stageSemantic: d.STAGE_SEMANTIC_ID ?? null,
          /**
           * The contact this deal points at, kept as the SOURCE id.
           *
           * Deals are written before their contacts exist — the deal pass is
           * what discovers which contacts are worth fetching — so `customerId`
           * is null on the first write. Keeping the source id here lets the
           * customer pass close the link with one UPDATE instead of re-reading
           * 415 591 deals from the portal a second time.
           */
          contactId: d.CONTACT_ID ? String(d.CONTACT_ID) : null,
        },
      })
    }

    this.dealsRead += rows.length
    this.progress(`  deals: ${this.dealsRead}`)

    return {
      items: deals,
      nextCursor: done ? undefined : (rows[rows.length - 1]?.ID ?? undefined),
    }
  }

  /**
   * Contacts, paged straight through.
   *
   * An earlier version fetched only the contacts an imported deal referenced,
   * which made sense when two pipelines were in scope and 15 000 of the
   * portal's 317 674 contacts mattered. Now that every pipeline is imported,
   * nearly all of them do — and filtering by 250 000 ids means either 5 000
   * sequential calls or query strings tens of kilobytes long inside a batch.
   *
   * Reading the table in order costs 127 round trips and roughly fifteen
   * minutes, and it is simpler. The deal → customer links are closed
   * afterwards by the customer handler's `finalize`, from the contact id kept
   * on each deal.
   */
  async fetchCustomers(options: FetchOptions = {}): Promise<Page<RawCustomer>> {
    const afterId = options.cursor ?? '0'

    const filter: Record<string, unknown> = {}
    if (options.updatedSince) {
      filter['>=DATE_MODIFY'] = isoLocal(options.updatedSince)
    }

    const { rows, done } = await this.batchWalk<{
      ID: string
      NAME?: string
      LAST_NAME?: string
      SECOND_NAME?: string
      PHONE?: { VALUE: string }[]
      EMAIL?: { VALUE: string }[]
      ADDRESS_CITY?: string
      DATE_MODIFY?: string
    }>(
      'crm.contact.list',
      {
        filter,
        select: ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE', 'EMAIL', 'ADDRESS_CITY', 'DATE_MODIFY'],
      },
      afterId,
    )

    const customers: RawCustomer[] = rows.map((c) => ({
      externalId: String(c.ID),
      name:
        [c.LAST_NAME, c.NAME, c.SECOND_NAME].filter(Boolean).join(' ').trim() || `Kontakt ${c.ID}`,
      isCompany: false,
      phone: c.PHONE?.[0]?.VALUE,
      email: c.EMAIL?.[0]?.VALUE,
      region: c.ADDRESS_CITY || undefined,
      updatedAtSource: toDate(c.DATE_MODIFY),
    }))

    this.customersRead += rows.length
    this.progress(`  customers: ${this.customersRead}`)

    return {
      items: customers,
      nextCursor: done ? undefined : (rows[rows.length - 1]?.ID ?? undefined),
    }
  }

  /**
   * Line items — for REVENUE pipelines only.
   *
   * `crm.deal.productrows.get` takes one deal at a time. Reading line items for
   * all 415 591 deals would take days and tell us nothing: the lead and triage
   * funnels carry no products. The 16 500 deals that produce money do.
   */
  async fetchDealItems(_o?: FetchOptions): Promise<Page<RawDealItem>> {
    if (this.revenueDealIds.length === 0) return this.page([])

    const commands: Record<string, string> = {}
    for (const id of this.revenueDealIds) {
      commands[`d${id}`] = `crm.deal.productrows.get?id=${id}`
    }

    const results = await this.batch<
      {
        PRODUCT_ID: string
        PRODUCT_NAME?: string
        ORIGINAL_PRODUCT_NAME?: string
        QUANTITY: string
        PRICE: string
        DISCOUNT_SUM?: string
        DISCOUNT_RATE?: string
      }[]
    >(commands, 'product rows')

    const items: RawDealItem[] = []

    for (const [key, rows] of Object.entries(results)) {
      const dealId = key.slice(1)
      for (const [index, row] of (rows ?? []).entries()) {
        if (!row?.PRODUCT_ID) continue
        const unit = toMinorUnits(row.PRICE)
        const quantity = Math.max(1, Math.round(Number(row.QUANTITY ?? 1)))

        items.push({
          // Bitrix24 gives product rows no stable id, so one is composed from
          // the deal and the row position — stable across re-imports.
          externalId: `${dealId}-${index}`,
          dealExternalId: dealId,
          productExternalId: String(row.PRODUCT_ID),
          quantity,
          unitPriceMinor: unit,
          totalMinor: unit * BigInt(quantity),
          productName: row.PRODUCT_NAME || row.ORIGINAL_PRODUCT_NAME || undefined,
          /**
           * PER UNIT, times the quantity.
           *
           * Bitrix24 names this field DISCOUNT_SUM, which reads like a line
           * total. It is not. The portal's own arithmetic is
           * `PRICE + DISCOUNT_SUM = list price` — per unit — and the database
           * proves it: across a month, at every quantity above one, the
           * per-unit identity matches and the per-line one never does
           * (qty 2: 469 of 475 lines match per-unit, 0 per-line; qty 4: 171 of
           * 172 against 0).
           *
           * Stored per line, as the schema promises, so multiply here rather
           * than at every read. Left unmultiplied it understated the month's
           * discounts by 389 mln soʻm — a quarter of the total — and silently,
           * because a discount that is too small makes margin look better.
           */
          discountMinor: discountOf(row, unit, quantity),
          // A rate is scale-free, so this one needs no quantity. 100 means the
          // line was given away outright; those destroy margin silently unless
          // they are visible.
          discountRateBp: Math.round(Number(row.DISCOUNT_RATE ?? 0) * 100),
        })
      }
    }

    this.progress(`  deal items: ${items.length}`)
    return this.page(items)
  }

  /** Not available on this portal — verified. See mapping.ts. */
  async fetchPayments(_o?: FetchOptions): Promise<Page<RawPayment>> {
    return this.page([])
  }

  // -------------------------------------------------------------------------
  // Stage history
  // -------------------------------------------------------------------------

  /**
   * Stage transitions — the basis of every duration in the product.
   *
   * The portal holds 3.8 million of them and the endpoint returns 50 at a
   * time, so this is the longest step by far. Two things keep it tractable:
   * only the pipelines whose durations anyone measures are read, and the rows
   * come back 2 500 at a time through the batch endpoint.
   *
   * The response nests rows under `result.items`, unlike every other list
   * method — hence the unwrap.
   */
  async fetchStageHistory(options: FetchOptions = {}): Promise<Page<RawStageHistory>> {
    const afterId = options.cursor ?? '0'

    const filter: Record<string, unknown> = { CATEGORY_ID: [...this.historyPipelines] }
    if (options.updatedSince) {
      filter['>CREATED_TIME'] = isoLocal(options.updatedSince)
    }

    const { rows, done } = await this.batchWalk<{
      ID: number
      OWNER_ID: number
      STAGE_ID: string
      CREATED_TIME: string
      TYPE_ID: number
    }>(
      'crm.stagehistory.list',
      { entityTypeId: 2, filter },
      afterId,
      // Unlike every other list method, this one nests its rows under
      // `items`, so the chain reference has to reach through that key too.
      { unwrap: nestedIn('items'), refPath: '[items][49][ID]' },
    )

    const history: RawStageHistory[] = rows
      .filter((r) => r.OWNER_ID && r.STAGE_ID && r.CREATED_TIME)
      .map((r) => ({
        externalId: String(r.ID),
        dealExternalId: String(r.OWNER_ID),
        stageExternalId: r.STAGE_ID,
        enteredAt: toDate(r.CREATED_TIME) ?? new Date(),
      }))

    this.historyRead += rows.length
    this.progress(`  stage history: ${this.historyRead}`)

    return {
      items: history,
      nextCursor: done ? undefined : String(rows[rows.length - 1]?.ID ?? ''),
    }
  }

  // -------------------------------------------------------------------------
  // Telephony
  // -------------------------------------------------------------------------

  /**
   * Call records — who spoke to whom, for how long, and whether it connected.
   *
   * Read one DAY at a time, not by walking a single 283 000-row result.
   *
   * `voximplant.statistic.get` is metered: asking it for offset 20 000 of the
   * whole history earns `OPERATION_TIME_LIMIT` and the method is then blocked
   * for everyone, including the cheap calls. Measured, not guessed — the first
   * import hit it after eight batches. A day holds roughly eight hundred
   * calls, so every offset stays under a thousand and the method never gets
   * near its limit.
   *
   * Bounded to the last `callHistoryMonths` because the portal has been
   * running since 2025 and nobody asks how long a call lasted two years ago,
   * while the volume would dominate the import.
   *
   * `transcript` and `score` are not populated. The recordings are, so a call
   * quality scorer added later reads this table instead of facing a year-long
   * gap in the data.
   */
  async fetchCalls(options: FetchOptions = {}): Promise<Page<RawCall>> {
    const from = startOfUtcDay(
      options.updatedSince ?? new Date(Date.now() - this.callHistoryMonths * 30 * DAY_MS),
    )
    const days = Math.max(1, Math.ceil((Date.now() - from.getTime()) / DAY_MS))

    const [dayText, afterText] = (options.cursor ?? '0:0').split(':')
    const startDay = Number(dayText)

    // Skip empty days rather than returning an empty page for each, which the
    // sync engine would read as the end of the data.
    for (let day = startDay; day < days; day++) {
      const dayStart = new Date(from.getTime() + day * DAY_MS)
      const windowEnd = new Date(dayStart.getTime() + DAY_MS)

      /**
       * On an incremental run, start at the watermark instant — not at
       * midnight of the day it falls in.
       *
       * Day windows exist to keep offsets shallow, not to define the query.
       * Flooring to midnight made every minute-by-minute sync re-read the
       * whole day: 10 000 rows and forty seconds to find the handful of calls
       * that were actually new.
       */
      const windowStart =
        options.updatedSince && day === startDay && options.updatedSince > dayStart
          ? options.updatedSince
          : dayStart

      const afterId = day === startDay ? (afterText ?? '0') : '0'

      const { rows, done } = await this.batchWalk<{
        ID: string
        PORTAL_USER_ID?: string
        PHONE_NUMBER?: string
        CALL_TYPE?: string
        CALL_CATEGORY?: string
        CALL_DURATION?: string
        CALL_START_DATE?: string
        CALL_RECORD_URL?: string
        CALL_FAILED_CODE?: string
        CRM_ENTITY_TYPE?: string
        CRM_ENTITY_ID?: string
      }>(
        'voximplant.statistic.get',
        {
          FILTER: {
            '>=CALL_START_DATE': isoLocal(windowStart),
            '<CALL_START_DATE': isoLocal(windowEnd),
          },
        },
        afterId,
        // Telephony names its parameters in upper case and sorts through SORT
        // rather than an order map, so the walk's clauses differ here.
        { filterKey: 'FILTER', orderQuery: 'SORT=ID&ORDER=ASC' },
      )

      if (rows.length === 0) continue

      const calls: RawCall[] = rows
        .filter((r) => r.ID && r.CALL_START_DATE)
        .map((r) => ({
          externalId: String(r.ID),
          employeeExternalId: nonEmpty(r.PORTAL_USER_ID),
          customerExternalId:
            r.CRM_ENTITY_TYPE === 'CONTACT' ? nonEmpty(r.CRM_ENTITY_ID) : undefined,
          dealExternalId: r.CRM_ENTITY_TYPE === 'DEAL' ? nonEmpty(r.CRM_ENTITY_ID) : undefined,
          direction: callDirection(r.CALL_CATEGORY, r.CALL_TYPE),
          phoneNumber: r.PHONE_NUMBER || undefined,
          startedAt: toDate(r.CALL_START_DATE) ?? dayStart,
          durationSec: Number(r.CALL_DURATION ?? 0),
          // 200 is the portal's success code; anything else is a failed leg,
          // and the reason is kept so "nobody answered" reads differently
          // from "the number was wrong".
          connected: r.CALL_FAILED_CODE === '200',
          failedCode:
            r.CALL_FAILED_CODE && r.CALL_FAILED_CODE !== '200' ? r.CALL_FAILED_CODE : undefined,
          recordUrl: r.CALL_RECORD_URL || undefined,
        }))

      this.callsRead += rows.length
      this.progress(
        `  calls: ${this.callsRead} (${dayStart.toISOString().slice(0, 10)}, kun ${day + 1}/${days})`,
      )

      const lastId = rows[rows.length - 1]?.ID
      const nextCursor = !done && lastId ? `${day}:${lastId}` : day + 1 < days ? `${day + 1}:0` : undefined

      return { items: calls, nextCursor }
    }

    return this.page([])
  }

  // -------------------------------------------------------------------------
  // Warehouse
  // -------------------------------------------------------------------------

  async fetchStores(_o?: FetchOptions): Promise<Page<RawStore>> {
    const scopes = await this.detectScopes()
    if (!scopes.has('catalog')) return this.page([])

    const rows = await this.listAll<{
      id: string
      title: string
      address?: string
      active?: string
    }>(
      'catalog.store.list',
      { select: ['id', 'title', 'address', 'active'], order: { id: 'ASC' } },
      'stores',
      nestedIn('stores'),
    )

    return this.page(
      rows.map((s) => ({
        externalId: String(s.id),
        name: s.title,
        address: s.address || undefined,
        isActive: s.active !== 'N',
      })),
    )
  }

  async fetchStockLevels(_o?: FetchOptions): Promise<Page<RawStockLevel>> {
    const scopes = await this.detectScopes()
    if (!scopes.has('catalog')) return this.page([])

    /**
     * The portal defines four stores but keeps no balances in them:
     * `catalog.storeproduct.list` returns zero rows and
     * `catalog.document.list` zero documents. Inventory is simply not run in
     * Bitrix24 here.
     *
     * So this reads what is there and imports whatever it finds — today,
     * nothing. The warehouse module reports dispatch by fulfilment point,
     * which the portal DOES record on every deal, and says plainly that
     * on-hand balances are not maintained rather than drawing an empty shelf.
     */
    const rows = await this.listAll<{
      storeId: string
      productId: string
      amount?: string
      quantityReserved?: string
    }>(
      'catalog.storeproduct.list',
      { select: ['storeId', 'productId', 'amount', 'quantityReserved'] },
      'stock',
      nestedIn('storeProducts'),
    )

    return this.page(
      rows.map((r) => ({
        storeExternalId: String(r.storeId),
        productExternalId: String(r.productId),
        quantity: String(r.amount ?? '0'),
        reserved: String(r.quantityReserved ?? '0'),
      })),
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight UTC of the day a date falls in. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS)
}

/**
 * A source id, or nothing.
 *
 * The empty string is the trap this closes. `('' && map.get(''))` evaluates to
 * `''`, not `undefined`, so `?? null` leaves an empty string in a foreign key
 * column and Postgres rejects the whole multi-row insert. Normalising blank to
 * undefined at the provider boundary means no downstream writer has to know.
 */
export function nonEmpty(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

/** A list method that returns a bare array. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * A list method that nests its rows under a named key.
 *
 * `crm.stagehistory.list` uses `items`; every `catalog.*` method uses a key
 * named after the entity. Falls back to a bare array so one helper covers both
 * conventions.
 */
export function nestedIn<T>(key: string): (value: unknown) => T[] {
  return (value) => {
    if (Array.isArray(value)) return value as T[]
    const inner = (value as Record<string, unknown> | undefined)?.[key]
    return Array.isArray(inner) ? (inner as T[]) : []
  }
}

/**
 * Serialise nested params the way Bitrix24's query strings expect.
 *
 * `{ filter: { CATEGORY_ID: [6, 14] } }` becomes
 * `filter[CATEGORY_ID][0]=6&filter[CATEGORY_ID][1]=14`. Needed because batch
 * commands are query strings, not JSON bodies.
 *
 * KEYS ARE ENCODED, NOT JUST VALUES.
 * Bitrix24 puts the comparison operator inside the key: a range filter is
 * `FILTER[>=CALL_START_DATE]`. Left raw, the `>` and `<` do not survive the
 * query string, and the portal does not complain — it silently drops the
 * filter and answers with the whole table.
 *
 * That failure is invisible at a glance and expensive: a day-windowed read of
 * telephony came back with calls from the previous year, every window
 * returning the same ancient rows, so 20 750 fetched rows held 12 800 distinct
 * ones. The same bug would have made every incremental sync a full one, since
 * `>=DATE_MODIFY` and `>CREATED_TIME` are built the same way.
 *
 * Brackets stay literal — the portal's parser needs them — and everything
 * between them is percent-encoded.
 */
export function encodeParams(params: Record<string, unknown>): string {
  const parts: string[] = []

  const walk = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) return

    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v))
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(`${prefix}[${encodeURIComponent(k)}]`, v)
      }
      return
    }
    parts.push(`${prefix}=${encodeURIComponent(String(value))}`)
  }

  for (const [key, value] of Object.entries(params)) walk(encodeURIComponent(key), value)
  return parts.join('&')
}

/**
 * Bitrix24 filters compare against portal-local time, not UTC.
 *
 * An ISO string ending in `Z` is accepted but interpreted in the portal's
 * timezone, which would silently shift every incremental watermark by the
 * offset. Formatting with the offset spelled out removes the ambiguity.
 */
export function isoLocal(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '+00:00')
}

/**
 * Strip anything token-shaped from an error before it is logged.
 *
 * The webhook URL carries the access token in its path, so any error carrying
 * a URL is a credential leak waiting to happen.
 */
export function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https:\/\/[^\s/]+\/rest\/\d+\/[^\s/]+/gi, 'https://<portal>/rest/<redacted>')
    .replace(/\b[a-z0-9]{20,}\b/gi, '<redacted>')
}

/**
 * A line's discount, per line, with the impossible rows rejected.
 *
 * QUANTITY: Bitrix24's DISCOUNT_SUM is per UNIT despite the name — the
 * portal's own arithmetic is `PRICE + DISCOUNT_SUM = list price`, and the
 * database confirms it at every quantity above one.
 *
 * THE REJECTED ROWS: 33 lines carry `DISCOUNT_SUM = -PRICE` with
 * `DISCOUNT_RATE = 0`. Read literally that says the catalogue price was
 * exactly zero and the customer was charged a markup of the entire sale — a
 * rate of zero and an amount of everything cannot both be true. They are a
 * parse artefact worth 22.6 mln soʻm of phantom markup, and reporting them as
 * "sold above list" would be inventing a fact. Zero is the honest value: no
 * discount is recorded for these lines, because none was.
 */
function discountOf(
  row: { DISCOUNT_SUM?: string; DISCOUNT_RATE?: string },
  unitPriceMinor: bigint,
  quantity: number,
): bigint {
  const perUnit = toMinorUnits(row.DISCOUNT_SUM)
  const rateBp = Math.round(Number(row.DISCOUNT_RATE ?? 0) * 100)

  if (rateBp === 0 && perUnit === -unitPriceMinor && perUnit !== 0n) return 0n

  return perUnit * BigInt(quantity)
}

