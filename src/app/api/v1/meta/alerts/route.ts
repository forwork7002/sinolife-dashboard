import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { alertsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The header's three facts: how fresh, what is waiting, what is wrong.
 *
 * `section: null` because the header is on every screen. Not a hole: the
 * service gates the queue count and the marketing warning on the sections
 * the caller actually holds, so an account barred from the queue gets no
 * bell rather than a number it may not open.
 */
const ACCESS = { permission: 'analytics:read:own', section: null } as const

export const GET = getHandler(ACCESS, z.object({}), async (ctx) => ({
  data: await alertsService.load(ctx.principal, ctx.now, ctx.timeZone),
}))
