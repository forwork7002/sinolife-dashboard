/**
 * The reporting window, shaped once for every screen that has one.
 *
 * WHAT IS LEFT OF THIS FILE, AND WHY. It was the analytics orchestrator —
 * overview, sales, products, sources, funnel, employees and leaderboard, each
 * loading deals through `DealRepository` and handing them to the domain. Every
 * one of those endpoints was removed as the product narrowed to the sections
 * the client actually asked for, and on 2026-09-10 the last of them went with
 * «Boshqaruv markazi». Nothing constructs this class any more.
 *
 * What three live routes still ask it for is the CONTEXT: a period, its
 * comparison window, the currency and the caller's filters, built the same way
 * everywhere so that «oʻtgan davrga nisbatan» means the same thing on every
 * screen. That, and the `meta` block which prints it. Both are static, so this
 * is a namespace rather than a service — kept under its old name because
 * `AnalyticsService.context(...)` reads correctly at every call site and
 * renaming it would touch three routes to say nothing new.
 */

import { type Period, previousEquivalent, toPeriodDto } from '@/server/domain/period/period'
import type { EmployeeScopeFilter } from '@/server/domain/employees/branches'
import type { DealFilters } from '@/server/repositories/dealRepository'

/**
 * Deal filters plus the resolved FILIAL scope.
 *
 * `restrictToEmployeeIds` is branch ∩ authorisation, already intersected — one
 * list that carries both restrictions, so a repository honouring this single
 * field is automatically correct for a SALES caller too. Null means
 * unrestricted; it is never an empty array, because every repository tests id
 * lists with `?.length` and an empty one would read as "no filter" and widen
 * the query to the whole company. See `NO_EMPLOYEE_IN_SCOPE`.
 */
export interface AnalyticsFilters extends DealFilters, EmployeeScopeFilter {}

export interface AnalyticsContext {
  readonly period: Period
  readonly comparison: Period & { readonly isTruncated: boolean }
  readonly currency: string
  readonly filters: AnalyticsFilters
  readonly now: Date
}

export class AnalyticsService {
  /** Build the context both periods share. */
  static context(
    period: Period,
    currency: string,
    filters: AnalyticsFilters,
    now: Date,
  ): AnalyticsContext {
    return { period, comparison: previousEquivalent(period), currency, filters, now }
  }

  /** Serialisable period metadata for the response envelope. */
  static periodMeta(ctx: AnalyticsContext) {
    return {
      period: toPeriodDto(ctx.period),
      comparisonPeriod: toPeriodDto(ctx.comparison),
      comparisonTruncated: ctx.comparison.isTruncated,
    }
  }
}
