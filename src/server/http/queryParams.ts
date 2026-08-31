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
import {
  CONFIRMATION_ORDER_SORTS,
  CONFIRMATION_OUTCOMES,
  DEAL_STATUSES,
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

/** A calendar date, `YYYY-MM-DD`, interpreted in the app timezone downstream. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), 'Not a valid calendar date')

export const periodQuerySchema = z
  .object({
    preset: z.enum(PERIOD_PRESETS).default('this_month'),
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
  })

export const filterQuerySchema = z.object({
  employeeIds: idList,
  departmentIds: idList,
  stageIds: idList,
  productIds: idList,
  sourceIds: idList,
  status: z.enum(DEAL_STATUSES).optional(),
  /** Free-text search. Bounded so it cannot become a scan of arbitrary length. */
  q: z.string().trim().min(1).max(120).optional(),
  /**
   * FILIAL — the branch scope, and the one filter with a non-empty default.
   *
   * Absent means DEFAULT_BRANCH (Навоий), not "everything": this product's
   * default reality is one branch, and a link that loses a query parameter must
   * not quietly widen to a company total while the page still says "Навоий
   * filiali". `filial=all` is how a caller asks for every branch, on purpose
   * and in the URL where it is visible and shareable.
   *
   * Only the SHAPE is checked here. Whether the name exists is a question about
   * the live department tree, which this schema cannot reach — the resolver
   * answers it (`ReferenceRepository.resolveBranchScope`) and an unknown name
   * comes back as a 400 listing the branches that do exist. Validating it here
   * against a hardcoded list would be a second copy of the org chart.
   */
  filial: z.string().trim().min(1).max(64).optional(),
})

/** Columns a client may sort by. An allowlist, never the raw parameter. */
export const DEAL_SORT_FIELDS = [
  'createdAtSource',
  'closedAt',
  'amountMinor',
  'title',
  'status',
] as const

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  // Capped: without an upper bound, one request could pull the whole table.
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(DEAL_SORT_FIELDS).default('createdAtSource'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export const analyticsQuerySchema = periodQuerySchema.and(filterQuerySchema)

export const dealsQuerySchema = periodQuerySchema
  .and(filterQuerySchema)
  .and(paginationQuerySchema)

/**
 * The confirmation queue's own page contract.
 *
 * It cannot ride `paginationQuerySchema`: that one's sort allowlist is the
 * deal table's columns, and this list is ordered by when an order entered the
 * queue — a column no deal query has.
 */
export const confirmationOrdersQuerySchema = periodQuerySchema
  .and(filterQuerySchema)
  .and(
    z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(25),
      sort: z.enum(CONFIRMATION_ORDER_SORTS).default('movedAt'),
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
      /** A single ROP group by name. Bounded: it reaches SQL as a parameter. */
      rop: z.string().trim().min(1).max(64).optional(),
    }),
  )

export type PeriodQuery = z.infer<typeof periodQuerySchema>
export type FilterQuery = z.infer<typeof filterQuerySchema>
export type PaginationQuery = z.infer<typeof paginationQuerySchema>
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>
export type DealsQuery = z.infer<typeof dealsQuerySchema>
export type ConfirmationOrdersQuery = z.infer<typeof confirmationOrdersQuerySchema>

/** Flatten URLSearchParams to a plain object, keeping the last value per key. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of params.entries()) result[key] = value
  return result
}
