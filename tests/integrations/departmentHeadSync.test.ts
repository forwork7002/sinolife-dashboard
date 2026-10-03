import { describe, expect, it } from 'vitest'

import type { RawDepartment } from '@/server/integrations/crm/CrmProvider'
import { createSyncHandlers } from '@/server/integrations/crm/sync/handlers'

/*
  A HEAD THE PORTAL CLEARS IS CLEARED HERE TOO (2026-10-02).

  The department pass only ever SET a head: «Saida(ROP)» kept Shohjaxon after
  the portal emptied its UF_HEAD, and every lead naming him was filed under the
  «Саида РОП» the client had removed. A head the portal does name is still
  linked after the employee pass (the person must exist first), so the
  department pass writes nothing about it.
*/
function fakes() {
  const upserts: { externalId: string; create: Record<string, unknown>; update: Record<string, unknown> }[] = []
  const prisma = {
    department: {
      findMany: async () => [],
      upsert: async (args: { where: { externalSource_externalId: { externalId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        upserts.push({ externalId: args.where.externalSource_externalId.externalId, create: args.create, update: args.update })
        return {}
      },
      update: async () => ({}),
    },
  }
  const resolver = { invalidate: () => {}, optional: async () => undefined }
  return { prisma, resolver, upserts }
}

describe('the department pass', () => {
  it('clears a head the portal no longer names, and leaves a named one to the employee pass', async () => {
    const { prisma, resolver, upserts } = fakes()
    const departments = createSyncHandlers(prisma as never, 'BITRIX24', resolver as never).find((h) => h.entity === 'DEPARTMENTS')!
    const batch: RawDepartment[] = [
      { externalId: '78', name: 'Saida(ROP)', isActive: true },
      { externalId: '76', name: 'Shohjaxon(ROP)', isActive: true, headExternalId: '68210' },
    ]
    await departments.persist(batch)

    const saida = upserts.find((u) => u.externalId === '78')!
    const shohjaxon = upserts.find((u) => u.externalId === '76')!
    expect(saida.update).toMatchObject({ name: 'Saida(ROP)', headId: null })
    expect(shohjaxon.update).not.toHaveProperty('headId')
    // A new department starts with no head either way; the employee pass links a named one.
    expect(saida.create).not.toHaveProperty('headId')
    expect(shohjaxon.create).not.toHaveProperty('headId')
  })
})
