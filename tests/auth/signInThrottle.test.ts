import { describe, expect, it, vi } from 'vitest'

import {
  KNOWN_IP_LOOKBACK_MS,
  KNOWN_IP_MEMO_LIMIT,
  KNOWN_IP_MEMO_MS,
  KNOWN_IP_MIN_USERS,
  KNOWN_IP_SIGN_IN_MAX,
  SIGN_IN_MAX,
  SIGN_IN_WINDOW_SECONDS,
  signInThrottle,
} from '@/server/auth/signInThrottle'

/**
 * The office signs in through one address. Five a minute was that whole
 * floor's budget; an address three different people signed in from this week
 * gets thirty, and anything the throttle cannot vouch for keeps five.
 */

const OFFICE = '203.0.113.9'
const STRANGER = '198.51.100.7'

/** A request whose client address is the `x-ip` header — the resolver is ours. */
function from(ip: string | null): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/username', {
    method: 'POST',
    headers: ip ? { 'x-ip': ip } : {},
  })
}

/** `users` is how many different people signed in from each address this week. */
function setup(users: Record<string, number> = { [OFFICE]: 12, [STRANGER]: 0 }) {
  let clock = Date.UTC(2026, 9, 16, 9, 0, 0)
  const usersSignedInFrom = vi.fn(async (ip: string, _since: Date, enough: number) =>
    Math.min(users[ip] ?? 0, enough),
  )
  const onLookupError = vi.fn()
  const rule = signInThrottle({
    clientIp: (request) => request.headers.get('x-ip'),
    usersSignedInFrom,
    onLookupError,
    now: () => clock,
  })
  return {
    rule,
    users,
    usersSignedInFrom,
    onLookupError,
    advance: (ms: number) => {
      clock += ms
    },
    now: () => clock,
  }
}

const max = async (rule: (r: Request) => Promise<{ max: number }>, ip: string | null) => (await rule(from(ip))).max

describe('signInThrottle', () => {
  it('is five a minute, thirty from an address three people signed in from', () => {
    // Every other case compares against the constants; this one holds them.
    expect([SIGN_IN_MAX, KNOWN_IP_SIGN_IN_MAX, KNOWN_IP_MIN_USERS, SIGN_IN_WINDOW_SECONDS]).toEqual([5, 30, 3, 60])
    expect(KNOWN_IP_LOOKBACK_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('gives an address several people signed in from this week thirty a minute', async () => {
    const { rule } = setup()
    expect(await rule(from(OFFICE))).toEqual({ window: SIGN_IN_WINDOW_SECONDS, max: KNOWN_IP_SIGN_IN_MAX })
  })

  it('keeps any other address at five', async () => {
    const { rule } = setup()
    expect(await rule(from(STRANGER))).toEqual({ window: SIGN_IN_WINDOW_SECONDS, max: SIGN_IN_MAX })
  })

  it('does not trust an address one or two people signed in from', async () => {
    const { rule } = setup({ '192.0.2.1': 1, '192.0.2.2': KNOWN_IP_MIN_USERS - 1, '192.0.2.3': KNOWN_IP_MIN_USERS })
    expect(await max(rule, '192.0.2.1')).toBe(SIGN_IN_MAX)
    expect(await max(rule, '192.0.2.2')).toBe(SIGN_IN_MAX)
    expect(await max(rule, '192.0.2.3')).toBe(KNOWN_IP_SIGN_IN_MAX)
  })

  it('asks about the last seven days, and only as far as it needs to count', async () => {
    const { rule, usersSignedInFrom, now } = setup()
    await rule(from(OFFICE))
    expect(usersSignedInFrom).toHaveBeenCalledWith(OFFICE, new Date(now() - KNOWN_IP_LOOKBACK_MS), KNOWN_IP_MIN_USERS)
  })

  it('keeps five, and asks nothing, when the limiter has no address', async () => {
    const { rule, usersSignedInFrom } = setup()
    expect(await max(rule, null)).toBe(SIGN_IN_MAX)
    expect(usersSignedInFrom).not.toHaveBeenCalled()
  })

  it('fails closed: a lookup that throws is five, and is reported', async () => {
    const { rule, usersSignedInFrom, onLookupError } = setup()
    const failure = new Error('pool timeout')
    usersSignedInFrom.mockRejectedValueOnce(failure)
    expect(await max(rule, OFFICE)).toBe(SIGN_IN_MAX)
    expect(onLookupError).toHaveBeenCalledWith(failure)
  })

  it('asks the database once a minute per address, whatever the answer', async () => {
    const { rule, usersSignedInFrom, advance } = setup()
    for (let i = 0; i < 10; i += 1) {
      await rule(from(OFFICE))
      await rule(from(STRANGER))
    }
    expect(usersSignedInFrom).toHaveBeenCalledTimes(2)

    advance(KNOWN_IP_MEMO_MS)
    await rule(from(OFFICE))
    expect(usersSignedInFrom).toHaveBeenCalledTimes(3)
  })

  it('answers a burst of parallel requests from a new address with ONE query', async () => {
    const { rule, usersSignedInFrom } = setup()
    const answers = await Promise.all(Array.from({ length: 20 }, () => max(rule, OFFICE)))
    expect(answers.every((m) => m === KNOWN_IP_SIGN_IN_MAX)).toBe(true)
    expect(usersSignedInFrom).toHaveBeenCalledTimes(1)
  })

  it('remembers a failed lookup too, so an outage is not a query per request', async () => {
    const { rule, usersSignedInFrom } = setup()
    usersSignedInFrom.mockRejectedValueOnce(new Error('down'))
    await rule(from(OFFICE))
    await rule(from(OFFICE))
    expect(usersSignedInFrom).toHaveBeenCalledTimes(1)
  })

  it('learns a new office address within a minute of it qualifying', async () => {
    const { rule, users, advance } = setup({ [OFFICE]: 2 })
    expect(await max(rule, OFFICE)).toBe(SIGN_IN_MAX)

    users[OFFICE] = 3
    expect(await max(rule, OFFICE)).toBe(SIGN_IN_MAX)
    advance(KNOWN_IP_MEMO_MS)
    expect(await max(rule, OFFICE)).toBe(KNOWN_IP_SIGN_IN_MAX)
  })

  it('forgets the oldest address first once the memo is full', async () => {
    const { rule, usersSignedInFrom } = setup()
    await rule(from(OFFICE))
    for (let i = 0; i < KNOWN_IP_MEMO_LIMIT; i += 1) await rule(from(`10.1.${i >> 8}.${i & 255}`))
    usersSignedInFrom.mockClear()

    await rule(from(OFFICE))
    expect(usersSignedInFrom).toHaveBeenCalledTimes(1)
  })
})
