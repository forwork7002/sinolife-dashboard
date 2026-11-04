import { z } from 'zod'

import { canControlAi } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { getHandler, mutationHandler } from '@/server/http/handler'
import { controlWriteSchema } from '@/server/integrations/aiRegistrator/control'
import { aiRegistratorControlService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, the screen it lives in — and on
 * top of both, the accounts the owner named (adminjon, umida — the list is
 * `auth/aiControl.ts`). Everyone else who holds «AI registrator» reads the
 * report and gets 403 here, an administrator included.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'airegistrator' } as const

function assertAiControl(principal: Parameters<typeof canControlAi>[0]): void {
  if (!canControlAi(principal)) throw ApiError.forbidden('AI registrator boshqaruvi faqat egasi belgilagan hisoblarga ochiq.')
}

/**
 * «AI registrator → Boshqaruv»: the saved settings, the agent's last report
 * (stale after ninety seconds), the extensions' names and the audit of saves.
 * `?part=live` is the page's 5 s poll — the last report alone, one row read.
 */
export const GET = getHandler(ACCESS, z.object({ part: z.enum(['live']).optional() }), async (ctx) => {
  assertAiControl(ctx.principal)
  return {
    data: ctx.query.part === 'live' ? await aiRegistratorControlService.live(ctx.now) : await aiRegistratorControlService.panel(ctx.now),
  }
})

/**
 * «Saqlash» — the next version, its audit row; the agent picks it up on its
 * next read. `{ baseVersion, enabled }` alone is «Toʻxtatish» / «Yoqish»: the
 * next version with only the stop changed. A whole save never carries it, so
 * the stored state stays whatever «Saqlash» changes.
 */
export const POST = mutationHandler(ACCESS, controlWriteSchema, async (ctx) => {
  assertAiControl(ctx.principal)
  const by = { label: ctx.principal.login ?? ctx.principal.userId, userId: ctx.principal.userId }
  const body = ctx.body
  const data = 'enabled' in body ? await aiRegistratorControlService.setEnabled(body, by) : await aiRegistratorControlService.save(body, by)
  return { data }
})
