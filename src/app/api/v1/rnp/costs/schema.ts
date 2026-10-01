import { z } from 'zod'

import { RNP_COST_LINES, RNP_COST_PROJECTS } from '@/server/domain/rnp/rnpSheet'

/*
  The body of `POST /api/v1/rnp/costs`, kept beside the route (a route file
  may export only its handlers) so its rules can be tested.
*/

/** A real calendar day of `month`, `YYYY-MM-DD` — «2026-02-30» is refused, not rolled over. */
export const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`)
    // «2026-99-99» is an Invalid Date, and toISOString would throw — a 400, not a 500.
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d
  }, 'Not a calendar day')

export const costsBodySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
    cells: z
      .array(
        z.object({
          day: calendarDay,
          project: z.enum(RNP_COST_PROJECTS),
          line: z.enum(RNP_COST_LINES),
          /** Whole soʻm; null clears the cell. A trillion is far beyond any one day's cost. */
          value: z.number().int().min(0).max(1_000_000_000_000).nullable(),
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((body, ctx) => {
    body.cells.forEach((c, i) => {
      if (!c.day.startsWith(`${body.month}-`)) ctx.addIssue({ code: 'custom', message: 'The day is not in the month', path: ['cells', i, 'day'] })
    })
  })

