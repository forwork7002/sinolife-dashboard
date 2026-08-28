import { describe, expect, it } from 'vitest'

import {
  MIN_PASSWORD_LENGTH,
  checkPassword,
  passwordStrength,
} from '@/lib/passwordPolicy'

/**
 * The password policy guards the only door into a dashboard that holds every
 * deal, every customer's phone number and a year of revenue. These tests exist
 * so a future edit that loosens a rule fails here rather than in the wild.
 */
describe('checkPassword', () => {
  it('accepts a long passphrase with three character classes', () => {
    const result = checkPassword('Bugungi-savdo-yaxshi7')
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('accepts a generated password', () => {
    expect(checkPassword('Tog-nilufar-burgut85!').ok).toBe(true)
  })

  it(`refuses anything shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    const result = checkPassword('Qisqa1!x')
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes(String(MIN_PASSWORD_LENGTH)))).toBe(true)
  })

  it('refuses a long password that uses only one character class', () => {
    const result = checkPassword('abcdefghijklmnop')
    expect(result.ok).toBe(false)
  })

  it('accepts three of the four classes rather than demanding all four', () => {
    // lower + upper + digit, no symbol — the passphrase case the rule protects.
    expect(checkPassword('Yulduzli-Kecha42').ok).toBe(true)
  })

  it('refuses a password built around a word an attacker would try first', () => {
    for (const weak of ['Sinolife-2026!', 'MyParol-12345', 'Zextra-Dashboard1']) {
      expect(checkPassword(weak).ok, weak).toBe(false)
    }
  })

  it('refuses a long run of one character', () => {
    expect(checkPassword('Aaaaaaaaaaaa1!').ok).toBe(false)
  })

  it('refuses keyboard and alphabet runs', () => {
    expect(checkPassword('Qwertyuiop12!').ok).toBe(false)
    expect(checkPassword('Xabcdefgh12!Z').ok).toBe(false)
  })

  it('refuses a password that restates the account email or name', () => {
    const identity = { email: 'murod@sinolife.uz', name: 'Murod Sodiqov' }
    expect(checkPassword('Murod-Kuchli-42!', identity).ok).toBe(false)
    expect(checkPassword('murod@sinolife.uz-X1', identity).ok).toBe(false)
    // The same password is fine for a different account.
    expect(checkPassword('Murod-Kuchli-42!', { email: 'ali@example.com', name: 'Ali' }).ok).toBe(
      true,
    )
  })

  it('reports every broken rule at once, not just the first', () => {
    const result = checkPassword('parol')
    expect(result.problems.length).toBeGreaterThan(1)
  })

  it('does not crash on an empty password', () => {
    expect(checkPassword('').ok).toBe(false)
  })
})

describe('passwordStrength', () => {
  it('is zero for nothing typed', () => {
    expect(passwordStrength('')).toBe(0)
  })

  it('never claims a policy-failing password is acceptable', () => {
    // A weak password can reach at most the first bar.
    expect(passwordStrength('password123')).toBeLessThanOrEqual(1)
  })

  it('grows with length once the policy is satisfied', () => {
    const short = passwordStrength('Yulduzli-Kecha42')
    const long = passwordStrength('Yulduzli-Kecha-Osmon-42')
    expect(short).toBeGreaterThanOrEqual(2)
    expect(long).toBeGreaterThan(short)
  })
})
