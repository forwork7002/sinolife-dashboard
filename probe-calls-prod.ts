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

  await q('call_record coverage', `
    SELECT count(*)::int AS calls,
           min("startedAt")::date AS first_call,
           max("startedAt")::date AS last_call,
           count(*) FILTER (WHERE "employeeId" IS NOT NULL)::int AS with_emp,
           count(*) FILTER (WHERE "customerId" IS NOT NULL)::int AS with_customer,
           count(*) FILTER (WHERE "dealId" IS NOT NULL)::int AS with_deal,
           count(*) FILTER (WHERE connected)::int AS connected,
           count(DISTINCT "employeeId")::int AS employees,
           round(sum("durationSec")/3600.0)::int AS total_hours
      FROM "call_record"`)

  await q('by direction', `
    SELECT "direction", count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           round(avg("durationSec") FILTER (WHERE connected))::int AS avg_sec_connected,
           round(sum("durationSec")/3600.0)::int AS hours
      FROM "call_record" GROUP BY "direction" ORDER BY calls DESC`)

  await q('last 14 days by day', `
    SELECT ("startedAt" AT TIME ZONE 'Asia/Tashkent')::date AS d,
           count(*)::int AS calls,
           count(*) FILTER (WHERE connected)::int AS connected,
           round(sum("durationSec")/3600.0, 1) AS hours
      FROM "call_record"
     WHERE "startedAt" >= now() - interval '14 days'
     GROUP BY 1 ORDER BY 1 DESC`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
