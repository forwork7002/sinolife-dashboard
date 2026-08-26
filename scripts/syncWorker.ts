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
 * A Postgres advisory lock keeps a second worker out rather than letting it
 * race the first. Two running at once produced foreign-key rejections on call
 * records and spent twice the portal's rate limit for no extra freshness.
 *
 * The lock lives on a connection held open for the life of the process, NOT on
 * a pooled one — a pooled connection goes back to the pool the moment the
 * query returns and Postgres drops the lock with it, which looks like it works
 * and enforces nothing. Holding it on a dedicated client also means it
 * releases by itself if the process dies without cleaning up, the case a flag
 * column in a table gets wrong.
 *
 * A second copy WAITS instead of exiting. On a rolling redeploy the new worker
 * starts before the old one has finished its tick, and a worker that exits is
 * a worker the platform restarts — so exiting here would produce a restart
 * loop until the old process happened to go away. Waiting turns the same
 * situation into a few quiet seconds of overlap.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import type { PoolClient } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

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

/**
 * Interruptible sleep.
 *
 * A plain setTimeout would hold SIGTERM for as long as the wait — up to six
 * minutes once backoff is in play — and the platform kills a container that
 * takes longer than thirty seconds to stop. `wake` is called by the signal
 * handler so shutdown is immediate whenever a tick is not in flight.
 */
let wake: () => void = () => {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    wake = finish
    function finish() {
      clearTimeout(timer)
      wake = () => {}
      resolve()
    }
  })
}

/**
 * Arbitrary but fixed. Advisory locks are namespaced only by this number, so
 * it must be stable across deploys and unlikely to collide with anything else
 * using the same database.
 */
const LOCK_ID = 8_872_601

/** Seconds between attempts while another worker still holds the lock. */
const LOCK_RETRY_SEC = 10

/**
 * Take the single-worker lock, waiting for it if someone else has it.
 *
 * Returns the client the lock is held on. Keeping a reference matters: the
 * lock lives as long as that connection and not a moment longer.
 */
async function acquireLock(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect()

  // Postgres cannot tell us the lock was lost, so if this connection breaks
  // we are no longer the only worker and must not keep writing.
  client.on('error', (error) => {
    console.error(`\n  ${stamp()} ✗ blokirovka ulanishi uzildi:`, error, '\n')
    process.exit(1)
  })

  let waited = false

  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [LOCK_ID],
    )

    if (rows[0]?.locked) {
      if (waited) console.log(`  ${stamp()} blokirovka olindi — ishga tushdi.`)
      return client
    }

    if (!waited) {
      waited = true
      console.log(
        `\n  ${stamp()} boshqa worker ishlayapti — u toʻxtaguncha kutilmoqda.` +
          `\n  (Ikkitasi bir vaqtda ishlasa portal limitini ikki barobar sarflaydi.)\n`,
      )
    }

    await sleep(LOCK_RETRY_SEC * 1000)
  }
}

async function main() {
  // Five: one is checked out permanently to hold the advisory lock, and the
  // sync engine runs one query at a time, so the rest is headroom. The point
  // of the cap is the managed database's 22-connection ceiling, which the web
  // service and the deploy jobs also draw on.
  const pool = new Pool(poolConfig(url, { caCert: caCertFromEnv(), max: 5 }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const lockClient = await acquireLock(pool)

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
      // Finish the tick in flight rather than leaving a half-written batch,
      // but cut short any wait — the platform allows thirty seconds to stop.
      console.log(`\n  ${stamp()} toʻxtatilmoqda…`)
      stopping = true
      wake()
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

  // Releasing the lock explicitly lets a replacement worker start at once
  // instead of waiting out the connection's own timeout.
  await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
  lockClient.release()
  await prisma.$disconnect()
  await pool.end()
  console.log(`  ${stamp()} toʻxtadi.\n`)
}

main().catch((error) => {
  console.error('\n  Worker xatosi:', error, '\n')
  process.exit(1)
})
