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

  const from = new Date(now.getTime() - days * 86_400_000)

  /*
    ONLY EVER BACKWARDS. A cursor already outside the window — after an outage,
    or a worker that has been down for a week — is left where it is. Moving it
    forward would skip everything in between, which is the one thing a repair
    must not do.
  */
  return cursor > from ? from : null
}
