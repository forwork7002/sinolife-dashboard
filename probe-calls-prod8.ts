import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

/**
 * «база не база мижозларга call duration» — calls split by whether the called
 * customer is a База customer. Above the data floor only. Pure aggregates.
 *
 * Two definitions, because they can differ:
 *   NOW    — the customer has any RETENTION deal today
 *   BEFORE — the customer had a RETENTION deal created before the call started
 *            (a new lead called today who buys next week is not База yet)
 */
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
    console.log(`\n=== ${label} — ${Date.now() - t}ms ===`)
    console.table(r.rows)
  }

  await q('NOW: calls by База membership today', `
    WITH based AS (
      SELECT DISTINCT d."customerId" AS cid FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
       WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
    )
    SELECT
      CASE WHEN r."customerId" IS NULL THEN 'unlinked'
           WHEN b.cid IS NOT NULL THEN 'baza'
           ELSE 'not_baza' END AS side,
      count(*)::int AS calls,
      count(*) FILTER (WHERE r.connected)::int AS connected,
      round(100.0 * count(*) FILTER (WHERE r.connected) / count(*), 1) AS connect_pct,
      round(sum(r."durationSec") FILTER (WHERE r.connected) / 3600.0, 1) AS talk_hours,
      round(avg(r."durationSec") FILTER (WHERE r.connected))::int AS mean_sec,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY r."durationSec") FILTER (WHERE r.connected) AS median_sec,
      count(DISTINCT r."customerId")::int AS customers
    FROM "call_record" r
    LEFT JOIN based b ON b.cid = r."customerId"
    WHERE r."startedAt" >= ${FLOOR}
    GROUP BY 1 ORDER BY 1`)

  await q('BEFORE: calls by a База deal created before the call', `
    WITH first_baza AS (
      SELECT d."customerId" AS cid, min(d."createdAtSource") AS first_at
        FROM "deal" d JOIN "pipeline" p ON p."id" = d."pipelineId"
       WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
       GROUP BY 1
    )
    SELECT
      CASE WHEN r."customerId" IS NULL THEN 'unlinked'
           WHEN f.first_at IS NOT NULL AND f.first_at <= r."startedAt" THEN 'baza'
           ELSE 'not_baza' END AS side,
      count(*)::int AS calls,
      count(*) FILTER (WHERE r.connected)::int AS connected,
      round(100.0 * count(*) FILTER (WHERE r.connected) / count(*), 1) AS connect_pct,
      round(sum(r."durationSec") FILTER (WHERE r.connected) / 3600.0, 1) AS talk_hours,
      round(avg(r."durationSec") FILTER (WHERE r.connected))::int AS mean_sec,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY r."durationSec") FILTER (WHERE r.connected) AS median_sec,
      count(DISTINCT r."customerId")::int AS customers
    FROM "call_record" r
    LEFT JOIN first_baza f ON f.cid = r."customerId"
    WHERE r."startedAt" >= ${FLOOR}
    GROUP BY 1 ORDER BY 1`)

  await q('which departments call База vs non-База customers (BEFORE basis)', `
    WITH first_baza AS (
      SELECT d."customerId" AS cid, min(d."createdAtSource") AS first_at
        FROM "deal" d JOIN "pipeline" p ON p."id" = d."pipelineId"
       WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
       GROUP BY 1
    )
    SELECT dp."name" AS department,
      count(*) FILTER (WHERE f.first_at IS NOT NULL AND f.first_at <= r."startedAt")::int AS baza_calls,
      count(*) FILTER (WHERE r."customerId" IS NOT NULL AND (f.first_at IS NULL OR f.first_at > r."startedAt"))::int AS not_baza_calls
    FROM "call_record" r
    LEFT JOIN first_baza f ON f.cid = r."customerId"
    LEFT JOIN "employee" e ON e."id" = r."employeeId"
    LEFT JOIN "department" dp ON dp."id" = e."departmentId"
    WHERE r."startedAt" >= ${FLOOR}
    GROUP BY 1 ORDER BY (count(*)) DESC LIMIT 16`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
