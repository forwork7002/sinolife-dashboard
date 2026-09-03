import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { bulkUpsert, type ColumnSpec } from '@/server/integrations/crm/sync/bulkUpsert'

/**
 * AN UPSERT MAY NOT CHANGE WHAT IT UPSERTED.
 *
 * `rowId()` mints a fresh id for every row of every batch, and the write
 * conflicts on the EXTERNAL key — so an id left out of `insertOnly` lands in
 * the update set as `"id" = EXCLUDED."id"` and an ordinary re-import replaces
 * the primary key of a row that already existed. Measured on production
 * 2026-09-03: of nineteen deals watched over a hundred seconds, the one the
 * sync touched came back under a new id.
 *
 * Two things followed from that. Children were dragged along — `deal_item` and
 * `deal_stage_history` relate to the deal with the default `onUpdate: Cascade`,
 * so re-importing one deal rewrote the foreign key of every transition it had,
 * on a one-vCPU database. And every URL holding an internal id went stale
 * within the minute: `/deals/[id]` and the confirmation queue's trace panel
 * both address a deal by that column.
 */

/** Captures the SQL instead of executing it. */
function capture() {
  const statements: string[] = []
  const prisma = {
    $executeRawUnsafe: async (sql: string) => {
      statements.push(sql)
      return 1
    },
  } as unknown as Parameters<typeof bulkUpsert>[0]['prisma']
  return { prisma, statements }
}

const COLUMNS: ColumnSpec[] = [
  { name: 'id', insertOnly: true },
  { name: 'externalSource' },
  { name: 'externalId' },
  { name: 'title' },
  { name: 'createdAt', insertOnly: true },
  { name: 'updatedAt' },
]

describe('bulk upsert', () => {
  it('never updates a column marked insert-only', async () => {
    const { prisma, statements } = capture()

    await bulkUpsert({
      prisma,
      table: 'deal',
      columns: COLUMNS,
      conflict: ['externalSource', 'externalId'],
      rows: [['row-1', 'BITRIX24', '935632', 'a deal', 'now', 'now']],
    })

    const [sql] = statements
    expect(sql).toContain('ON CONFLICT ("externalSource", "externalId")')
    // The row keeps the identity it was created with.
    expect(sql).not.toContain('"id" = EXCLUDED."id"')
    expect(sql).not.toContain('"createdAt" = EXCLUDED."createdAt"')
    // …and everything the portal can restate still moves.
    expect(sql).toContain('"title" = EXCLUDED."title"')
    expect(sql).toContain('"updatedAt" = EXCLUDED."updatedAt"')
  })

  it('inserts the insert-only columns, rather than omitting them', async () => {
    const { prisma, statements } = capture()

    await bulkUpsert({
      prisma,
      table: 'deal',
      columns: COLUMNS,
      conflict: ['externalSource', 'externalId'],
      rows: [['row-1', 'BITRIX24', '935632', 'a deal', 'now', 'now']],
    })

    // A new row still needs an id and a createdAt: insert-only is about the
    // CONFLICT branch, not about the column being optional.
    expect(statements[0]).toContain('INSERT INTO "deal" ("id", "externalSource"')
  })

  it('writes nothing at all for an empty batch', async () => {
    const { prisma, statements } = capture()
    const written = await bulkUpsert({
      prisma,
      table: 'deal',
      columns: COLUMNS,
      conflict: ['externalSource', 'externalId'],
      rows: [],
    })
    expect(written).toBe(0)
    expect(statements).toHaveLength(0)
  })

  /**
   * The mechanism above is only worth anything if the real column specs use it,
   * and they are internal to `createSyncHandlers` — there is no seam that
   * reaches them. This reads the declarations instead: cheap, and it fails for
   * a new table that declares `id` the old way, which is exactly how this got
   * into production in the first place.
   */
  it('declares every id column insert-only in the sync handlers', () => {
    const source = readFileSync('src/server/integrations/crm/sync/handlers.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

    const declarations = [...source.matchAll(/\{\s*name:\s*'id'[^}]*\}/g)].map((m) => m[0])

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(declaration).toContain('insertOnly: true')
    }
  })
})
