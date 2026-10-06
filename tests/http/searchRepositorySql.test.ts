import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import { SearchRepository } from '@/server/repositories/searchRepository'

/**
 * WHICH STATEMENTS A TERM IS ALLOWED TO COST.
 *
 * Measured on production on 2026-09-16 (`pg_stat_statements`, one-core
 * db-s-1vcpu-1gb): the deals statement averaged 1.2–1.5 s and the customers
 * statement the same, with a 3.3 s worst case — for EVERY term, because every
 * term ran every arm. A deal id was compared against 423 845 titles, a name
 * against 326 859 phone numbers, and three reference tables were read for a
 * phone number that could not be in any of them. Five statements per
 * keystroke, on a pool of eight connections shared with every screen.
 *
 * The tests below pin the shape of the work, not its speed: a number touches
 * the id, code and phone columns and nothing else; text touches names, codes
 * and titles and never a phone column; the reference tables are read in ONE
 * statement, and only for text. Everything a statement does not need to read
 * is the whole saving.
 */

interface Call {
  readonly sql: string
  readonly params: readonly unknown[]
}

function repositoryCapturing(calls: Call[]): SearchRepository {
  const prisma = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params })
      return []
    },
  } as unknown as PrismaClient
  return new SearchRepository(prisma)
}

const stripped = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('a number', () => {
  it('reads ids, codes and phones — never titles, names or reference tables', async () => {
    const calls: Call[] = []
    await repositoryCapturing(calls).search('+998 90 123 45 67', null)

    const sql = calls.map((c) => stripped(c.sql))
    expect(calls).toHaveLength(2)

    const [deals, customers] = sql
    expect(deals).toContain('"externalId" = $')
    expect(deals).toContain('"orderCode" ILIKE')
    expect(deals).toContain('"phone" ILIKE')
    expect(deals).toContain('"phones"::text ILIKE')
    expect(deals).not.toContain('"title" ILIKE')
    expect(deals).not.toContain('"name" ILIKE')

    expect(customers).toContain('"phone" ILIKE')
    expect(customers).not.toContain('"name" ILIKE')

    expect(sql.some((s) => s.includes('"fullName" ILIKE'))).toBe(false)
  })

  it('compares the digits alone, so punctuation in the box still finds the row', async () => {
    const calls: Call[] = []
    await repositoryCapturing(calls).search('+998 (90) 123-45-67', null)

    for (const call of calls) {
      expect(call.params).toContain('%998901234567%')
    }
  })

  it('looks a deal up by its exact id, and a term that is not an id matches no deal', async () => {
    const calls: Call[] = []
    await repositoryCapturing(calls).search('925842', null)
    expect(calls[0]?.params[0]).toBe('925842')

    calls.length = 0
    await repositoryCapturing(calls).search('Dilnoza', null)
    expect(calls[0]?.sql).not.toContain('"externalId" =')
  })
})

describe('text', () => {
  it('reads names, codes and titles — never a phone column', async () => {
    const calls: Call[] = []
    await repositoryCapturing(calls).search('Dilnoza', null)

    const sql = calls.map((c) => stripped(c.sql))
    expect(calls).toHaveLength(3)

    const [deals, customers, named] = sql
    expect(deals).toContain('"title" ILIKE')
    expect(deals).toContain('"orderCode" ILIKE')
    expect(deals).toContain('c."name" ILIKE')
    expect(deals).not.toContain('"phone" ILIKE')
    expect(deals).not.toContain('"phones"::text ILIKE')

    expect(customers).toContain('"name" ILIKE')
    expect(customers).not.toContain('"phone" ILIKE')

    // One statement for three small tables, not three round trips.
    expect(named).toContain('"employee"')
    expect(named).toContain('"product"')
    expect(named).toContain('"sales_source"')
  })

  it('escapes the characters ILIKE would read as wildcards', async () => {
    const calls: Call[] = []
    await repositoryCapturing(calls).search('100%_x', null)
    expect(calls[0]?.params).toContain('%100\\%\\_x%')
  })
})

describe('a term not worth a round trip', () => {
  it('sends nothing to the database', async () => {
    const calls: Call[] = []
    const repository = repositoryCapturing(calls)
    for (const term of ['', 'di', '998', '9989']) {
      const results = await repository.search(term, null)
      expect(results.deals).toEqual([])
      expect(results.customers).toEqual([])
      expect(results.employees).toEqual([])
    }
    expect(calls).toHaveLength(0)
  })
})

describe('the deal hits', () => {
  it('say whether each deal arrived in Тасдиклаш, which is what the queue can find it by', async () => {
    for (const term of ['925842', 'Dilnoza']) {
      const calls: Call[] = []
      await repositoryCapturing(calls).search(term, null)
      expect(stripped(calls[0]!.sql)).toMatch(
        /EXISTS \(\s*SELECT 1 FROM "deal_stage_history"[\s\S]*"confirmationSignal" = 'CONFIRM_NEW'\s*\) AS queued/,
      )
    }
  })

  it('say whether ANY deal of the customer arrived there — what a link by phone can find', async () => {
    for (const term of ['925842', 'Dilnoza']) {
      const calls: Call[] = []
      await repositoryCapturing(calls).search(term, null)
      expect(stripped(calls[0]!.sql)).toMatch(
        /EXISTS \(\s*SELECT 1 FROM "deal" cd[\s\S]*cd\."customerId" = d\."customerId"[\s\S]*"confirmationSignal" = 'CONFIRM_NEW'\s*\) AS customer_queued/,
      )
    }
  })
})

describe('scope', () => {
  it('reaches every row-bearing statement as the joined employee list', async () => {
    const calls: Call[] = []
    await repositoryCapturing(calls).search('Dilnoza', ['e1', 'e2'])
    const [deals, customers] = calls
    expect(deals?.params).toContain('e1,e2')
    expect(customers?.params).toContain('e1,e2')
  })
})
