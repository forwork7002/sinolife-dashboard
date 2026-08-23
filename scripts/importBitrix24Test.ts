/**
 * Bitrix24 test import.
 *
 *     npm run bitrix:import:test
 *
 * Imports Доставка (#6) and Ecommerce (#14) into a SEPARATE database through
 * the real synchronisation engine — the same path the demo data takes. The
 * live dashboard and its database are untouched.
 *
 * SAFETY
 * Refuses to run unless BITRIX24_TEST_DB_URL is set and differs from
 * DATABASE_URL. A mistyped variable must not be able to overwrite production.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import type { SyncEntityValue } from '../src/server/domain/types'
import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { PIPELINE_NAMES, REVENUE_PIPELINES } from '../src/server/integrations/crm/bitrix24/mapping'
import { createSyncHandlers } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL
const TEST_DB = process.env.BITRIX24_TEST_DB_URL
const LIVE_DB = process.env.DATABASE_URL

if (!WEBHOOK) {
  console.error('\n  BITRIX24_WEBHOOK_URL .env da yoʻq.\n')
  process.exit(1)
}
if (!TEST_DB) {
  console.error('\n  BITRIX24_TEST_DB_URL .env da yoʻq.')
  console.error('  Sinov importi alohida bazaga yoziladi — masalan:')
  console.error('  BITRIX24_TEST_DB_URL="postgresql://postgres:PAROL@localhost:5432/sinolife_test?schema=public"\n')
  process.exit(1)
}
if (TEST_DB === LIVE_DB) {
  console.error('\n  ✗ BITRIX24_TEST_DB_URL va DATABASE_URL bir xil.')
  console.error('  Sinov importi ishlab turgan bazani ustiga yozib yuborardi. Toʻxtatildi.\n')
  process.exit(1)
}

/** Narrowed after the guards above, so the rest of the file has real strings. */
const TARGET_DB: string = TEST_DB
const WEBHOOK_URL: string = WEBHOOK

/**
 * Deals must be read BEFORE customers.
 *
 * The provider notes which contacts the imported deals reference and then
 * fetches only those — 15 000 instead of the portal's 314 610. The default
 * order puts customers first, which would fetch nothing.
 *
 * Deals are written before their customers exist, so `customerId` is left null
 * on the first pass and filled by the second run of DEALS at the end.
 */
const ORDER: SyncEntityValue[] = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCTS',
  'STAGES',
  'SOURCES',
  'DEALS',
  'CUSTOMERS',
  'DEALS',
  'DEAL_ITEMS',
]

async function main() {
  const started = Date.now()
  const pool = new Pool({ connectionString: TARGET_DB })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const logger = {
    info: (o: unknown, m?: string) => console.log(`  · ${m ?? ''}`, o ?? ''),
    warn: (o: unknown, m?: string) => console.warn(`  ! ${m ?? ''}`, o ?? ''),
    error: (o: unknown, m?: string) => console.error(`  ✗ ${m ?? ''}`, o ?? ''),
  }

  try {
    console.log('\n  ' + '━'.repeat(70))
    console.log('  BITRIX24 SINOV IMPORTI')
    console.log('  ' + '━'.repeat(70))
    console.log(`  Baza      : ${new URL(TARGET_DB.replace(/^postgres/, 'http')).pathname.slice(1)}`)
    console.log(`  Voronkalar: ${REVENUE_PIPELINES.map((p) => PIPELINE_NAMES[p]).join(', ')}`)
    console.log('  База (#10) ataylab qoʻshilmadi — Доставка nusxasi.\n')

    const provider = new Bitrix24CrmProvider({
      webhookUrl: WEBHOOK_URL,
      rateLimitRps: Number(process.env.BITRIX24_RATE_LIMIT_RPS ?? 2),
      onProgress: (m) => console.log(m),
    })

    const health = await provider.healthCheck()
    console.log(`  ${health.ok ? '✓' : '✗'} ${health.detail}\n`)
    if (!health.ok) process.exit(1)

    const engine = new SyncEngine({
      provider,
      store: new PrismaSyncStore(prisma),
      handlers: createSyncHandlers(prisma, 'BITRIX24'),
      pageSize: 500,
      logger,
    })

    console.log('  Import boshlandi…\n')
    const results = await engine.runAll(ORDER, 'FULL')

    console.log('\n  entity              status    read  created  updated  skipped  failed')
    console.log('  ' + '-'.repeat(72))
    for (const r of results) {
      console.log(
        '  ' +
          r.entity.padEnd(20) +
          r.status.padEnd(10) +
          String(r.recordsRead).padStart(4) +
          String(r.recordsCreated).padStart(9) +
          String(r.recordsUpdated).padStart(9) +
          String(r.recordsSkipped).padStart(9) +
          String(r.recordsFailed).padStart(8),
      )
    }

    // ---- Totals, for comparison against Bitrix24's own reports -------------
    const [deals, won, employees, products, items, customers] = await Promise.all([
      prisma.deal.count(),
      prisma.deal.aggregate({ where: { status: 'WON' }, _sum: { amountMinor: true }, _count: { _all: true } }),
      prisma.employee.count(),
      prisma.product.count(),
      prisma.dealItem.count(),
      prisma.customer.count(),
    ])

    console.log('\n  ' + '━'.repeat(70))
    console.log('  NATIJA')
    console.log('  ' + '━'.repeat(70))
    console.log(`  Bitimlar        : ${deals.toLocaleString('en-US')}`)
    console.log(`  Yutuq           : ${won._count._all.toLocaleString('en-US')}`)
    console.log(`  Jami tushum     : ${((won._sum.amountMinor ?? 0n) / 100n).toLocaleString('en-US')} soʻm`)
    console.log(`  Xodimlar        : ${employees}`)
    console.log(`  Mijozlar        : ${customers.toLocaleString('en-US')}`)
    console.log(`  Mahsulotlar     : ${products}`)
    console.log(`  Mahsulot qatori : ${items.toLocaleString('en-US')}`)
    console.log(`\n  Vaqt: ${((Date.now() - started) / 1000 / 60).toFixed(1)} daqiqa\n`)

    const failed = results.filter((r) => r.status === 'FAILED')
    if (failed.length) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('\n  Import xatosi:', error, '\n')
  process.exit(1)
})
