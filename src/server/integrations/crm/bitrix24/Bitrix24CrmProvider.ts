/**
 * Bitrix24 CRM provider.
 *
 * Implements the same `CrmProvider` interface as the demo provider, so nothing
 * downstream — sync engine, database, analytics, API, dashboard — changes when
 * this becomes the active source.
 *
 * The field mapping in `mapping.ts` was read from the live portal, not guessed.
 */

import {
  type CrmProvider,
  type FetchOptions,
  type Page,
  type ProviderCapabilities,
  type ProviderHealth,
  type RawCustomer,
  type RawDeal,
  type RawDealItem,
  type RawDepartment,
  type RawEmployee,
  type RawPayment,
  type RawProduct,
  type RawProductCategory,
  type RawSalesSource,
  type RawStage,
} from '@/server/integrations/crm/CrmProvider'
import type { ExternalSourceValue } from '@/server/domain/types'

import {
  PIPELINE_NAMES,
  REVENUE_PIPELINES,
  categoryFromSemantic,
  extractOrderCode,
  statusFromSemantic,
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
  /** Override which pipelines count as revenue. Defaults to Доставка + Ecommerce. */
  readonly pipelines?: readonly number[]
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

const PAGE = 50

export class Bitrix24CrmProvider implements CrmProvider {
  readonly source: ExternalSourceValue = 'BITRIX24'

  /**
   * Payments are false because the portal has none — verified, not assumed.
   * The API then reports finance as unavailable rather than as zero.
   */
  readonly capabilities: ProviderCapabilities = Object.freeze({
    DEPARTMENTS: true,
    EMPLOYEES: true,
    PRODUCT_CATEGORIES: false,
    PRODUCTS: true,
    STAGES: true,
    SOURCES: true,
    CUSTOMERS: true,
    DEALS: true,
    DEAL_ITEMS: true,
    PAYMENTS: false,
  })

  private readonly webhookUrl: string
  private readonly limiter: RateLimiter
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch
  private readonly pipelines: readonly number[]
  private readonly progress: (m: string) => void

  /**
   * Contacts and deal ids discovered while reading deals.
   *
   * The portal holds 314 610 contacts but only ~15 000 belong to imported
   * deals. Fetching all of them would take hours and fill the database with
   * people who never bought anything, so customers are looked up by id.
   */
  private referencedContactIds = new Set<string>()
  private importedDealIds: string[] = []

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
    this.pipelines = options.pipelines ?? REVENUE_PIPELINES
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
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)

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
            false,
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

  /** Read every page of a list method. */
  private async listAll<T>(
    method: string,
    params: Record<string, unknown>,
    label: string,
  ): Promise<T[]> {
    const rows: T[] = []
    let start = 0

    for (let guard = 0; guard < 20_000; guard++) {
      const payload = await this.call<T[]>(method, { ...params, start })
      const batch = payload.result ?? []
      rows.push(...batch)

      if (rows.length % 500 === 0 && rows.length > 0) {
        this.progress(`  ${label}: ${rows.length}${payload.total ? `/${payload.total}` : ''}`)
      }
      if (payload.next === undefined) break
      start = payload.next
    }

    return rows
  }

  /**
   * Bitrix24's batch endpoint: up to 50 commands per request.
   *
   * Product rows are per-deal, and 16 500 sequential calls at 2/second is over
   * two hours. Batched it is a few minutes — the difference between usable
   * product analytics and none.
   */
  private async batch<T>(commands: Record<string, string>): Promise<Record<string, T>> {
    const entries = Object.entries(commands)
    const results: Record<string, T> = {}

    for (let i = 0; i < entries.length; i += PAGE) {
      const chunk = Object.fromEntries(entries.slice(i, i + PAGE))
      const payload = await this.call<{ result?: Record<string, T> }>('batch', {
        halt: 0,
        cmd: chunk,
      })
      Object.assign(results, payload.result?.result ?? {})
      if (i % 500 === 0) this.progress(`  batch: ${i}/${entries.length}`)
    }

    return results
  }

  /** Everything is fetched in one pass; the sync engine gets a single page. */
  private page<T>(items: T[]): Page<T> {
    return { items }
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const profile = await this.call<{ ID: string; NAME?: string }>('profile', {})
      const names = this.pipelines.map((p) => PIPELINE_NAMES[p] ?? p).join(', ')
      return {
        ok: true,
        detail: `Bitrix24 ulandi (user #${profile.result?.ID}). Voronkalar: ${names}.`,
      }
    } catch (error) {
      return { ok: false, detail: `Bitrix24 unreachable: ${redact(error)}` }
    }
  }

  // -------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------

  async fetchDepartments(_o?: FetchOptions): Promise<Page<RawDepartment>> {
    try {
      const rows = await this.listAll<{ ID: string; NAME: string }>('department.get', {}, 'departments')
      return this.page(
        rows.map((d) => ({ externalId: String(d.ID), name: d.NAME, isActive: true })),
      )
    } catch {
      // The `department` scope may be absent from the webhook. Departments are
      // a filter convenience, not a dependency — everything else still works.
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
      WORK_POSITION?: string
      ACTIVE?: boolean
      PERSONAL_PHOTO?: string
      UF_DEPARTMENT?: number[]
    }>('user.get', {}, 'employees')

    return this.page(
      rows.map((u) => ({
        externalId: String(u.ID),
        fullName: [u.LAST_NAME, u.NAME, u.SECOND_NAME].filter(Boolean).join(' ').trim() || `User ${u.ID}`,
        email: u.EMAIL || undefined,
        position: u.WORK_POSITION || undefined,
        departmentExternalId: u.UF_DEPARTMENT?.[0] ? String(u.UF_DEPARTMENT[0]) : undefined,
        avatarUrl: u.PERSONAL_PHOTO || undefined,
        isActive: u.ACTIVE !== false,
      })),
    )
  }

  async fetchProductCategories(_o?: FetchOptions): Promise<Page<RawProductCategory>> {
    return this.page([])
  }

  async fetchProducts(_o?: FetchOptions): Promise<Page<RawProduct>> {
    const rows = await this.listAll<{
      ID: string
      NAME: string
      PRICE?: string
      CURRENCY_ID?: string
      ACTIVE?: string
    }>('crm.product.list', { select: ['ID', 'NAME', 'PRICE', 'CURRENCY_ID', 'ACTIVE'] }, 'products')

    return this.page(
      rows.map((p) => ({
        externalId: String(p.ID),
        name: p.NAME,
        priceMinor: p.PRICE ? toMinorUnits(p.PRICE) : undefined,
        currency: p.CURRENCY_ID || 'UZS',
        isActive: p.ACTIVE !== 'N',
      })),
    )
  }

  /**
   * Stages, per revenue pipeline.
   *
   * `crm.dealcategory.stage.list` returns each stage's SEMANTICS, which is the
   * authoritative won/lost classification. Stage ids repeat across pipelines
   * (`C6:WON`, `C14:WON`), so they are already namespaced by Bitrix24.
   */
  async fetchStages(_o?: FetchOptions): Promise<Page<RawStage>> {
    const stages: RawStage[] = []

    for (const pipelineId of this.pipelines) {
      const payload = await this.call<{ STATUS_ID: string; NAME: string; SORT: string; SEMANTICS?: string }[]>(
        'crm.dealcategory.stage.list',
        { id: pipelineId },
      )

      const rows = payload.result ?? []
      rows.forEach((s, index) => {
        stages.push({
          externalId: s.STATUS_ID,
          name: `${PIPELINE_NAMES[pipelineId] ?? pipelineId} · ${s.NAME}`,
          category: categoryFromSemantic(s.SEMANTICS, index === 0, s.STATUS_ID),
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
    return this.page(
      rows.map((s) => ({ externalId: s.STATUS_ID, name: s.NAME, isActive: true })),
    )
  }

  /**
   * Only the contacts referenced by imported deals.
   *
   * Requires deals to have been read first, so the sync order must place
   * CUSTOMERS after DEALS — see the import script, which overrides the default
   * order for exactly this reason.
   */
  async fetchCustomers(_o?: FetchOptions): Promise<Page<RawCustomer>> {
    const ids = [...this.referencedContactIds]
    if (ids.length === 0) return this.page([])

    this.progress(`  customers: ${ids.length} ta havola qilingan kontakt`)
    const customers: RawCustomer[] = []

    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const rows = await this.listAll<{
        ID: string
        NAME?: string
        LAST_NAME?: string
        PHONE?: { VALUE: string }[]
        EMAIL?: { VALUE: string }[]
        ADDRESS_CITY?: string
      }>(
        'crm.contact.list',
        {
          filter: { ID: chunk },
          select: ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'EMAIL', 'ADDRESS_CITY'],
        },
        'customers',
      )

      for (const c of rows) {
        customers.push({
          externalId: String(c.ID),
          name: [c.LAST_NAME, c.NAME].filter(Boolean).join(' ').trim() || `Kontakt ${c.ID}`,
          isCompany: false,
          phone: c.PHONE?.[0]?.VALUE,
          email: c.EMAIL?.[0]?.VALUE,
          region: c.ADDRESS_CITY || undefined,
        })
      }
    }

    return this.page(customers)
  }

  async fetchDeals(_o?: FetchOptions): Promise<Page<RawDeal>> {
    const rows = await this.listAll<Record<string, string>>(
      'crm.deal.list',
      {
        filter: { CATEGORY_ID: [...this.pipelines] },
        select: [
          'ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
          'OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID', 'CONTACT_ID',
          'SOURCE_ID', 'DATE_CREATE', 'DATE_MODIFY', 'CLOSEDATE', 'CLOSED',
        ],
        order: { ID: 'ASC' },
      },
      'deals',
    )

    this.referencedContactIds = new Set()
    this.importedDealIds = []

    const deals: RawDeal[] = []

    for (const d of rows) {
      const id = String(d.ID)
      this.importedDealIds.push(id)
      if (d.CONTACT_ID) this.referencedContactIds.add(String(d.CONTACT_ID))

      const status = statusFromSemantic(d.STAGE_SEMANTIC_ID)

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
        createdAtSource: toDate(d.DATE_CREATE) ?? new Date(),
        updatedAtSource: toDate(d.DATE_MODIFY),
        // Only trust CLOSEDATE when Bitrix24 says the deal is actually closed.
        closedAt: status === 'OPEN' ? undefined : toDate(d.CLOSEDATE),
        metadata: {
          pipelineId: Number(d.CATEGORY_ID ?? 0),
          pipelineName: PIPELINE_NAMES[Number(d.CATEGORY_ID ?? 0)] ?? null,
          orderCode: extractOrderCode(d.TITLE) ?? null,
          stageSemantic: d.STAGE_SEMANTIC_ID ?? null,
        },
      })
    }

    this.progress(`  deals: ${deals.length} ta yuklandi`)
    return this.page(deals)
  }

  /** Line items for the imported deals, via the batch endpoint. */
  async fetchDealItems(_o?: FetchOptions): Promise<Page<RawDealItem>> {
    if (this.importedDealIds.length === 0) return this.page([])

    const commands: Record<string, string> = {}
    for (const id of this.importedDealIds) {
      commands[`d${id}`] = `crm.deal.productrows.get?id=${id}`
    }

    const results = await this.batch<{
      PRODUCT_ID: string
      QUANTITY: string
      PRICE: string
    }[]>(commands)

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
