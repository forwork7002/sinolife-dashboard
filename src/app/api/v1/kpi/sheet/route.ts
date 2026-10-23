import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { sverkaService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like «Sverka» whose deals these are: MoySklad's half carries
 * no employee of ours to narrow by, so a narrowed account is refused rather
 * than answered with the company.
 *
 * Gated on «Sverka»'s section, as `/kpi/days` and `/kpi/products` are and for
 * their reason: the sheet is those two cards (and «Нутрицолог») a column per
 * day — every team's soʻm and pieces — so it reaches exactly the accounts
 * `/sverka/overview` already answers.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'sverka' } as const

const querySchema = z.object({
  /**
   * `YYYY-MM`. A calendar month by construction, like «RNP jadvali». Bounded
   * below by MoySklad's first month (`MOYSKLAD_DATA_FLOOR`, June 2026): a
   * month before it would be Bitrix24 beside nothing.
   */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
    .refine((m) => m >= '2026-06' && m <= '2100-12', 'Month out of range'),
})

/**
 * «KPI jadvali» — «Нутрицолог», «Tovarlar» and «Kunlar boʻyicha» for one
 * calendar month, Bitrix24 against MoySklad, a column per day. See kpiSheet.ts.
 */
export const GET = getHandler(ACCESS, querySchema, async (ctx) => {
  const data = await sverkaService.sheet(ctx.query.month, ctx.timeZone, ctx.now)
  return { data }
})
