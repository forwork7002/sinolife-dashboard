import { isAPIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'

import {
  MAX_FAILED_SIGN_INS,
  type LockoutState,
  type LockoutStore,
  type LockoutTx,
  lockoutKey,
} from '@/server/auth/lockout'
import {
  type AccountLookup,
  guardSignIn,
  refuseUnusedEndpoint,
  settleSignIn,
  signInLockoutIdentifiers,
  signInOutcome,
} from '@/server/auth/signInHooks'
import { APIError } from 'better-auth/api'

/**
 * The sign-in hooks, without a database.
 *
 * `MemoryStore` behaves like the Postgres store where it matters: every read
 * and write is a separate await (a round trip), so attempts that are not
 * serialised interleave exactly as concurrent requests do — and `lock` holds a
 * key until the transaction ends, like `pg_advisory_xact_lock`. Remove the
 * lock from `reserveSignInAttempt` and the race cases below fail.
 */

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

class MemoryStore implements LockoutStore {
  readonly rows = new Map<string, LockoutState>()
  private readonly tails = new Map<string, Promise<void>>()

  async transaction<T>(work: (tx: LockoutTx) => Promise<T>): Promise<T> {
    const held: (() => void)[] = []
    const tx: LockoutTx = {
      lock: async (keys) => {
        for (const key of keys) {
          const previous = this.tails.get(key) ?? Promise.resolve()
          let release!: () => void
          const mine = new Promise<void>((resolve) => (release = resolve))
          this.tails.set(key, previous.then(() => mine))
          await previous
          held.push(release)
        }
      },
      read: async (key) => {
        await tick()
        return this.rows.get(key) ?? null
      },
      write: async (key, state) => {
        await tick()
        this.rows.set(key, state)
      },
      remove: async (key) => {
        await tick()
        this.rows.delete(key)
      },
    }
    try {
      return await work(tx)
    } finally {
      for (const release of held) release()
    }
  }

  async prune(): Promise<void> {}

  stateOf(identifier: string): LockoutState | undefined {
    return this.rows.get(lockoutKey(identifier))
  }
}

/** Nobody exists: the lookup a guesser's invented login meets. */
const NOBODY: AccountLookup = { byLogin: async () => null, byEmail: async () => null }

function accounts(list: { username: string | null; email: string }[]): AccountLookup {
  return {
    byLogin: async (login) => list.find((a) => a.username === login) ?? null,
    byEmail: async (email) => list.find((a) => a.email === email) ?? null,
  }
}

const UNAUTHORIZED = new APIError('UNAUTHORIZED', { message: 'Invalid username or password' })

/** One full attempt: before → the (slow) password check → after. */
async function attempt(
  store: MemoryStore,
  path: '/sign-in/username' | '/sign-in/email',
  body: Record<string, unknown>,
  returned: unknown,
  lookup: AccountLookup = NOBODY,
): Promise<'verified' | 'locked'> {
  try {
    await guardSignIn(path, body, { lookup, store })
  } catch (error) {
    if (isAPIError(error) && error.statusCode === 429) return 'locked'
    throw error
  }
  // scrypt runs off the event loop; every other request proceeds meanwhile.
  for (let i = 0; i < 5; i++) await tick()
  await settleSignIn(path, body, returned, { lookup, store })
  return 'verified'
}

describe('refused auth endpoints', () => {
  it('refuses /update-user, so no session can rename itself', () => {
    let thrown: unknown
    try {
      refuseUnusedEndpoint('/update-user')
    } catch (error) {
      thrown = error
    }
    expect(isAPIError(thrown)).toBe(true)
    expect((thrown as APIError).statusCode).toBe(404)
  })

  it('still refuses /is-username-available', () => {
    expect(() => refuseUnusedEndpoint('/is-username-available')).toThrow()
  })

  it('leaves the paths the product uses alone', () => {
    for (const path of ['/sign-in/username', '/sign-in/email', '/get-session', '/change-password', '/sign-out']) {
      expect(() => refuseUnusedEndpoint(path)).not.toThrow()
    }
  })
})

describe('lockout identifiers', () => {
  it("keys the login path on '<login>@sinolife.local' whether or not the login exists", async () => {
    const exists = accounts([{ username: 'ali', email: 'ali@sinolife.local' }])
    const viaLogin = await signInLockoutIdentifiers('/sign-in/username', { username: ' Ali ' }, exists)
    const viaEmail = await signInLockoutIdentifiers('/sign-in/email', { email: 'ali@sinolife.local' }, exists)
    const inventedLogin = await signInLockoutIdentifiers('/sign-in/username', { username: 'ali' }, NOBODY)
    const inventedEmail = await signInLockoutIdentifiers('/sign-in/email', { email: 'ALI@sinolife.local' }, NOBODY)

    expect(viaLogin).toEqual(['ali@sinolife.local'])
    expect(viaEmail).toEqual(viaLogin)
    expect(inventedLogin).toEqual(viaLogin)
    expect(inventedEmail).toEqual(viaLogin)
  })

  it('also counts a real-email account under its other name, both ways', async () => {
    const founder = accounts([{ username: 'admin', email: 'owner@example.uz' }])
    expect(await signInLockoutIdentifiers('/sign-in/username', { username: 'admin' }, founder)).toEqual([
      'admin@sinolife.local',
      'owner@example.uz',
    ])
    expect(await signInLockoutIdentifiers('/sign-in/email', { email: 'Owner@Example.uz' }, founder)).toEqual([
      'owner@example.uz',
      'admin@sinolife.local',
    ])
  })

  it('ignores other paths and empty bodies', async () => {
    expect(await signInLockoutIdentifiers('/sign-in/username', {}, NOBODY)).toEqual([])
    expect(await signInLockoutIdentifiers('/sign-in/email', { email: '  ' }, NOBODY)).toEqual([])
    expect(await signInLockoutIdentifiers('/change-password', { email: 'x@y.z' }, NOBODY)).toEqual([])
  })
})

describe('the cross-path existence oracle', () => {
  /*
    The probe from the finding: five wrong passwords on /sign-in/email for
    '<name>@sinolife.local', then one /sign-in/username for '<name>'. It must
    answer the same — locked — for a login that exists and one that does not.
  */
  for (const [label, lookup] of [
    ['exists', accounts([{ username: 'ali', email: 'ali@sinolife.local' }])],
    ['does not exist', NOBODY],
  ] as const) {
    it(`answers 429 on the login path when the login ${label}`, async () => {
      const store = new MemoryStore()
      for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) {
        await attempt(store, '/sign-in/email', { email: 'ali@sinolife.local' }, UNAUTHORIZED, lookup)
      }
      expect(await attempt(store, '/sign-in/username', { username: 'ali' }, UNAUTHORIZED, lookup)).toBe('locked')
    })
  }

  it('still carries a lock across paths for the real-email account', async () => {
    const founder = accounts([{ username: 'admin', email: 'owner@example.uz' }])
    const store = new MemoryStore()
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) {
      await attempt(store, '/sign-in/email', { email: 'owner@example.uz' }, UNAUTHORIZED, founder)
    }
    expect(await attempt(store, '/sign-in/username', { username: 'admin' }, {}, founder)).toBe('locked')
  })
})

describe('concurrent attempts', () => {
  it('lets no more than five of ten parallel wrong passwords reach verification', async () => {
    const store = new MemoryStore()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => attempt(store, '/sign-in/username', { username: 'ali' }, UNAUTHORIZED)),
    )

    expect(results.filter((r) => r === 'verified')).toHaveLength(MAX_FAILED_SIGN_INS)
    expect(results.filter((r) => r === 'locked')).toHaveLength(10 - MAX_FAILED_SIGN_INS)
    const state = store.stateOf('ali@sinolife.local')
    expect(state?.failedCount).toBe(MAX_FAILED_SIGN_INS)
    expect(state?.lockedUntil).not.toBeNull()
  })

  it('counts every parallel failure below the threshold (no lost updates)', async () => {
    const store = new MemoryStore()
    await Promise.all(
      Array.from({ length: 4 }, () => attempt(store, '/sign-in/username', { username: 'ali' }, UNAUTHORIZED)),
    )
    expect(store.stateOf('ali@sinolife.local')?.failedCount).toBe(4)
    expect(store.stateOf('ali@sinolife.local')?.lockedUntil).toBeNull()
  })
})

describe('settling a reservation', () => {
  it('a correct password clears the record', async () => {
    const store = new MemoryStore()
    await attempt(store, '/sign-in/username', { username: 'ali' }, UNAUTHORIZED)
    await attempt(store, '/sign-in/username', { username: 'ali' }, { token: 't', user: { id: 'u' } })
    expect(store.stateOf('ali@sinolife.local')).toBeUndefined()
  })

  it('a wrong origin or a server error costs nothing', async () => {
    const store = new MemoryStore()
    for (let i = 0; i < 3; i++) {
      await attempt(store, '/sign-in/username', { username: 'ali' }, UNAUTHORIZED)
    }
    await attempt(store, '/sign-in/username', { username: 'ali' }, new APIError('FORBIDDEN'))
    await attempt(store, '/sign-in/username', { username: 'ali' }, new APIError('INTERNAL_SERVER_ERROR'))
    expect(store.stateOf('ali@sinolife.local')?.failedCount).toBe(3)
  })

  it('handing back the reservation that armed the lock lifts the lock', async () => {
    const store = new MemoryStore()
    for (let i = 0; i < MAX_FAILED_SIGN_INS - 1; i++) {
      await attempt(store, '/sign-in/username', { username: 'ali' }, UNAUTHORIZED)
    }
    await attempt(store, '/sign-in/username', { username: 'ali' }, new APIError('FORBIDDEN'))
    const state = store.stateOf('ali@sinolife.local')
    expect(state?.failedCount).toBe(MAX_FAILED_SIGN_INS - 1)
    expect(state?.lockedUntil).toBeNull()
  })

  it('reads only a 401 as a guess', () => {
    expect(signInOutcome(UNAUTHORIZED)).toBe('failed')
    expect(signInOutcome(new APIError('FORBIDDEN'))).toBe('void')
    expect(signInOutcome(new APIError('BAD_REQUEST'))).toBe('void')
    expect(signInOutcome({ token: 't' })).toBe('succeeded')
  })
})
