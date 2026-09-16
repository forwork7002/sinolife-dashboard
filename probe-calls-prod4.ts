import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

const ARM = (from: string, to: string) => `
WITH scoped AS (
  SELECT r."id", r."employeeId", r."customerId", r."durationSec", r.connected,
         (r."startedAt" AT TIME ZONE 'Asia/Tashkent')::date AS d
    FROM "call_record" r
   WHERE r."startedAt" >= timestamp '${from}' AND r."startedAt" < timestamp '${to}'
),
joined AS (
  SELECT s.*, e."fullName" AS employee,
         CASE WHEN dp."name" ~* '\\(ROP\\)'
              THEN btrim(regexp_replace(dp."name", '\\(ROP\\)', '', 'i'))
              END AS rop
    FROM scoped s
    LEFT JOIN "employee" e ON e."id" = s."employeeId"
    LEFT JOIN "department" dp ON dp."id" = e."departmentId"
)
SELECT grouping(employee) AS g_emp, grouping(rop) AS g_rop, grouping(d) AS g_day,
       employee, rop, d,
       count(*)::int AS calls,
       count(*) FILTER (WHERE connected)::int AS connected,
       sum("durationSec") FILTER (WHERE connected)::bigint AS talk_sec,
       count(DISTINCT "customerId")::int AS customers
  FROM joined
 GROUP BY GROUPING SETS ((), (employee), (rop), (d))
 ORDER BY 1, 2, 3, calls DESC`

async function main() {
  const c = new Client({
    connectionString: RAW.replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { ca, rejectUnauthorized: true },
  })
  await c.connect()
  const time = async (label: string, sql: string) => {
    const t = Date.now()
    const r = await c.query(sql)
    console.log(`\n=== ${label} — ${r.rows.length} rows in ${Date.now() - t}ms ===`)
    console.table(r.rows.slice(0, 12))
  }

  await time('grouping sets, 3 days (2026-09-13 →)', ARM('2026-09-12 19:00', '2026-09-16 19:00'))
  await time('grouping sets, 30 days', ARM('2026-08-17 19:00', '2026-09-16 19:00'))

  await time('customer call bands, 3 days', `
    WITH per AS (
      SELECT "customerId", count(*)::int AS calls,
             sum("durationSec") FILTER (WHERE connected)::bigint AS talk_sec
        FROM "call_record"
       WHERE "startedAt" >= timestamp '2026-09-12 19:00' AND "customerId" IS NOT NULL
       GROUP BY 1)
    SELECT CASE WHEN calls = 1 THEN '1'
                WHEN calls <= 3 THEN '2-3'
                WHEN calls <= 5 THEN '4-5'
                ELSE '6+' END AS band,
           count(*)::int AS customers,
           round(avg(talk_sec))::int AS avg_talk_sec,
           round(sum(talk_sec)/3600.0, 1) AS hours
      FROM per GROUP BY 1 ORDER BY 1`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
