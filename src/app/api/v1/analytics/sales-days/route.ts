import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { z } from 'zod'

import { brandFilter, periodQuerySchema } from '@/server/http/queryParams'
import { roistatService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, as `/roistat/overview` is: Meta spend carries no employee,
 * so a ROP is refused rather than answered with the company; the screen
 * hides the block for a narrowed account. Section `sales`, not `roistat` —
 * Savdo dinamikasi draws it.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'sales' } as const

/**
 * «Kunlar boʻyicha» on Savdo dinamikasi: Roistat's «Дни» cut, the same rows
 * and counters (`RoistatService.days`). The window only — the page's
 * employee, department and source filters do not reach Meta money.
 */
// The Collagen / Zextra switch: Roistat's own brand rule (`RoistatService.days`).
const schema = periodQuerySchema.and(z.object({ brand: brandFilter }))

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await roistatService.days(period, ctx.now, ctx.query.brand)
  return { data, meta: { period: toPeriodDto(period) } }
})
