/**
 * Runs once when a Next.js server starts (see node_modules/next/dist/docs,
 * «instrumentation.js»). Starts the «RNP jadvali», «Lidlar», «Лид назорати» and «Kunlar boʻyicha» warm-ups — Node runtime
 * only, and not while `next build` collects pages.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.NODE_ENV !== 'production') return
  const [
    { RNP_WARM_EVERY_MS, startRnpWarmer, startWarmer },
    { warmServices },
    { env },
    { LEADS_WARM_EVERY_MS },
    { LEAD_WATCH_WARM_EVERY_MS },
    { monthReadsWarm },
  ] = await Promise.all([
    import('@/server/services/rnpWarmer'),
    import('@/server/services/container'),
    import('@/server/config/env'),
    import('@/server/services/leadSourcesService'),
    import('@/server/services/leadWatchService'),
    import('@/server/services/monthReadsWarmer'),
  ])
  /*
    On the warm lane's one connection (`warmServices`, container.ts), never
    the screens' five: a warm-up queues behind itself, not in front of a reader.
  */
  const { rnp: rnpService, leadSources: leadSourcesService, leadWatch: leadWatchService, roistat: roistatService } = warmServices
  // Not awaited: `register` must finish before the server takes requests.
  const rnp = startRnpWarmer(() => rnpService.warm(new Date(), env.APP_TIMEZONE))
  // After RNP's first build, not beside it: both cold at once would take the pool, /api/health's probe included.
  const leads = startWarmer('leads', () => leadSourcesService.warm(new Date(), env.APP_TIMEZONE), LEADS_WARM_EVERY_MS, undefined, rnp())
  // «Лид назорати» after them, for the same reason: a day's rows, small beside the two above.
  // First in the lane on every tick after (2026-10-28): a live screen does not wait behind a month's scans.
  const leadWatch = startWarmer(
    'lead-watch',
    () => leadWatchService.warm(new Date(), env.APP_TIMEZONE),
    LEAD_WATCH_WARM_EVERY_MS,
    undefined,
    leads(),
    true,
  )
  // «Kunlar boʻyicha»'s «Shu oy» (2026-10-28) last: its FAKT is the RNP sheet's, built first.
  const salesDays = startWarmer('sales-days', () => roistatService.warm(new Date(), env.APP_TIMEZONE), RNP_WARM_EVERY_MS, undefined, leadWatch())
  // The month reads the screens' 20 s pool could not build (2026-10-28) — «Qoʻngʻiroqlar», «Kiruvchi tahlil», Reklama / DM.
  const monthReads = monthReadsWarm(warmServices)
  startWarmer('month-reads', () => monthReads(new Date(), env.APP_TIMEZONE), RNP_WARM_EVERY_MS, undefined, salesDays())
}
