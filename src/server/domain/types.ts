/**
 * Shared domain vocabulary.
 *
 * These unions mirror the enums in prisma/schema.prisma, but they are declared
 * here rather than imported from the generated Prisma client on purpose: the
 * domain layer must not depend on the persistence layer. That is what lets the
 * analytics engine be unit tested without a database, and what would let this
 * layer be lifted into a separate service unchanged.
 *
 * src/server/repositories/enumParity.ts asserts at compile time that these
 * stay in step with the Prisma enums, so the duplication cannot drift silently.
 */

export const EXTERNAL_SOURCES = ['DEMO', 'BITRIX24', 'MANUAL'] as const
export type ExternalSourceValue = (typeof EXTERNAL_SOURCES)[number]

export const ROLES = ['ADMIN', 'MANAGER', 'SALES'] as const
export type RoleValue = (typeof ROLES)[number]

/**
 * Our normalised meaning of a pipeline stage. Bitrix24 stage IDs are mapped
 * onto these by configuration; no analytics code ever reads a stage name.
 */
export const STAGE_CATEGORIES = ['NEW', 'IN_PROGRESS', 'WON', 'LOST'] as const
export type StageCategoryValue = (typeof STAGE_CATEGORIES)[number]

export const DEAL_STATUSES = ['OPEN', 'WON', 'LOST'] as const
export type DealStatusValue = (typeof DEAL_STATUSES)[number]

export const KPI_METRICS = [
  'REVENUE',
  'DEALS_CREATED',
  'DEALS_WON',
  'AVERAGE_DEAL',
  'CONVERSION_RATE',
] as const
export type KpiMetricValue = (typeof KPI_METRICS)[number]

export const KPI_PERIODS = ['MONTH', 'QUARTER', 'YEAR'] as const
export type KpiPeriodValue = (typeof KPI_PERIODS)[number]

export const KPI_STATUSES = ['ACHIEVED', 'ON_TRACK', 'AT_RISK', 'BEHIND'] as const
export type KpiStatusValue = (typeof KPI_STATUSES)[number]

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]

export const SYNC_ENTITIES = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCT_CATEGORIES',
  'PRODUCTS',
  'STAGES',
  'SOURCES',
  'CUSTOMERS',
  'DEALS',
  'DEAL_ITEMS',
  'PAYMENTS',
] as const
export type SyncEntityValue = (typeof SYNC_ENTITIES)[number]

/**
 * Dependency order for a full synchronisation.
 *
 * Deals reference stages, employees, customers and sources, so those must
 * already exist when deals are written. Running the entities in this order is
 * what keeps foreign keys satisfiable on a cold database.
 */
export const SYNC_ORDER: readonly SyncEntityValue[] = SYNC_ENTITIES

export const SYNC_MODES = ['FULL', 'INCREMENTAL'] as const
export type SyncModeValue = (typeof SYNC_MODES)[number]

export const SYNC_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] as const
export type SyncStatusValue = (typeof SYNC_STATUSES)[number]

/** Map a stage category onto the deal status it implies. */
export function statusForStageCategory(category: StageCategoryValue): DealStatusValue {
  switch (category) {
    case 'WON':
      return 'WON'
    case 'LOST':
      return 'LOST'
    case 'NEW':
    case 'IN_PROGRESS':
      return 'OPEN'
  }
}

/** A deal is resolved once it has left the pipeline, either way. */
export function isResolved(status: DealStatusValue): boolean {
  return status === 'WON' || status === 'LOST'
}
