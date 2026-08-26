import { describe, expect, it } from 'vitest'

import { caCertFromEnv, poolConfig } from '@/server/db/poolConfig'

/**
 * The bug these lock in.
 *
 * DigitalOcean's managed Postgres hands out a URL ending `?sslmode=require`
 * and signs the cluster with its own CA. `pg` reads `require` as "verify
 * against the system trust store" — libpq reads it as "encrypt, do not
 * verify" — so every connection was rejected with `self-signed certificate in
 * certificate chain` and the app never reached the database at all.
 */

const MANAGED = 'postgresql://u:p@db.example.com:25060/defaultdb?sslmode=require'
const LOCAL = 'postgresql://postgres:p@localhost:5432/sinolife?schema=public'

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'

describe('poolConfig', () => {
  it('stops pg verifying a managed cluster it has no CA for', () => {
    expect(poolConfig(MANAGED).ssl).toEqual({ rejectUnauthorized: false })
  })

  it('verifies for real once the CA is supplied', () => {
    expect(poolConfig(MANAGED, { caCert: PEM }).ssl).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    })
  })

  it('accepts a CA whose newlines survived a dashboard field as literal \\n', () => {
    const flattened = PEM.replace(/\n/g, '\\n')
    const ssl = poolConfig(MANAGED, { caCert: flattened }).ssl as { ca: string }
    expect(ssl.ca).toBe(PEM)
  })

  it('leaves a local URL with no sslmode completely alone', () => {
    expect(poolConfig(LOCAL).ssl).toBeUndefined()
  })

  it('leaves sslmode=disable alone', () => {
    expect(poolConfig(`${LOCAL}&sslmode=disable`).ssl).toBeUndefined()
  })

  it('does not weaken a URL that explicitly asked for verify-full', () => {
    const url = MANAGED.replace('sslmode=require', 'sslmode=verify-full')
    expect(poolConfig(url).ssl).toBeUndefined()
  })

  it('honours verify-full with a CA rather than ignoring the CA', () => {
    const url = MANAGED.replace('sslmode=require', 'sslmode=verify-full')
    expect(poolConfig(url, { caCert: PEM }).ssl).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    })
  })

  it('passes pool sizing through and keeps it out of the ssl block', () => {
    const config = poolConfig(MANAGED, { max: 5, idleTimeoutMillis: 30_000 })
    expect(config.max).toBe(5)
    expect(config.idleTimeoutMillis).toBe(30_000)
    expect(config.ssl).toEqual({ rejectUnauthorized: false })
  })

  it('sets a server-side statement timeout only when one is asked for', () => {
    expect(poolConfig(MANAGED).statement_timeout).toBeUndefined()
    expect(poolConfig(MANAGED, { statementTimeoutMs: 20_000 }).statement_timeout).toBe(20_000)
  })

  it('leaves an unparseable connection string to pg to complain about', () => {
    expect(() => poolConfig('not a url')).not.toThrow()
    expect(poolConfig('not a url').ssl).toBeUndefined()
  })
})

describe('caCertFromEnv', () => {
  it('treats a blank variable as unset — a dashboard field left empty is not a CA', () => {
    expect(caCertFromEnv({ DATABASE_CA_CERT: '' })).toBeUndefined()
    expect(caCertFromEnv({ DATABASE_CA_CERT: '   ' })).toBeUndefined()
    expect(caCertFromEnv({})).toBeUndefined()
  })

  it('returns the certificate when one is set', () => {
    expect(caCertFromEnv({ DATABASE_CA_CERT: PEM })).toBe(PEM)
  })
})
