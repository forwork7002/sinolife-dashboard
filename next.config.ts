import type { NextConfig } from 'next'

/**
 * The app's own address, as configured. Used only to decide whether HSTS
 * applies — sending it over plain http would be ignored by browsers anyway,
 * and sending it in local development would pin localhost to https in the
 * browser's HSTS store for a year, which is genuinely hard to undo.
 */
const isHttps = (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://')

const HSTS = 'max-age=31536000; includeSubDomains'

/**
 * Nothing here is used. Naming them denies them: a script that manages to run
 * cannot reach for the camera, the microphone or the location API.
 */
const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'interest-cohort=()',
].join(', ')

/**
 * Content Security Policy.
 *
 * The value of this one is `connect-src 'self'` and `form-action 'self'`: even
 * if something injected a script into the page, it could not post the sales
 * figures — or a session — to an address outside this origin. `frame-ancestors`
 * repeats X-Frame-Options for browsers that prefer CSP, and `base-uri` closes
 * the `<base href>` trick that redirects every relative URL on the page.
 *
 * `'unsafe-inline'` on scripts is not an oversight. Next.js inlines its
 * hydration bootstrap and its flight data into the document; locking that down
 * means threading a per-request nonce through middleware, which cannot be done
 * for statically rendered routes. Styles are inline for the same reason —
 * Tailwind's critical CSS ships in the document head.
 *
 * `'unsafe-eval'` is development-only. React Refresh needs it; production
 * does not, and leaving it on in production would hand an injected script the
 * one primitive CSP is best at removing.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
  /**
   * Prisma must not be bundled into the serverless function.
   *
   * The generated client loads its schema and adapter at runtime; bundling it
   * breaks that resolution and the function fails on first query with a module
   * error that looks nothing like a database problem.
   */
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],

  // The dashboard is an internal tool: keep it out of search results and out
  // of other people's iframes.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
          ...(isHttps ? [{ key: 'Strict-Transport-Security', value: HSTS }] : []),
        ],
      },
    ]
  },
}

export default nextConfig
