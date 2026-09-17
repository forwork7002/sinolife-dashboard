import type { CallRowDto } from '@/lib/api'
import { formatDateShort } from '@/lib/format'

/**
 * The points `CallTimeChart` draws, kept apart from the chart so the page can
 * build them without pulling recharts into its first download.
 *
 * HOURS ARE GAP-FILLED, DAYS ARE NOT. Inside the span of hours that carry any
 * call, an hour nobody rang is a true zero on a working floor, and skipping it
 * would draw 13:00 beside 15:00 as if they were neighbours. Days are left as
 * the server sent them: a missing day is «nothing recorded», and the calls
 * arrive on a three-hourly sync, so a manufactured zero could be a day that has
 * simply not been imported yet.
 */

export interface CallTimePoint {
  readonly key: string
  readonly label: string
  readonly calls: number
  readonly connected: number
  readonly connectPercent: number | null
  readonly talkSec: number
  readonly medianSec: number | null
}

/** Rows keyed '0'…'23' → one point per hour from the first busy hour to the last. */
export function hourPoints(rows: readonly CallRowDto[]): CallTimePoint[] {
  if (rows.length === 0) return []
  const byHour = new Map(rows.map((row) => [Number(row.key), row]))
  const hours = [...byHour.keys()]
  const first = Math.min(...hours)
  const last = Math.max(...hours)

  const points: CallTimePoint[] = []
  for (let hour = first; hour <= last; hour += 1) {
    const row = byHour.get(hour)
    points.push({
      key: String(hour),
      label: `${String(hour).padStart(2, '0')}:00`,
      calls: row?.calls ?? 0,
      connected: row?.connected ?? 0,
      connectPercent: row?.connectPercent ?? null,
      talkSec: row?.talkSec ?? 0,
      medianSec: row?.medianSec ?? null,
    })
  }
  return points
}

/** Rows keyed 'YYYY-MM-DD' → one point per day, as sent. */
export function dayPoints(rows: readonly CallRowDto[]): CallTimePoint[] {
  return rows.map((row) => ({
    key: row.key,
    label: formatDateShort(row.key),
    calls: row.calls,
    connected: row.connected,
    connectPercent: row.connectPercent,
    talkSec: row.talkSec,
    medianSec: row.medianSec,
  }))
}
