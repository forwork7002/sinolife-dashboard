/**
 * The CRM boundary.
 *
 * Everything upstream of this interface is provider-specific. Everything
 * downstream — the sync engine, the database, the analytics, the API, the
 * dashboard — is provider-agnostic and must stay that way.
 *
 * THE RULE
 * A provider returns NORMALISED records, never raw payloads. Nothing outside
 * `integrations/crm/<provider>/` may learn a Bitrix24 field name, a Bitrix24
 * stage ID, or the shape of a Bitrix24 response. When the real credentials
 * arrive, the work is confined to one directory and one mapping file.
 *
 * Records are keyed by `externalId` and related to each other by
 * `*ExternalId`, not by our internal cuids — the provider has never heard of
 * those. The sync engine resolves external references to internal foreign keys
 * as it writes.
 */

import type {
  DealStatusValue,
  ExternalSourceValue,
  PaymentMethodValue,
  StageCategoryValue,
  SyncEntityValue,
} from '@/server/domain/types'

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * An opaque provider-defined position. Bitrix24 paginates with a numeric
 * `start` offset; the demo provider uses an index. Callers must treat it as
 * a token and never parse it.
 */
export type Cursor = string

export interface Page<T> {
  readonly items: readonly T[]
  /** Present only when more records remain. */
  readonly nextCursor?: Cursor
}

export interface FetchOptions {
  readonly cursor?: Cursor
  /**
   * Incremental sync watermark. When set, the provider returns only records
   * whose SOURCE-side updated-at is at or after this instant. Providers that
   * cannot filter server-side must still honour it by filtering client-side,
   * so the sync engine's contract holds regardless.
   */
  readonly updatedSince?: Date
  /** Upper bound on records per page. Providers may return fewer, never more. */
  readonly pageSize?: number
}

// ---------------------------------------------------------------------------
// Normalised records
// ---------------------------------------------------------------------------

interface ExternalRecord {
  /** Stable identifier in the source system. The sync engine upserts on this. */
  readonly externalId: string
  /** Source-side last-modified time, when the provider exposes one. */
  readonly updatedAtSource?: Date
}

export interface RawDepartment extends ExternalRecord {
  readonly name: string
  readonly isActive: boolean
}

export interface RawEmployee extends ExternalRecord {
  readonly fullName: string
  readonly email?: string
  readonly phone?: string
  readonly position?: string
  readonly departmentExternalId?: string
  readonly avatarUrl?: string
  readonly isActive: boolean
  readonly hiredAt?: Date
}

export interface RawProductCategory extends ExternalRecord {
  readonly name: string
  readonly isActive: boolean
}

export interface RawProduct extends ExternalRecord {
  readonly name: string
  readonly sku?: string
  readonly categoryExternalId?: string
  /** Minor units. Absent when the source publishes no list price. */
  readonly priceMinor?: bigint
  readonly currency: string
  readonly isActive: boolean
}

export interface RawStage extends ExternalRecord {
  readonly name: string
  /**
   * Already mapped to OUR semantics by the provider's mapping configuration.
   * A provider that cannot classify a stage must fail loudly rather than
   * guess: a stage silently defaulted to IN_PROGRESS would quietly remove
   * revenue from every won-deal figure.
   */
  readonly category: StageCategoryValue
  readonly sortOrder: number
  readonly isActive: boolean
}

export interface RawSalesSource extends ExternalRecord {
  readonly name: string
  readonly isActive: boolean
}

export interface RawCustomer extends ExternalRecord {
  readonly name: string
  readonly isCompany: boolean
  readonly email?: string
  readonly phone?: string
  readonly region?: string
}

export interface RawDeal extends ExternalRecord {
  readonly title: string
  readonly amountMinor: bigint
  readonly currency: string
  readonly stageExternalId: string
  readonly status: DealStatusValue
  readonly employeeExternalId: string
  readonly customerExternalId?: string
  readonly sourceExternalId?: string
  /** When the deal was created in the SOURCE system, not when we imported it. */
  readonly createdAtSource: Date
  readonly closedAt?: Date
  /**
   * Source fields with no confirmed mapping yet. Preserved verbatim so no data
   * is lost before its meaning is agreed. Must never contain credentials.
   */
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface RawDealItem extends ExternalRecord {
  readonly dealExternalId: string
  readonly productExternalId: string
  readonly quantity: number
  readonly unitPriceMinor: bigint
  readonly totalMinor: bigint
}

export interface RawPayment extends ExternalRecord {
  readonly dealExternalId: string
  readonly amountMinor: bigint
  readonly currency: string
  readonly paidAt: Date
  readonly method: PaymentMethodValue
  readonly note?: string
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What a provider can actually supply.
 *
 * This exists so the application can distinguish "the value is zero" from
 * "this source does not expose that data". The API reports an unsupported
 * entity as unavailable rather than as 0, because a financial panel confidently
 * showing 0 so'm outstanding is worse than one that says the data is not
 * connected yet.
 */
export interface ProviderCapabilities {
  readonly [entity: string]: boolean
}

export function supports(
  capabilities: ProviderCapabilities,
  entity: SyncEntityValue,
): boolean {
  return capabilities[entity] === true
}

export type ProviderHealth =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly detail: string }

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface CrmProvider {
  /** Stamped onto every row this provider produces. Drives the demo badge. */
  readonly source: ExternalSourceValue
  readonly capabilities: ProviderCapabilities

  /**
   * Cheap reachability probe. Must never throw — a provider that cannot be
   * reached reports `{ ok: false }` so the admin screen can render the reason
   * instead of the whole page failing.
   */
  healthCheck(): Promise<ProviderHealth>

  fetchDepartments(options?: FetchOptions): Promise<Page<RawDepartment>>
  fetchEmployees(options?: FetchOptions): Promise<Page<RawEmployee>>
  fetchProductCategories(options?: FetchOptions): Promise<Page<RawProductCategory>>
  fetchProducts(options?: FetchOptions): Promise<Page<RawProduct>>
  fetchStages(options?: FetchOptions): Promise<Page<RawStage>>
  fetchSources(options?: FetchOptions): Promise<Page<RawSalesSource>>
  fetchCustomers(options?: FetchOptions): Promise<Page<RawCustomer>>
  fetchDeals(options?: FetchOptions): Promise<Page<RawDeal>>
  fetchDealItems(options?: FetchOptions): Promise<Page<RawDealItem>>
  fetchPayments(options?: FetchOptions): Promise<Page<RawPayment>>
}

/** Raised when a provider is asked for an entity it does not support. */
export class UnsupportedEntityError extends Error {
  constructor(source: string, entity: SyncEntityValue) {
    super(`Provider "${source}" does not supply ${entity}.`)
    this.name = 'UnsupportedEntityError'
  }
}

/** Raised when a provider cannot classify source data into our vocabulary. */
export class ProviderMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderMappingError'
  }
}

export const EMPTY_PAGE: Page<never> = Object.freeze({ items: Object.freeze([]) })
