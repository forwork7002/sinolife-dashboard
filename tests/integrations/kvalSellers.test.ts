import { describe, expect, it } from 'vitest'

import { kvalDealsWithoutSellerSql, rereadKvalSellers } from '@/server/integrations/crm/sync/kvalSellers'

/**
 * «RNP jadvali» credits a kval lead to its «Сотувчи (Первичка)»'s team
 * (2026-10-08). A kval deal stored with no seller — read before the column
 * existed, or given to a seller the roster did not know yet — is re-read by
 * id; these pin which deals are asked about and the re-read's bookkeeping.
 */
describe('kvalDealsWithoutSellerSql', () => {
  const sql = kvalDealsWithoutSellerSql()

  it('asks about the kval deals only — Регистрация at «Сделка успешна», closed in the window, no seller stored', () => {
    expect(sql).toContain(`JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'`)
    expect(sql).toContain(`d."status" = 'WON'`)
    expect(sql).toContain('d."closedAt" >= $2')
    expect(sql).toContain('d."primarySellerEmployeeId" IS NULL')
  })
})

describe('rereadKvalSellers', () => {
  type D = { id: string; seller?: string }
  const hasSeller = (d: D) => d.seller !== undefined

  it('asks the portal nothing when every kval deal has its seller', async () => {
    let fetched = 0
    const r = await rereadKvalSellers<D>(
      [],
      async () => {
        fetched += 1
        return []
      },
      async () => ({ failed: 0, skipped: 0 }),
      hasSeller,
    )
    expect(r).toEqual({ checked: 0, named: 0, skipped: 0 })
    expect(fetched).toBe(0)
  })

  it('writes only the deals the portal names a seller on — the rest would be rewritten every pass for nothing', async () => {
    const written: D[] = []
    const r = await rereadKvalSellers<D>(
      ['1', '2', '3'],
      // Deal 2 has no seller on the portal either; deal 3 is gone from it (the deletion sweeps own that).
      async () => [{ id: '1', seller: '6884' }, { id: '2' }],
      async (deals) => {
        written.push(...deals)
        return { failed: 0, skipped: 1 }
      },
      hasSeller,
    )
    expect(written.map((d) => d.id)).toEqual(['1'])
    expect(r).toEqual({ checked: 3, named: 1, skipped: 1 })
  })

  it('reads and writes a page of 2 500 at a time, so a failure keeps the pages before it', async () => {
    const ids = Array.from({ length: 5_800 }, (_, i) => String(i + 1))
    const asked: number[] = []
    const wrote: number[] = []
    const pass = rereadKvalSellers<D>(
      ids,
      async (page) => {
        asked.push(page.length)
        return page.map((id) => ({ id, seller: '6884' }))
      },
      async (deals) => {
        wrote.push(deals.length)
        return { failed: wrote.length === 3 ? 1 : 0, skipped: 0 }
      },
      hasSeller,
    )
    await expect(pass).rejects.toThrow('1 ta bitim yozilmadi')
    expect(asked).toEqual([2_500, 2_500, 800])
    expect(wrote).toEqual([2_500, 2_500, 800])
  })

  it('throws when a deal could not be written, so the pass is tried again', async () => {
    await expect(
      rereadKvalSellers<D>(['1'], async () => [{ id: '1', seller: '6884' }], async () => ({ failed: 1, skipped: 0 }), hasSeller),
    ).rejects.toThrow('1 ta bitim yozilmadi')
  })
})
