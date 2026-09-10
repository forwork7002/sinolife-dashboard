import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The Доставка board is read straight off the portal's own kanban.
 *
 * The client puts this block beside `obey.bitrix24.kz` and reads the same two
 * numbers per column, so "close enough" is a support ticket. Four of the ways
 * this query can go wrong produce a PLAUSIBLE board rather than an error, and
 * none of them is visible in a screenshot:
 *
 *   · a filter moved from the LEFT JOIN's ON clause into the WHERE turns the
 *     outer join back into an inner one and DELETES every empty column —
 *     «Подготовка товара 0» and «Заказ в мой склад 0» simply stop existing,
 *     and a board somebody reads positionally renumbers itself;
 *   · a date bound added "to match the page" answers a different question and
 *     drifts further from the portal every month;
 *   · `count(*)` instead of `count(d."id")` prints 1 for every empty column,
 *     because an outer join emits one all-null row;
 *   · the closing columns creeping back in as three permanent noughts.
 *
 * Read off the source rather than through a database: this is a statement
 * about SQL SHAPE, and the suite touches no database at all.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/pulseRepository.ts'),
  'utf8',
)

/** The `deliveryBoard` method, from its signature to its closing brace. */
const METHOD = (() => {
  const start = SOURCE.indexOf('async deliveryBoard(')
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('\n  }\n', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
})()

/*
  Negative assertions run against the method with its prose stripped: the
  docblock above the query names the very things the `not.toContain` checks
  forbid, and would satisfy every one of them on its own.
*/
const bare = METHOD.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the Доставка board SQL', () => {
  it('starts from the stages and joins the deals outward, so an empty column survives', () => {
    expect(bare).toContain('FROM "deal_stage" s')
    expect(bare).toContain('LEFT JOIN "deal" d')
  })

  it('carries the dashboard filters in the JOIN, never in the WHERE', () => {
    const joinAt = bare.indexOf('LEFT JOIN "deal" d')
    const filterAt = bare.indexOf('${filterClause}')
    const whereAt = bare.indexOf('WHERE pl.')

    expect(filterAt).toBeGreaterThan(joinAt)
    // The whole point: the interpolation sits between the join and the WHERE.
    expect(filterAt).toBeLessThan(whereAt)
  })

  it('counts the joined deal, not the row, so an unmatched column reads zero', () => {
    expect(bare).toContain('count(d."id")')
    expect(bare).not.toContain('count(*)')
  })

  it('has no reporting window — a kanban column is a snapshot', () => {
    for (const dated of ['closedAt', 'createdAtSource', 'queuedAt', 'period', 'BETWEEN']) {
      expect(bare).not.toContain(dated)
    }
  })

  it('leaves out the three closing columns by category, not by name', () => {
    expect(bare).toContain(`NOT IN ('WON', 'LOST')`)
    for (const named of ['Доставлено', 'Отказ', 'C6:WON', 'C6:LOSE']) {
      expect(bare).not.toContain(named)
    }
  })

  it('asks for one funnel through the mapping constant, never a bare id', () => {
    expect(bare).toContain('DELIVERY_PIPELINE_EXTERNAL_ID')
    expect(bare).toContain('WHERE pl."externalId" = $1')
    // `pl."role" = 'REVENUE'` would admit Ecommerce as well.
    expect(bare).not.toContain(`'REVENUE'`)
  })

  it('names countsAsRevenue, like every other query that touches money', () => {
    expect(bare).toContain('d."countsAsRevenue"')
  })
})

describe('the delivery pipeline id', () => {
  it('lives in the Bitrix24 mapping and nowhere else', async () => {
    const { DELIVERY_PIPELINE_EXTERNAL_ID } = await import(
      '@/server/integrations/crm/bitrix24/mapping'
    )
    // Доставка is category 6 on the portal; `Pipeline.externalId` is that id
    // written out by `fetchPipelines`.
    expect(DELIVERY_PIPELINE_EXTERNAL_ID).toBe('6')
  })
})
