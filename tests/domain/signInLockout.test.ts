/**
 * The sign-in lockout policy.
 *
 * These tests are about one property above all others: A LOCK MUST ALWAYS END.
 * There is one user of this dashboard and nobody behind them to lift a lock,
 * so an escalation that runs away — a doubling with no ceiling, an overflow to
 * Infinity, a NaN that compares false against every clock — would not be a bug
 * report, it would be the owner locked out of their own company's numbers with
 * no way back in short of a database edit. Everything below either checks that
 * the lock bites, or that it lets go.
 *
 * The policy is pure arithmetic on purpose (see `lockout.ts`), so all of this
 * runs without a database.
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_LOCK_MS,
  FAILURE_DECAY_MS,
  MAX_FAILED_SIGN_INS,
  MAX_LOCK_MS,
  applyFailure,
  isLocked,
  lockDurationMs,
  lockMinutes,
  lockoutKey,
  lockoutMessage,
  remainingLockMs,
  type LockoutState,
} from '@/server/auth/lockout'

const T0 = new Date('2026-08-28T09:00:00.000Z')
const MINUTE = 60_000

/** Replay `count` failures back to back, one second apart. */
function failTimes(count: number, from: Date = T0): LockoutState | null {
  let state: LockoutState | null = null
  for (let i = 0; i < count; i += 1) {
    state = applyFailure(state, new Date(from.getTime() + i * 1_000))
  }
  return state
}

describe('lockDurationMs', () => {
  it('costs nothing below the threshold', () => {
    for (let n = 0; n < MAX_FAILED_SIGN_INS; n += 1) {
      expect(lockDurationMs(n)).toBe(0)
    }
  })

  it('locks for fifteen minutes on the fifth consecutive failure', () => {
    expect(lockDurationMs(MAX_FAILED_SIGN_INS)).toBe(BASE_LOCK_MS)
    expect(BASE_LOCK_MS).toBe(15 * MINUTE)
  })

  it('doubles each time the budget is spent again, then stops', () => {
    expect(lockDurationMs(5)).toBe(15 * MINUTE)
    expect(lockDurationMs(6)).toBe(30 * MINUTE)
    expect(lockDurationMs(7)).toBe(60 * MINUTE)
    expect(lockDurationMs(8)).toBe(MAX_LOCK_MS)
  })

  it('never exceeds the ceiling, however long the attack runs', () => {
    // A guesser who never stops must not be able to push the lock past an
    // hour: past that point the escalation is punishing the owner, not them.
    for (const n of [9, 12, 40, 500, 10_000, Number.MAX_SAFE_INTEGER]) {
      const ms = lockDurationMs(n)
      expect(Number.isFinite(ms)).toBe(true)
      expect(ms).toBeLessThanOrEqual(MAX_LOCK_MS)
    }
  })
})

describe('applyFailure', () => {
  it('counts the first failure without locking', () => {
    const state = applyFailure(null, T0)
    expect(state.failedCount).toBe(1)
    expect(state.lockedUntil).toBeNull()
    expect(state.lastFailedAt).toEqual(T0)
  })

  it('leaves the first four typos free', () => {
    const state = failTimes(MAX_FAILED_SIGN_INS - 1)
    expect(state?.failedCount).toBe(4)
    expect(state?.lockedUntil).toBeNull()
  })

  it('arms the lock exactly on the fifth', () => {
    const state = failTimes(MAX_FAILED_SIGN_INS)
    expect(state?.failedCount).toBe(5)
    expect(state?.lockedUntil).not.toBeNull()

    // Armed relative to the LAST failure, not the first.
    const lastFailure = T0.getTime() + (MAX_FAILED_SIGN_INS - 1) * 1_000
    expect(state?.lockedUntil?.getTime()).toBe(lastFailure + BASE_LOCK_MS)
  })

  it('forgets failures once a whole day has passed', () => {
    // Four mistyped passwords spread over months must not leave the owner one
    // typo away from a lock they cannot explain.
    const stale = failTimes(4)
    const muchLater = new Date(T0.getTime() + FAILURE_DECAY_MS + MINUTE)

    const next = applyFailure(stale, muchLater)
    expect(next.failedCount).toBe(1)
    expect(next.lockedUntil).toBeNull()
  })

  it('does not forget failures inside the day', () => {
    const recent = failTimes(4)
    const almostADayLater = new Date(T0.getTime() + FAILURE_DECAY_MS - MINUTE)

    const next = applyFailure(recent, almostADayLater)
    expect(next.failedCount).toBe(5)
    expect(next.lockedUntil).not.toBeNull()
  })

  it('escalates for a guesser who waits out each lock', () => {
    // The patient attack: fail five times, wait for the lock to lift, fail
    // once more. The second lock must be longer than the first, or waiting is
    // free and the lockout only ever costs fifteen minutes.
    const first = failTimes(5)
    expect(first?.lockedUntil).not.toBeNull()

    const afterFirstLock = new Date(first!.lockedUntil!.getTime() + 1_000)
    const second = applyFailure(first, afterFirstLock)

    expect(second.failedCount).toBe(6)
    expect(second.lockedUntil!.getTime() - afterFirstLock.getTime()).toBe(2 * BASE_LOCK_MS)
  })

  it('produces a lock that always lies in the future and always ends', () => {
    let state: LockoutState | null = null
    let now = T0

    for (let i = 0; i < 50; i += 1) {
      state = applyFailure(state, now)
      const until = state.lockedUntil
      if (until) {
        expect(until.getTime()).toBeGreaterThan(now.getTime())
        expect(until.getTime() - now.getTime()).toBeLessThanOrEqual(MAX_LOCK_MS)
        // Step past the lock, the way a determined attacker would.
        now = new Date(until.getTime() + 1_000)
      } else {
        now = new Date(now.getTime() + 1_000)
      }
    }
  })
})

describe('isLocked / remainingLockMs', () => {
  const locked: LockoutState = {
    failedCount: 5,
    lockedUntil: new Date(T0.getTime() + 15 * MINUTE),
    lastFailedAt: T0,
  }

  it('treats a missing record as free to sign in', () => {
    expect(isLocked(null, T0)).toBe(false)
    expect(remainingLockMs(null, T0)).toBe(0)
  })

  it('treats counted-but-unlocked as free to sign in', () => {
    expect(isLocked({ failedCount: 4, lockedUntil: null, lastFailedAt: T0 }, T0)).toBe(false)
  })

  it('refuses while the lock is live and reports what is left', () => {
    const fiveMinutesIn = new Date(T0.getTime() + 5 * MINUTE)
    expect(isLocked(locked, fiveMinutesIn)).toBe(true)
    expect(remainingLockMs(locked, fiveMinutesIn)).toBe(10 * MINUTE)
  })

  it('lets go the instant the lock expires', () => {
    const atExpiry = new Date(locked.lockedUntil!.getTime())
    expect(isLocked(locked, atExpiry)).toBe(false)
    expect(remainingLockMs(locked, atExpiry)).toBe(0)

    const longAfter = new Date(locked.lockedUntil!.getTime() + FAILURE_DECAY_MS)
    expect(isLocked(locked, longAfter)).toBe(false)
    expect(remainingLockMs(locked, longAfter)).toBe(0)
  })
})

describe('lockoutKey', () => {
  it('is the same key however the address is typed', () => {
    // better-auth looks the user up with `email.toLowerCase()`. Keying on the
    // raw string would give `Owner@X.uz` its own budget — a lockout with a
    // bypass anyone could find by holding shift.
    const canonical = lockoutKey('owner@sinolife.uz')
    expect(lockoutKey('Owner@SinoLife.uz')).toBe(canonical)
    expect(lockoutKey('  owner@sinolife.uz  ')).toBe(canonical)
  })

  it('separates different addresses', () => {
    expect(lockoutKey('owner@sinolife.uz')).not.toBe(lockoutKey('someone@sinolife.uz'))
  })

  it('does not carry the address into the table', () => {
    const key = lockoutKey('owner@sinolife.uz')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('owner')
    expect(key).not.toContain('sinolife')
  })
})

describe('lockoutMessage', () => {
  it('rounds the wait up, and never says zero minutes', () => {
    expect(lockMinutes(1)).toBe(1)
    expect(lockMinutes(MINUTE)).toBe(1)
    expect(lockMinutes(MINUTE + 1)).toBe(2)
    expect(lockMinutes(15 * MINUTE)).toBe(15)
  })

  it('tells the owner how long without telling an attacker anything', () => {
    const message = lockoutMessage(14 * MINUTE + 30_000)

    // A number to wait for, so nobody retries every thirty seconds for an hour.
    expect(message).toContain('15 daqiqa')
    // Uzbek, with the house apostrophe (U+02BB).
    expect(message).toContain('koʻp')
    // Nothing about accounts, addresses, or whether either exists: the same
    // sentence has to serve a real address and an invented one.
    expect(message.toLowerCase()).not.toContain('email')
    expect(message).not.toMatch(/@/)
    expect(message.toLowerCase()).not.toContain('parol')
  })
})
