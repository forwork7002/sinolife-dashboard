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

import { PERIOD_PRESETS } from '@/server/domain/period/period'
import { ROISTAT_DIMS } from '@/server/domain/roistat/roistatCuts'
import {
  BRAND_FILTERS,
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

/**
 * A calendar date, `YYYY-MM-DD`, interpreted in the app timezone downstream.
 *
 * «2026-02-30» is refused, not rolled over: `Date` turns it into 2 March, and
 * a reused leap-day link answered 1 March's numbers with a 200 under a picker
 * that said 29.02. The string has to come back unchanged from its own date —
 * the check `registration/schema.ts` and `rnp/costs/schema.ts` already make.
 *
 * BOTH CHECKS ABORT. A failed check is continuable in zod 4: the transform is
 * skipped, but `periodQuerySchema`'s `superRefine` still ran — on the raw
 * string — and its `.getTime()` threw a TypeError, which the handler answers as
 * a 500 and logs as a fault, for a typo in a pasted link («2026-9-01»).
 * Aborting skips the object's refinement, so the answer is the field's 400.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Expected a date in YYYY-MM-DD format', abort: true })
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    },
    { error: 'Not a valid calendar date', abort: true },
  )
  .transform((value) => new Date(`${value}T00:00:00.000Z`))

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

/** Free text reaching a WHERE clause: trimmed, bounded, empty means absent. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined))

const filterQuerySchema = z.object({
  employeeIds: idList,
  departmentIds: idList,
  stageIds: idList,
  productIds: idList,
  sourceIds: idList,
  status: z.enum(DEAL_STATUSES).optional(),
  /**
   * Free-text search. Bounded so it cannot become a scan of arbitrary length.
   *
   * A term of nothing but spaces is NO term, not a bad one: it was `min(1)`
   * after the trim, so a space typed into Тасдиклаш's box and left for the
   * debounce answered 400 on every request of the page — the table, all six
   * tiles and the region list — until the box was cleared.
   */
  q: optionalText(120),
})

export const analyticsQuerySchema = periodQuerySchema.and(filterQuerySchema)

/**
 * «Sotuvchilar oyligi» — the dashboard's window (2026-10-17), but AT MOST A
 * MONTH. The window's length picks the pay table and the month's is the
 * longest; a quarter or a year read by it would pay one fiksa and one ROP
 * oklad over many months and print it as somebody's salary. So «Shu yil» and
 * a range over `PAYROLL_MAX_DAYS` are a 400, never a figure.
 */
export const PAYROLL_MAX_DAYS = 31

export const payrollQuerySchema = periodQuerySchema.superRefine((value, ctx) => {
  if (value.preset === 'this_year') {
    ctx.addIssue({ code: 'custom', path: ['preset'], message: 'A payroll is at most a month' })
  }
  if (
    value.preset === 'custom' &&
    value.from &&
    value.to &&
    Math.round((value.to.getTime() - value.from.getTime()) / 86_400_000) + 1 > PAYROLL_MAX_DAYS
  ) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `At most ${PAYROLL_MAX_DAYS} days` })
  }
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
 * The brand switch every main screen carries (`?brand=`, `BRAND_FILTERS`):
 * both, one, or «Brendsiz». A lead is filed by RNP's `leadBrand`, a sale by
 * the product it was paid for (`saleBrand`; its team only with no line
 * item), Meta money by `adBudgetProduct`.
 */
export const brandFilter = z.enum(BRAND_FILTERS).default('all')

/** «Reklama samarasi»: the window and the brand switch. */
export const reklamaOverviewQuerySchema = periodQuerySchema.and(z.object({ brand: brandFilter }))

export const targetOverviewQuerySchema = periodQuerySchema.and(
  z.object({ scope: targetScope, product: targetProduct }),
)

/** «Target tahlili»'s DM sheet: the window and the product switch. */
export const targetDmQuerySchema = periodQuerySchema.and(z.object({ product: targetProduct }))

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
