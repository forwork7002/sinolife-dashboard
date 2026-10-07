import { z } from 'zod'

import { calendarDay } from '@/app/api/v1/rnp/costs/schema'
import { MANUAL_SPEND_CHANNELS, MANUAL_SPEND_PROJECTS } from '@/server/domain/reklama/manualSpend'

/*
  The body of `POST /api/v1/reklama/manual-spend`, kept beside the route (a
  route file may export only its handlers) so its rules can be tested.
*/

/** One day's dollars, to the cent — the sheet writes «390,6$»; a million a day is far beyond any channel. */
const usd = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most two decimals')

export const manualSpendBodySchema = z.object({
  cells: z
    .array(
      z.object({
        // Bounded as RNP's typed cells are: a day in 1990 is a script's slip, not a cost.
        day: calendarDay.refine((d) => d >= '2025-01-01', 'Day out of range'),
        project: z.enum(MANUAL_SPEND_PROJECTS),
        channel: z.enum(MANUAL_SPEND_CHANNELS),
        /** Dollars; null clears the cell. */
        value: usd.nullable(),
      }),
    )
    .min(1)
    .max(500),
})

export type ManualSpendBody = z.infer<typeof manualSpendBodySchema>
