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

import { spawn } from 'node:child_process'

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
import { historyBackfillCursor } from '../src/server/integrations/crm/sync/backfill'
import { importMetaSpend } from '../src/server/integrations/meta/metaImport'
import { zonedDateKey } from '../src/server/domain/period/period'
import {
  type DealsBackfill,
  isBackfillDue,
  isPassDue,
  SWEEP_RETRY_MS,
} from '../src/server/integrations/crm/sync/schedule'
import {
  classifyRefusal,
  refusalCode,
  SELF_LIMIT_CODE,
} from '../src/server/integrations/crm/bitrix24/refusal'
import type { RefusalClass } from '../src/server/integrations/crm/bitrix24/refusal'
import { FRESHNESS_ENTITIES } from '../src/server/repositories/referenceRepository'

const DATABASE_URL = process.env.DATABASE_URL
const WEBHOOK_URL = process.env.BITRIX24_WEBHOOK_URL

if (!DATABASE_URL || !WEBHOOK_URL) {
  console.error('\n  DATABASE_URL va BITRIX24_WEBHOOK_URL kerak.\n')
  process.exit(1)
}

/** Seconds between ticks. One minute is the design point. */
const INTERVAL_SEC = Number(process.env.SYNC_INTERVAL_SEC ?? 60)

/**
 * How many ticks between reference-data refreshes. Default: every three hours.
 *
 * WAS THIRTY MINUTES, AND NOTHING IT READS MOVES THAT FAST. Departments,
 * employees, products, pipelines, stages and sources change a few times
 * a MONTH — the file header says so — and this pass was asking the portal about
 * all of them 48 times a day. `PRODUCTS` pages through
 * `catalog.*` fifty rows at a time, so the pass is not one request but dozens.
 *
 * Three-hourly is 8 passes a day instead of 48. What that delays: a new
 * department head named in Bitrix24 reaches the org chart, the ROP picker and
 * a TEAM account's scope up to three hours later instead of thirty minutes.
 * Nobody's money moves — every analytic reads `employee."departmentId"`, which
 * this pass writes, and a head appointed at eleven who appears at two is not a
 * reporting error. If a specific hand-over needs to land now,
 * `npm run bitrix:resync -- DEPARTMENTS EMPLOYEES` does it in seconds.
 */
const REFERENCE_EVERY = Number(process.env.SYNC_REFERENCE_EVERY ?? 180)

/**
 * How many ticks between Roistat imports. Default: hourly.
 *
 * The marketing module reads a SECOND source — the client's published page,
 * not Bitrix24 — and without this it only ever refreshed when someone ran
 * `npm run roistat:import` by hand. On a deployed dashboard that means the
 * Reklama samarasi screen quietly freezes at whatever the last manual run
 * saw, which is exactly the failure the freshness panel exists to expose and
 * the one nobody notices because the page still renders numbers.
 *
 * Hourly, not every minute: the source is a 5.5 MB static page regenerated by
 * the client on their own schedule, and its sheet-fed dimensions move a few
 * times a day. Re-reading it sixty times an hour would spend bandwidth to
 * re-import bytes that did not change — the importer's own digest check
 * proves that, printing "0 changed" on a re-run.
 *
 * Set to 0 to turn it off.
 */
const ROISTAT_EVERY = Number(process.env.SYNC_ROISTAT_EVERY ?? 60)

/**
 * Meta Ads spend, every N ticks — hourly at the one-minute tick. Off without
 * `META_ACCESS_TOKEN`. In-process, unlike Roistat: fourteen accounts' daily
 * rows are a few hundred small objects, not a five-megabyte page, and the
 * calls go to Meta, never to Bitrix24, so the portal's budget is untouched.
 */
const META_EVERY = Number(process.env.SYNC_META_EVERY ?? 60)
const META_TOKEN = process.env.META_ACCESS_TOKEN?.trim() || null

/**
 * How many ticks between deletion sweeps. Default: 60 = hourly.
 *
 * A deletion is rare and a stale row is quiet — nobody notices until they go
 * looking for an order they removed and find it still counted. Hourly is
 * often enough that a test deal does not survive the afternoon, and rare
 * enough that the FULL pass it needs is not competing with the minute tick.
 *
 * SIX-HOURLY SINCE 2026-09-15, AND THIS IS THE SINGLE BIGGEST THING WE STOPPED
 * SPENDING ON THE PORTAL.
 *
 * Measured: `listDealIds` walks all 464 396 deals at 2 500 a round trip = 180
 * requests, which at the 2 rps limiter is ninety seconds of continuous traffic.
 * Hourly, that was 4 320 requests a day — 32% of the worker's ENTIRE volume —
 * carrying 9 000 `crm.deal.list` invocations an hour against that method's
 * ten-minute operating basket, to detect an event this comment itself calls
 * rare. Bitrix24's own helpdesk names «an app that checks all CRM activities
 * every five minutes» as the kind of thing that earns an administrative block,
 * and on 2026-09-14 and again on 2026-09-15 this portal issued one.
 *
 * 24 bursts a day become 4: 4 320 requests → 720, with no change to the walk,
 * to `sweepByAntiJoin` or to the short-read guard, so nothing about correctness
 * moves.
 *
 * DAILY SINCE 2026-09-16, FOR THE SAME REASON ONE STEP FURTHER, AND BECAUSE IT
 * IS NOW THE LARGEST THING LEFT.
 *
 * The narrow chain (`CHAIN_MIN` in the provider) took the hot path from
 * ~288 000 method invocations a day to ~11 500. That did not touch the sweep,
 * which walks a fixed 464 396 ids however narrow the chain is — so at six
 * bursts a day it went from a third of our volume to about THREE QUARTERS of
 * it: 37 200 invocations against the hot path's 11 500. Cutting the biggest
 * remaining item is the whole of this instruction.
 *
 * One burst a day, ~9 300 invocations. Nothing about the walk,
 * `sweepByAntiJoin` or the short-read guard moves; correctness is untouched.
 *
 * WHAT IT COSTS, SAID PLAINLY: a deal deleted in the portal can be counted
 * here for up to a DAY. Read a day-old test deal as this setting, not as a
 * sync fault — and if the client wants the old latency back, it is
 * `SYNC_SWEEP_EVERY` on the deployed app and no deploy. The cheaper thing to
 * do first is to ask whether the number they are checking is one a deletion
 * would move at all.
 *
 * Set to 0 to switch it off.
 */
const SWEEP_EVERY = Number(process.env.SYNC_SWEEP_EVERY ?? 1440)

/**
 * How far back the stage history is re-read once, at startup. Default: 45 days.
 *
 * A LOST ARRIVAL ROW TAKES AN ORDER OFF THE BOARD AND SAYS NOTHING. The
 * Тасдиклаш queue is cohorted on the deal's entry into `C4:NEW`, so that one
 * row IS the order's membership — and until the watermark learned to rewind
 * after a skipped run (`SKIP_LOOKBACK_MS` in SyncEngine.ts), a row whose deal
 * had not been imported yet was dropped and never offered again. Measured
 * against the client's own board on 2026-09-03: 927148 and 928094 both reached
 * the queue on 31 August, both are absent from this database, and the deals
 * themselves are here — only their arrivals are missing.
 *
 * The engine fix stops new gaps. It cannot close the old ones, because the
 * portal is only ever asked for rows newer than the cursor. So the cursor is
 * wound back once per start, and the ordinary incremental pass repairs
 * whatever it finds — every write is the same idempotent upsert, so re-reading
 * a row that is already correct costs a write and changes nothing.
 *
 * FORTY-FIVE DAYS IS SIZED, NOT GUESSED. It is 76 000 of this portal's 222 000
 * history rows: about thirty batched round trips, a few seconds of reading and
 * one pass of chunked upserts. Compare the deletion sweep, which is why tick 0
 * is otherwise kept clear — that one walked 434 000 deals and took thirty
 * minutes, and with deploys landing several times a day the worker spent its
 * life in it. This is under a minute, once, and it is also a standing net: any
 * gap inside the window heals at the next restart even if some future skip
 * escapes the lookback.
 *
 * Set to 0 to switch it off.
 */
const HISTORY_BACKFILL_DAYS = Number(process.env.SYNC_HISTORY_BACKFILL_DAYS ?? 45)

/*
  THE TEN-MINUTE WAIT MOVED, IT DID NOT GO.

  `THROTTLED_WAIT_MS` lived here — a flat ten minutes after any refusal, put in
  by the 2026-09-14 incident because a portal refusing the whole REST surface is
  not our error to retry out of. It is now the CEILING of `PortalGate`'s probe
  ladder (`THROTTLE_LADDER_MS` in portalGate.ts), which keeps the bound it set
  while fixing what it could not do: a flat wait cannot notice a block that
  lifted after ninety seconds, so recovery always cost the full ten minutes.

  THE BOUND IS ALSO A PROMISE MADE IN WRITING. The ticket opened with Bitrix24
  support after the 2026-09-14 block says this integration backs off when it is
  refused. The ladder honours that more strictly than the flat wait did — it
  sends ONE `profile` where a tick sent three to twelve — but the ceiling is
  what bounds the worst case, and it should not be raised without remembering
  what it answers to.
*/

/**
 * The heap the Roistat child is allowed, in megabytes.
 *
 * Deliberately NOT the worker's own 768 — see `runRoistatImport` for the
 * measurement that forced this. Roughly ten times the working set of the 5.5 MB
 * page it parses, and a third of the container, so parent and child together
 * cannot reach the ceiling. If the importer ever genuinely needs more it dies
 * with a JavaScript heap error naming this constant: one passenger failing
 * diagnosably, which is the whole point of it being a child process.
 */
const ROISTAT_HEAP_MB = 320

/**
 * Read on every tick.
 *
 * These four are what every screen in the product is built on: the deal, its
 * items, its stage history and the customer. A minute late on any of them is
 * a minute the confirmation queue, the sellers board and the payroll are
 * wrong, which is the whole reason this worker runs at all.
 */
const HOT: SyncEntityValue[] = ['CUSTOMERS', 'DEALS', 'DEAL_ITEMS', 'STAGE_HISTORY']

/**
 * Read occasionally. Order matters — deals reference all of these.
 *
 * `STORES` AND `STOCK` LEFT THIS LIST ON 2026-09-16, and each was a portal
 * method spent on a table NOTHING READS. `CALLS` left with them at 15:32 and
 * CAME BACK THE SAME EVENING, the way the paragraph below says it should: «Mijozlar
 * va qoʻngʻiroqlar» reads `call_record` now. It costs roughly 60–120 invocations
 * a pass on this three-hourly clock — three hours of new calls plus the three
 * hours `SETTLE_LOOKBACK_MS` re-reads so a call stored mid-conversation gets its
 * finished duration — against the 15 000-an-hour `portalBudget`. LAST in the
 * list, so its employee and customer links resolve against the passes above it.
 * What follows was written about all three and still holds for the other two. `store` and `stock_level` have
 * no reader since «Joʻnatish nuqtalari» was paused, and
 * `catalog.storeproduct.list` returns zero rows on this portal anyway;
 * `call_record` has had no reader since `/insights/calls` went in the
 * 2026-09-10 cull. On a portal that blocked us three mornings running, a
 * request for data nobody renders is the one kind with no argument for it.
 *
 * REMOVED FROM THE SCHEDULE, NOT FROM THE CODE. The handlers, the provider
 * methods and the tables stay, so the day a screen needs one of them again it
 * is `npm run bitrix:resync -- CALLS` to fill it and one line here to keep it
 * current — and the history already imported is not thrown away.
 */
const REFERENCE: SyncEntityValue[] = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCTS',
  'PIPELINES',
  'STAGES',
  'SOURCES',
  'CALLS',
]

const url: string = DATABASE_URL
const webhook: string = WEBHOOK_URL

function stamp(): string {
  return new Date().toISOString().slice(11, 19)
}

/** A failure that never reached the portal: a socket, or the gate holding one. */
const NETWORK_FAILURE = /fetch failed|UND_ERR_|ECONN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|gate: UNKNOWN/

/**
 * Ticks after a recovery that run the hot entities only.
 *
 * On 2026-09-16 11:35 UTC the address block lifted for a moment, the probe got
 * through, and the worker answered with a reference tick — twelve entities back
 * to back — and was dropped again inside a minute. The reference pass, the
 * sweep and anything else scheduled onto the recovery tick wait until the
 * portal has taken this many ordinary ticks from us.
 */
const CALM_TICKS = 3

/** How long `sync_log` keeps a row. Every diagnostic in CLAUDE.md reads days, not months. */
const SYNC_LOG_RETENTION_MS = 30 * 86_400_000

/**
 * Keep `sync_log` a working log rather than an archive.
 *
 * It grows ~3 000 rows a day at the 120 s tick and nothing ever deleted one:
 * 126 000 rows by 2026-09-17, every query on it an index walk that gets longer.
 * And ~270 of them were `RUNNING` forever — a pass whose process was killed
 * mid-tick (a deploy, the OOM kills of 2026-09-14) never writes its ending. A
 * pass cannot run for a day, so a day-old `RUNNING` row is a dead process, not
 * a slow one. Run at startup and after each daily sweep; never fatal.
 */
async function pruneSyncLog(db: PrismaClient): Promise<void> {
  const now = Date.now()
  try {
    const { count } = await db.syncLog.deleteMany({
      where: {
        OR: [
          { startedAt: { lt: new Date(now - SYNC_LOG_RETENTION_MS) } },
          { status: 'RUNNING', startedAt: { lt: new Date(now - 86_400_000) } },
        ],
      },
    })
    if (count > 0) console.log(`  ${stamp()} sync_log: ${count} ta eski yozuv oʻchirildi`)
  } catch (error) {
    console.warn(`  ${stamp()} ! sync_log tozalanmadi:`, error)
  }
}

/**
 * THE ONE-OFF DEALS RE-READ, requested in code. Null when nothing is owed.
 *
 * Set on 2026-09-19 for «Target tahlili»: three new deal columns (targetolog,
 * creative, primarySource) that the sync fills only on deals the portal
 * touches again. This re-reads everything modified since 1 August, once, in
 * the night window, through THIS process's provider — the same 2 rps limiter,
 * hourly ceiling and refusal gate as the minute tick, so there is never a
 * second process asking the portal for anything. Settled by a `DEALS /
 * BACKFILL` success in `sync_log` after `requestedAt`; dropped unserved after
 * `BACKFILL_EXPIRES_MS`. The next column that needs one replaces this value.
 */
const DEALS_BACKFILL: DealsBackfill | null = {
  since: new Date('2026-08-01T00:00:00+05:00'),
  requestedAt: new Date('2026-09-19T00:00:00+05:00'),
}

const WORKER_TIME_ZONE = process.env.APP_TIMEZONE ?? 'Asia/Tashkent'

/** How recent a logged refusal must be to start the next worker already closed. */
const SEED_MAX_AGE_MS = 15 * 60_000

/**
 * What the process that died in the block already wrote down.
 *
 * Two index walks on `@@index([status, finishedAt(sort: Desc)])`, no portal
 * call. Returns nothing unless the newest failure is NEWER than the last
 * success the freshness clock trusts — a failure sitting behind a success is a
 * blip that already healed — and unless it is recent enough to still be true.
 */
async function lastRefusal(
  db: PrismaClient,
  now: Date,
): Promise<{ kind: RefusalClass; code: string; since: Date } | null> {
  const [failure, success] = await Promise.all([
    db.syncLog.findFirst({
      where: { status: 'FAILED' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, errorMessage: true },
    }),
    db.syncLog.findFirst({
      where: { status: { in: ['SUCCESS', 'PARTIAL'] }, entity: { in: [...FRESHNESS_ENTITIES] } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    }),
  ])

  const at = failure?.finishedAt
  if (!at) return null
  if (success?.finishedAt && success.finishedAt >= at) return null
  if (now.getTime() - at.getTime() > SEED_MAX_AGE_MS) return null

  /*
    AN UNREACHABLE PORTAL IS REMEMBERED TOO. Neither «fetch failed
    [UND_ERR_CONNECT_TIMEOUT]» nor the gate's own «Bitrix24 gate: UNKNOWN …
    not sent» carries a portal code, so `classifyRefusal` reads both as
    nothing — and every redeploy inside the 2026-09-16 address block opened
    with a health check and a reference tick into the firewall that was
    dropping us.
  */
  const kind =
    classifyRefusal(failure.errorMessage) ??
    (NETWORK_FAILURE.test(failure.errorMessage ?? '') ? 'TRANSIENT' : null)
  if (kind !== 'THROTTLE' && kind !== 'CREDENTIAL' && kind !== 'TRANSIENT') return null

  return { kind, code: refusalCode(failure.errorMessage) ?? 'UNKNOWN', since: at }
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

/**
 * The Roistat import, as a CHILD PROCESS rather than an inlined call.
 *
 * `scripts/importRoistat.ts` opens its own pool, owns its own transaction and
 * calls `process.exit(1)` on failure — a design that is right for a command
 * someone runs and fatal for a loop that must survive it. Spawning isolates
 * all three: a Roistat failure cannot exit this worker, cannot poison its
 * Prisma client, and cannot leave a half-open pool behind. The cost is one
 * process start an hour, which is nothing against a tick that already spends
 * thirty seconds waiting on Bitrix24.
 *
 * Never throws. The Bitrix sync is the worker's job; marketing is a passenger
 * and a passenger does not get to stop the vehicle.
 *
 * THE CHILD GETS ITS OWN, SMALLER HEAP — and that is what stopped this worker
 * dying seventeen times a day. See `ROISTAT_HEAP_MB`.
 */
async function runRoistatImport(): Promise<void> {
  await new Promise<void>((resolve) => {
    /*
      `env: process.env` MINUS `NODE_OPTIONS`, with the cap on argv instead.

      The platform sets NODE_OPTIONS=--max-old-space-size=768 on this worker and
      a spawned child inherits the whole environment — so a 1 024 MB container
      held TWO V8 isolates, each believing it could take 768 MB. Neither ever
      felt pressure, neither collected defensively, and neither raised a
      JavaScript OOM: the kernel got there first, which is exactly why no
      out-of-memory message was ever in any log.

      Measured on production 2026-09-14, before this change: the worker's own
      RSS is flat at 262-297 MB for a whole hour and the deletion sweep adds
      about 65 MB, while DigitalOcean's own metric caught the container at
      999.0 MB of 1 024 — during the tick-60 window, the only tick that runs the
      sweep AND this import. Fifteen restarts in 24 hours, every one beginning
      the instant CALLS finished, i.e. inside this block; twelve killed the
      container, three got through. Nothing else in the process is big enough to
      account for the difference.
    */
    const { NODE_OPTIONS: _workerHeap, ...env } = process.env

    /*
      SPAWN CAN THROW SYNCHRONOUSLY, and the header above promises it does not.

      `spawn` raises ENOMEM or EMFILE from inside this executor rather than
      through the 'error' event — and a throw here REJECTS the promise, which
      travels up the one awaited call in the tick loop that carries no catch,
      reaches `main().catch` and exits the process. Under memory pressure at
      tick 60 that is a second, quieter way for this block to kill the worker,
      punctual and tick-aligned and indistinguishable in the data from the
      kernel doing it. Caught here, the passenger fails and the vehicle
      continues, which is what the whole child-process design is for.
    */
    let child
    try {
      child = spawn(
        process.execPath,
        [`--max-old-space-size=${ROISTAT_HEAP_MB}`, '--import', 'tsx', 'scripts/importRoistat.ts'],
        {
          cwd: process.cwd(),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (error) {
      console.warn(`  ${stamp()} roistat: ishga tushirib boʻlmadi — ${(error as Error).message}`)
      resolve()
      return
    }

    // The importer prints a full report; only its verdict belongs in this log.
    let tail = ''
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)

    // Shutdown must reach the child too: an orphaned importer would hold its
    // own pool open against a database the platform is about to take away.
    const onStop = () => child.kill('SIGTERM')
    process.once('SIGTERM', onStop)
    process.once('SIGINT', onStop)
    const done = (fn: () => void) => {
      process.off('SIGTERM', onStop)
      process.off('SIGINT', onStop)
      fn()
    }

    child.on('error', (error) => {
      done(() => {
        console.warn(`  ${stamp()} roistat: ishga tushmadi — ${error.message}`)
        resolve()
      })
    })

    child.on('close', (code, signal) => {
      done(() => {
        if (code === 0) {
          const changed = /(\d+)\s+ta oʻlchov oʻzgardi/.exec(tail)
          console.log(
            `  ${stamp()} roistat: ${changed ? `${changed[1]} oʻlchov yangilandi` : 'oʻzgarish yoʻq'}`,
          )
        } else if (code === null) {
          /*
            Killed by a signal — and WHICH signal is the whole diagnosis.

            SIGTERM is our own shutdown reaching the child mid-import: an
            interruption, not a failure, and logging it as one would put a red
            line in the log on every redeploy. SIGKILL is the kernel, which on a
            1 024 MB container means the memory ceiling — the death this worker
            spent seventeen restarts a day hiding behind an unnamed
            `code === null`. Naming it is how the next one is diagnosable
            without container logs nobody can read.
          */
          console.log(
            `  ${stamp()} roistat: toʻxtatildi (${signal ?? 'signalsiz'})` +
              (signal === 'SIGKILL' ? ' — xotira chegarasi boʻlishi mumkin' : '') +
              ' — keyingi tsiklda qaytadan uriniladi',
          )
        } else {
          const reason = /✗ IMPORT TOʻXTADI\s*\n\s*\n\s*(.+)/.exec(tail)
          console.warn(
            `  ${stamp()} roistat: muvaffaqiyatsiz (kod ${code})` +
              (reason ? ` — ${reason[1].trim().slice(0, 160)}` : ''),
          )
        }
        resolve()
      })
    })
  })
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

  /*
    Held in a const, not inlined into the SyncEngine, because the deletion
    sweep below calls `deleteMissing` on the DEALS handler directly rather
    than going through the engine. See the sweep block for why.
  */
  const handlers = createSyncHandlers(prisma, 'BITRIX24')
  const dealsHandler = handlers.find((h) => h.entity === 'DEALS')

  const store = new PrismaSyncStore(prisma)

  const engine = new SyncEngine({
    provider,
    store,
    handlers,
    logger: {
      info: () => {},
      warn: (o, m) => console.warn(`  ${stamp()} ! ${m ?? ''}`, o ?? ''),
      error: (o, m) => console.error(`  ${stamp()} ✗ ${m ?? ''}`, o ?? ''),
    },
  })

  /*
    A FAILED HEALTH CHECK IS REPORTED, NOT FATAL — and that changed on
    2026-09-14, when Bitrix24 blocked its own REST API for a quarter of an
    hour («OVERLOAD_LIMIT — REST API is blocked due to overload»).

    `process.exit(1)` here turns exactly that state into a restart loop: the
    platform brings the worker back, the portal is still throttling, the
    process exits again — and every cycle pays the startup cost and issues the
    same call that is being refused, which is the last thing a portal
    complaining about load needs from us. Meanwhile nothing syncs even in the
    minute AFTER the block lifts, because the process that would have noticed
    is gone.

    The tick loop already handles a portal that will not answer: it logs, it
    counts consecutive failures and it backs off up to five minutes between
    ticks. Starting into that loop is strictly better than not starting.

    What is lost is the fast fail on a genuinely bad configuration — a
    mistyped webhook never gets a first reading. The line below still says so
    on the first line of the log, and the dashboard's own header now names the
    portal's error code (see `AlertsDto.syncError`), which is a better place
    for it than a container nobody is watching.
  */
  /*
    START ALREADY KNOWING. The database was told about the block by the process
    that died in it — reading that back costs two index walks and no portal
    call at all.

    Measured 2026-09-15: a restart inside a block cost ~11 requests, one for the
    health check and ten because tick 0 is always a reference tick
    (`0 % REFERENCE_EVERY === 0`). At the ~17 restarts a day this worker was
    recording, that is ~187 requests a day spent re-discovering a block we
    already knew about, issued at exactly the moment the portal is complaining
    about load. Seeded, the same restart costs 0 until a probe is due.

    THE FIFTEEN-MINUTE BOUND IS WHAT KEEPS THIS HONEST. A database left idle
    over a weekend must not start the worker blocked on a Friday failure, so
    only a recent refusal — and only one NEWER than the last success — seeds
    anything. Anything older, and the worker starts by asking the portal, which
    is the right default.
  */
  try {
    const seeded = await lastRefusal(prisma, new Date())
    if (seeded) {
      provider.gate.seed(seeded.kind, seeded.code, seeded.since, new Date())
      console.log(
        `  ${stamp()} oldingi tsikl ${seeded.code} bilan toʻxtagan` +
          ` (${seeded.since.toISOString()}) — portal zondlanadi, toʻliq tsikl emas.`,
      )
    }
  } catch (error) {
    // Never fatal: not knowing costs one refused request, which is what the
    // worker did before this existed.
    console.warn(`  ${stamp()} ! oldingi holat oʻqilmadi:`, error)
  }

  /*
    The health check is SKIPPED when the gate was seeded shut. It is one more
    request into a door the database just told us is closed, and `probe()` on
    the ladder asks the same question at a time worth asking it.
  */
  if (!provider.gate.isOpen()) {
    const health = await provider.healthCheck()
    console.log(`\n  ${health.ok ? '✓' : '✗'} ${health.detail}`)
    if (!health.ok && NETWORK_FAILURE.test(health.detail)) {
      // Unreachable, not refused: shut the gate now rather than following up
      // with a dozen reference-tick connections. The ladder probes from here.
      provider.gate.seed('TRANSIENT', 'UNKNOWN', new Date(), new Date())
      console.warn(`  ${stamp()} ! portalga ulanib boʻlmadi — tekshiruv jadval boʻyicha, toʻliq tsikl emas.`)
    } else if (!health.ok) {
      console.warn(
        `  ${stamp()} ! portal javob bermadi — tsikl baribir boshlanadi,` +
          ' xatolar har tsiklda qayd etiladi.',
      )
    }
  }

  /*
    WIND THE HISTORY CURSOR BACK, ONCE, BEFORE THE FIRST TICK.

    See `HISTORY_BACKFILL_DAYS`. The first ordinary incremental pass then
    re-reads the window and upserts whatever it finds, which is what repairs an
    arrival row that was skipped before the watermark learned to rewind.

    ONLY EVER BACKWARDS. A cursor already older than the window — after an
    outage, or on a database that has never synced — is left where it is:
    moving it forward here would skip everything between, which is the one
    thing this must not do.

    Failure is not fatal. A worker that cannot reach the cursor table has
    bigger problems than a backfill, and the tick loop below reports them
    properly; refusing to start over a repair would turn a degraded sync into
    no sync at all.
  */
  try {
    const cursor = await store.getCursor(provider.source, 'STAGE_HISTORY')
    const from = historyBackfillCursor(cursor, new Date(), HISTORY_BACKFILL_DAYS)
    if (from !== null) {
      await store.setCursor(provider.source, 'STAGE_HISTORY', from)
      console.log(
        `  ${stamp()} bosqich tarixi ${HISTORY_BACKFILL_DAYS} kunga qaytarildi —` +
          ' yoʻqolgan yozuvlar shu tsiklda tiklanadi.',
      )
    }
  } catch (error) {
    console.warn(`  ${stamp()} ! tarixni qaytarib boʻlmadi:`, error)
  }

  /*
    THE SLOW CLOCKS ARE INHERITED, NOT RESTARTED — see `schedule.ts`.

    `REFERENCE_EVERY` and `SWEEP_EVERY` keep their meaning in TICKS so the
    deployed spec needs no edit; they are converted to wall time here and
    measured from what the previous process wrote to `sync_log`. Both reads are
    bounded to twice their period so they stay short walks of the
    `[status, finishedAt DESC]` index on a log of 120 000 rows.

    A reference pass is dated by its FIRST entity, whatever became of the rest:
    that is the moment the pass was attempted, which is what the tick counter
    measured too. Dating it by a later entity that failed would re-run the whole
    pass on every tick for as long as that one entity kept failing.

    The sweep writes its own `DEALS` / `FULL` row (below), because until now it
    left no trace in the database at all.
  */
  const REFERENCE_MS = REFERENCE_EVERY * INTERVAL_SEC * 1000
  const SWEEP_MS = SWEEP_EVERY * INTERVAL_SEC * 1000
  let lastReferenceAt: Date | null = null
  let lastSweepAt: Date | null = null
  let lastSweepFailedAt: Date | null = null
  try {
    const now = Date.now()
    const [reference, sweep] = await Promise.all([
      REFERENCE_MS > 0
        ? prisma.syncLog.findFirst({
            where: {
              status: { in: ['SUCCESS', 'PARTIAL'] },
              entity: REFERENCE[0],
              finishedAt: { gt: new Date(now - 2 * REFERENCE_MS) },
            },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          })
        : null,
      SWEEP_MS > 0
        ? prisma.syncLog.findFirst({
            where: {
              status: 'SUCCESS',
              entity: 'DEALS',
              mode: 'FULL',
              finishedAt: { gt: new Date(now - 2 * SWEEP_MS) },
            },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          })
        : null,
    ])
    lastReferenceAt = reference?.finishedAt ?? null
    lastSweepAt = sweep?.finishedAt ?? null
  } catch (error) {
    // Not fatal: unknown means «due», which is exactly what a restart did before.
    console.warn(`  ${stamp()} ! oxirgi maʼlumotnoma/tozalash vaqti oʻqilmadi:`, error)
  }

  await pruneSyncLog(prisma)

  // Unknown reads as «not yet settled»: a second backfill costs a night's
  // invocations, a skipped one leaves the columns empty for good.
  let backfillSettled = DEALS_BACKFILL === null
  let backfillFailedAt: Date | null = null
  if (DEALS_BACKFILL) {
    try {
      backfillSettled =
        (await prisma.syncLog.findFirst({
          where: {
            entity: 'DEALS',
            mode: 'BACKFILL',
            status: { in: ['SUCCESS', 'PARTIAL'] },
            startedAt: { gte: DEALS_BACKFILL.requestedAt },
          },
          select: { id: true },
        })) !== null
    } catch (error) {
      console.warn(`  ${stamp()} ! backfill holati oʻqilmadi:`, error)
    }
  }

  console.log(
    `  Sinxronizatsiya har ${INTERVAL_SEC}s. Maʼlumotnomalar har ${REFERENCE_EVERY} tsiklda` +
      ` (oxirgisi: ${lastReferenceAt?.toISOString() ?? 'yozilmagan'}).` +
      (SWEEP_EVERY > 0 ? ` Oxirgi tozalash: ${lastSweepAt?.toISOString() ?? 'yozilmagan'}.` : '') +
      (ROISTAT_EVERY > 0 ? ` Roistat har ${ROISTAT_EVERY} tsiklda.` : ' Roistat oʻchirilgan.') +
      (META_TOKEN && META_EVERY > 0 ? ` Meta har ${META_EVERY} tsiklda.` : ' Meta oʻchirilgan (token yoʻq).') +
      (SWEEP_EVERY > 0
        ? ` Oʻchirilganlarni tozalash har ${SWEEP_EVERY} tsiklda.`
        : ' Tozalash oʻchirilgan.') +
      '\n',
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
  /** Hot-only ticks left after a recovery; see `CALM_TICKS`. */
  let calm = 0
  /** A reference pass that fell inside the calm and still has to run. */
  let referenceOwed = false

  while (!stopping) {
    const started = Date.now()

    /*
      A CLOSED DOOR IS NOT KNOCKED ON — IT IS PROBED, ONCE, ON A LADDER.

      This replaces the `throttled` flag, which could not do the job it was
      written for: it is computed from the RESULTS of `runAll`, so by the time
      it is true every entity in that tick has already been refused. Measured
      on 2026-09-15, a hot tick under `OVERLOAD_LIMIT` sent 3 requests of which
      2 left after the portal had already said no; a reference tick sent 12 of
      which 11 did; a restart inside the block sent 11 more. The gate inside
      `call()` stops those. This is the other half: while the gate is open the
      worker does no work at all, and asks exactly ONE cheap question when the
      ladder says it is worth asking.

      `tick` is deliberately NOT incremented here. It schedules the Roistat
      import; the reference pass and the sweep run on the wall clock
      (`schedule.ts`), and what keeps THEM off a portal that has just started
      answering again is `CALM_TICKS`.
    */
    if (provider.gate.isOpen()) {
      const now = new Date()

      if (!provider.gate.dueForProbe(now)) {
        const wait = provider.gate.nextWaitMs(now)
        if (wait > 0 && !stopping) await sleep(wait)
        continue
      }

      const state = provider.gate.state()
      if (!(await provider.probe())) {
        console.warn(
          `  ${stamp()} portal hali ham band (${state.code}) —` +
            ` ${Math.round(provider.gate.nextWaitMs(new Date()) / 1000)}s kutiladi` +
            (provider.lastProbeError ? `
    sabab: ${provider.lastProbeError}` : ''),
        )
        /*
          THE NETWORK DIAGNOSIS IS NO LONGER RUN FROM HERE. `reachability.ts`
          answered its question on 2026-09-16 — TCP opens, TLS never completes,
          Bitrix24 is dropping this address — and each run opened ~11
          connections to four portal addresses at once, handshakes left
          unfinished, which is what a scan looks like to the firewall we were
          waiting on.
        */
        const wait = provider.gate.nextWaitMs(new Date())
        if (wait > 0 && !stopping) await sleep(wait)
        continue
      }

      // `probe()` succeeded, so `call()` has already closed the gate. Fall
      // straight through into a full tick rather than waiting for the next
      // boundary: the data is as stale as the outage was long.
      failures = 0
      calm = CALM_TICKS
      console.log(
        `  ${stamp()} ✓ portal javob berdi (${state.code} tugadi) — sinxronizatsiya sekin tiklanmoqda`,
      )
    }

    const referenceDue: boolean = isPassDue(lastReferenceAt, new Date(), REFERENCE_MS) || referenceOwed
    referenceOwed = referenceDue && calm > 0
    const withReference = referenceDue && calm === 0
    const entities = withReference ? [...REFERENCE, ...HOT] : HOT
    // Stamped when the pass is ATTEMPTED — see the startup read for why.
    if (withReference) lastReferenceAt = new Date()

    // Zeroed per tick, so the line below reports THIS tick's cost rather than
    // the process total. The baskets are kept — they belong to the portal's
    // ten-minute clock, not to ours.
    provider.meter.resetCounters()

    try {
      const results = await engine.runAll(entities, 'INCREMENTAL')
      const changed = results.reduce((sum, r) => sum + r.recordsCreated + r.recordsUpdated, 0)
      const failed = results.filter((r) => r.status === 'FAILED')

      /*
        THE SUBSTRING MATCH IS GONE, AND WITH IT ITS BLIND SPOT.

        This used to read the two codes out of an error MESSAGE — which only
        works when the message carries them. It did not for the whole 429/5xx
        family: that branch of `call()` dropped the response body, so a
        `QUERY_LIMIT_EXCEEDED` behind a 503 arrived as «Bitrix24 responded 503»,
        this test was false, and the ten-minute wait it guards never engaged.
        `PortalGate` is told by `call()` itself, from the error's own `code`
        field, before any message is formatted.
      */
      if (failed.length > 0) {
        failures += 1
        console.warn(
          `  ${stamp()} ${failed.map((r) => r.entity).join(', ')} muvaffaqiyatsiz` +
            ` (${failures}-marta ketma-ket)`,
        )
        /*
          SAID ONCE, IN THE WORDS OF THE ACT IT NEEDS.

          «muvaffaqiyatsiz» above reads like a portal having a bad minute, and
          for every other failure it is. This one needs a person, and the log
          is the only place an operator will be looking before the client
          phones — so it names the act rather than the symptom.
        */
        /*
          OUR OWN CEILING NAMES ITSELF, AND NAMES THE REMEDY.

          A budget refusal is not a portal fault and not something to wait out —
          either a regression is spending the hour or the ceiling is genuinely
          too low for what this worker has been asked to do (a cold start on an
          empty database is the honest case: the first walks are millions of
          rows and `npm run bitrix:import` is the path built for it). Both are
          acted on, not waited on, so the line says which and what to look at.
        */
        const budgetNow = provider.budget.state(new Date())
        if (failed.some((r) => r.errorMessage?.includes(SELF_LIMIT_CODE))) {
          console.error(
            `  ${stamp()} ✗ soatlik chaqiruv chegarasi toʻldi` +
              ` (${budgetNow.spent}/${budgetNow.ceiling}) — portal aybdor EMAS.` +
              ` Eng koʻp sarflagan: ${
                budgetNow.byMethod
                  .slice(0, 3)
                  .map((m) => `${m.method} ${m.invocations}`)
                  .join(', ') || 'yoʻq'
              }.` +
              ' Regressiya boʻlmasa BITRIX24_HOURLY_INVOCATIONS ni koʻtaring;' +
              ' toʻliq import uchun `npm run bitrix:import` ishlating.',
          )
        }

        const gate = provider.gate.state()
        if (gate.kind === 'CREDENTIAL') {
          console.error(
            `  ${stamp()} ✗ Bitrix24 webhook rad etildi (${gate.code}). Yangi webhook kerak —` +
              ' qayta urinish yordam bermaydi, portal ' +
              `${Math.round(provider.gate.nextWaitMs(new Date()) / 60_000)} daqiqada zondlanadi.`,
          )
        } else if (gate.kind === 'THROTTLE') {
          console.warn(
            `  ${stamp()} portal bloklandi (${gate.code}) — soʻrovlar toʻxtatildi,` +
              ` ${Math.round(provider.gate.nextWaitMs(new Date()) / 1000)}s dan keyin zondlanadi.`,
          )
        }
      } else {
        failures = 0
        /*
          WHAT THIS TICK COST THE PORTAL, IN THE PORTAL'S OWN UNITS.

          Two portal-wide blocks were diagnosed after the fact from `sync_log`
          row counts, and the support ticket opened after the first one had to
          estimate our request volume from this side of the wire. It is a
          measurement now: HTTP requests, the method invocations they carried
          (a `batch` is one of the first and up to fifty of the second), and
          the fullest basket the portal reported.

          Printed only when a basket is worth reporting or a pace was applied,
          so a healthy idle minute stays silent — the same rule as `changed`
          below, and for the same reason.
        */
        const cost = provider.meter.stats()
        const hottest = cost.peak[0]
        const budget = provider.budget.state(new Date())
        if (cost.waits > 0 || (hottest && hottest.pct >= 25) || budget.pct >= 50) {
          console.log(
            `  ${stamp()} portal: ${cost.requests} soʻrov / ${cost.invocations} chaqiruv` +
              `, soatlik ${budget.spent}/${budget.ceiling} (${budget.pct}%)` +
              (hottest ? `, eng band: ${hottest.method} ${hottest.operating}s (${hottest.pct}%)` : '') +
              (cost.waits > 0 ? `, ${cost.waits} marta sekinlashtirildi` : ''),
          )
        }
        /*
          THE CEILING IS NOT A QUIET SETTING. It sits ~30× above an ordinary
          hour, so reaching three quarters of it means something regressed —
          the chain width, a restart loop, a new pass nobody costed. Said here,
          once, with the spenders named, because the alternative is finding out
          from a 401 several days later, which is how both blocks were found.
        */
        if (budget.pct >= 75) {
          console.warn(
            `  ${stamp()} ⚠ soatlik chaqiruv chegarasiga yaqin: ${budget.pct}% —` +
              ` ${budget.byMethod
                .slice(0, 3)
                .map((m) => `${m.method} ${m.invocations}`)
                .join(', ')}`,
          )
        }
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

    /*
      DELETED IN BITRIX, DELETED HERE.

      An incremental run cannot do this and says so: it fetches only what
      changed since the watermark, so "not returned" means "not touched", not
      "gone". The sweep therefore needs a FULL pass, which is why it has its
      own, much slower clock — and why the dashboard showed a deal for as long
      as it existed, even after somebody deleted it in the portal.

      DEALS ALONE. `deal_item` and `deal_stage_history` are `onDelete: Cascade`
      on the deal, so they follow without a pass of their own; `calls` and
      `stage_history` have no sweeper at all and a FULL run over their 200-300
      thousand rows would be work with nothing to show for it.

      IDS ONLY, AND NEVER THROUGH THE ENGINE.

      This used to run `engine.runAll(['DEALS'], 'FULL', {sweepDeleted: true})`,
      and a FULL engine run does not just collect ids — it re-upserts every row
      it walks. That was 432 000 deals rewritten to answer a question the ID
      column alone answers: thirty to sixty minutes of write traffic on a
      1-vCPU database, with this loop blocked for all of it and no incremental
      tick running. `listDealIds` walks the same pipelines selecting only ID —
      a couple of minutes, zero writes — and `deleteMissing` is called
      directly, so the DEALS watermark is never touched by a sweep.

      NOT AT TICK 0. `tick` starts at zero and `0 % N === 0`, so this fired on
      the first tick after every start, restart and redeploy. With deploys
      landing more often than the old sweep could finish, the worker spent its
      whole life sweeping and the dashboard never saw a second minute-tick.
      Reference data loads at tick 0 only when its wall clock says it is due;
      the sweep never does.

      Guarded, because `sweepByAntiJoin` refuses to delete anything when the
      source returns nothing at all, and `listDealIds` throws rather than
      returning a short read — a failed read must never empty the table.
    */
    /*
      ON THE WALL CLOCK SINCE 2026-09-17 (`schedule.ts`): the tick counter
      restarts with every deploy, and with more than one deploy a day this
      never reached tick 720 at all. A failure is retried after
      `SWEEP_RETRY_MS`, never on the next tick — ~9 300 invocations every two
      minutes into a portal that just refused one is the loop to avoid.
    */
    const sweepNow = new Date()
    const sweepDue =
      isPassDue(lastSweepAt, sweepNow, SWEEP_MS) &&
      (lastSweepFailedAt === null || sweepNow.getTime() - lastSweepFailedAt.getTime() >= SWEEP_RETRY_MS)
    if (sweepDue && tick > 0 && calm === 0 && !provider.gate.isOpen() && !stopping && dealsHandler) {
      const sweepStarted = Date.now()
      try {
        const live = await provider.listDealIds()
        const deleted = (await dealsHandler.deleteMissing?.(live)) ?? 0
        lastSweepAt = new Date()
        lastSweepFailedAt = null
        /*
          THE SWEEP'S OWN RECORD — the next process reads it back at startup.
          `recordsRead` is the portal's deal count and `recordsUpdated` the
          rows deleted here. A write failure costs one early sweep after the
          next restart, so it is reported and not fatal.
        */
        await prisma.syncLog
          .create({
            data: {
              provider: 'BITRIX24',
              entity: 'DEALS',
              mode: 'FULL',
              status: 'SUCCESS',
              startedAt: new Date(sweepStarted),
              finishedAt: lastSweepAt,
              recordsRead: live.size,
              recordsUpdated: deleted,
            },
          })
          .catch((error: unknown) => console.warn(`  ${stamp()} ! tozalash yozuvi saqlanmadi:`, error))
        await pruneSyncLog(prisma)
        // Logged unconditionally, including the zero. The old code logged only
        // when something was deleted, so a sweep that silently deleted nothing
        // for months was indistinguishable from one that had nothing to do.
        console.log(
          `  ${stamp()} tozalash: portalda ${live.size} bitim, ${deleted} ta oʻchirildi` +
            `  (${((Date.now() - sweepStarted) / 1000).toFixed(1)}s)`,
        )
      } catch (error) {
        // Never fatal: a failed sweep leaves stale rows, which is the state we
        // were already in. Losing the tick loop over it would be worse.
        lastSweepFailedAt = new Date()
        console.warn(`  ${stamp()} tozalash muvaffaqiyatsiz: ${(error as Error).message}`)
      }
    }

    /*
      THE ONE-OFF BACKFILL — see `DEALS_BACKFILL`. Same guards as the sweep:
      never tick 0, never while recovering from a block, never with the gate
      shut; plus the night window. PARTIAL settles it like SUCCESS — a skipped
      deal is one the portal no longer resolves, and re-reading the window
      would skip it again.
    */
    const backfillNow = new Date()
    if (
      DEALS_BACKFILL &&
      tick > 0 &&
      calm === 0 &&
      !provider.gate.isOpen() &&
      !stopping &&
      isBackfillDue(DEALS_BACKFILL, backfillSettled, backfillNow, WORKER_TIME_ZONE, backfillFailedAt)
    ) {
      const backfillStarted = Date.now()
      console.log(
        `  ${stamp()} backfill: ${DEALS_BACKFILL.since.toISOString().slice(0, 10)} dan beri` +
          ' oʻzgargan bitimlar qayta oʻqilmoqda',
      )
      const r = await engine.runEntity('DEALS', 'BACKFILL', { updatedSince: DEALS_BACKFILL.since })
      if (r.status === 'SUCCESS' || r.status === 'PARTIAL') {
        backfillSettled = true
        console.log(
          `  ${stamp()} backfill tugadi: ${r.recordsRead} bitim oʻqildi, ${r.recordsUpdated} yangilandi` +
            `  (${((Date.now() - backfillStarted) / 1000).toFixed(1)}s,` +
            ` soatlik ${provider.budget.state(new Date()).spent}/${provider.budget.state(new Date()).ceiling})`,
        )
      } else {
        backfillFailedAt = new Date()
        console.warn(`  ${stamp()} backfill muvaffaqiyatsiz: ${r.errorMessage ?? r.status} — bir soatdan keyin`)
      }
    }

    /*
      After the Bitrix tick, never instead of it: the portal sync is what the
      dashboard is judged on, and an hourly page fetch must not delay it.

      `tick > 0` for the same reason as the sweep: a five-megabyte page fetch
      on the first tick after every redeploy delays the first real sync for
      nothing — the source changes a few times a day.
    */
    if (ROISTAT_EVERY > 0 && tick > 0 && tick % ROISTAT_EVERY === 0 && !stopping) {
      await runRoistatImport()
    }

    /*
      Meta, on the same «after the tick, never tick 0» rule. Offset by half a
      period from Roistat so the two passengers never ride the same tick. A
      failure is logged and forgotten until the next hour — Meta being down
      must never cost a Bitrix24 tick.
    */
    if (
      META_TOKEN &&
      META_EVERY > 0 &&
      tick > 0 &&
      (tick + Math.floor(META_EVERY / 2)) % META_EVERY === 0 &&
      !stopping
    ) {
      const metaStarted = Date.now()
      try {
        const r = await importMetaSpend(
          prisma,
          META_TOKEN,
          zonedDateKey(new Date(), WORKER_TIME_ZONE),
        )
        console.log(
          `  ${stamp()} meta: ${r.accounts} akkaunt, ${r.rows} kun-qator (${r.since} – ${r.until})` +
            `  (${((Date.now() - metaStarted) / 1000).toFixed(1)}s)`,
        )
      } catch (error) {
        console.warn(`  ${stamp()} meta muvaffaqiyatsiz: ${(error as Error).message}`)
      }
    }

    tick += 1
    if (calm > 0 && !provider.gate.isOpen()) calm -= 1

    /**
     * Wait out the rest of the interval, not the whole interval.
     *
     * A tick that took forty seconds should be followed by twenty, not sixty —
     * otherwise the effective cadence drifts with how much work there was.
     */
    /*
      Backoff is a FLOOR, not an addend.

      Added to `remaining` it disappeared exactly when it was needed: a tick
      failing slowly — thirty-second portal timeouts, five entities — already
      overruns the interval, so `remaining` was negative and the sum stayed
      negative. The worker skipped its sleep entirely and hammered a portal
      that blocks an expensive method for about ten minutes, which is the one
      situation backoff exists to defuse. As a floor, a failing worker always
      waits at least its backoff; a long but SUCCESSFUL tick still starts the
      next one immediately, because `backoff` is zero when nothing failed.
    */
    /*
      The gate owns the wait whenever it is open — its ladder is the schedule,
      and `THROTTLED_WAIT_MS` survives as that ladder's ceiling rather than as a
      flat wait, so the ten minutes a production incident put there still bounds
      how long the dashboard can be stale without anyone asking the portal.
    */
    const backoff = provider.gate.isOpen()
      ? provider.gate.nextWaitMs(new Date())
      : Math.min(failures, 5) * INTERVAL_SEC * 1000
    const remaining = Math.max(INTERVAL_SEC * 1000 - (Date.now() - started), backoff)

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
