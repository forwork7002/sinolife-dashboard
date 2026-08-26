import { describe, expect, it } from 'vitest'

import { resolveTrustedProxies } from '@/server/auth/trustedProxies'

/**
 * The hole these close.
 *
 * Rate limiting is keyed on the client IP, and behind a proxy the only source
 * of that is X-Forwarded-For — a header the client writes. With no proxy list
 * configured, better-auth takes a single-value header at face value, so
 * `X-Forwarded-For: 1.2.3.4` picks a bucket and the next value picks another.
 * Unlimited password attempts, one per bucket.
 */

describe('resolveTrustedProxies', () => {
  it('defaults to private space, where a managed load balancer connects from', () => {
    const proxies = resolveTrustedProxies(undefined)
    expect(proxies).toContain('10.0.0.0/8')
    expect(proxies).toContain('172.16.0.0/12')
    expect(proxies).toContain('192.168.0.0/16')
  })

  it('treats a blank variable as unset — a platform stores an empty field, not a missing one', () => {
    expect(resolveTrustedProxies('')).toEqual(resolveTrustedProxies(undefined))
    expect(resolveTrustedProxies('  ,  ')).toEqual(resolveTrustedProxies(undefined))
  })

  it('replaces the default rather than adding to it, so a narrower list stays narrow', () => {
    expect(resolveTrustedProxies('192.0.2.10')).toEqual(['192.0.2.10'])
  })

  it('splits a comma-separated list and trims it', () => {
    expect(resolveTrustedProxies(' 192.0.2.10 , 10.0.0.0/24 ')).toEqual([
      '192.0.2.10',
      '10.0.0.0/24',
    ])
  })
})
