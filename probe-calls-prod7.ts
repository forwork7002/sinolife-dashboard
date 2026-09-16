import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

/**
 * Is «база / база emas» an informative split of our buyers, or a constant?
 * Pure counts — no customer column is selected.
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

  await q('buyers split by any База deal', `
    WITH cust AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
       WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    ),
    based AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
       WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
    )
    SELECT
      (SELECT count(*) FROM cust)::int AS buyers,
      (SELECT count(*) FROM based)::int AS in_baza_any_customer,
      (SELECT count(*) FROM cust c WHERE EXISTS (SELECT 1 FROM based b WHERE b.cid = c.cid))::int AS buyers_in_baza,
      (SELECT count(*) FROM cust c WHERE NOT EXISTS (SELECT 1 FROM based b WHERE b.cid = c.cid))::int AS buyers_not_in_baza,
      (SELECT count(*) FROM based b WHERE NOT EXISTS (SELECT 1 FROM cust c WHERE c.cid = b.cid))::int AS baza_not_buyers`)

  await q('buyers split by an OPEN База deal (being worked now)', `
    WITH cust AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
       WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    ),
    worked AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
       WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL AND d."status" = 'OPEN'
    )
    SELECT
      (SELECT count(*) FROM cust c WHERE EXISTS (SELECT 1 FROM worked w WHERE w.cid = c.cid))::int AS buyers_open_in_baza,
      (SELECT count(*) FROM cust c WHERE NOT EXISTS (SELECT 1 FROM worked w WHERE w.cid = c.cid))::int AS buyers_not_open_in_baza`)

  await q('buyers who bought via Доставка, by whether they ever reached База', `
    WITH won AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
       WHERE d."countsAsRevenue" AND d."status" = 'WON' AND d."customerId" IS NOT NULL
    ),
    based AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
       WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
    )
    SELECT
      (SELECT count(*) FROM won)::int AS won_buyers,
      (SELECT count(*) FROM won w WHERE EXISTS (SELECT 1 FROM based b WHERE b.cid = w.cid))::int AS won_in_baza,
      (SELECT count(*) FROM won w WHERE NOT EXISTS (SELECT 1 FROM based b WHERE b.cid = w.cid))::int AS won_not_in_baza`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
