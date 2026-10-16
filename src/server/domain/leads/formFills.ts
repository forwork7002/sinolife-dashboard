import type { Period } from '@/server/domain/period/period'

/**
 * THE CRM-FORM FILLS AS THE BITRIX24 COUNT OF META'S FORM LEADS (2026-10-15,
 * the client: «facebookdagi leadlar … qanday kombinatsiya … bitrix24da ham
 * huddi shu kombinatsiyada»). Meta counts every fill on the day it was
 * filled; the portal records every fill too (`crm_form_fill`, written by
 * `formFillFeed.ts`) but opens a deal for only some. Wherever a Bitrix24
 * lead count stands beside Meta's form leads, it is these fills.
 */

/** One Tashkent day's fills of one form subject («Заполнена CRM-форма "<form>"»). */
export interface FormFillDayRow {
  readonly day: string
  readonly subject: string
  readonly fills: number
}

/**
 * What `crm_form_fill` holds: fills from `from` (where the backfill began) to
 * `through` (the start of the last pass that reached the newest fill).
 */
export interface FormFillCoverage {
  readonly from: Date
  readonly through: Date
}

/**
 * How old the fills' last whole pass may be before a window running to now
 * stops trusting them. The worker reads every ~6 minutes; a feed that has
 * failed for half an hour would count today short under the «every fill»
 * rule, so the deals are counted instead until it reads again.
 */
export const FILLS_STALE_MS = 30 * 60_000

/** Whether the fills cover the whole window — read from its start, and current to its end. */
export function fillsCover(coverage: FormFillCoverage | null, period: Period, now: Date): boolean {
  if (coverage === null || period.start < coverage.from) return false
  return coverage.through.getTime() >= Math.min(period.end.getTime(), now.getTime()) - FILLS_STALE_MS
}

/**
 * A form of the AI targetolog's own integration («AI targetolog · <form>»,
 * the name `leadFormTitleSql` gives it): its leads arrive as Регистрация
 * deals and never as a CRM-form fill, so on the fills' side they are its deals.
 */
export function isIntegrationForm(formName: string): boolean {
  // `\s*`: with no form after «forma:» the name is cut to «AI targetolog ·».
  return /^AI targetolog\s*·/.test(formName)
}
