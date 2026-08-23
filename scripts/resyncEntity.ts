/**
 * Re-sync one entity into the Bitrix24 test database.
 *
 *     npm run bitrix:resync -- STAGES
 *
 * Useful after a mapping fix, when re-running the whole 11-minute import to
 * correct one entity would be wasteful.
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

const entity = process.argv[2]?.toUpperCase() as SyncEntityValue | undefined
const url = process.env.BITRIX24_TEST_DB_URL
const webhook = process.env.BITRIX24_WEBHOOK_URL

if (!entity || !SYNC_ENTITIES.includes(entity)) {
  console.error(`\n  Entity kerak. Mavjud: ${SYNC_ENTITIES.join(', ')}\n`)
  process.exit(1)
}
if (!url || !webhook) {
  console.error('\n  BITRIX24_TEST_DB_URL yoki BITRIX24_WEBHOOK_URL yoʻq.\n')
  process.exit(1)
}
if (url === process.env.DATABASE_URL) {
  console.error('\n  ✗ Test bazasi ishlab turgan baza bilan bir xil. Toʻxtatildi.\n')
  process.exit(1)
}

async function main() {
  const pool = new Pool({ connectionString: url })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const engine = new SyncEngine({
      provider: new Bitrix24CrmProvider({ webhookUrl: webhook! }),
      store: new PrismaSyncStore(prisma),
      handlers: createSyncHandlers(prisma, 'BITRIX24'),
      logger: {
        info: (o, m) => console.log(`  · ${m ?? ''}`, o ?? ''),
        warn: (o, m) => console.warn(`  ! ${m ?? ''}`, o ?? ''),
        error: (o, m) => console.error(`  ✗ ${m ?? ''}`, o ?? ''),
      },
    })

    const r = await engine.runEntity(entity!, 'FULL')
    console.log(
      `\n  ${r.entity}: ${r.status}  read=${r.recordsRead}` +
        `  created=${r.recordsCreated} updated=${r.recordsUpdated}` +
        `  skipped=${r.recordsSkipped} failed=${r.recordsFailed}\n`,
    )
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
