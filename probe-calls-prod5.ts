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
    console.log(`\n=== ${label} — ${r.rows.length} rows in ${Date.now() - t}ms ===`)
    console.table(r.rows.slice(0, 20))
  }

  await q('which departments do callers sit in (3 days)', `
    SELECT dp."name" AS department, count(DISTINCT r."employeeId")::int AS callers,
           count(*)::int AS calls,
           (dp."name" ~* '\\(ROP\\)') AS is_rop
      FROM "call_record" r
      LEFT JOIN "employee" e ON e."id" = r."employeeId"
      LEFT JOIN "department" dp ON dp."id" = e."departmentId"
     WHERE r."startedAt" >= timestamp '2026-09-12 19:00'
     GROUP BY 1, 4 ORDER BY calls DESC LIMIT 20`)

  await q('callers via DepartmentMember memberships (3 days)', `
    SELECT dp."name" AS department, count(DISTINCT r."employeeId")::int AS callers,
           count(*)::int AS calls,
           (dp."name" ~* '\\(ROP\\)') AS is_rop
      FROM "call_record" r
      JOIN "department_member" m ON m."employeeId" = r."employeeId"
      JOIN "department" dp ON dp."id" = m."departmentId"
     WHERE r."startedAt" >= timestamp '2026-09-12 19:00'
     GROUP BY 1, 4 ORDER BY calls DESC LIMIT 20`)

  await q('do callers also appear as deal operators (a team basis that works)', `
    SELECT count(DISTINCT r."employeeId")::int AS callers,
           count(DISTINCT d."operatorEmployeeId")::int AS callers_who_sold,
           count(DISTINCT d."operatorTeamSource")::int AS teams_on_deals
      FROM "call_record" r
      LEFT JOIN "deal" d ON d."operatorEmployeeId" = r."employeeId"
     WHERE r."startedAt" >= timestamp '2026-09-12 19:00'`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
