import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

import { AUTH_COOKIE_PREFIX } from '@/server/auth/cookiePrefix'

/**
 * Route gate for PAGES.
 *
 * This is an optimistic check only: it looks for the presence of a session
 * cookie so a signed-out visitor is redirected to /login instead of watching a
 * dashboard shell flash and then fail every request.
 *
 * It is NOT the authorisation boundary. The cookie is not verified here â€”
 * middleware runs on the edge without database access, and validating a session
 * per navigation would mean a database round trip on every page. Every API
 * route independently resolves and verifies the session and asserts a
 * permission, which is where access is actually decided. A forged cookie gets
 * past this redirect and then receives 401s from every endpoint.
 */
export function middleware(request: NextRequest) {
  // The prefix MUST match the auth config, or this looks for a cookie that
  // does not exist and redirects every signed-in user back to login.
  const cookie = getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })

  if (!cookie) {
    const url = new URL('/login', request.url)
    // Preserve where they were heading so login can return them there.
    url.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  /**
   * Everything except the auth endpoints, the login page, Next's internals and
   * static assets. The API is excluded on purpose: an unauthenticated API call
   * must return a 401 envelope the client can handle, not an HTML redirect.
   */
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico|.*\\.svg).*)'],
}
