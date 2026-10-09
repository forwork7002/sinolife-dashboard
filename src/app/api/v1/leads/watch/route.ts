import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { leadWatchService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * COMPANY-WIDE, like the rest of «Lidlar». The watch is about leads nobody
 * has taken yet — no ROP, no call, no answer — so there is no team to narrow
 * them by, and a ROP is refused rather than answered with the company.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/**
 * «Лид назорати» — what is waiting right now: seven checks over today's
 * Регистрация leads, the open chats and the day's calls, and the working
 * day's intake by hour. See leadWatchService.ts.
 *
 * NO PARAMETERS. Always today in the app's time zone, every brand: the page
 * filters the rows it was sent, and a hand-typed `?preset=` is ignored
 * rather than answered with a 400.
 */
export const GET = getHandler(ACCESS, z.object({}), async (ctx) => {
  const data = await leadWatchService.watch(ctx.now, ctx.timeZone)
  return { data }
})
