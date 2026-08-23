/**
 * Seed the database with demo data.
 *
 * Deliberately NOT a pile of `prisma.create` calls. The demo provider is run
 * through the real synchronisation engine, so demo data enters by exactly the
 * path Bitrix24 data will:
 *
 *     DemoCrmProvider -> SyncEngine -> upsert -> PostgreSQL
 *
 * That means this script also exercises the sync engine on every run. If
 * seeding works, the import path works.
 *
 * Idempotent: run it as often as you like. The second run updates rather than
 * duplicating, because every write is keyed on (externalSource, externalId).
 */

// Next.js loads .env automatically; a standalone tsx script does not.
import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { SYNC_ORDER } from '../src/server/domain/types'
import { DemoCrmProvider } from '../src/server/integrations/crm/demo/DemoCrmProvider'
import { createSyncHandlers } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'
import { seedKpiTargets } from '../src/server/integrations/crm/sync/seedKpi'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.')
}

const seed = Number(process.env.DEMO_SEED ?? 20260101)
const currency = process.env.APP_DEFAULT_CURRENCY ?? 'UZS'
const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Tashkent'

const consoleLogger = {
  info: (o: unknown, m?: string) => console.log(`  · ${m ?? ''}`, o),
  warn: (o: unknown, m?: string) => console.warn(`  ! ${m ?? ''}`, o),
  error: (o: unknown, m?: string) => console.error(`  ✗ ${m ?? ''}`, o),
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const startedAt = Date.now()

  try {
    console.log(`\nSeeding demo data (seed=${seed}, currency=${currency})\n`)

    const provider = new DemoCrmProvider({
      seed,
      referenceDate: new Date(),
      currency,
    })

    const health = await provider.healthCheck()
    console.log(`  ${health.detail}\n`)

    const engine = new SyncEngine({
      provider,
      store: new PrismaSyncStore(prisma),
      handlers: createSyncHandlers(prisma, provider.source),
      pageSize: 250,
      logger: consoleLogger,
    })

    // Sweeping is enabled for the demo seed: regenerating the dataset changes
    // which records exist, and rows left behind from a previous generation
    // would attach to the wrong deals. For Bitrix24 this stays opt-in until
    // the deletion policy is agreed — see docs/BITRIX24.md §10.
    const results = await engine.runAll(SYNC_ORDER, 'FULL', { sweepDeleted: true })

    console.log('  entity              status    read  created  updated  skipped  failed  deleted')
    console.log('  ' + '-'.repeat(81))
    for (const r of results) {
      console.log(
        '  ' +
          r.entity.padEnd(20) +
          r.status.padEnd(10) +
          String(r.recordsRead).padStart(4) +
          String(r.recordsCreated).padStart(9) +
          String(r.recordsUpdated).padStart(9) +
          String(r.recordsSkipped).padStart(9) +
          String(r.recordsFailed).padStart(8) +
          String(r.recordsDeleted).padStart(9),
      )
    }

    const failures = results.filter((r) => r.status === 'FAILED')
    const partials = results.filter((r) => r.status === 'PARTIAL')

    // KPI targets are OUR data, not the CRM's: they are goals the business
    // sets, so they are generated here rather than imported.
    const kpiCount = await seedKpiTargets(prisma, seed, timeZone)
    console.log(`\n  KPI targets: ${kpiCount}`)

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`\n  Completed in ${elapsed}s`)

    if (failures.length > 0) {
      console.error(`\n  ✗ ${failures.length} entities FAILED`)
      process.exitCode = 1
    } else if (partials.length > 0) {
      console.warn(`\n  ! ${partials.length} entities completed PARTIALLY`)
      process.exitCode = 1
    } else {
      console.log('\n  ✓ All entities synchronised cleanly\n')
    }
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('\nSeeding failed:', error)
  process.exit(1)
})
