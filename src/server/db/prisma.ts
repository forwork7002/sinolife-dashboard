/**
 * PrismaClient singleton.
 *
 * Server-only. The one place a database connection is created.
 *
 * PRISMA 7 NOTES
 * The Rust query engine is gone; a driver adapter is now mandatory, so
 * `new PrismaClient()` with no arguments throws. The connection URL is read
 * from `env`, which has already validated it — including rejecting the
 * `CHANGE_ME` placeholder, so a half-configured .env fails at startup with a
 * clear message rather than as an obscure connection error later.
 *
 * ONE POOL PER PROCESS (one per lane since 2026-10-24 — see THE AUTH LANE)
 * The client is cached on `globalThis` in EVERY environment, production
 * included. Two reasons, one mechanism:
 *  - development: Next.js re-evaluates modules on every edit; without the
 *    cache each reload would open a fresh pool and the database would run
 *    out of connections after a few dozen saves;
 *  - production: the build holds this module more than once — the API-route
 *    bundle, the app-page bundle (requireSection / session) and the chunk
 *    instrumentation loads for the rnp/leads warmers each carry their own
 *    copy. A module-level `const` gave each copy its own Pool(max 8), so one
 *    web process could hold three pools and break the per-container budget
 *    sized below. `globalThis` is shared by every copy in the process, so
 *    whichever bundle imports first creates the pool and the rest reuse it.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/server/config/env'
import { caCertFromEnv, poolConfig } from '@/server/db/poolConfig'

if (typeof window !== 'undefined') {
  throw new Error(
    'src/server/db/prisma.ts was imported from client code. ' +
      'Database access must stay on the server.',
  )
}

/** Which of the process's pools a client sits on — see THE AUTH LANE and THE WARM LANE below. */
type Lane = 'main' | 'auth' | 'warm'

function createPrismaClient(lane: Lane): PrismaClient {
  /**
   * Pool size depends on where this runs.
   *
   * On a single long-lived server, ten connections is comfortable. On Netlify
   * every request may land in its own function instance, each opening its own
   * pool — ten of those across a few dozen concurrent instances exhausts
   * Postgres' 100-connection limit and requests start failing with "too many
   * clients", which looks like an application bug rather than a config one.
   *
   * So serverless gets a small pool and short idle timeout, and should be
   * pointed at Neon's POOLED connection string (the host containing
   * `-pooler`), which multiplexes on the database side.
   *
   * EIGHT on a long-lived server, and the arithmetic has to include the
   * deploy. The managed instance reports max_connections = 25. The sync
   * worker holds five plus one for its advisory lock; a deploy runs two jobs
   * on top; and for the length of a rolling deploy the OLD web container and
   * the NEW one are both alive, each with a full pool. 2 × 8 + 6 + 2 = 24.
   *
   * It was raised to fourteen for one screen that fans out sixteen queries at
   * once, on the sum 14 + 6 + 2 = 22 — which forgot the second container.
   * 2 × 14 + 8 = 36, and the next deploy's post-deploy job died on
   * TooManyConnections and rolled the release back. Fourteen was solving the
   * wrong problem anyway: that screen now shares one build across readers and
   * its heaviest queries are gone, so eight is enough again.
   *
   * The connect timeout is twenty seconds rather than ten for the same
   * reason more connections were wanted: a burst should QUEUE in front of
   * the pool and drain, not fail. On a one-core database a queue is the
   * honest state; an error is a page that shows nothing.
   */
  const isServerless = Boolean(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

  /*
    THE AUTH LANE (2026-10-24, «bo'limlardan bo'limlarga o'tishda sekin»).
    The eight are now SIX + TWO, so the arithmetic above is unchanged
    (2 × 8 + 6 + 2 = 24). Every click on the rail renders the next page on
    the server, and that render waits for the page guard's session lookup —
    two index reads, a few milliseconds of database work. On the one pool
    they queued behind whatever held all eight: on production at 17:36 that
    day eight analytics statements had the pool and 43 requests waited
    behind them, the guard took 7–33 s for navigations that needed 5 ms, three
    of them ran into the connect timeout and sent signed-in readers to /login
    (`resolved: false`), and the health probe waited 16 s against the
    platform's 10 s limit. The session, the caller's user row and the health
    probe now have two connections nothing else can take (`authPrisma`), so a
    click is never queued behind a report. Analytics keep six; on one core
    the seventh and eighth concurrent scan only slowed the other six.

    THE WARM LANE (2026-10-28). The six are now FIVE + ONE, so the
    arithmetic still holds. The background warm-ups — «RNP jadvali», «Lidlar», «Лид
    назорати» (`instrumentation.ts`) — ran on the readers' six, two scans at
    a time, and on production that morning the six were taken with fifteen
    requests queued behind them while «Lidlar»'s ran (plain screens 1.3–3.4 s),
    and its «Факт1 мижоз» match died on the 20 s limit 29 times in 17 hours
    («leads warm-up failed»). The warmers now build on ONE connection of
    their own (`warmPrisma`), one statement at a time — nobody waits on a
    warm-up, so it queues behind itself and never in front of a reader — and
    under a minute's limit: a build that took 25 s beside the readers is
    allowed to finish rather than be thrown away and started again.
  */
  const main = lane === 'main'
  const warm = lane === 'warm'
  const pool = new Pool({
    // Named so `pg_stat_activity` tells the lanes and the sync worker apart (2026-10-24).
    application_name: main ? 'web' : warm ? 'web-warm' : 'web-auth',
    ...poolConfig(env.DATABASE_URL, {
      caCert: caCertFromEnv(),
      max: main ? (isServerless ? 3 : 5) : warm ? 1 : isServerless ? 1 : 2,
      /*
        The auth lane keeps ONE connection once it has made it: a click after
        half a minute of quiet would otherwise open a fresh TLS connection to
        the database (the idle timeout below) before the guard could ask.
      */
      ...(main || warm || isServerless ? {} : { min: 1 }),
      idleTimeoutMillis: isServerless ? 10_000 : 30_000,
      connectionTimeoutMillis: 20_000,
      // An index read that is still going after five seconds is not going to answer a click.
      statementTimeoutMs: main ? 20_000 : warm ? WARM_STATEMENT_TIMEOUT_MS : 5_000,
      /*
        The warm lane's own builds queue for its one connection — a warm-up
        reads two scans side by side — and that wait is the design, not a
        fault: as long as a build may run, twice over.
      */
      ...(warm ? { connectionTimeoutMillis: WARM_STATEMENT_TIMEOUT_MS * 2 } : {}),
    }),
  })

  if (main) globalForPrisma.__sinolifePool = pool
  else if (warm) globalForPrisma.__sinolifeWarmPool = pool
  else globalForPrisma.__sinolifeAuthPool = pool
  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  })
}

/** A warm-up statement's limit (THE WARM LANE): its slowest builds measured 25–43 s beside the readers. */
export const WARM_STATEMENT_TIMEOUT_MS = 60_000

const globalForPrisma = globalThis as unknown as {
  __sinolifePrisma?: PrismaClient
  __sinolifePool?: Pool
  __sinolifeAuthPrisma?: PrismaClient
  __sinolifeAuthPool?: Pool
  __sinolifeWarmPrisma?: PrismaClient
  __sinolifeWarmPool?: Pool
}

// Written in every environment — see ONE POOL PER PROCESS above. Gating this
// on NODE_ENV !== 'production' is what used to give each bundle its own pool.
globalForPrisma.__sinolifePrisma ??= createPrismaClient('main')

export const prisma: PrismaClient = globalForPrisma.__sinolifePrisma

/*
  The auth lane's client — the session, the caller's row, the health probe;
  see THE AUTH LANE above. Nothing else may use it: a report on these two
  connections would bring back the queue they exist to skip. A `pg` Pool
  opens no connection until it is asked, so the sync worker, which never
  resolves a session, never holds one.
*/
globalForPrisma.__sinolifeAuthPrisma ??= createPrismaClient('auth')

export const authPrisma: PrismaClient = globalForPrisma.__sinolifeAuthPrisma

/*
  The warm lane's client — the background warm-ups only; see THE WARM LANE
  above. A reader on it would wait behind a whole warm-up. Like the auth
  lane it opens nothing until asked, so the sync worker never holds one.
*/
globalForPrisma.__sinolifeWarmPrisma ??= createPrismaClient('warm')

export const warmPrisma: PrismaClient = globalForPrisma.__sinolifeWarmPrisma

/**
 * The pool's state at this instant — for the slow-request log (`handler.ts`).
 *
 * `waiting` is the number that separates the two kinds of slow: requests
 * queued for one of the six connections (the warmers and the heavy scans
 * have them all) against a database that is simply slow to answer. Null
 * before the pool exists.
 */
export function poolStats(): { total: number; idle: number; waiting: number } | null {
  return statsOf(globalForPrisma.__sinolifePool)
}

/** The auth lane's state, for the page guard's and the health probe's slow lines. */
export function authPoolStats(): { total: number; idle: number; waiting: number } | null {
  return statsOf(globalForPrisma.__sinolifeAuthPool)
}

function statsOf(pool: Pool | undefined): { total: number; idle: number; waiting: number } | null {
  if (!pool) return null
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
}
