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

async function read(key: string): Promise<LockoutState | null> {
  const prisma = await db()
  const row = await prisma.signInLockout.findUnique({ where: { emailHash: key } })
  if (!row) return null
  return {
    failedCount: row.failedCount,
    lockedUntil: row.lockedUntil,
    lastFailedAt: row.lastFailedAt,
  }
}

/**
 * Is this address currently locked out? Returns the remaining milliseconds, or
 * 0 when sign-in may proceed.
 *
 * Called BEFORE the password is checked, so a locked account costs an attacker
 * a lookup rather than a bcrypt verification — which also means the lockout
 * doubles as protection against using the login form as a CPU sink.
 */
export async function checkSignInLockout(email: string, now = new Date()): Promise<number> {
  const state = await read(lockoutKey(email))
  return remainingLockMs(state, now)
}

/**
 * Count one failed sign-in.
 *
 * Read-then-write rather than a single atomic statement: two simultaneous
 * wrong passwords could in principle count as one. That is an acceptable loss
 * — the attacker gains at most one extra guess per race, and the alternative
 * (an atomic increment) cannot express the decay-then-escalate rule in one
 * round trip. What must not be lost is the lock itself, and `upsert` on the
 * primary key cannot lose that.
 */
export async function recordFailedSignIn(email: string, now = new Date()): Promise<void> {
  const prisma = await db()
  const key = lockoutKey(email)
  const next = applyFailure(await read(key), now)

  await prisma.signInLockout.upsert({
    where: { emailHash: key },
    create: {
      emailHash: key,
      failedCount: next.failedCount,
      lockedUntil: next.lockedUntil,
      lastFailedAt: next.lastFailedAt,
    },
    update: {
      failedCount: next.failedCount,
      lockedUntil: next.lockedUntil,
      lastFailedAt: next.lastFailedAt,
    },
  })

  await prune(now)
}

/**
 * A correct password clears the record.
 *
 * `deleteMany` rather than `delete` so the common case — someone who has never
 * failed — is not an exception to catch.
 */
export async function clearSignInFailures(email: string): Promise<void> {
  const prisma = await db()
  await prisma.signInLockout.deleteMany({ where: { emailHash: lockoutKey(email) } })
}

/**
 * Drop records that can no longer influence a decision.
 *
 * A row whose last failure is past the decay window is treated as absent
 * anyway, so keeping it only feeds the table. Deleting on write keeps this
 * off any schedule — there is no cron on this deployment to hang a cleanup
 * job from.
 */
async function prune(now: Date): Promise<void> {
  const prisma = await db()
  await prisma.signInLockout.deleteMany({
    where: {
      lastFailedAt: { lt: new Date(now.getTime() - PRUNE_AFTER_MS) },
    },
  })
}
