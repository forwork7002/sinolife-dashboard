/**
 * Import MoySklad customer orders by hand — the same pass the sync worker runs.
 *
 *     MOYSKLAD_TOKEN=… npm run moysklad:import            # changed orders
 *     MOYSKLAD_TOKEN=… npm run moysklad:import -- --sweep # and drop deleted ones
 *
 * Read-only against MoySklad (GET only); writes `moysklad_order` and
 * `moysklad_order_item`. See moyskladImport.ts.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'
import { importMoyskladOrders } from '../src/server/integrations/moysklad/moyskladImport'

const url = process.env.DATABASE_URL
const token = process.env.MOYSKLAD_TOKEN?.trim()
if (!url || !token) {
  console.error('\n  DATABASE_URL yoki MOYSKLAD_TOKEN yoʻq.\n')
  process.exit(1)
}

async function main() {
  const pool = new Pool(poolConfig(url!, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const started = Date.now()
    const r = await importMoyskladOrders(prisma, token!, { sweep: process.argv.includes('--sweep') })
    console.log(
      `\n  MoySklad: ${r.orders} buyurtma, ${r.items} pozitsiya` +
        (r.since ? ` (${r.since.toISOString()} dan)` : ' (hammasi)') +
        (r.skipped > 0 ? `, sanasiz ${r.skipped}` : '') +
        (r.deleted === null ? '' : `, oʻchirilgan: ${r.deleted}`) +
        `  ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
    )
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(`  ✗ ${(error as Error).message}`)
  process.exit(1)
})
