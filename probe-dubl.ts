/*
  READ-ONLY. What «dublikat» actually means on this portal.

  The client asked to be rid of duplicates. Phone-duplicate contacts measured
  at 0.6% of buyers (probe-identity.ts), which is too small to be what they
  meant — and the База funnel turns out to carry a stage named «Дубль заказы»
  (C10:UC_085NVA) that NEITHER of the two stage partitions on this screen
  names. So the desk marks duplicates itself, on ORDERS, and nothing in the
  product reads that mark.
*/
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/bcc40603-9066-44fa-b2cf-0a0d4f05f55d/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

/* `pg` v9 reads sslmode=require as verify-full and lets the connection string
   override the ssl object, so the CA is ignored unless the parameter goes. */
const connectionString = RAW.replace(/[?&]sslmode=[^&]*/, '')

async function main() {
  const c = new Client({ connectionString, ssl: { ca, rejectUnauthorized: true } })
  await c.connect()

  const q = async (label: string, sql: string) => {
    const t = Date.now()
    const r = await c.query(sql)
    console.log(`\n### ${label}  (${Date.now() - t} ms)`)
    console.table(r.rows)
  }

  await q('A. every RETENTION stage as production actually holds it', `
    SELECT s."externalId" AS id, s."name",
           count(d."id")::int                                  AS deals,
           count(d."id") FILTER (WHERE d."status"='OPEN')::int AS open_deals,
           count(DISTINCT d."customerId")::int                 AS customers
    FROM "deal_stage" s
    JOIN "pipeline" p ON p."id" = s."pipelineId"
    LEFT JOIN "deal" d ON d."stageId" = s."id"
    WHERE p."role" = 'RETENTION'
    GROUP BY 1, 2, s."sortOrder" ORDER BY s."sortOrder"
  `)

  await q('B. «Дубль заказы» — who sits there, and are they buyers elsewhere', `
    WITH dub AS (
      SELECT DISTINCT d."customerId" AS id
      FROM "deal" d JOIN "deal_stage" s ON s."id" = d."stageId"
      WHERE s."externalId" = 'C10:UC_085NVA' AND d."customerId" IS NOT NULL
    )
    SELECT
      (SELECT count(*) FROM dub) AS customers_marked_duplicate,
      (SELECT count(*) FROM dub d2 WHERE EXISTS (
         SELECT 1 FROM "deal" x WHERE x."customerId" = d2.id AND x."countsAsRevenue"
       )) AS of_them_are_buyers,
      (SELECT count(*) FROM dub d3 WHERE EXISTS (
         SELECT 1 FROM "deal" x WHERE x."customerId" = d3.id
           AND x."countsAsRevenue" AND x."status" = 'WON'
       )) AS of_them_reached_won
  `)

  await q('C. does the RETENTION funnel leak into the revenue matrix', `
    SELECT p."name" AS pipeline, p."role",
           count(*) FILTER (WHERE d."countsAsRevenue")::int AS revenue_deals,
           count(*)::int                                    AS all_deals
    FROM "deal" d JOIN "pipeline" p ON p."id" = d."pipelineId"
    GROUP BY 1, 2 ORDER BY 3 DESC
  `)

  await q('D. duplicate ORDERS on the revenue side — same customer, day and amount', `
    WITH g AS (
      SELECT d."customerId" AS id,
             (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date AS day,
             d."amountMinor" AS amount,
             count(*) AS n
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
        AND d."createdAtSource" IS NOT NULL
      GROUP BY 1, 2, 3 HAVING count(*) > 1
    )
    SELECT count(*)::int          AS duplicate_groups,
           sum(n)::int            AS orders_in_groups,
           sum(n - 1)::int        AS extra_orders,
           count(DISTINCT id)::int AS customers_affected
    FROM g
  `)

  await c.end()
}

void main()
