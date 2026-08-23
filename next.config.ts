import type { NextConfig } from 'next'

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
        ],
      },
    ]
  },
}

export default nextConfig
