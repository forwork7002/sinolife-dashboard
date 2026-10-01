import { z } from 'zod'

import { RNP_PLAN_METRICS } from '@/server/domain/rnp/rnpSheet'

/*
  The body of `POST /api/v1/rnp/plan`, kept beside the route (a route file
  may export only its handlers) so its rules can be tested.
*/

export const planBodySchema = z.object({
  // Bounded as `/rnp/overview` is: each month a save names is built in full to check its cells.
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
    .refine((m) => m >= '2025-01' && m <= '2100-12', 'Month out of range'),
  cells: z
    .array(
      z.object({
        /** The team ('' = company-wide, or a brand / registration group), as the row's `planInput` names it. */
        team: z.string().trim().max(100),
        metric: z.enum(RNP_PLAN_METRICS),
        /** In the row's own unit (soʻm, dollars, percent, a count), up to two decimals; null clears the plan. */
        value: z
          .number()
          .min(0)
          .max(1_000_000_000_000)
          // Relative to the value: a float's error grows with it, and 123 456 789 012,34 is two decimals.
          .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6 * Math.max(1, v * 100), 'At most two decimals')
          .nullable(),
      }),
    )
    .min(1)
    // The grid saves one cell at a time; a few dozen is room for a script, not for a flood.
    .max(50),
})
