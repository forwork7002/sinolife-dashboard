import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { relinkDealContacts, relinkLimit } from '@/server/integrations/crm/sync/contactRelink'

/**
 * Merged contacts in Bitrix24 move deals without bumping their DATE_MODIFY, so
 * the daily sweep's walk carries CONTACT_ID and re-points the deals that moved.
 * The walk must never read as «every deal lost its contact», and a pass that
 * would re-point most of the table must write nothing.
 */

/** A portal whose `crm.deal.list` walk answers `rows` in one short page. */
function portal(rows: Record<string, string | null>[]) {
  const commands: string[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const { cmd } = JSON.parse(init.body) as { cmd: Record<string, string> }
    commands.push(...Object.values(cmd))
    return new Response(JSON.stringify({ result: { result: { c0: rows }, result_error: {} } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return {
    commands,
    provider: new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, maxRetries: 0 }),
  }
}

describe('listDealContacts', () => {
  it('reads the contact alongside the id, on the same walk', async () => {
    const { provider, commands } = portal([
      { ID: '10', CONTACT_ID: '579290' },
      { ID: '11', CONTACT_ID: null },
      { ID: '12', CONTACT_ID: '' },
    ])

    const deals = await provider.listDealContacts()

    expect([...deals]).toEqual([
      ['10', '579290'],
      ['11', null],
      ['12', null],
    ])
    expect(decodeURIComponent(commands[0]!)).toContain('select[1]=CONTACT_ID')
  })

  it('throws when the portal ignored the column', async () => {
    const { provider } = portal([{ ID: '10' }, { ID: '11' }])
    await expect(provider.listDealContacts()).rejects.toThrow(/CONTACT_ID/)
  })

  it('still answers the sweep its ids', async () => {
    const { provider } = portal([{ ID: '10', CONTACT_ID: '1' }, { ID: '11', CONTACT_ID: null }])
    expect(await provider.listDealIds()).toEqual(new Set(['10', '11']))
  })
})

describe('relinkLimit', () => {
  it('is a quarter of the deals, never under 500', () => {
    expect(relinkLimit(100)).toBe(500)
    expect(relinkLimit(400_000)).toBe(100_000)
  })
})

/** A transaction that records statements and answers the count with `moved`. */
function db(moved: number) {
  const statements: string[] = []
  const tx = {
    $executeRawUnsafe: async (sql: string) => {
      statements.push(sql)
      return sql.includes('UPDATE') ? moved : 0
    },
    $queryRawUnsafe: async (sql: string) => {
      statements.push(sql)
      return [{ deals: BigInt(moved), customers: BigInt(Math.ceil(moved / 2)) }]
    },
  }
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof relinkDealContacts>[0]
  return { prisma, statements }
}

const live = (n: number) => new Map(Array.from({ length: n }, (_, i) => [String(i + 1), String(9000 + i)] as const))

describe('relinkDealContacts', () => {
  it('re-points the deals that moved', async () => {
    const { prisma, statements } = db(3)
    const r = await relinkDealContacts(prisma, 'BITRIX24', live(1_000))
    expect(r).toEqual({ checked: 1_000, relinked: 3, customersBefore: 2 })
    expect(statements.some((s) => s.includes('UPDATE "deal"'))).toBe(true)
  })

  it('skips deals the portal gave no contact, and does nothing with none left', async () => {
    const { prisma, statements } = db(0)
    const r = await relinkDealContacts(prisma, 'BITRIX24', new Map([['1', null]]))
    expect(r).toEqual({ checked: 0, relinked: 0, customersBefore: 0 })
    expect(statements).toEqual([])
  })

  it('writes nothing when most of the table would move', async () => {
    const { prisma, statements } = db(600)
    await expect(relinkDealContacts(prisma, 'BITRIX24', live(1_000))).rejects.toThrow(/juda koʻp/)
    expect(statements.some((s) => s.includes('UPDATE'))).toBe(false)
  })
})
