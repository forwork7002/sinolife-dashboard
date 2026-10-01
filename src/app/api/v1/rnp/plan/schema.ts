import { z } from 'zod'

import { RNP_PLAN_METRICS } from '@/server/domain/rnp/rnpSheet'

/*
  The body of `POST /api/v1/rnp/plan`, kept beside the route (a route file
  may export only its handlers) so its rules can be tested.
*/

export const planBodySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
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
          .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most two decimals')
          .nullable(),
      }),
    )
    .min(1)
    .max(500),
})
