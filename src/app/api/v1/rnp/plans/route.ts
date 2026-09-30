import { z } from 'zod'

import { RNP_PLAN_METRICS, SETTING_LEAD_VALUE } from '@/server/domain/rnp/rnpSheet'
import { can } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who may change a plan — the same two conditions as «Sotuv · ROP»'s form:
 * `analytics:read:all` at the gate (the plans are every team's), and
 * `kpi:manage` inside (administrators and managers only).
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/**
 * A figure as the form types it, in the row's own unit (soʻm, dollars,
 * percent or a count), up to two decimals; null removes the plan.
 */
const figure = z.number().min(0).max(1_000_000_000_000).nullable()
const som = z.number().int().min(0).max(1_000_000_000_000).nullable()

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
  rows: z
    .array(
      z.object({
        team: z.string().trim().max(200),
        /** Only the plan keys the sheet reads (RNP_PLAN_METRICS). */
        metric: z.string().max(64).refine((k) => (RNP_PLAN_METRICS as readonly string[]).includes(k), 'Unknown plan key'),
        fromDay: z.number().int().min(1).max(31),
        value: figure,
      }),
    )
    .max(2000)
    /*
      One home per figure. A team's FAKT 1 / FAKT 2 plan lives in
      team_month_plan (shared with «Sotuv · ROP») and arrives in `fakt`; a
      copy in rnp_plan would be a second plan the other screen never sees.
      Only a lead's value changes mid-month — every other row starts on day 1.
    */
    .superRefine((rows, ctx) => {
      rows.forEach((r, i) => {
        const problem =
          (r.metric === 'fakt1' || r.metric === 'fakt2') && r.team !== ''
            ? 'A team FAKT plan belongs in `fakt`'
            : r.metric !== SETTING_LEAD_VALUE && r.fromDay !== 1
              ? 'Only a lead value may start after day 1'
              : null
        if (problem) ctx.addIssue({ code: 'custom', message: problem, path: [i] })
      })
    }),
  fakt: z
    .array(z.object({ rop: z.string().trim().min(1).max(200), fakt1: som, fakt2: som }))
    .max(200),
})

const centi = (v: number | null) => (v === null ? null : BigInt(Math.round(v * 100)))

/** Save one month's plans and settings — the «Rejalar» form on «RNP jadvali». */
export const POST = mutationHandler(ACCESS, bodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Rejalarni faqat administrator oʻzgartira oladi.')
  await rnpService.savePlans(
    ctx.body.month,
    {
      rows: ctx.body.rows.map((r) => ({ team: r.team, metric: r.metric, fromDay: r.fromDay, valueCenti: centi(r.value) })),
      fakt: ctx.body.fakt.map((t) => ({ rop: t.rop, fakt1Minor: centi(t.fakt1), fakt2Minor: centi(t.fakt2) })),
    },
    ctx.principal.userId,
  )
  return { data: { saved: true } }
})
