import { describe, expect, it } from 'vitest'

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  passwordStrength,
} from '@/lib/passwordPolicy'

/**
 * The policy is length, and only length.
 *
 * It used to be twelve characters, three of four character classes, a
 * banned-fragment list, no repeated or keyboard runs, and no restating of the
 * account's own email or name. The owner of the deployment removed all of it
 * deliberately; these tests were rewritten to describe what the product does
 * now rather than left asserting rules it no longer has.
 *
 * What they still pin down is the part that matters: the floor holds, the
 * ceiling holds, and nothing else silently creeps back in — a password of
 * eight ordinary characters must be ACCEPTED, and a test that fails because
 * someone re-added a class rule is the point.
 */
describe('checkPassword', () => {
  it(`accepts exactly ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true)
  })

  it(`refuses anything shorter than ${MIN_PASSWORD_LENGTH}`, () => {
    const result = checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('accepts the simple passwords the old policy refused', () => {
    // Every one of these broke a rule that no longer exists: one character
    // class, a keyboard run, a repeated character, the company name.
    for (const password of ['12345678', 'password', 'qwertyui', 'aaaaaaaa', 'sinolife']) {
      expect(checkPassword(password).ok, password).toBe(true)
    }
  })

  it('does not care about the account email or name any more', () => {
    const result = checkPassword('dilnoza@sinolife.local', {
      email: 'dilnoza@sinolife.local',
      name: 'Dilnoza',
    })
    expect(result.ok).toBe(true)
  })

  it(`refuses more than ${MAX_PASSWORD_LENGTH} characters`, () => {
    // Not a policy choice: better-auth refuses it, and hashing unbounded input
    // is a denial of service rather than a strong password.
    expect(checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false)
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
    expect(passwordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(0)
  })

  it('grows with length, as advice rather than as a gate', () => {
    const short = passwordStrength('a'.repeat(MIN_PASSWORD_LENGTH))
    const longer = passwordStrength('a'.repeat(20))
    expect(short).toBeGreaterThan(0)
    expect(longer).toBeGreaterThan(short)
  })
})
