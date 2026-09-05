import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { alertsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The header's two facts: how fresh the numbers are, and what is waiting.
 *
 * `section: null` because the header is on every screen. Not a hole: the
 * service gates the queue count on the section the caller actually holds, so
 * an account barred from the queue gets no bell rather than a number it may
 * not open.
 */
const ACCESS = { permission: 'analytics:read:own', section: null } as const

export const GET = getHandler(ACCESS, z.object({}), async (ctx) => ({
  data: await alertsService.load(ctx.principal, ctx.scope, ctx.now, ctx.timeZone),
}))
