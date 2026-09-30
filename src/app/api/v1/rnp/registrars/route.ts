import { z } from 'zod'

import { can } from '@/server/auth/rbac'
import { REGISTRATION_GROUPS } from '@/server/domain/rnp/rnpSheet'
import { ApiError } from '@/server/http/errors'
import { mutationHandler } from '@/server/http/handler'
import { rnpService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who may regroup registrars — the same two conditions as the plans form:
 * `analytics:read:all` at the gate, `kpi:manage` inside.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'rnp' } as const

const GROUPS = [...REGISTRATION_GROUPS] as [string, ...string[]]

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
  rows: z
    .array(
      z.object({
        /** The «Регистрация» label as Bitrix24 spells it. */
        registrar: z.string().trim().min(1).max(100),
        /** One of the sheet's groups; null takes the registrar out of every group. */
        group: z.enum(GROUPS).nullable(),
      }),
    )
    .min(1)
    .max(100),
})

/** Save the month's registrar → «guruh» assignments of «RNP jadvali». */
export const POST = mutationHandler(ACCESS, bodySchema, async (ctx) => {
  if (!can(ctx.principal, 'kpi:manage')) throw ApiError.forbidden('Guruhlarni faqat administrator oʻzgartira oladi.')
  await rnpService.saveRegistrarGroups(ctx.body.month, ctx.body.rows, ctx.principal.userId)
  return { data: { saved: true } }
})
