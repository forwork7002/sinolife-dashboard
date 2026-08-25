/**
 * Re-sync one or more entities into the live database.
 *
 *     npm run bitrix:resync -- STAGES DEALS
 *
 * Useful after a mapping fix, when re-running the whole import to correct one
 * entity would be wasteful. Order is as given, so a dependency can be listed
 * before what depends on it.
 *
 * Every write is the same idempotent upsert the full import uses, so this
 * updates rows in place rather than duplicating them.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { SYNC_ENTITIES, type SyncEntityValue } from '../src/server/domain/types'
import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { createSyncHandlers } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'

const requested = process.argv.slice(2).map((arg) => arg.toUpperCase()) as SyncEntityValue[]
const url = process.env.DATABASE_URL
const webhook = process.env.BITRIX24_WEBHOOK_URL

const unknown = requested.filter((name) => !SYNC_ENTITIES.includes(name))

if (requested.length === 0 || unknown.length > 0) {
  if (unknown.length > 0) console.error(`\n  Nomaʼlum entity: ${unknown.join(', ')}`)
  console.error(`\n  Entity kerak. Mavjud: ${SYNC_ENTITIES.join(', ')}\n`)
  process.exit(1)
}
if (!url || !webhook) {
  console.error('\n  DATABASE_URL yoki BITRIX24_WEBHOOK_URL yoʻq.\n')
  process.exit(1)
}

/** Narrowed after the guard above, so the rest of the file has real strings. */
const DATABASE_URL: string = url
const WEBHOOK_URL: string = webhook

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const engine = new SyncEngine({
      provider: new Bitrix24CrmProvider({
        webhookUrl: WEBHOOK_URL,
        callHistoryMonths: Number(process.env.BITRIX24_CALL_MONTHS ?? 1),
        onProgress: (m) => console.log(m),
      }),
      store: new PrismaSyncStore(prisma),
      handlers: createSyncHandlers(prisma, 'BITRIX24'),
      logger: {
        info: (o, m) => console.log(`  · ${m ?? ''}`, o ?? ''),
        warn: (o, m) => console.warn(`  ! ${m ?? ''}`, o ?? ''),
        error: (o, m) => console.error(`  ✗ ${m ?? ''}`, o ?? ''),
      },
    })

    for (const entity of requested) {
      const r = await engine.runEntity(entity, 'FULL')
      console.log(
        `\n  ${r.entity}: ${r.status}  read=${r.recordsRead}` +
          `  created=${r.recordsCreated} updated=${r.recordsUpdated}` +
          `  skipped=${r.recordsSkipped} failed=${r.recordsFailed}\n`,
      )
    }
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
