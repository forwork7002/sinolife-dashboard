import { z } from 'zod'

import { calendarDay } from '../costs/schema'

/*
  The body of `POST /api/v1/rnp/headcount`, kept beside the route (a route
  file may export only its handlers) so its rules can be tested.
*/

export const headcountBodySchema = z
  .object({
    // Bounded as `/rnp/overview` is: each month a save names is built in full to check its teams.
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
      .refine((m) => m >= '2025-01' && m <= '2100-12', 'Month out of range'),
    cells: z
      .array(
        z.object({
          day: calendarDay,
          /** The team as the sheet's ROP block names it (`team:<rop>`). */
          rop: z.string().trim().min(1).max(100),
          /** Whole people; null clears the day. A thousand is far beyond any one team. */
          value: z.number().int().min(0).max(1000).nullable(),
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
