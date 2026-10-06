/**
 * Runs once when a Next.js server starts (see node_modules/next/dist/docs,
 * «instrumentation.js»). Starts the «RNP jadvali» and «Lidlar» warm-ups — Node runtime
 * only, and not while `next build` collects pages.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.NODE_ENV !== 'production') return
  const [{ startRnpWarmer, startWarmer }, { rnpService, leadSourcesService }, { env }, { LEADS_WARM_EVERY_MS }] = await Promise.all([
    import('@/server/services/rnpWarmer'),
    import('@/server/services/container'),
    import('@/server/config/env'),
    import('@/server/services/leadSourcesService'),
  ])
  // Not awaited: `register` must finish before the server takes requests.
  const rnp = startRnpWarmer(() => rnpService.warm(new Date(), env.APP_TIMEZONE))
  // After RNP's first build, not beside it: both cold at once would take the pool, /api/health's probe included.
  startWarmer('leads', () => leadSourcesService.warm(new Date(), env.APP_TIMEZONE), LEADS_WARM_EVERY_MS, undefined, rnp())
}
