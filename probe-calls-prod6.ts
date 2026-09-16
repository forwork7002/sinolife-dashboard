import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

/** Everything below the 2026-09-13 floor is excluded — the truncated window. */
const FLOOR = "timestamp '2026-09-12 19:00'"

async function main() {
  const c = new Client({
    connectionString: RAW.replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca, rejectUnauthorized: true },
  })
  await c.connect()
  const q = async (label: string, sql: string) => {
    const t = Date.now()
    const r = await c.query(sql)
    console.log(`\n=== ${label} — ${r.rows.length} rows in ${Date.now() - t}ms ===`)
    console.table(r.rows.slice(0, 20))
  }

  await q('duration percentiles, connected only, since floor', `
    SELECT count(*)::int AS connected_calls,
           round(avg("durationSec"))::int AS avg_sec,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY "durationSec")::int AS p50,
           percentile_disc(0.75) WITHIN GROUP (ORDER BY "durationSec")::int AS p75,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY "durationSec")::int AS p90,
           percentile_disc(0.99) WITHIN GROUP (ORDER BY "durationSec")::int AS p99,
           max("durationSec")::int AS max_sec,
           round(sum("durationSec")/3600.0, 1) AS talk_hours
      FROM "call_record" WHERE connected AND "startedAt" >= ${FLOOR}`)

  await q('duration bands, connected only, since floor', `
    SELECT CASE
             WHEN "durationSec" < 10  THEN '1 · 0-9 s'
             WHEN "durationSec" < 30  THEN '2 · 10-29 s'
             WHEN "durationSec" < 60  THEN '3 · 30-59 s'
             WHEN "durationSec" < 180 THEN '4 · 1-3 daq'
             WHEN "durationSec" < 600 THEN '5 · 3-10 daq'
             ELSE '6 · 10+ daq' END AS band,
           count(*)::int AS calls,
           round(sum("durationSec")/3600.0, 1) AS hours,
           round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS share_pct
      FROM "call_record" WHERE connected AND "startedAt" >= ${FLOOR}
     GROUP BY 1 ORDER BY 1`)

  await q('per-operator percentiles are affordable in the same pass', `
    WITH scoped AS (
      SELECT r."employeeId", r."durationSec", r.connected
        FROM "call_record" r WHERE r."startedAt" >= ${FLOOR})
    SELECT e."fullName" AS employee,
           count(*)::int AS calls,
           count(*) FILTER (WHERE s.connected)::int AS connected,
           round(sum(s."durationSec") FILTER (WHERE s.connected)/3600.0, 1) AS hours,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY s."durationSec")
             FILTER (WHERE s.connected)::int AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY s."durationSec")
             FILTER (WHERE s.connected)::int AS p90
      FROM scoped s JOIN "employee" e ON e."id" = s."employeeId"
     GROUP BY 1 ORDER BY hours DESC NULLS LAST LIMIT 8`)

  await q('zero-duration connected calls, since floor', `
    SELECT count(*) FILTER (WHERE connected AND "durationSec" = 0)::int AS connected_zero,
           count(*) FILTER (WHERE connected)::int AS connected,
           count(*) FILTER (WHERE NOT connected AND "durationSec" > 0)::int AS failed_with_time
      FROM "call_record" WHERE "startedAt" >= ${FLOOR}`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
