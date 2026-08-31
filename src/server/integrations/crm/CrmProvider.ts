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
  CallDirectionValue,
  ConfirmStatusValue,
  ConfirmationSignalValue,
  DealStatusValue,
  ExternalSourceValue,
  LogisticsRoleValue,
  PaymentMethodValue,
  PipelineRoleValue,
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
  /** Parent in the company tree. Absent for the root. */
  readonly parentExternalId?: string
  /** The employee who heads this department, by their external id. */
  readonly headExternalId?: string
  readonly sortOrder?: number
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
  /**
   * Purchase price in minor units — the COGS basis for margin.
   *
   * Absent means UNKNOWN, never zero. A margin computed against a zero cost
   * reads as 100% and is worse than showing no margin at all.
   */
  readonly costMinor?: bigint
  readonly currency: string
  readonly isActive: boolean
}

/**
 * A pipeline (воронка). Which ones count as revenue is a business decision,
 * so the provider states the role and the database stores it as data.
 */
export interface RawPipeline extends ExternalRecord {
  readonly name: string
  readonly role: PipelineRoleValue
  readonly sortOrder: number
}

export interface RawStage extends ExternalRecord {
  readonly name: string
  /** Which pipeline this stage belongs to. Stage ids repeat across pipelines. */
  readonly pipelineExternalId?: string
  /** Place in the delivery ladder. Set only for logistics pipelines. */
  readonly logisticsRole?: LogisticsRoleValue
  /**
   * What entering this stage says about the order's confirmation.
   *
   * Set for the five stages the client's bot reacts to and left undefined for
   * every other, which is the meaningful part: an undefined signal is "this
   * move changes nothing", not "we could not classify it".
   */
  readonly confirmationSignal?: ConfirmationSignalValue
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
  /** The first number. Kept because every existing query reads it. */
  readonly phone?: string
  /** Every number the source holds, in its own order. */
  readonly phones?: readonly string[]
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
  readonly pipelineExternalId?: string

  /** Order code parsed from the title, when the source uses one. */
  readonly orderCode?: string
  /** True only for pipelines the provider classifies as REVENUE. */
  readonly countsAsRevenue: boolean

  // Custom fields promoted out of `metadata` because analytics filters on
  // them. Absent always means the source left the field empty.
  readonly region?: string
  readonly fulfilmentPoint?: string
  /** Delivery address, free text as the operator typed it. */
  readonly deliveryAddress?: string
  readonly confirmStatus?: ConfirmStatusValue
  readonly refusalReason?: string
  readonly paymentMethodRaw?: string
  readonly productLine?: string
  readonly customerGrade?: string
  readonly isReturnCustomer?: boolean
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
  readonly discountMinor?: bigint
  /** Basis points. 10.11% arrives as 1011. */
  readonly discountRateBp?: number
  /**
   * The product's name as recorded ON THE LINE, not in the catalogue.
   *
   * Products get deleted; their line items do not. Carrying the name means a
   * deleted product's sales stay attributable instead of vanishing from
   * product analytics along with the catalogue row.
   */
  readonly productName?: string
}

/**
 * One stage transition. The basis for every duration metric in the product.
 *
 * `leftAt` is not supplied by the source — it is derived by the sync engine
 * from the deal's next transition, so a provider only reports entries.
 */
export interface RawStageHistory extends ExternalRecord {
  readonly dealExternalId: string
  readonly stageExternalId: string
  readonly enteredAt: Date
}

export interface RawCall extends ExternalRecord {
  readonly employeeExternalId?: string
  readonly customerExternalId?: string
  readonly dealExternalId?: string
  readonly direction: CallDirectionValue
  readonly phoneNumber?: string
  readonly startedAt: Date
  readonly durationSec: number
  readonly connected: boolean
  readonly failedCode?: string
  readonly recordUrl?: string
}

export interface RawStore extends ExternalRecord {
  readonly name: string
  readonly address?: string
  readonly isActive: boolean
}

export interface RawStockLevel {
  readonly storeExternalId: string
  readonly productExternalId: string
  readonly quantity: string
  readonly reserved: string
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
  fetchPipelines(options?: FetchOptions): Promise<Page<RawPipeline>>
  fetchStages(options?: FetchOptions): Promise<Page<RawStage>>
  fetchSources(options?: FetchOptions): Promise<Page<RawSalesSource>>
  fetchCustomers(options?: FetchOptions): Promise<Page<RawCustomer>>
  fetchDeals(options?: FetchOptions): Promise<Page<RawDeal>>
  fetchDealItems(options?: FetchOptions): Promise<Page<RawDealItem>>
  fetchPayments(options?: FetchOptions): Promise<Page<RawPayment>>
  fetchStageHistory(options?: FetchOptions): Promise<Page<RawStageHistory>>
  fetchCalls(options?: FetchOptions): Promise<Page<RawCall>>
  fetchStores(options?: FetchOptions): Promise<Page<RawStore>>
  fetchStockLevels(options?: FetchOptions): Promise<Page<RawStockLevel>>
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
