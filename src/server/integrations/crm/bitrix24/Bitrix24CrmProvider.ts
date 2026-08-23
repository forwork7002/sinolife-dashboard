/**
 * Bitrix24 CRM provider — BITRIX24_INTEGRATION_PENDING
 *
 * The transport is real and finished: authentication via the inbound webhook,
 * rate limiting, retry with jittered backoff, timeouts, cursor pagination and
 * error redaction all work today. What is deliberately absent is the FIELD
 * MAPPING, because that cannot be written without seeing the live portal.
 *
 * The provider therefore refuses to run rather than importing guessed data.
 * That refusal is the feature: a wrong mapping would import silently and give
 * the business a dashboard that looks authoritative and is wrong.
 *
 * TO FINISH THIS INTEGRATION
 *   1. Put the inbound webhook URL in BITRIX24_WEBHOOK_URL.
 *   2. Fill in `mapping.ts` from the real portal, marking each field confirmed.
 *   3. Populate BITRIX24_STAGE_CATEGORIES with the portal's stage IDs.
 *   4. Implement the `map*` methods below (the transport is already done).
 *   5. Set DATA_SOURCE=bitrix24.
 *
 * See docs/BITRIX24.md for the open questions that need business answers.
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
import type { ExternalSourceValue, SyncEntityValue } from '@/server/domain/types'

import { assertMappingComplete, findMappingGaps } from './mapping'
import { RateLimiter, backoffDelayMs, sleep } from './rateLimiter'

export interface Bitrix24ProviderOptions {
  /** Inbound webhook URL. Embeds an access token — treat as a secret. */
  readonly webhookUrl: string
  readonly rateLimitRps?: number
  readonly requestTimeoutMs?: number
  readonly maxRetries?: number
  readonly fetchImpl?: typeof fetch
}

/** Bitrix24 REST envelope. Only the fields we actually rely on. */
interface Bitrix24Response<T> {
  readonly result?: T
  readonly next?: number
  readonly total?: number
  readonly error?: string
  readonly error_description?: string
}

export class Bitrix24Error extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'Bitrix24Error'
  }
}

export class Bitrix24CrmProvider implements CrmProvider {
  readonly source: ExternalSourceValue = 'BITRIX24'

  /**
   * Payments are false on purpose. Standard Bitrix24 has no first-class
   * payment ledger on deals, and how (or whether) this business records them
   * is an open question. Reporting the capability as false makes the API say
   * "not connected" instead of "0 so'm outstanding", which would be a lie.
   */
  readonly capabilities: ProviderCapabilities = Object.freeze({
    DEPARTMENTS: true,
    EMPLOYEES: true,
    PRODUCT_CATEGORIES: true,
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

  constructor(options: Bitrix24ProviderOptions) {
    if (!options.webhookUrl) {
      throw new Bitrix24Error('Bitrix24CrmProvider requires a webhook URL')
    }
    if (!/^https:\/\//i.test(options.webhookUrl)) {
      throw new Bitrix24Error(
        'Bitrix24 webhook URL must use https; it embeds an access token',
      )
    }

    // Normalise to a single trailing slash so method concatenation is safe.
    this.webhookUrl = options.webhookUrl.replace(/\/+$/, '') + '/'
    this.limiter = new RateLimiter(options.rateLimitRps ?? 2)
    this.timeoutMs = options.requestTimeoutMs ?? 15_000
    this.maxRetries = options.maxRetries ?? 3
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<ProviderHealth> {
    const gaps = findMappingGaps()

    try {
      // `profile` is the cheapest authenticated call Bitrix24 offers.
      await this.call<unknown>('profile', {})
    } catch (error) {
      return {
        ok: false,
        detail: `Bitrix24 unreachable or unauthorised: ${redact(error)}`,
      }
    }

    if (gaps.length > 0) {
      return {
        ok: false,
        detail:
          `Bitrix24 reachable, but the field mapping is incomplete for ` +
          `${gaps.length} entities (${gaps.map((g) => g.entity).join(', ')}). ` +
          'BITRIX24_INTEGRATION_PENDING.',
      }
    }

    return { ok: true, detail: 'Bitrix24 reachable and mapping confirmed.' }
  }

  // -------------------------------------------------------------------------
  // Transport — finished and usable
  // -------------------------------------------------------------------------

  /**
   * Invoke one REST method, honouring the rate limit and retrying transient
   * failures. Never throws a raw fetch error: messages are redacted first so
   * the webhook token cannot reach a log or an API response.
   */
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

        // 429 and 5xx are worth retrying; 4xx generally is not.
        if (response.status === 429 || response.status >= 500) {
          throw new Bitrix24Error(
            `Bitrix24 responded ${response.status}`,
            response.status,
            true,
          )
        }

        if (!response.ok) {
          throw new Bitrix24Error(
            `Bitrix24 responded ${response.status}`,
            response.status,
            false,
          )
        }

        const payload = (await response.json()) as Bitrix24Response<T>

        if (payload.error) {
          throw new Bitrix24Error(
            `Bitrix24 error: ${payload.error}${
              payload.error_description ? ` (${payload.error_description})` : ''
            }`,
            response.status,
            false,
          )
        }

        return payload
      } catch (error) {
        lastError = error

        const retryable =
          error instanceof Bitrix24Error
            ? error.retryable
            : // Aborts and network faults are transient by nature.
              true

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
   * Fetch one page using Bitrix24's `start` offset pagination.
   * Exposed to the map* methods below; not used until mapping is confirmed.
   */
  protected async fetchPage<T>(
    method: string,
    params: Record<string, unknown>,
    options: FetchOptions = {},
  ): Promise<{ items: readonly T[]; nextCursor?: string }> {
    const start = options.cursor ? Number.parseInt(options.cursor, 10) : 0

    if (!Number.isInteger(start) || start < 0) {
      throw new Bitrix24Error(`Malformed cursor: ${options.cursor}`)
    }

    const payload = await this.call<T[]>(method, { ...params, start })
    const items = payload.result ?? []

    return payload.next !== undefined
      ? { items, nextCursor: String(payload.next) }
      : { items }
  }

  // -------------------------------------------------------------------------
  // Mapping — intentionally unimplemented
  // -------------------------------------------------------------------------

  private notMapped(entity: SyncEntityValue): never {
    // Surfaces the precise list of unconfirmed fields rather than a bare
    // "not implemented", so finishing the integration is a checklist.
    assertMappingComplete()
    throw new Bitrix24Error(`BITRIX24_INTEGRATION_PENDING: ${entity} mapping not implemented`)
  }

  async fetchDepartments(_o?: FetchOptions): Promise<Page<RawDepartment>> { this.notMapped('DEPARTMENTS') }
  async fetchEmployees(_o?: FetchOptions): Promise<Page<RawEmployee>> { this.notMapped('EMPLOYEES') }
  async fetchProductCategories(_o?: FetchOptions): Promise<Page<RawProductCategory>> { this.notMapped('PRODUCT_CATEGORIES') }
  async fetchProducts(_o?: FetchOptions): Promise<Page<RawProduct>> { this.notMapped('PRODUCTS') }
  async fetchStages(_o?: FetchOptions): Promise<Page<RawStage>> { this.notMapped('STAGES') }
  async fetchSources(_o?: FetchOptions): Promise<Page<RawSalesSource>> { this.notMapped('SOURCES') }
  async fetchCustomers(_o?: FetchOptions): Promise<Page<RawCustomer>> { this.notMapped('CUSTOMERS') }
  async fetchDeals(_o?: FetchOptions): Promise<Page<RawDeal>> { this.notMapped('DEALS') }
  async fetchDealItems(_o?: FetchOptions): Promise<Page<RawDealItem>> { this.notMapped('DEAL_ITEMS') }
  async fetchPayments(_o?: FetchOptions): Promise<Page<RawPayment>> { this.notMapped('PAYMENTS') }
}

/**
 * Strip anything token-shaped from an error before it is logged.
 *
 * The webhook URL contains the access token in its path, so any error carrying
 * a URL is a credential leak waiting to happen.
 */
export function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https:\/\/[^\s/]+\/rest\/\d+\/[^\s/]+/gi, 'https://<portal>/rest/<redacted>')
    .replace(/\b[a-z0-9]{20,}\b/gi, '<redacted>')
}
