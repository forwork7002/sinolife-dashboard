import { describe, expect, it } from 'vitest'

import {
  configuredOrigins,
  resolveTrustedOrigins,
  selfOrigins,
} from '@/server/auth/trustedOrigins'

/**
 * The bug these lock in.
 *
 * The dashboard is reachable at several addresses — localhost, 127.0.0.1, the
 * machine's LAN IP — and better-auth trusted only the one in BETTER_AUTH_URL.
 * Signing in at any other returned 403 INVALID_ORIGIN, no cookie was set, and
 * the page middleware then redirected every section back to /login. It looked
 * like a password that had stopped working.
 */

/** A stand-in for the machine's interfaces, so the tests do not depend on one. */
const interfaces = () => ({
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth0: [
    { address: '192.168.1.86', family: 'IPv4', internal: false },
    { address: 'fd00::1d18', family: 'IPv6', internal: false },
  ],
}) as unknown as ReturnType<typeof import('node:os').networkInterfaces>

describe('selfOrigins', () => {
  it('trusts loopback and this machine, on the configured port', () => {
    const origins = selfOrigins('http://localhost:3000', interfaces)

    expect(origins).toContain('http://localhost:3000')
    expect(origins).toContain('http://127.0.0.1:3000')
    expect(origins).toContain('http://[::1]:3000')
    expect(origins).toContain('http://192.168.1.86:3000')
  })

  it('keeps the port, because a different port is a different origin', () => {
    expect(selfOrigins('http://localhost:3100', interfaces)).toContain('http://localhost:3100')
    expect(selfOrigins('http://localhost:3100', interfaces)).not.toContain('http://localhost:3000')
  })

  /**
   * An https instance is reached by domain name. Adding loopback there would
   * give up a real protection for no benefit.
   */
  it('adds nothing for an https deployment', () => {
    expect(selfOrigins('https://dash.example.uz', interfaces)).toEqual([])
  })

  it('skips interface addresses that are internal or IPv6', () => {
    const origins = selfOrigins('http://localhost:3000', interfaces)
    expect(origins).not.toContain('http://fd00::1d18:3000')
  })

  it('survives a malformed base URL rather than throwing at boot', () => {
    expect(selfOrigins('not a url', interfaces)).toEqual([])
  })

  it('includes a configured hostname that is not loopback', () => {
    expect(selfOrigins('http://sinolife.local:3000', interfaces)).toContain(
      'http://sinolife.local:3000',
    )
  })
})

describe('configuredOrigins', () => {
  it('splits, trims and drops blanks', () => {
    expect(configuredOrigins(' https://a.uz , https://b.uz ,, ')).toEqual([
      'https://a.uz',
      'https://b.uz',
    ])
  })

  it('treats an unset value as none', () => {
    expect(configuredOrigins(undefined)).toEqual([])
    expect(configuredOrigins('')).toEqual([])
  })
})

describe('resolveTrustedOrigins', () => {
  it('combines both sources without duplicates', () => {
    const origins = resolveTrustedOrigins(
      'http://localhost:3000',
      'http://localhost:3000,https://dash.example.uz',
      interfaces,
    )

    // better-auth logs this list when it rejects a request; a duplicate entry
    // sends whoever is reading it looking for a second cause.
    expect(origins.filter((o) => o === 'http://localhost:3000')).toHaveLength(1)
    expect(origins).toContain('https://dash.example.uz')
  })

  it('lets a production domain be added to an https deployment', () => {
    expect(
      resolveTrustedOrigins('https://dash.example.uz', 'https://www.example.uz', interfaces),
    ).toEqual(['https://www.example.uz'])
  })
})
