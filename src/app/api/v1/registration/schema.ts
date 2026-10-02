import { z } from 'zod'

import { INTAKE_GROUPS } from '@/server/domain/registration/groupIntake'
import { SHARE_TOTAL_BP } from '@/server/domain/registration/leadSplit'

/*
  The query and body of `/api/v1/registration/*`, kept beside the routes (a
  route file may export only its handlers) so their rules can be tested.
*/

/** A real calendar day, `YYYY-MM-DD`, inside the portal's years — «2026-02-30» is refused, not rolled over. */
export const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`)
    // «2026-99-99» is an Invalid Date, and toISOString would throw — a 400, not a 500.
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d
  }, 'Not a calendar day')
  .refine((d) => d >= '2025-01-01' && d <= '2100-12-31', 'Day out of range')

export const overviewQuerySchema = z.object({
  /** Omitted: today, on the Tashkent calendar. */
  day: calendarDay.optional(),
})

export const splitBodySchema = z.object({
  day: calendarDay,
  rows: z
    .array(
      z.object({
        /** A team as `ropNameSql` names it: letters, digits, spaces and a little punctuation. */
        rop: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[\p{L}\p{N} ._()'ʼ‘’-]+$/u, 'Not a team name'),
        /** Basis points: 15 % = 1 500. */
        shareBp: z.number().int().min(0).max(SHARE_TOTAL_BP),
      }),
    )
    .min(1)
    .max(40),
})

/** The most leads one group can take in a day — far past any real day (the portal's busiest is ~1 200 in all). */
export const MAX_GROUP_INTAKE = 100_000

export const groupIntakeBodySchema = z.object({
  day: calendarDay,
  rows: z
    .array(
      z.object({
        group: z.enum(INTAKE_GROUPS),
        /** Null removes the typed number. */
        leads: z.number().int().min(0).max(MAX_GROUP_INTAKE).nullable(),
      }),
    )
    .min(1)
    .max(INTAKE_GROUPS.length)
    .refine((rows) => new Set(rows.map((r) => r.group)).size === rows.length, 'A group is sent twice'),
})
