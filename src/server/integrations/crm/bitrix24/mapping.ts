/**
 * Bitrix24 field mapping — BITRIX24_INTEGRATION_PENDING
 *
 * WHAT THIS FILE IS
 * The single place where Bitrix24's vocabulary is translated into ours. When
 * the real portal credentials arrive, this file and `Bitrix24CrmProvider` are
 * the only things that should need to change. No React component, no analytics
 * function and no database query may reference anything declared here.
 *
 * WHAT IS AND IS NOT KNOWN
 * The REST METHOD names below are Bitrix24's public, documented endpoints, so
 * they are safe defaults. The FIELD names are NOT: a Bitrix24 portal is heavily
 * customisable, and this business will have its own custom fields, its own
 * pipeline and its own stage IDs. Nothing here is guessed from the customer's
 * actual portal.
 *
 * Every entry marked `confirmed: false` must be verified against the live
 * portal before `DATA_SOURCE=bitrix24` is switched on. `assertMappingComplete`
 * enforces that at startup, so an unverified mapping cannot silently produce a
 * dashboard full of wrong numbers.
 */

import type { StageCategoryValue } from '@/server/domain/types'

export interface FieldMapping {
  /** Our internal field name. */
  readonly domainField: string
  /** The Bitrix24 field to read it from. Empty until confirmed. */
  readonly sourceField: string
  /** Set to true only after checking against the real portal. */
  readonly confirmed: boolean
  readonly note?: string
}

export interface EntityMapping {
  /** Documented Bitrix24 REST method. */
  readonly method: string
  readonly fields: readonly FieldMapping[]
  /** True once the whole entity has been verified end to end. */
  readonly confirmed: boolean
}

const pending = (domainField: string, note?: string): FieldMapping => ({
  domainField,
  sourceField: '',
  confirmed: false,
  note,
})

/**
 * Default mapping skeleton.
 *
 * Deliberately left empty rather than pre-filled with plausible guesses like
 * `OPPORTUNITY` or `ASSIGNED_BY_ID`. A wrong-but-plausible mapping would import
 * silently and produce a dashboard that looks right and is not — far worse than
 * one that refuses to start.
 */
export const BITRIX24_MAPPING: Readonly<Record<string, EntityMapping>> = Object.freeze({
  EMPLOYEES: {
    method: 'user.get',
    confirmed: false,
    fields: [
      pending('externalId'),
      pending('fullName', 'Bitrix24 splits the name across several fields'),
      pending('email'),
      pending('position'),
      pending('departmentExternalId', 'Bitrix24 departments are a tree; we store one level'),
      pending('isActive'),
    ],
  },

  DEPARTMENTS: {
    method: 'department.get',
    confirmed: false,
    fields: [pending('externalId'), pending('name')],
  },

  STAGES: {
    method: 'crm.status.list',
    confirmed: false,
    fields: [
      pending('externalId'),
      pending('name'),
      pending('sortOrder'),
      pending('category', 'Requires the stage-category table below'),
    ],
  },

  SOURCES: {
    method: 'crm.status.list',
    confirmed: false,
    fields: [pending('externalId'), pending('name')],
  },

  PRODUCTS: {
    method: 'crm.product.list',
    confirmed: false,
    fields: [
      pending('externalId'),
      pending('name'),
      pending('categoryExternalId'),
      pending('priceMinor', 'Bitrix24 returns a decimal string; convert to minor units'),
      pending('currency'),
      pending('isActive'),
    ],
  },

  PRODUCT_CATEGORIES: {
    method: 'crm.productsection.list',
    confirmed: false,
    fields: [pending('externalId'), pending('name')],
  },

  CUSTOMERS: {
    method: 'crm.company.list',
    confirmed: false,
    fields: [
      pending('externalId'),
      pending('name'),
      pending('isCompany', 'Companies and contacts are separate entities in Bitrix24'),
      pending('phone'),
      pending('email'),
      pending('region'),
    ],
  },

  DEALS: {
    method: 'crm.deal.list',
    confirmed: false,
    fields: [
      pending('externalId'),
      pending('title'),
      pending('amountMinor', 'Decimal string; convert to minor units, never via float'),
      pending('currency'),
      pending('stageExternalId'),
      pending('employeeExternalId'),
      pending('customerExternalId'),
      pending('sourceExternalId'),
      pending('createdAtSource'),
      pending('closedAt'),
    ],
  },

  DEAL_ITEMS: {
    method: 'crm.deal.productrows.get',
    confirmed: false,
    fields: [
      pending('dealExternalId'),
      pending('productExternalId'),
      pending('quantity'),
      pending('unitPriceMinor'),
    ],
  },

  /**
   * Standard Bitrix24 has no first-class payment ledger on deals. Whether this
   * business tracks payments in custom fields, in an invoice entity, or not in
   * Bitrix24 at all is UNKNOWN and must not be assumed.
   */
  PAYMENTS: {
    method: '',
    confirmed: false,
    fields: [
      pending('dealExternalId', 'Source unknown — see docs/BITRIX24.md open questions'),
      pending('amountMinor'),
      pending('paidAt'),
      pending('method'),
    ],
  },
})

/**
 * Bitrix24 stage ID -> our stage category.
 *
 * Stage IDs are portal-specific strings like `C1:NEW`. There is no way to
 * derive the mapping without seeing the portal, and guessing it would corrupt
 * every won/lost figure on the dashboard, so it starts empty.
 */
export const BITRIX24_STAGE_CATEGORIES: Readonly<Record<string, StageCategoryValue>> =
  Object.freeze({})

export interface MappingGap {
  readonly entity: string
  readonly missing: readonly string[]
}

/** Every entity that is not yet fully confirmed, with its unmapped fields. */
export function findMappingGaps(
  mapping: Readonly<Record<string, EntityMapping>> = BITRIX24_MAPPING,
): readonly MappingGap[] {
  const gaps: MappingGap[] = []

  for (const [entity, entityMapping] of Object.entries(mapping)) {
    const missing = entityMapping.fields
      .filter((field) => !field.confirmed || field.sourceField === '')
      .map((field) => field.domainField)

    if (missing.length > 0 || !entityMapping.confirmed) {
      gaps.push({ entity, missing })
    }
  }

  return gaps
}

export class MappingIncompleteError extends Error {
  constructor(public readonly gaps: readonly MappingGap[]) {
    const summary = gaps
      .map((gap) => `  - ${gap.entity}: ${gap.missing.join(', ') || 'entity not confirmed'}`)
      .join('\n')

    super(
      'BITRIX24_INTEGRATION_PENDING — the Bitrix24 field mapping is incomplete:\n' +
        `${summary}\n\n` +
        'Confirm each field against the live portal in ' +
        'src/server/integrations/crm/bitrix24/mapping.ts before enabling ' +
        'DATA_SOURCE=bitrix24. Refusing to import rather than guessing.',
    )
    this.name = 'MappingIncompleteError'
  }
}

/** @throws MappingIncompleteError when anything is still unconfirmed. */
export function assertMappingComplete(
  mapping: Readonly<Record<string, EntityMapping>> = BITRIX24_MAPPING,
): void {
  const gaps = findMappingGaps(mapping)
  if (gaps.length > 0) throw new MappingIncompleteError(gaps)
}
