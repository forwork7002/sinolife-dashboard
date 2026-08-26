/**
 * Bitrix24 → production import.
 *
 *     npm run bitrix:import            incremental, safe to repeat
 *     npm run bitrix:import -- --full  full re-read of every entity
 *     npm run bitrix:import -- --reset --full   wipe first, then re-read
 *
 * This writes to DATABASE_URL — the database the dashboard serves. It is the
 * real import, not the test one; `scripts/importBitrix24Test.ts` still exists
 * for rehearsing against a scratch database.
 *
 * `--reset` deletes every DEMO-sourced row before importing. Demo data is
 * retired: the dashboard must never mix generated numbers with live ones, and
 * the provenance badge only distinguishes them per row.
 *
 * The full run reads ~415 600 deals, ~250 000 contacts and several hundred
 * thousand stage transitions. Budget 30–60 minutes. It is resumable — every
 * entity records its own cursor, so a crash costs the current entity, not the
 * run.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

import { PrismaClient } from '../src/generated/prisma/client'
import { SYNC_ORDER, type SyncModeValue } from '../src/server/domain/types'
import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { ALL_PIPELINES, PIPELINE_NAMES } from '../src/server/integrations/crm/bitrix24/mapping'
import { createSyncHandlers } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL
const DATABASE = process.env.DATABASE_URL

if (!WEBHOOK) {
  console.error('\n  BITRIX24_WEBHOOK_URL .env da yoʻq.\n')
  process.exit(1)
}
if (!DATABASE) {
  console.error('\n  DATABASE_URL .env da yoʻq.\n')
  process.exit(1)
}

const WEBHOOK_URL: string = WEBHOOK
const DATABASE_URL: string = DATABASE

const args = new Set(process.argv.slice(2))
const MODE: SyncModeValue = args.has('--full') ? 'FULL' : 'INCREMENTAL'
const RESET = args.has('--reset')

function hhmmss(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function money(minor: bigint): string {
  return (minor / 100n).toLocaleString('en-US').replace(/,/g, ' ')
}

async function main() {
  const started = Date.now()
  const pool = new Pool(poolConfig(DATABASE_URL, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const stamp = () => hhmmss(Date.now() - started)
  const logger = {
    info: (o: unknown, m?: string) => console.log(`  ${stamp()} · ${m ?? ''}`, o ?? ''),
    warn: (o: unknown, m?: string) => console.warn(`  ${stamp()} ! ${m ?? ''}`, o ?? ''),
    error: (o: unknown, m?: string) => console.error(`  ${stamp()} ✗ ${m ?? ''}`, o ?? ''),
  }

  try {
    console.log('\n  ' + '━'.repeat(74))
    console.log(`  BITRIX24 IMPORT — ${MODE}${RESET ? ' + RESET' : ''}`)
    console.log('  ' + '━'.repeat(74))
    console.log(`  Baza      : ${new URL(DATABASE_URL.replace(/^postgres/, 'http')).pathname.slice(1)}`)
    console.log(`  Voronkalar: ${ALL_PIPELINES.map((p) => PIPELINE_NAMES[p]).join(', ')}`)
    console.log('  Daromad faqat Доставка + Ecommerce dan. База — nusxa, hisobga kirmaydi.\n')

    const provider = new Bitrix24CrmProvider({
      webhookUrl: WEBHOOK_URL,
      rateLimitRps: Number(process.env.BITRIX24_RATE_LIMIT_RPS ?? 2),
      requestTimeoutMs: Number(process.env.BITRIX24_REQUEST_TIMEOUT_MS ?? 30_000),
      callHistoryMonths: Number(process.env.BITRIX24_CALL_MONTHS ?? 1),
      onProgress: (m) => console.log(`  ${stamp()} ${m}`),
    })

    const health = await provider.healthCheck()
    console.log(`  ${health.ok ? '✓' : '✗'} ${health.detail}\n`)
    if (!health.ok) process.exit(1)

    if (RESET) {
      /**
       * Demo rows go first, and only demo rows.
       *
       * Deleting by provenance rather than truncating means a re-run after a
       * partial import keeps what it already fetched. Order follows the
       * foreign keys inward-out; the cascades cover items, payments, history
       * and calls.
       */
      console.log('  Demo maʼlumotlari oʻchirilmoqda…')
      const demo = { externalSource: 'DEMO' as const }
      await prisma.dealItem.deleteMany({ where: demo })
      await prisma.payment.deleteMany({ where: demo })
      await prisma.deal.deleteMany({ where: demo })
      await prisma.customer.deleteMany({ where: demo })
      await prisma.dealStage.deleteMany({ where: demo })
      await prisma.salesSource.deleteMany({ where: demo })
      await prisma.product.deleteMany({ where: demo })
      await prisma.productCategory.deleteMany({ where: demo })
      await prisma.employee.deleteMany({ where: demo })
      await prisma.department.deleteMany({ where: demo })
      console.log('  ✓ Demo tozalandi\n')
    }

    const engine = new SyncEngine({
      provider,
      store: new PrismaSyncStore(prisma),
      handlers: createSyncHandlers(prisma, 'BITRIX24'),
      pageSize: 500,
      logger,
    })

    console.log('  Import boshlandi…\n')
    const results = await engine.runAll([...SYNC_ORDER], MODE)

    console.log('\n  entity              status      read   created   updated   skipped   failed')
    console.log('  ' + '-'.repeat(76))
    for (const r of results) {
      console.log(
        '  ' +
          r.entity.padEnd(20) +
          r.status.padEnd(10) +
          String(r.recordsRead).padStart(8) +
          String(r.recordsCreated).padStart(10) +
          String(r.recordsUpdated).padStart(10) +
          String(r.recordsSkipped).padStart(10) +
          String(r.recordsFailed).padStart(9),
      )
    }

    // ---- Totals, for comparison against Bitrix24's own reports -------------
    const [pipelines, deals, revenue, all, employees, customers, products, items, history, calls] =
      await Promise.all([
        prisma.pipeline.findMany({ orderBy: { sortOrder: 'asc' }, select: { name: true, role: true, _count: { select: { deals: true } } } }),
        prisma.deal.count(),
        prisma.deal.aggregate({
          where: { countsAsRevenue: true, status: 'WON' },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        prisma.deal.aggregate({ where: { status: 'WON' }, _sum: { amountMinor: true } }),
        prisma.employee.count(),
        prisma.customer.count(),
        prisma.product.count(),
        prisma.dealItem.count(),
        prisma.dealStageHistory.count(),
        prisma.callRecord.count(),
      ])

    console.log('\n  ' + '━'.repeat(74))
    console.log('  VORONKALAR')
    console.log('  ' + '━'.repeat(74))
    for (const p of pipelines) {
      console.log(`  ${p.name.padEnd(26)} ${p.role.padEnd(14)} ${String(p._count.deals).padStart(8)}`)
    }

    console.log('\n  ' + '━'.repeat(74))
    console.log('  NATIJA')
    console.log('  ' + '━'.repeat(74))
    console.log(`  Bitimlar (jami)   : ${deals.toLocaleString('en-US')}`)
    console.log(`  Daromadli yutuq   : ${revenue._count._all.toLocaleString('en-US')}`)
    console.log(`  Tushum            : ${money(revenue._sum.amountMinor ?? 0n)} soʻm`)
    console.log(`  Xodimlar          : ${employees}`)
    console.log(`  Mijozlar          : ${customers.toLocaleString('en-US')}`)
    console.log(`  Mahsulotlar       : ${products}`)
    console.log(`  Mahsulot qatori   : ${items.toLocaleString('en-US')}`)
    console.log(`  Bosqich tarixi    : ${history.toLocaleString('en-US')}`)
    console.log(`  Qoʻngʻiroqlar     : ${calls.toLocaleString('en-US')}`)

    /**
     * The duplicate guard, stated out loud.
     *
     * If these two ever match, `countsAsRevenue` has stopped filtering and
     * every revenue figure in the dashboard is roughly double the truth.
     */
    const excluded = (all._sum.amountMinor ?? 0n) - (revenue._sum.amountMinor ?? 0n)
    console.log(`\n  Hisobga kirmagan yutuqlar (База va boshqalar): ${money(excluded)} soʻm`)
    console.log(`  Vaqt: ${hhmmss(Date.now() - started)}\n`)

    if (results.some((r) => r.status === 'FAILED')) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('\n  Import xatosi:', error, '\n')
  process.exit(1)
})
