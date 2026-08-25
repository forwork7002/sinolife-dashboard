/**
 * Multi-row upsert.
 *
 * The per-record `prisma.upsert` the small handlers use is one round trip per
 * row. That is fine for 288 employees and ruinous for 415 591 deals: at even
 * two milliseconds a row it is over twenty minutes of pure latency, on top of
 * the twenty the portal itself takes.
 *
 * This builds one `INSERT … ON CONFLICT … DO UPDATE` per chunk instead, so a
 * thousand rows cost one round trip. The write stays exactly as idempotent as
 * the single-row version — same unique index, same conflict target — because
 * idempotence is the property the whole sync design rests on.
 *
 * WHY RAW SQL
 * Prisma has no bulk upsert. `createMany({ skipDuplicates })` silently ignores
 * changed rows, which would make re-syncing a deal whose stage moved a no-op,
 * and `updateMany` cannot insert. Neither is a substitute.
 *
 * Values are always passed as bound parameters. Column and table names are
 * never interpolated from anything a provider supplies — they come only from
 * the literal specs in `handlers.ts`.
 */

import type { PrismaClient } from '@/generated/prisma/client'

/**
 * One column in a bulk write.
 *
 * `cast` is the Postgres type to coerce the bound parameter to. Enums and
 * bigints need it: the driver sends both as text, and Postgres will not infer
 * an enum type for an untyped parameter inside a multi-row VALUES list.
 */
export interface ColumnSpec {
  readonly name: string
  readonly cast?: string
  /**
   * Set on columns that must keep their FIRST value when a row already exists.
   * `createdAt` is the only one: an upsert is a re-import of the same record,
   * not a new one, and moving its creation timestamp forward would make every
   * "imported today" figure meaningless.
   */
  readonly insertOnly?: boolean
}

/** Postgres refuses more than 65 535 bound parameters in one statement. */
const MAX_PARAMS = 60_000

/**
 * Monotonic, collision-resistant row id.
 *
 * Prisma generates `cuid()` defaults in the client, so a raw INSERT has to
 * supply its own. Uniqueness is ultimately guaranteed by the unique index on
 * `(externalSource, externalId)` — this only has to avoid colliding with
 * itself, which timestamp + counter + randomness does comfortably.
 */
let idCounter = 0
export function rowId(): string {
  const time = Date.now().toString(36)
  const count = (idCounter++ & 0xffffffff).toString(36).padStart(7, '0')
  const random = Math.random().toString(36).slice(2, 10)
  return `c${time}${count}${random}`
}

export interface BulkUpsertInput {
  readonly prisma: PrismaClient
  readonly table: string
  readonly columns: readonly ColumnSpec[]
  /** Columns forming the unique index the conflict is resolved against. */
  readonly conflict: readonly string[]
  /** One array of values per row, in `columns` order. */
  readonly rows: readonly (readonly unknown[])[]
}

/**
 * Write every row, inserting what is new and updating what is not.
 *
 * Returns the number of rows written, which is every row given: Postgres
 * reports affected rows, not which branch each took. Created-versus-updated
 * counts come from the caller's pre-read of existing external ids, exactly as
 * they do for the single-row handlers.
 */
export async function bulkUpsert({
  prisma,
  table,
  columns,
  conflict,
  rows,
}: BulkUpsertInput): Promise<number> {
  if (rows.length === 0) return 0

  const columnList = columns.map((c) => `"${c.name}"`).join(', ')
  const conflictList = conflict.map((c) => `"${c}"`).join(', ')

  const updatable = columns.filter((c) => !conflict.includes(c.name) && !c.insertOnly)
  const updateList = updatable.map((c) => `"${c.name}" = EXCLUDED."${c.name}"`).join(', ')

  const perRow = columns.length
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / perRow))
  let written = 0

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)

    const tuples: string[] = []
    const params: unknown[] = []

    for (const row of chunk) {
      const placeholders = columns.map((column, i) => {
        params.push(row[i])
        return column.cast ? `$${params.length}::${column.cast}` : `$${params.length}`
      })
      tuples.push(`(${placeholders.join(', ')})`)
    }

    const sql =
      `INSERT INTO "${table}" (${columnList}) VALUES ${tuples.join(', ')} ` +
      `ON CONFLICT (${conflictList}) DO ` +
      (updateList ? `UPDATE SET ${updateList}` : 'NOTHING')

    written += await prisma.$executeRawUnsafe(sql, ...params)
  }

  return written
}
