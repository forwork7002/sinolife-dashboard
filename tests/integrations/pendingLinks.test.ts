import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import { UF } from '@/server/integrations/crm/bitrix24/mapping'
import { applyLabelRenames } from '@/server/integrations/crm/sync/labelRenames'
import { repairPendingLinks } from '@/server/integrations/crm/sync/pendingLinks'

function recorder() {
  const sql: { text: string; args: unknown[] }[] = []
  const deleted: unknown[] = []
  const prisma = {
    $executeRawUnsafe: async (text: string, ...args: unknown[]) => {
      sql.push({ text, args })
      return text.trimStart().startsWith('UPDATE') ? 2 : 0
    },
    dealPendingLink: {
      deleteMany: async (args: unknown) => {
        deleted.push(args)
        return { count: 1 }
      },
      count: async () => 3,
    },
  } as unknown as PrismaClient
  return { prisma, sql, deleted }
}

describe('repairPendingLinks — a deal written before its source or ROP arrived (2026-10-22)', () => {
  it('fills each optional column only where it is still NULL, from the table its id lives in', async () => {
    const { prisma, sql } = recorder()
    const r = await repairPendingLinks(prisma, new Date('2026-10-22T12:00:00Z'))

    const updates = sql.filter((q) => q.text.includes('UPDATE'))
    expect(updates.map((q) => q.args[0])).toEqual(['sourceId', 'leadRopEmployeeId', 'ropKvalLidEmployeeId', 'createdByEmployeeId'])
    expect(updates[0]!.text).toContain('JOIN "sales_source" r')
    expect(updates[1]!.text).toContain('JOIN "employee" r')
    expect(updates.every((q) => /d\."\w+" IS NULL/.test(q.text))).toBe(true)
    expect(r).toEqual({ filled: 8, dropped: 1, waiting: 3 })
  })

  it('gives up on an id that has not arrived in a week', async () => {
    const { prisma, deleted } = recorder()
    await repairPendingLinks(prisma, new Date('2026-10-22T12:00:00Z'))
    expect(deleted).toEqual([{ where: { createdAt: { lt: new Date('2026-10-15T12:00:00Z') } } }])
  })
})

describe('applyLabelRenames — a renamed dropdown item follows onto the stored deals', () => {
  it('rewrites the column that holds that field\'s label', async () => {
    const { prisma, sql } = recorder()
    const changed = await applyLabelRenames(prisma, [
      { field: UF.TARGETOLOG, from: 'Timur', to: 'Timur (Zextra)' },
      { field: UF.REGION, from: 'Ташкент', to: 'Ташкент г.' },
    ])
    expect(changed).toBe(4)
    expect(sql.map((q) => [q.text, q.args])).toEqual([
      ['UPDATE "deal" SET "targetolog" = $1, "updatedAt" = now() WHERE "targetolog" = $2', ['Timur (Zextra)', 'Timur']],
      ['UPDATE "deal" SET "region" = $1, "updatedAt" = now() WHERE "region" = $2', ['Ташкент г.', 'Ташкент']],
    ])
  })

  it('leaves a field read into an enum alone — a rename there is a mapping change', async () => {
    const { prisma, sql } = recorder()
    expect(await applyLabelRenames(prisma, [{ field: UF.CONFIRM_STATUS, from: 'a', to: 'b' }])).toBe(0)
    expect(sql).toEqual([])
  })
})
