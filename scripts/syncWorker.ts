/**
 * Continuous Bitrix24 synchronisation.
 *
 *     npm run bitrix:worker
 *
 * Keeps the database within about a minute of the portal, so the dashboard is
 * current without anyone pressing anything. The browser refetches on the same
 * cadence; the two together are what make an always-open screen trustworthy.
 *
 * WHAT RUNS HOW OFTEN
 * Transactional data — deals, stage history, calls, contacts — changes
 * constantly and is read every tick. Reference data — employees, departments,
 * products, pipelines, stages, sources, stores — changes a few times a month,
 * and re-reading it sixty times an hour would spend the portal's rate limit on
 * rows that are already correct. It runs on its own slower cadence and on the
 * first tick after startup.
 *
 * WHY IT IS SAFE TO RUN FOREVER
 * Every write is an upsert keyed on the source record's own id, so a tick that
 * overlaps the previous one cannot double anything. Each entity carries its own
 * watermark, advanced only after a clean run — a failed tick re-reads the same
 * window next time rather than skipping it.
 *
 * ONE AT A TIME
 * A Postgres advisory lock makes a second worker refuse to start rather than
 * race the first. Two running at once produced foreign-key rejections on call
 * records and spent twice the portal's rate limit for no extra freshness. The
 * lock is held by the connection, so it releases automatically if the process
 * dies without cleaning up — the case a flag column in a table gets wrong.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import type { SyncEntityValue } from '../src/server/domain/types'
import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { createSyncHandlers } from '../src/server/integrations/crm/sync/handlers'
import { PrismaSyncStore } from '../src/server/integrations/crm/sync/PrismaSyncStore'
import { SyncEngine } from '../src/server/integrations/crm/sync/SyncEngine'

const DATABASE_URL = process.env.DATABASE_URL
const WEBHOOK_URL = process.env.BITRIX24_WEBHOOK_URL

if (!DATABASE_URL || !WEBHOOK_URL) {
  console.error('\n  DATABASE_URL va BITRIX24_WEBHOOK_URL kerak.\n')
  process.exit(1)
}

/** Seconds between ticks. One minute is the design point. */
const INTERVAL_SEC = Number(process.env.SYNC_INTERVAL_SEC ?? 60)

/** How many ticks between reference-data refreshes. Default: every 30 minutes. */
const REFERENCE_EVERY = Number(process.env.SYNC_REFERENCE_EVERY ?? 30)

/** Read on every tick. */
const HOT: SyncEntityValue[] = ['CUSTOMERS', 'DEALS', 'DEAL_ITEMS', 'STAGE_HISTORY', 'CALLS']

/** Read occasionally. Order matters — deals reference all of these. */
const REFERENCE: SyncEntityValue[] = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCTS',
  'PIPELINES',
  'STAGES',
  'SOURCES',
  'STORES',
  'STOCK',
]

const url: string = DATABASE_URL
const webhook: string = WEBHOOK_URL

function stamp(): string {
  return new Date().toISOString().slice(11, 19)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Arbitrary but fixed. Advisory locks are namespaced only by this number, so
 * it must be stable across deploys and unlikely to collide with anything else
 * using the same database.
 */
const LOCK_ID = 8_872_601

async function main() {
  const pool = new Pool({ connectionString: url })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const [lock] = await prisma.$queryRawUnsafe<{ locked: boolean }[]>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    LOCK_ID,
  )

  if (!lock?.locked) {
    console.error(
      '\n  Boshqa worker allaqachon ishlayapti — bu nusxa toʻxtatildi.' +
        '\n  Ikkitasi bir vaqtda ishlasa portal limitini ikki barobar sarflaydi.\n',
    )
    await prisma.$disconnect()
    await pool.end()
    process.exit(0)
  }

  const provider = new Bitrix24CrmProvider({
    webhookUrl: webhook,
    rateLimitRps: Number(process.env.BITRIX24_RATE_LIMIT_RPS ?? 2),
    requestTimeoutMs: Number(process.env.BITRIX24_REQUEST_TIMEOUT_MS ?? 30_000),
    callHistoryMonths: Number(process.env.BITRIX24_CALL_MONTHS ?? 1),
  })

  const engine = new SyncEngine({
    provider,
    store: new PrismaSyncStore(prisma),
    handlers: createSyncHandlers(prisma, 'BITRIX24'),
    logger: {
      info: () => {},
      warn: (o, m) => console.warn(`  ${stamp()} ! ${m ?? ''}`, o ?? ''),
      error: (o, m) => console.error(`  ${stamp()} ✗ ${m ?? ''}`, o ?? ''),
    },
  })

  const health = await provider.healthCheck()
  console.log(`\n  ${health.ok ? '✓' : '✗'} ${health.detail}`)
  if (!health.ok) process.exit(1)

  console.log(
    `  Sinxronizatsiya har ${INTERVAL_SEC}s. Maʼlumotnomalar har ${REFERENCE_EVERY} tsiklda.\n`,
  )

  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // Finish the tick in flight rather than leaving a half-written batch.
      console.log(`\n  ${stamp()} toʻxtatilmoqda…`)
      stopping = true
    })
  }

  let tick = 0
  /**
   * Consecutive failures, for backoff.
   *
   * The portal blocks a method for about ten minutes when it decides a read
   * was too expensive. Hammering it every minute through that window keeps the
   * block alive; backing off lets it clear.
   */
  let failures = 0

  while (!stopping) {
    const started = Date.now()
    const entities = tick % REFERENCE_EVERY === 0 ? [...REFERENCE, ...HOT] : HOT

    try {
      const results = await engine.runAll(entities, 'INCREMENTAL')
      const changed = results.reduce((sum, r) => sum + r.recordsCreated + r.recordsUpdated, 0)
      const failed = results.filter((r) => r.status === 'FAILED')

      if (failed.length > 0) {
        failures += 1
        console.warn(
          `  ${stamp()} ${failed.map((r) => r.entity).join(', ')} muvaffaqiyatsiz` +
            ` (${failures}-marta ketma-ket)`,
        )
      } else {
        failures = 0
        // Silent when nothing moved: a worker that logs every idle minute
        // buries the ticks that did something.
        if (changed > 0) {
          const detail = results
            .filter((r) => r.recordsCreated + r.recordsUpdated > 0)
            .map((r) => `${r.entity.toLowerCase()} ${r.recordsCreated + r.recordsUpdated}`)
            .join(', ')
          console.log(
            `  ${stamp()} ${changed} yozuv yangilandi — ${detail}` +
              `  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
          )
        }
      }
    } catch (error) {
      failures += 1
      console.error(`  ${stamp()} ✗ tsikl xatosi:`, error)
    }

    tick += 1

    /**
     * Wait out the rest of the interval, not the whole interval.
     *
     * A tick that took forty seconds should be followed by twenty, not sixty —
     * otherwise the effective cadence drifts with how much work there was.
     */
    const backoff = Math.min(failures, 5) * INTERVAL_SEC * 1000
    const remaining = INTERVAL_SEC * 1000 - (Date.now() - started) + backoff

    if (remaining > 0 && !stopping) await sleep(remaining)
  }

  await prisma.$disconnect()
  await pool.end()
  console.log(`  ${stamp()} toʻxtadi.\n`)
}

main().catch((error) => {
  console.error('\n  Worker xatosi:', error, '\n')
  process.exit(1)
})
