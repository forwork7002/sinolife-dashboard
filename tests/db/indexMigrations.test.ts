import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The 2026-10-07 indexes: additive, fail-fast, and in step with schema.prisma.
 *
 * `prisma migrate deploy` runs these against production on every push to
 * main, so the file itself is the change. What must hold: only CREATE INDEX
 * (no drop, no delete, no column change), a lock_timeout so a busy table
 * fails the deploy instead of queueing the sync behind it, and the same index
 * declared in schema.prisma under Prisma's default name — or the next
 * `migrate dev` would try to drop it as drift.
 */

const root = process.cwd()
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const MIGRATIONS = [
  {
    dir: '20261007090000_deal_pipeline_updated_index',
    name: 'deal_pipelineId_updatedAtSource_idx',
    on: `"deal"("pipelineId", "updatedAtSource")`,
    schema: '@@index([pipelineId, updatedAtSource])',
  },
  {
    dir: '20261007090100_stage_history_cover_index',
    name: 'deal_stage_history_stageId_enteredAt_dealId_idx',
    on: `"deal_stage_history"("stageId", "enteredAt", "dealId")`,
    schema: '@@index([stageId, enteredAt, dealId])',
  },
] as const

/** Statements only — comments explain DROP-free reasoning and may name words. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('2026-10-07 index migrations', () => {
  for (const m of MIGRATIONS) {
    it(`${m.dir} only creates ${m.name}, under a lock timeout`, () => {
      const stmts = statements(read(`prisma/migrations/${m.dir}/migration.sql`))
      expect(stmts).toEqual([
        `SET lock_timeout = '5s'`,
        `CREATE INDEX IF NOT EXISTS "${m.name}" ON ${m.on}`,
        'RESET lock_timeout',
      ])
    })

    it(`schema.prisma declares ${m.schema}`, () => {
      expect(read('prisma/schema.prisma')).toContain(m.schema)
    })
  }

  it('sorts after the migration that was last when they were written', () => {
    // `migrate deploy` applies in name order; one that sorted earlier than an
    // applied migration would be reported as missing history.
    const dirs = readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    for (const m of MIGRATIONS) {
      expect(dirs).toContain(m.dir)
      expect(m.dir > '20261006160000_deal_owner_change').toBe(true)
    }
  })

  it('keeps the indexes the queue already used', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toContain('@@index([stageId, enteredAt])')
    expect(schema).toContain('@@index([pipelineId])')
  })
})
