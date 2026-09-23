import { SKIP_LOOKBACK_MS } from './SyncEngine'

/**
 * How long the cursor must have stood still before a start counts as a
 * RECOVERY: half an hour of real idleness, PLUS the distance the engine itself
 * sets the cursor back.
 *
 * Stage history finishes PARTIAL on nearly every run (rows pointing at stages
 * and deals the portal has deleted), so the engine stores `startedAt − 35 min`
 * as its watermark after an ordinary healthy tick. Measured against a bare
 * thirty minutes, that cursor looked idle the instant it was written: the
 * deploy of 2026-09-23 06:36 UTC, under a worker that had synced two minutes
 * earlier, wound back 45 days and re-read 81 970 rows from the portal in one
 * tick — the redeploy cost this rule was written to stop.
 */
export const HISTORY_IDLE_MS = 30 * 60_000 + (SKIP_LOOKBACK_MS.STAGE_HISTORY ?? 0)

/**
 * Where the stage-history cursor should be wound back to at startup, if at all.
 *
 * A LOST ARRIVAL ROW TAKES AN ORDER OFF THE BOARD AND SAYS NOTHING. The
 * Тасдиклаш queue is cohorted on the deal's entry into `C4:NEW`, so that one
 * row IS the order's membership — and before the watermark learned to rewind
 * after a skipped run (`SKIP_LOOKBACK_MS` in SyncEngine.ts), a row whose deal
 * had not been imported yet was dropped and never offered again. That fix stops
 * new gaps; it cannot close old ones, because the portal is only ever asked for
 * rows newer than the cursor.
 *
 * So the worker winds the cursor back once per start and lets the ordinary
 * incremental pass repair what it finds. Every write is the same idempotent
 * upsert, so re-reading a row that is already correct costs a write and changes
 * nothing.
 */
export function historyBackfillCursor(
  cursor: Date | undefined,
  now: Date,
  days: number,
  /**
   * How long the cursor must have stood still for this to be treated as a
   * RECOVERY rather than a RESTART. `HISTORY_IDLE_MS` by default.
   */
  minIdleMs = HISTORY_IDLE_MS,
): Date | null {
  // Switched off.
  if (!Number.isFinite(days) || days <= 0) return null

  /*
    A MISSING CURSOR IS NOT AN OLD ONE.

    With none stored, the incremental run asks the portal for everything — so
    writing a cursor here would TRUNCATE the first sync of a cold database to
    the backfill window and call it complete.
  */
  if (cursor === undefined) return null

  /*
    A REDEPLOY IS NOT AN OUTAGE, and it should not cost the portal 76 000 rows.

    This ran on every start, and a day of deploys is a day of 45-day
    stage-history re-reads: on 2026-09-14 five deploys inside two hours each
    fired one, alongside the reference pass tick 0 always makes. That
    afternoon Bitrix24 answered every REST call with «OVERLOAD_LIMIT — REST API
    is blocked due to overload» and the dashboard stopped being fed for a
    quarter of an hour. Our share of that load is not proven and is certainly
    not the whole of it — the portal carries the client's own bots and a
    МойСклад sync — but re-reading six weeks of history because somebody
    shipped a CSS change is not work anybody asked for.

    So the repair now runs when it is actually a repair: a cursor that has not
    moved for half an hour means the worker was DOWN, which is the case a gap
    can have opened in. A cursor from a minute ago means the process was
    restarted under a healthy sync, and the 35-minute `SKIP_LOOKBACK_MS`
    rewind already covers anything a skipped run left behind in that gap.
  */
  if (now.getTime() - cursor.getTime() < minIdleMs) return null

  const from = new Date(now.getTime() - days * 86_400_000)

  /*
    ONLY EVER BACKWARDS. A cursor already outside the window — after an outage,
    or a worker that has been down for a week — is left where it is. Moving it
    forward would skip everything in between, which is the one thing a repair
    must not do.
  */
  return cursor > from ? from : null
}
