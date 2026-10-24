import { z } from 'zod'

import { realDay } from '@/app/api/v1/registration/schema'
import { RNP_COST_LINES, RNP_COST_PROJECTS } from '@/server/domain/rnp/rnpSheet'

/*
  The body of `POST /api/v1/rnp/costs`, kept beside the route (a route file
  may export only its handlers) so its rules can be tested.
*/

export const costsBodySchema = z
  .object({
    // Bounded as `/rnp/overview`, the plans and the headcount are: a cost for 1990 is a script's slip, not a cost.
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
      .refine((m) => m >= '2025-01' && m <= '2100-12', 'Month out of range'),
    cells: z
      .array(
        z.object({
          // A real calendar day of `month` — the month is checked below.
          day: realDay,
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

