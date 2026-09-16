import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

async function main() {
  const c = new Client({
    connectionString: RAW.replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca, rejectUnauthorized: true },
  })
  await c.connect()
  const q = async (label: string, sql: string) => {
    const t = Date.now()
    const r = await c.query(sql)
    console.log(`\n=== ${label} (${Date.now() - t}ms) ===`)
    console.table(r.rows)
  }

  await q('duration profile by week', `
    SELECT date_trunc('week', "startedAt" AT TIME ZONE 'Asia/Tashkent')::date AS wk,
           count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           count(*) FILTER (WHERE connected AND "durationSec" = 0)::int AS connected_zero,
           round(avg("durationSec") FILTER (WHERE connected))::int AS avg_sec,
           max("durationSec")::int AS max_sec,
           round(sum("durationSec") FILTER (WHERE connected)/3600.0)::int AS hours
      FROM "call_record" GROUP BY 1 ORDER BY 1`)

  await q('failedCode mix', `
    SELECT "failedCode", count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           round(avg("durationSec"))::int AS avg_sec
      FROM "call_record" GROUP BY 1 ORDER BY calls DESC LIMIT 12`)

  await q('duration buckets, connected only', `
    SELECT CASE
             WHEN "durationSec" = 0 THEN '0'
             WHEN "durationSec" < 30 THEN '1-29'
             WHEN "durationSec" < 60 THEN '30-59'
             WHEN "durationSec" < 180 THEN '60-179'
             WHEN "durationSec" < 600 THEN '180-599'
             ELSE '600+' END AS band,
           count(*)::int AS calls
      FROM "call_record" WHERE connected GROUP BY 1 ORDER BY 1`)

  await q('top employees by connected talk time', `
    SELECT e."fullName" AS employee, count(*)::int AS calls,
           count(*) FILTER (WHERE r.connected)::int AS connected,
           round(sum(r."durationSec") FILTER (WHERE r.connected)/3600.0, 1) AS hours
      FROM "call_record" r JOIN "employee" e ON e."id" = r."employeeId"
     WHERE r."startedAt" >= now() - interval '30 days'
     GROUP BY 1 ORDER BY hours DESC NULLS LAST LIMIT 10`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
