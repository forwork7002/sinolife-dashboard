/**
 * Re-sync one or more entities into the live database.
 *
 *     npm run bitrix:resync -- STAGES DEALS
 *     npm run bitrix:resync -- DEALS --since=2026-06-01
 *
 * Useful after a mapping fix, when re-running the whole import to correct one
 * entity would be wasteful. Order is as given, so a dependency can be listed
 * before what depends on it.
 *
 * Every write is the same idempotent upsert the full import uses, so this
 * updates rows in place rather than duplicating them.
 *
 * `--since=YYYY-MM-DD` reads only what the portal modified on or after that
 * day (Tashkent midnight). It is how a new deal column is backfilled for the
 * weeks a screen reads without re-reading ~420 000 deals, and it leaves the
 * worker's own watermark where it was.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

import { PrismaClient } from '../src/generated/prisma/client'
import { SYNC_ENTITIES, type SyncEntityValue } from '../src/server/domain/types'
import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { createSyncHandlers } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'

const args = process.argv.slice(2)
const sinceArg = args.find((arg) => arg.startsWith('--since='))?.slice('--since='.length)
const requested = args
  .filter((arg) => !arg.startsWith('--'))
  .map((arg) => arg.toUpperCase()) as SyncEntityValue[]

// Tashkent midnight, stated rather than left to the machine's own zone.
const since = sinceArg ? new Date(`${sinceArg}T00:00:00+05:00`) : undefined
if (sinceArg !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(sinceArg) || Number.isNaN(since!.getTime()))) {
  console.error(`\n  --since sana boʻlishi kerak: YYYY-MM-DD (berilgan: ${sinceArg})\n`)
  process.exit(1)
}
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
  const pool = new Pool(poolConfig(DATABASE_URL, { caCert: caCertFromEnv() }))
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
      if (since) console.log(`\n  ${entity}: faqat ${sinceArg} dan beri oʻzgarganlar`)
      const r = await engine.runEntity(entity, 'FULL', since ? { updatedSince: since } : {})
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
