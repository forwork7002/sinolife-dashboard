import { z } from 'zod'

import { canControlAi } from '@/server/auth/rbac'
import { ApiError } from '@/server/http/errors'
import { getHandler, mutationHandler } from '@/server/http/handler'
import { controlSaveSchema } from '@/server/integrations/aiRegistrator/control'
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
 * (stale after two minutes), the extensions' names and the audit of saves.
 */
export const GET = getHandler(ACCESS, z.object({}), async (ctx) => {
  assertAiControl(ctx.principal)
  return { data: await aiRegistratorControlService.panel(ctx.now) }
})

/** «Saqlash» — the next version, its audit row; the agent picks it up on its next read. */
export const POST = mutationHandler(ACCESS, controlSaveSchema, async (ctx) => {
  assertAiControl(ctx.principal)
  const data = await aiRegistratorControlService.save(ctx.body, {
    label: ctx.principal.login ?? ctx.principal.userId,
    userId: ctx.principal.userId,
  })
  return { data }
})
