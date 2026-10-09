/**
 * «Лид назорати» — every threshold of the lead watch block on «Lidlar», in ONE
 * place (the user, 2026-10-09: «barcha chegaralar bitta sozlamalar faylida
 * boʻlsin, keyin oʻzgartira olay»). Shared vocabulary: the server reads it to
 * decide what is a problem, the client to colour a waiting timer the same way.
 *
 * Minutes unless a name says otherwise. `warn` is where a row becomes a
 * problem at all, `critical` where its card turns red.
 */
export const LEAD_WATCH_SETTINGS = {
  /** The page asks again this often; the worker refreshes calls and chats on the same clock. */
  refreshEveryMs: 2 * 60_000,
  /** «Yangilanmayapti»: the data is older than this. */
  staleAfterMin: 5,

  /** Working hours, Tashkent clock: [from, to) — «Канал стоп» and the flow chart. */
  workHours: { from: 9, to: 21 },

  /** 1 · «РОП (Первичка)» empty this long after the lead was created. */
  unassigned: { warnMin: 10, criticalMin: 30 },
  /** 2 · still on the first stage with no call this long after the lead was created. */
  idle: { warnMin: 15, criticalMin: 30 },
  /** 3 · an open-line chat left open (not completed) this long. */
  chats: { warnMin: 10, criticalMin: 30 },
  /** 4 · a missed inbound call nobody rang back within `warnMin`. */
  missedCalls: { warnMin: 30, criticalMin: 60 },
  /** 5 · a form or an SMM page silent for `silentMin` in an hour it usually delivers. */
  channelStop: {
    silentMin: 60,
    /** Days of history the «usual» hour is read from. */
    historyDays: 7,
    /** «Usually delivers»: at least this many leads in this hour on average over the history. */
    usualPerHour: 1,
    /** «Yetib keldi» (Bitrix lid ÷ Meta lid) below this is a problem… */
    arrivalWarnPct: 85,
    /** …and below this a critical one. */
    arrivalCriticalPct: 60,
    /** Fewer Meta leads than this is too few to judge a percentage on. */
    arrivalMinMetaLeads: 20,
  },
  /** 6 · a ROP's share of today's leads. */
  uneven: {
    /** Times the average ROP. */
    timesAverage: 2,
    /** Per cent off the «Taqsimotni belgilash» plan, either way. */
    planDeviationPct: 30,
    /** Fewer distributed leads than this today is too few to judge. */
    minLeads: 30,
    /** …and a ROP fewer than this many LEADS off its plan (or above the average) is not a problem, whatever the per cent. */
    minDiffLeads: 5,
  },
  /** 7 · «Проект» empty: any is a warning, this many is critical. */
  noProject: { criticalCount: 20 },

  /** Rows sent per problem; the count is always the real one. */
  maxRows: 300,
} as const

export type LeadWatchSettings = typeof LEAD_WATCH_SETTINGS
