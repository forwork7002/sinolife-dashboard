import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { aiRegistratorControlService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screen it feeds — the
 * same as the report beside it. NOT the named accounts of «Boshqaruv»: this
 * reads what the agent does now, it changes nothing.
 *
 * «AI registrator → Hozir · jonli» (2026-11-02, the owner's design canvas: the
 * live lanes head the report). The agent's last report alone, one row by its
 * key — the page's 5 s poll while the tab is in view. Its seller names come
 * with the report; the roster join stays in «Boshqaruv»'s minute read.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'airegistrator' } as const

export const GET = getHandler(ACCESS, z.object({}), async (ctx) => ({
  data: await aiRegistratorControlService.live(ctx.now),
}))
