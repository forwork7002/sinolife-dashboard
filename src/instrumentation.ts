/**
 * Runs once when a Next.js server starts (see node_modules/next/dist/docs,
 * «instrumentation.js»). Starts the «RNP jadvali» warm-up — Node runtime
 * only, and not while `next build` collects pages.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.NODE_ENV !== 'production') return
  const [{ startRnpWarmer }, { rnpService }, { env }] = await Promise.all([
    import('@/server/services/rnpWarmer'),
    import('@/server/services/container'),
    import('@/server/config/env'),
  ])
  // Not awaited: `register` must finish before the server takes requests.
  startRnpWarmer(() => rnpService.warm(new Date(), env.APP_TIMEZONE))
}
