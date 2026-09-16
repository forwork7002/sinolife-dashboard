import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const url = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='))!.slice('DATABASE_URL='.length).trim()

async function main() {
  const c = new Client({ connectionString: url })
  await c.connect()
  const r = await c.query(`select count(*)::int calls,
      count(distinct "employeeId")::int emps,
      min("startedAt")::date as first, max("startedAt")::date as last,
      coalesce(sum("durationSec"),0)::int total_sec,
      count(*) filter (where connected)::int connected,
      count(*) filter (where "customerId" is not null)::int with_customer,
      count(*) filter (where "dealId" is not null)::int with_deal,
      count(*) filter (where "employeeId" is not null)::int with_emp
    from call_record`)
  console.table(r.rows)
  await c.end()
}
main()
