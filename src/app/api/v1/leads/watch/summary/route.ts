import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { leadWatchService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * The same gate as `/leads/watch`, because it is the same answer: an account
 * that cannot open the watch gets no count of what is on it either.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'leads' } as const

/**
 * How many of «Лид назорати»'s cards are red — for the sidebar badge and the
 * tab title, which every page of the shell draws. Read from the SAME memoised
 * snapshot as `/leads/watch`, so the badge cannot disagree with the page it
 * leads to, and a tab that only shows the badge costs no build of its own.
 */
export const GET = getHandler(ACCESS, z.object({}), async (ctx) => {
  const data = await leadWatchService.summary(ctx.now, ctx.timeZone)
  return { data }
})
