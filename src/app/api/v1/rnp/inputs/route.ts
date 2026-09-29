import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { RNP_MANUAL_METRICS } from '@/server/domain/rnp/rnpSheet'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who may type a day cell — the same two conditions as the plans form:
 * `analytics:read:all` at the gate (the sheet is every team's), and
 * `kpi:manage` inside (administrators and managers only).
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

/**
 * A real calendar day, 2026 onwards. `new Date('2026-09-31')` is 1 October, so
 * a day that does not round-trip would upsert — or with null, delete — a
 * NEIGHBOURING day's cell; it is refused instead.
 */
const day = z
  .string()
  .regex(/^20(2[6-9]|[3-9]\d)-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`)
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d
  }, 'Not a calendar day')

/** Rows typed for the company as a whole; every other metric belongs to a team or a group. */
const COMPANY_METRICS: ReadonlySet<string> = new Set(
  RNP_MANUAL_METRICS.filter((m) => /^(ig_|tg_|hr_)/.test(m) || m === 'reg_zextra_leads'),
)
/** A Telegram channel's net change is the one figure that can be below zero. */
const SIGNED_METRICS: ReadonlySet<string> = new Set(['tg_subscribers', 'tg_subscribers_gummy'])

const bodySchema = z.object({
  rows: z
    .array(
      z
        .object({
          day,
          team: z.string().trim().max(200),
          /** Only the rows the sheet types — see RNP_MANUAL_METRICS. */
          metric: z.enum(RNP_MANUAL_METRICS),
          /** The figure in the row's unit, up to two decimals. Null clears the cell. */
          value: z.number().min(-1_000_000_000).max(1_000_000_000_000).nullable(),
        })
        .superRefine((r, ctx) => {
          if (COMPANY_METRICS.has(r.metric) !== (r.team === '')) {
            ctx.addIssue({ code: 'custom', path: ['team'], message: 'This row belongs to the company or to one team, not both' })
          }
          if (r.value !== null && r.value < 0 && !SIGNED_METRICS.has(r.metric)) {
            ctx.addIssue({ code: 'custom', path: ['value'], message: 'Only a subscriber change may be negative' })
          }
        }),
    )
    .min(1)
    .max(400),
})

const centi = (v: number | null) => (v === null ? null : BigInt(Math.round(v * 100)))

/** Save typed day cells of «RNP jadvali». Null clears a cell. */
export const POST = mutationHandler(ACCESS, bodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Kataklarni faqat administrator oʻzgartira oladi.')
  await rnpService.saveManualDays(
    ctx.body.rows.map((r) => ({ day: r.day, team: r.team, metric: r.metric, valueCenti: centi(r.value) })),
    ctx.principal.userId,
  )
  return { data: { saved: true } }
})
