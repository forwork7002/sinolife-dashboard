import { z } from 'zod'

import { LEAD_PIPELINES } from '@/server/domain/leadCohort/leadCohort'
import { brandFilter } from '@/server/http/queryParams'

import { realDay } from '../../registration/schema'

/*
  The query of `/api/v1/lead-cohort/overview`, kept beside the route (a route
  file may export only its handlers) so its rules can be tested.
*/

/*
  A REAL CALENDAR DAY, `realDay` (2026-10-06 audit): «2026-00-99» passed the
  old pattern and `leadCohortWindow`'s day arithmetic threw on it — a 500 and
  an error log where a 400 is right. No range, unlike `registration/schema`'s
  `calendarDay`: the date box sends every keystroke of a typed year (0002 →
  0020 → 0202 …), a refused one would put the error card in place of the
  whole tab, filters included, and the service already clamps any real day
  into a window from 2025-01-01 to today (`leadCohortWindow`).
*/
export const overviewQuerySchema = z.object({
  /** First arrival day, `YYYY-MM-DD`. Defaults to 13 days before `to`. */
  from: realDay.optional(),
  /** Last arrival day, `YYYY-MM-DD`. Defaults to today; never later. */
  to: realDay.optional(),
  /** Comma-separated CATEGORY_IDs out of 12, 4, 6. Defaults to all three. */
  pipelines: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return [...LEAD_PIPELINES]
      const ids = v.split(',').map(Number)
      if (ids.some((id) => !(LEAD_PIPELINES as readonly number[]).includes(id))) {
        ctx.addIssue({ code: 'custom', message: `pipelines: only ${LEAD_PIPELINES.join(', ')}` })
        return z.NEVER
      }
      return [...new Set(ids)]
    }),
  /** An employee id — the ROP the leads were routed to. */
  rop: z.string().min(1).max(64).optional(),
  /** The Collagen / Zextra switch. */
  brand: brandFilter,
})
