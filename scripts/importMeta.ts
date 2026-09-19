/**
 * Import Meta Ads spend by hand — the same pass the sync worker runs hourly.
 *
 *     META_ACCESS_TOKEN=… npm run meta:import
 *
 * Read-only against Meta (GET only); writes `meta_ad_daily`. See metaImport.ts.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'
import { importMetaSpend } from '../src/server/integrations/meta/metaImport'
import { zonedDateKey } from '../src/server/domain/period/period'

const url = process.env.DATABASE_URL
const token = process.env.META_ACCESS_TOKEN
if (!url || !token) {
  console.error('\n  DATABASE_URL yoki META_ACCESS_TOKEN yoʻq.\n')
  process.exit(1)
}

async function main() {
  const pool = new Pool(poolConfig(url!, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const started = Date.now()
    const today = zonedDateKey(new Date(), process.env.APP_TIMEZONE ?? 'Asia/Tashkent')
    const r = await importMetaSpend(prisma, token!, today)
    console.log(
      `\n  Meta: ${r.accounts} akkaunt, ${r.rows} kun-qator (${r.since} – ${r.until})` +
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
