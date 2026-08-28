/**
 * The API response contract.
 *
 * Every endpoint returns one of exactly two shapes, so the client has a single
 * code path for success and a single one for failure.
 *
 * WHY `meta.dataSource` IS ON EVERY RESPONSE
 * Requirement: demo data must never be mistakable for live Bitrix24 data. The
 * safest place to carry that fact is the transport itself — every payload
 * states its own provenance, so no screen can forget to check. The UI's "Demo
 * data" badge reads this field and nothing else.
 */

import type { ExternalSourceValue } from '@/server/domain/types'
import type { PeriodDto } from '@/server/domain/period/period'
import type { ApiError, ErrorCode, ErrorDetail } from './errors'

export interface ResponseMeta {
  /** Provenance of the data in this response. Drives the demo badge. */
  readonly dataSource: ExternalSourceValue
  readonly generatedAt: string
  /** Present on any endpoint that took a period filter. */
  readonly period?: PeriodDto
  /** Comparison window, when the endpoint computed deltas. */
  readonly comparisonPeriod?: PeriodDto
  /** Set when the comparison window had to be shortened; see previousEquivalent. */
  readonly comparisonTruncated?: boolean
  /** Correlation id, echoed so a user can quote it in a support request. */
  readonly correlationId?: string
  /** Entities the active provider cannot supply. The UI shows these as unavailable, not zero. */
  readonly unavailable?: readonly string[]
  /**
   * Which BOOK the figures come from, when it is not the CRM's.
   *
   * `dataSource` names the CRM provider behind the request and is typed as the
   * database's own `ExternalSource` enum — widening that enum to hold
   * 'ROISTAT' would be a lie about a column no marketing row ever fills. The
   * marketing module reads a genuinely separate ledger (the client's Google
   * Sheets plus Meta Ads, imported from their published Roistat page), so it
   * says so here instead. A screen that sees this must not render the
   * Bitrix24 provenance badge, and must never add these figures to a CRM
   * total: two systems, two books, different definitions of revenue.
   */
  readonly ledger?: 'ROISTAT'
}

export interface SuccessEnvelope<T> {
  readonly data: T
  readonly meta: ResponseMeta
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
    readonly details: readonly ErrorDetail[]
  }
  readonly meta: ResponseMeta
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope

export interface PaginationMeta {
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
  readonly hasNextPage: boolean
  readonly hasPreviousPage: boolean
}

export interface PaginatedData<T> {
  readonly items: readonly T[]
  readonly pagination: PaginationMeta
}

export function buildPagination(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationMeta {
  // An empty result set is one empty page, not zero pages: the UI still has a
  // page to render, and "page 1 of 0" reads as broken.
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  }
}

export function success<T>(data: T, meta: ResponseMeta): SuccessEnvelope<T> {
  return { data, meta }
}

export function failure(error: ApiError, meta: ResponseMeta): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    // `error.cause` is deliberately absent: it goes to the log, not the wire.
    meta,
  }
}

export function isSuccess<T>(envelope: Envelope<T>): envelope is SuccessEnvelope<T> {
  return 'data' in envelope
}

/**
 * JSON.stringify replacer that survives BigInt.
 *
 * Money is BigInt throughout the server; `JSON.stringify` throws on it rather
 * than guessing. Emitting a decimal string keeps the value exact — turning it
 * into a Number here would reintroduce exactly the precision loss the money
 * domain exists to prevent.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

export function serialise(payload: unknown): string {
  return JSON.stringify(payload, jsonReplacer)
}
