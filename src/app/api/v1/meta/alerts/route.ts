import { z } from 'zod'

import { widenForSection } from '@/server/auth/rbac'
import { getHandler } from '@/server/http/handler'
import { alertsService, scopeService } from '@/server/services/container'

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
  /*
    The scope here only cuts the bell, which counts the Tasdiqlash backlog —
    so it is the scope THAT SCREEN reads. A ROP given «Butun kompaniya» on
    Tasdiqlash sees the company's queue behind the link; a bell counting their
    team's would describe a different set of rows from the page it opens.
  */
  data: await alertsService.load(
    ctx.principal,
    await scopeService.resolve(widenForSection(ctx.principal, 'confirmation')),
    ctx.now,
    ctx.timeZone,
  ),
}))
