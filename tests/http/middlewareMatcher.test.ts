import { describe, expect, it } from 'vitest'

import { config } from '@/middleware'

/**
 * Which paths the signed-out redirect covers.
 *
 * Next compiles each matcher entry to an anchored regular expression; the
 * entry here is already a plain regex body, so anchoring it is the same test.
 * The `.svg` alternative exempted the template's public/*.svg, deleted on
 * 2026-08-29 — afterwards it only let any path ending in `.svg` skip the
 * redirect to /login.
 */

const matcher = new RegExp(`^${config.matcher[0]}$`)

describe('middleware matcher', () => {
  it('covers a path ending in .svg like any other page', () => {
    expect(matcher.test('/foo.svg')).toBe(true)
    expect(matcher.test('/rnp/chart.svg')).toBe(true)
  })

  it('covers the screens', () => {
    for (const path of ['/', '/rnp', '/leads', '/users', '/confirmation']) {
      expect(matcher.test(path)).toBe(true)
    }
  })

  it('still leaves the API, the login page and static assets alone', () => {
    for (const path of [
      '/api/v1/meta/filters',
      '/api/auth/sign-in/username',
      '/login',
      '/build-id.json',
      '/_next/static/chunks/app.js',
      '/_next/static/media/logo.svg',
      '/_next/image',
      '/favicon.ico',
    ]) {
      expect(matcher.test(path)).toBe(false)
    }
  })
})
