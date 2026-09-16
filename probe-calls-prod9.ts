import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

/**
 * Where does the truncation really end — on TASHKENT days this time?
 *
 * probe-calls-prod3.ts bucketed with the one-step AT TIME ZONE form, which
 * reads the naive UTC column as Tashkent local; its day labels were shifted.
 * This uses the two-step form the repository uses, and adds the hour of
 * import so the per-minute → half-hourly switch can be seen directly.
 */
async function main() {
  const c = new Client({
    connectionString: RAW.replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca, rejectUnauthorized: true },
  })
  await c.connect()
  const q = async (label: string, sql: string) => {
    const t = Date.now()
    const r = await c.query(sql)
    console.log(`\n=== ${label} — ${Date.now() - t}ms ===`)
    console.table(r.rows)
  }

  await q('per Tashkent day, 2026-09-08 → today', `
    SELECT ("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date::text AS tashkent_day,
           to_char(("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date, 'Dy') AS dow,
           count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           round(100.0 * count(*) FILTER (WHERE connected) / count(*), 1) AS connect_pct,
           round(avg("durationSec") FILTER (WHERE connected))::int AS avg_sec,
           max("durationSec")::int AS max_sec,
           round(sum("durationSec") FILTER (WHERE connected) / 3600.0, 1) AS hours
      FROM "call_record"
     WHERE "startedAt" >= timestamp '2026-09-07 19:00'
     GROUP BY 1, 2 ORDER BY 1`)

  await q('the switch, by Tashkent hour: max duration and import lag', `
    SELECT to_char("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'MM-DD HH24') AS tashkent_hour,
           count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           max("durationSec")::int AS max_sec,
           round(avg(EXTRACT(EPOCH FROM ("createdAt" - "startedAt")) / 60))::int AS avg_import_lag_min
      FROM "call_record"
     WHERE "startedAt" >= timestamp '2026-09-13 00:00'
       AND "startedAt" <  timestamp '2026-09-14 12:00'
     GROUP BY 1 ORDER BY 1`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
