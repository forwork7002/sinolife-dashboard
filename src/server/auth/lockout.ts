/**
 * Sign-in lockout.
 *
 * WHAT THIS DEFENDS AGAINST, AND WHY THE RATE LIMITER IS NOT ENOUGH.
 * better-auth already caps `/sign-in/email` at a handful of requests a minute.
 * That stops a burst. It does not stop patience: an attacker who stays under
 * the ceiling and keeps going for a week still gets tens of thousands of
 * guesses, and the counters live in this process's memory, so every deploy —
 * and this app redeploys — hands them a clean slate. Throttling limits the
 * rate; only a lockout limits the TOTAL.
 *
 * THE SHAPE OF THE RULE.
 * Five consecutive failures buy a fifteen-minute silence. Spend the budget
 * again and the silence doubles, to a ceiling of one hour. A correct password
 * wipes the record; so does simply not trying for a day.
 *
 *   failure 5 → 15 min      failure 7 → 60 min
 *   failure 6 → 30 min      failure 8+ → 60 min
 *
 * The escalation is what makes waiting out the lock unprofitable: a guesser
 * who returns the moment it expires is back to one attempt an hour, forever.
 *
 * WHY THE CEILING IS AN HOUR AND NOT A DAY.
 * There is exactly one user of this dashboard and nobody behind them to lift a
 * lock. Every minute of lockout is a minute the owner cannot see their own
 * business, and a lock they cannot end is a worse outcome than a slow guesser.
 * An hour is long enough to make guessing pointless against a twelve-character
 * house-policy password (24 tries a day) and short enough that the honest
 * answer to "what do I do" is "have a coffee", not "call someone". Nothing
 * here is permanent: every lock expires on its own, and the correct password
 * ends it early once it does.
 *
 * WHY THE COUNTER IS IN POSTGRES.
 * An in-memory counter is a reset button with a deploy button on it. The
 * platform restarts the process on every release and, on a small instance,
 * whenever it feels like it. A counter that survives that is the only kind
 * worth having.
 *
 * WHY THE KEY IS A HASH OF THE EMAIL.
 * See the `SignInLockout` model comment in prisma/schema.prisma. Short
 * version: an address with no account must be lockable too, or the lockout
 * message becomes an account-existence oracle; and the table must not become
 * a list of who banks here.
 */

import { createHash } from 'node:crypto'

/** Consecutive failures that spend the budget. */
export const MAX_FAILED_SIGN_INS = 5

/** The first lock, in milliseconds. */
export const BASE_LOCK_MS = 15 * 60 * 1000

/** The longest a lock may last. See the header for why this is not a day. */
export const MAX_LOCK_MS = 60 * 60 * 1000

/**
 * How long a failure counts for.
 *
 * Without this, four mistyped passwords spread over a year would leave the
 * owner one typo away from a lock they would never understand. With it, a gap
 * of a full day is treated as a fresh start — and a guesser who paces himself
 * to one attempt a day is not a threat anyone needs to model.
 */
export const FAILURE_DECAY_MS = 24 * 60 * 60 * 1000

/**
 * Rows older than this are deleted opportunistically on write. A failure
 * record past the decay window carries no information; keeping it would let
 * anyone who cycles through addresses grow the table for free.
 */
const PRUNE_AFTER_MS = FAILURE_DECAY_MS

/** The state we keep per key. Mirrors the `SignInLockout` row. */
export interface LockoutState {
  readonly failedCount: number
  readonly lockedUntil: Date | null
  readonly lastFailedAt: Date
}

/**
 * The lock earned by the n-th consecutive failure.
 *
 * Pure, and exported so the escalation can be tested without a database.
 * Below the threshold there is no lock at all — the first four typos cost the
 * owner nothing.
 */
export function lockDurationMs(failedCount: number): number {
  if (failedCount < MAX_FAILED_SIGN_INS) return 0
  const doublings = failedCount - MAX_FAILED_SIGN_INS
  // 2 ** doublings overflows into Infinity long before it matters, and
  // Math.min collapses it to the ceiling anyway — but cap the exponent so the
  // arithmetic stays finite and readable in a debugger.
  const factor = 2 ** Math.min(doublings, 10)
  return Math.min(BASE_LOCK_MS * factor, MAX_LOCK_MS)
}

/** Is this state locked right now? */
export function isLocked(state: LockoutState | null, now: Date): boolean {
  return state?.lockedUntil != null && state.lockedUntil.getTime() > now.getTime()
}

/** Milliseconds left on the lock, or 0 if it is not locked. */
export function remainingLockMs(state: LockoutState | null, now: Date): number {
  const until = state?.lockedUntil
  if (!until) return 0
  return Math.max(0, until.getTime() - now.getTime())
}

/**
 * The state after one more failure.
 *
 * Pure: the caller does the reading and the writing. Keeping the decision here
 * means the escalation, the decay and the ceiling are all testable as
 * arithmetic, which is the only way to be sure a lock cannot become permanent.
 */
export function applyFailure(previous: LockoutState | null, now: Date): LockoutState {
  const stale =
    previous != null && now.getTime() - previous.lastFailedAt.getTime() >= FAILURE_DECAY_MS

  const failedCount = (stale || previous == null ? 0 : previous.failedCount) + 1
  const duration = lockDurationMs(failedCount)

  return {
    failedCount,
    lockedUntil: duration > 0 ? new Date(now.getTime() + duration) : null,
    lastFailedAt: now,
  }
}

/**
 * THE ATTEMPT IS COUNTED BEFORE THE PASSWORD IS CHECKED.
 *
 * The lock used to be checked in `hooks.before` and the failure recorded in
 * `hooks.after`, with the scrypt verification — non-blocking, on the libuv
 * pool — in between. Every request already in flight when the count reached
 * five had passed the check, and concurrent failures that read the same row
 * all wrote the same count + 1. Five parallel guesses each time the per-IP
 * limit reset bought up to twenty-five guesses before the first lock, not
 * five. So an attempt now RESERVES a failure up front, under a lock on the
 * key, and the after hook settles it: a wrong password keeps it, a right one
 * clears the record, anything else (wrong origin, bad body, server error)
 * hands it back.
 *
 * Every key is judged together: if ANY is locked the attempt is refused, and
 * otherwise each takes one failure — see `signInLockoutIdentifiers` for why
 * an attempt can carry two keys.
 */
export type Reservation =
  | { readonly allowed: false; readonly remainingMs: number }
  | { readonly allowed: true; readonly next: readonly LockoutState[] }

export function reserveAttempt(
  states: readonly (LockoutState | null)[],
  now: Date,
): Reservation {
  const remainingMs = Math.max(0, ...states.map((state) => remainingLockMs(state, now)))
  if (remainingMs > 0) return { allowed: false, remainingMs }
  return { allowed: true, next: states.map((state) => applyFailure(state, now)) }
}

/**
 * Hand one reserved failure back — the attempt was not a wrong password.
 *
 * `null` means the row can go. Below the threshold no lock is justified, so a
 * lock the reservation armed goes with it. At or above it the lock is KEPT as
 * written: the row cannot say which attempt armed it, and the conservative
 * error is a lock that runs to its (at most one-hour) end for someone who has
 * already failed five times inside a day — never a lock lifted for a guesser.
 */
export function refundAttempt(state: LockoutState | null): LockoutState | null {
  if (state == null) return null
  const failedCount = Math.max(0, state.failedCount - 1)
  if (failedCount === 0) return null
  return {
    failedCount,
    lockedUntil: failedCount >= MAX_FAILED_SIGN_INS ? state.lockedUntil : null,
    lastFailedAt: state.lastFailedAt,
  }
}

/**
 * The lookup key for an email address.
 *
 * Lowercased and trimmed first, because better-auth looks the user up with
 * `email.toLowerCase()` — key it any other way and `Owner@x.uz` would get its
 * own budget, which is a lockout with a trivial bypass.
 *
 * SHA-256 with no salt is deliberate. This is not password storage; it is a
 * lookup key that must be computable from the request alone. What it buys is
 * that the table holds no addresses.
 */
export function lockoutKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex')
}

/**
 * How long the caller should tell the user to wait, in whole minutes, rounded
 * up. Zero minutes would read as "try now" while the lock is still on.
 */
export function lockMinutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000))
}

/**
 * The refusal the owner sees.
 *
 * It names no email and says nothing about whether an account exists — the
 * same sentence appears for a real address and for one that was never
 * registered, which is what stops the lockout being an enumeration oracle. It
 * does say how long, because "try again later" with no number is what makes a
 * person retry every thirty seconds for an hour.
 */
export function lockoutMessage(remainingMs: number): string {
  return (
    `Juda koʻp muvaffaqiyatsiz urinish. Kirish vaqtincha toʻxtatildi — ` +
    `${lockMinutes(remainingMs)} daqiqadan soʻng qayta urinib koʻring.`
  )
}

/**
 * The Prisma client, imported on first use rather than at module load.
 *
 * `@/server/db/prisma` opens a connection pool and validates the whole
 * environment as a side effect of being imported. The policy above is plain
 * arithmetic and is unit-tested as such; a static import would drag a database
 * and a validated .env into every test that wants to check that a lock
 * expires. The dynamic import keeps the pure half genuinely pure.
 */
async function db() {
  const { prisma } = await import('@/server/db/prisma')
  return prisma
}

/** One transaction's view of the lockout rows. */
export interface LockoutTx {
  /** Serialise every other attempt on these keys until the transaction ends. */
  lock(keys: readonly string[]): Promise<void>
  read(key: string): Promise<LockoutState | null>
  write(key: string, state: LockoutState): Promise<void>
  remove(key: string): Promise<void>
}

/** Where the counters live. Postgres in production; a fake in the tests. */
export interface LockoutStore {
  transaction<T>(work: (tx: LockoutTx) => Promise<T>): Promise<T>
  prune(olderThan: Date): Promise<void>
}

/**
 * The advisory-lock namespace for sign-in keys — the TWO-int4 form.
 *
 * Postgres keeps the one-bigint and two-int4 advisory key spaces apart, and
 * the sync worker holds a one-bigint lock for its whole life
 * (`pg_try_advisory_lock` in syncWorker.ts). A sign-in key hashed into that
 * space could, by a one-in-four-billion accident, wait on the worker forever.
 */
const SIGN_IN_LOCK_NAMESPACE = 0x51_4c_4f

/**
 * The transaction waits as long as the pool does for a connection. Prisma's
 * interactive defaults (2 s to start, 5 s to finish) would turn a busy
 * one-core database into a failed sign-in, where the rest of the app queues.
 */
const TRANSACTION_WAIT_MS = 20_000

function prismaStore(): LockoutStore {
  return {
    async transaction(work) {
      const prisma = await db()
      return prisma.$transaction(
        async (tx) =>
          work({
            async lock(keys) {
              // Sorted by the caller, so two attempts on the same pair of keys
              // take them in the same order and cannot deadlock.
              for (const key of keys) {
                await tx.$executeRawUnsafe(
                  `SELECT pg_advisory_xact_lock(${SIGN_IN_LOCK_NAMESPACE}, hashtext($1))`,
                  key,
                )
              }
            },
            async read(key) {
              const row = await tx.signInLockout.findUnique({ where: { emailHash: key } })
              return row
                ? { failedCount: row.failedCount, lockedUntil: row.lockedUntil, lastFailedAt: row.lastFailedAt }
                : null
            },
            async write(key, state) {
              await tx.signInLockout.upsert({
                where: { emailHash: key },
                create: { emailHash: key, ...state },
                update: { ...state },
              })
            },
            async remove(key) {
              await tx.signInLockout.deleteMany({ where: { emailHash: key } })
            },
          }),
        { maxWait: TRANSACTION_WAIT_MS, timeout: TRANSACTION_WAIT_MS },
      )
    },
    async prune(olderThan) {
      const prisma = await db()
      await prisma.signInLockout.deleteMany({ where: { lastFailedAt: { lt: olderThan } } })
    },
  }
}

/** Distinct hashed keys in a fixed order — the lock order. */
function keysOf(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers.map(lockoutKey))].sort()
}

/**
 * Reserve one failed attempt on every identifier, atomically. Returns the
 * milliseconds left on a lock (the attempt is refused and nothing is
 * written), or 0 when sign-in may proceed with the failure already counted.
 *
 * Called BEFORE the password is checked, so a locked account costs an
 * attacker a lookup rather than a scrypt verification — which also means the
 * lockout doubles as protection against using the login form as a CPU sink.
 */
export async function reserveSignInAttempt(
  identifiers: readonly string[],
  now = new Date(),
  store: LockoutStore = prismaStore(),
): Promise<number> {
  const keys = keysOf(identifiers)
  if (keys.length === 0) return 0

  const remainingMs = await store.transaction(async (tx) => {
    await tx.lock(keys)
    const states: (LockoutState | null)[] = []
    for (const key of keys) states.push(await tx.read(key))
    const decision = reserveAttempt(states, now)
    if (!decision.allowed) return decision.remainingMs
    for (const [i, key] of keys.entries()) await tx.write(key, decision.next[i])
    return 0
  })

  await store.prune(new Date(now.getTime() - PRUNE_AFTER_MS))
  return remainingMs
}

/**
 * What the sign-in turned out to be.
 *
 * `failed` — a wrong password (401): the reserved failure stands.
 * `succeeded` — the record is cleared, as a correct password always did.
 * `void` — anything else: the deployment misbehaving (403 origin, 500), not
 * a guess, and charging the owner's budget for it would turn an outage into a
 * lockout. The reservation is handed back.
 */
export type SignInOutcome = 'failed' | 'succeeded' | 'void'

export async function settleSignInAttempt(
  identifiers: readonly string[],
  outcome: SignInOutcome,
  store: LockoutStore = prismaStore(),
): Promise<void> {
  if (outcome === 'failed') return
  const keys = keysOf(identifiers)
  if (keys.length === 0) return

  await store.transaction(async (tx) => {
    await tx.lock(keys)
    for (const key of keys) {
      if (outcome === 'succeeded') {
        await tx.remove(key)
        continue
      }
      const next = refundAttempt(await tx.read(key))
      if (next) await tx.write(key, next)
      else await tx.remove(key)
    }
  })
}
