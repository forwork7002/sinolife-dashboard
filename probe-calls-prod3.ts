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

  await q('import time vs call time, by week', `
    SELECT date_trunc('week', "startedAt" AT TIME ZONE 'Asia/Tashkent')::date AS wk,
           count(*)::int AS calls,
           min("createdAt")::date AS imported_first,
           max("createdAt")::date AS imported_last,
           count(*) FILTER (WHERE "recordUrl" IS NOT NULL)::int AS with_record,
           count(DISTINCT "employeeId")::int AS employees
      FROM "call_record" GROUP BY 1 ORDER BY 1`)

  await q('failed code mix by week', `
    SELECT date_trunc('week', "startedAt" AT TIME ZONE 'Asia/Tashkent')::date AS wk,
           count(*) FILTER (WHERE "failedCode" = '304')::int AS c304,
           count(*) FILTER (WHERE "failedCode" = '503')::int AS c503,
           count(*) FILTER (WHERE "failedCode" IS NULL)::int AS ok200,
           round(100.0 * count(*) FILTER (WHERE "failedCode" IS NULL) / count(*), 1) AS ok_pct
      FROM "call_record" GROUP BY 1 ORDER BY 1`)

  await q('per-day inside the suspicious weeks', `
    SELECT ("startedAt" AT TIME ZONE 'Asia/Tashkent')::date AS d,
           count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           round(avg("durationSec") FILTER (WHERE connected))::int AS avg_sec,
           max("durationSec")::int AS max_sec,
           min("createdAt")::date AS imported
      FROM "call_record"
     WHERE ("startedAt" AT TIME ZONE 'Asia/Tashkent')::date
           BETWEEN date '2026-08-28' AND date '2026-09-15'
     GROUP BY 1 ORDER BY 1`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
