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
 * next read. Every other control is its own body, the next version with only
 * that changed, so «Saqlash» never carries them and each stays as it was:
 * `{ baseVersion, enabled }` «Toʻxtatish» / «Yoqish», `{ baseVersion, hours }`
 * «Ish vaqti», `{ baseVersion, pauseUntil }` «Vaqtincha toʻxtatish» /
 * «Davom ettirish», `{ baseVersion, linesOff }` an AI line on / off,
 * `{ baseVersion, tuning }` «Qoʻshimcha sozlamalar». `{ action }` is a press
 * («Qayta ulash», «TLSʼni yangilash») — no version: a row the agent does once.
 */
export const POST = mutationHandler(ACCESS, controlWriteSchema, async (ctx) => {
  assertAiControl(ctx.principal)
  const by = { label: ctx.principal.login ?? ctx.principal.userId, userId: ctx.principal.userId }
  const body = ctx.body
  const service = aiRegistratorControlService
  if ('action' in body) return { data: await service.requestAction(body, by, ctx.now) }
  if ('enabled' in body) return { data: await service.setEnabled(body, by) }
  if ('hours' in body) return { data: await service.setHours(body, by) }
  if ('pauseUntil' in body) return { data: await service.setPause(body, by, ctx.now) }
  if ('linesOff' in body) return { data: await service.setLinesOff(body, by) }
  if ('tuning' in body) return { data: await service.setTuning(body, by) }
  return { data: await service.save(body, by) }
})
