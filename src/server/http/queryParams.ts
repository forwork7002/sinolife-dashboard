/**
 * Shared query contract.
 *
 * One schema for every analytics endpoint, so `?from=`/`?employeeIds=` mean the
 * same thing everywhere and a filter added here becomes available to all of
 * them at once.
 *
 * Validation is not a formality: these values reach SQL. Prisma parameterises
 * queries, but an unvalidated `pageSize=1000000` is a denial-of-service and an
 * unvalidated sort column is an information leak. Everything is bounded and
 * enumerated below.
 */

import { z } from 'zod'

import { PAYROLL_HALVES, PERIOD_PRESETS } from '@/server/domain/period/period'
import { ROISTAT_DIMS } from '@/server/domain/roistat/roistatCuts'
import {
  CONFIRMATION_ORDER_SORTS,
  CONFIRMATION_OUTCOMES,
  CONFIRMATION_QUEUE_MODES,
  DEAL_STATUSES,
  TARGET_PRODUCT_FILTERS,
  TARGET_SCOPES,
} from '@/server/domain/types'

/** Comma-separated ids -> string[]. Empty entries dropped. */
const idList = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : undefined,
  )
  .pipe(z.array(z.string().min(1).max(64)).max(200).optional())

/**
 * The same list, for NAMES rather than ids.
 *
 * 64 characters is a cuid; a department name or a region is prose and runs
 * long — the ROP dropdown already offered one of 69 characters, which the id
 * cap would turn into a 400 on the whole page the moment it was picked. The
 * ceiling matches the column the value comes from, as `rop` below explains.
 */
const nameList = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : undefined,
  )
  .pipe(z.array(z.string().min(1).max(200)).max(40).optional())

/** A calendar date, `YYYY-MM-DD`, interpreted in the app timezone downstream. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), 'Not a valid calendar date')

/** Ten years, in milliseconds. See the span check in `periodQuerySchema`. */
const MAX_CUSTOM_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000

export const periodQuerySchema = z
  .object({
    // Matches the client's default in useDashboardFilters — see the note there.
    preset: z.enum(PERIOD_PRESETS).default('today'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** Whether to compute the previous-equivalent comparison. */
    compare: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, ctx) => {
    if (value.preset === 'custom' && (!value.from || !value.to)) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: "preset=custom requires both 'from' and 'to'",
      })
    }
    if (value.from && value.to && value.to.getTime() < value.from.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: "'to' must be on or after 'from'",
      })
    }
    /*
      A CEILING ON THE SPAN, for the same reason `pageSize` has one.

      Nothing else bounded a custom range, so `?from=1900-01-01&to=2100-01-01`
      was a single request asking every analytics endpoint to scan the whole
      deal table and bucket two centuries of it — which arrives as a timeout or
      a 500 rather than as the 400 it is. The portal's history starts in May
      2025; ten years is far past any real question and still a bound.
    */
    if (value.from && value.to && value.to.getTime() - value.from.getTime() > MAX_CUSTOM_RANGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Tanlangan oraliq juda uzun — koʻpi bilan 10 yil.',
      })
    }
  })

const filterQuerySchema = z.object({
  employeeIds: idList,
  departmentIds: idList,
  stageIds: idList,
  productIds: idList,
  sourceIds: idList,
  status: z.enum(DEAL_STATUSES).optional(),
  /** Free-text search. Bounded so it cannot become a scan of arbitrary length. */
  q: z.string().trim().min(1).max(120).optional(),
})

export const analyticsQuerySchema = periodQuerySchema.and(filterQuerySchema)

/**
 * «Oyliklar» — a payroll period, which is a MONTH and a HALF, never from/to.
 *
 * The office pays on the 1st-15th and the 16th-end, so the window is a
 * calendar fact rather than a range somebody drags. Taking `month` + `half`
 * and resolving them on the server (`payrollPeriod`) is what keeps a laptop in
 * another timezone from shifting a day of pay from one half into the other —
 * and it makes the URL say what the reader chose rather than what their clock
 * computed.
 *
 * NO `preset`, NO from/to, and no filters: this screen answers one question
 * about the whole company, and an employee filter on a payroll would produce a
 * fund total for a subset that reads like the payroll.
 */
export const payrollQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month in YYYY-MM format')
    /*
      Year 0001 at the earliest: the comparison window is the month BEFORE,
      and year 0000 has none a YYYY-MM can name — a 400 here, not a 500 there.
    */
    .refine((value) => !value.startsWith('0000'), 'Expected a year from 0001'),
  half: z.enum(PAYROLL_HALVES).default('full'),
})

/**
 * «Haftalik daromad» — a payroll WEEK, named by its Monday (`YYYY-MM-DD`).
 *
 * The same reasoning as `payrollQuerySchema`: the browser names the week, the
 * server builds the window in Tashkent (`payrollWeekPeriod`). No filters, no
 * preset.
 */
export const payrollWeekQuerySchema = z.object({
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a Monday in YYYY-MM-DD format')
    /*
      Checked here as well as in `payrollWeekPeriod`, so a wrong date is a 400
      naming the field rather than a 500. A calendar date's weekday does not
      depend on the zone, so UTC is enough for the question.
    */
    .refine((value) => {
      const [year, month, day] = value.split('-').map(Number)
      // setUTCFullYear, not Date.UTC: the latter reads years 0–99 as 1900–1999.
      const date = new Date(0)
      date.setUTCFullYear(year!, month! - 1, day!)
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month! - 1 &&
        date.getUTCDate() === day &&
        date.getUTCDay() === 1
      )
    }, 'Expected a date that is a Monday')
    // The comparison week is seven days earlier; year 0000 cannot name it.
    .refine((value) => !value.startsWith('0000'), 'Expected a year from 0001'),
})

/**
 * One department's roster, for the panel the org chart opens.
 *
 * `departmentId` is REQUIRED rather than optional-with-a-default. An optional
 * one would make a bare call to this endpoint mean "every person in the
 * company", which is a different question, a 289-row answer, and not one this
 * screen ever asks — and the caller who forgot the parameter would get it
 * silently instead of a 400 naming the mistake.
 */
export const departmentRosterQuerySchema = periodQuerySchema
  .and(filterQuerySchema)
  .and(z.object({ departmentId: z.string().min(1).max(64) }))

/**
 * The confirmation queue's own page contract.
 *
 * Its sort allowlist is its own: this list is ordered by when an order
 * entered the queue — a column no deal query has.
 */
export const confirmationOrdersQuerySchema = periodQuerySchema
  .and(filterQuerySchema)
  .and(
    z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(25),
      sort: z.enum(CONFIRMATION_ORDER_SORTS).default('queuedAt'),
      order: z.enum(['asc', 'desc']).default('desc'),
      /**
       * Any subset of the five states, comma-separated. Absent means all.
       *
       * A list rather than one value because the states are read in
       * combinations on the floor — "everything that did not get through" is
       * three of them at once, and making that three separate page loads is
       * making the reader do the union in their head.
       */
      outcomes: z
        .string()
        .optional()
        .transform((value) =>
          value
            ? value
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part.length > 0)
            : undefined,
        )
        .pipe(z.array(z.enum(CONFIRMATION_OUTCOMES)).min(1).max(5).optional()),
      /**
       * Which question the board answers — see `ConfirmationQueueMode`.
       *
       * 'window' (the default) keeps every existing link working: the board is
       * dated by the order's own Дата создания. 'backlog' ignores the period
       * entirely and lists what is waiting right now, which is the one
       * question a queue dated by intake cannot answer — the oldest unworked
       * order is older than any preset.
       */
      queue: z.enum(CONFIRMATION_QUEUE_MODES).default('window'),
      /**
       * A single ROP group by name. Bounded: it reaches SQL as a parameter.
       *
       * 200, not 64. The value is a DEPARTMENT NAME with the "(ROP)" marker
       * stripped, and department names on this portal run long — the dropdown
       * offered one of 69 characters, which the old cap turned into a 400 on
       * the whole page the moment it was picked. The ceiling matches the
       * column it comes from rather than a guess about how long a name is.
       */
      rop: z.string().trim().min(1).max(200).optional(),
      /**
       * ROP groups by name, comma-separated — the column filter's selection.
       *
       * A LIST NOW, because the control moved. It used to be the toolbar's
       * single-choice «Барча РОП»; the client asked on 2026-09-09 for an
       * Excel-style filter on the column itself («jadvaldagi roplar ustuniga
       * exceldagi filtrga oʻxshab filtr»), and an AutoFilter is a set of
       * checkboxes. Comparing two ROP groups against each other was a page
       * reload each before this.
       *
       * `rop` above is kept and still honoured, so every link already pasted
       * into Telegram — /confirmation?rop=Sevinch — opens on what it opened on
       * before. The service unions the two.
       *
       * 200 per entry for the reason `rop` states; 40 entries because the
       * portal has fifteen ROP departments and the ceiling is a bound, not a
       * prediction.
       */
      rops: nameList,
      /**
       * Customer regions by name, comma-separated.
       *
       * `deal.region` is one of fourteen values written by the portal's own
       * UF_CRM field, so this is a bounded vocabulary rather than free text —
       * but it is NOT enumerated here. The import writes whatever the portal
       * says, and a region added in Bitrix24 must not turn this endpoint into
       * a 400 on the whole page; the predicate compares strings and an unknown
       * one simply matches nothing.
       */
      regions: nameList,
      /**
       * The СУММА column's range, in whole soʻm — not minor units.
       *
       * MAJOR UNITS, BECAUSE A HUMAN TYPES THIS. The number in the box is the
       * number printed in the column, and the service multiplies by the
       * currency's exponent exactly once. Sending minor units would have made
       * the control a hundred times wrong for anybody who typed what they saw.
       *
       * The ceiling is 1e13 soʻm — four orders of magnitude above the largest
       * order this portal has recorded, and still far inside the safe integer
       * range once it becomes minor units.
       */
      amountMin: z.coerce.number().min(0).max(1e13).optional(),
      amountMax: z.coerce.number().min(0).max(1e13).optional(),
    }),
  )

export type PeriodQuery = z.infer<typeof periodQuerySchema>

/** Flatten URLSearchParams to a plain object, keeping the last value per key. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of params.entries()) result[key] = value
  return result
}

// ---------------------------------------------------------------------------
// «Target tahlili»
// ---------------------------------------------------------------------------

/** «Faqat target» by default — the screen is about the ad pages (`TARGET_SOURCE_IDS`). */
const targetScope = z.enum(TARGET_SCOPES).default('target')

/**
 * One product, or both. A product narrows BOTH halves: the leads to that
 * product's own target pages and the spend to its own ad accounts — and it
 * overrides `scope`, because a product is only defined on the target pages.
 */
const targetProduct = z.enum(TARGET_PRODUCT_FILTERS).default('all')

/**
 * The Collagen / Zextra switch every main screen carries (`?brand=`): both,
 * or one. A lead is filed by RNP's `leadBrand`, a sale by the team that sold
 * it (`teamBrand`), Meta money by its ad account (`adBudgetProduct`).
 */
export const brandFilter = z.enum(TARGET_PRODUCT_FILTERS).default('all')

/** «Reklama samarasi»: the window and the brand switch. */
export const reklamaOverviewQuerySchema = periodQuerySchema.and(z.object({ brand: brandFilter }))

/** Free text reaching a WHERE clause: trimmed, bounded, empty means absent. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined))

export const targetOverviewQuerySchema = periodQuerySchema.and(
  z.object({ scope: targetScope, product: targetProduct }),
)

export const targetLeadsQuerySchema = periodQuerySchema.and(
  z.object({
    scope: targetScope,
    product: targetProduct,
    /** A source NAME, as the overview groups it. */
    source: optionalText(200),
    /** A targetolog, or «Koʻrsatilmagan» for the leads that carry none. */
    targetolog: optionalText(200),
    /** A Регистрация stage name. */
    stage: optionalText(200),
    /** Deal id, title, customer name or phone. */
    q: optionalText(100),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }),
)

// ---------------------------------------------------------------------------
// «Roistat»
// ---------------------------------------------------------------------------

/**
 * The table's cut and, under Адсеты / Объявления, the campaign or adset being
 * drilled into — a Meta id, digits only, so nothing but an id reaches SQL.
 */
export const roistatOverviewQuerySchema = periodQuerySchema.and(
  z.object({
    dim: z.enum(ROISTAT_DIMS).default('camp'),
    brand: brandFilter,
    parent: z
      .string()
      .trim()
      .regex(/^\d{1,30}$/)
      .optional(),
  }),
)
