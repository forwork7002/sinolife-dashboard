/*
  READ-ONLY. How much of «yangi mijoz» is really an old customer under a
  second contact record — measured three ways, because the answer depends
  entirely on how two phone numbers are compared.

  `customer.phone` is PHONE[0] verbatim from Bitrix24 and nothing in this
  codebase normalises it, so raw equality is the weakest possible test.
*/
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const DIR = '/tmp/claude-1000/-home-smack-Work/bcc40603-9066-44fa-b2cf-0a0d4f05f55d/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

/* `pg` v9 reads sslmode=require as verify-full and lets the connection string
   override the ssl object, so the CA is ignored unless the parameter goes. */
const connectionString = RAW.replace(/[?&]sslmode=[^&]*/, '')

/** Digits only, last nine — the UZ national significant number. */
const KEY = `NULLIF(right(regexp_replace($COL$, '[^0-9]', '', 'g'), 9), '')`

async function main() {
  const c = new Client({ connectionString, ssl: { ca, rejectUnauthorized: true } })
  await c.connect()

  const q = async (label: string, sql: string) => {
    const t = Date.now()
    const r = await c.query(sql)
    console.log(`\n### ${label}  (${Date.now() - t} ms)`)
    console.table(r.rows)
  }

  await q('1. buyers and how many carry a phone at all', `
    WITH buyers AS (
      SELECT DISTINCT d."customerId" AS id
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    )
    SELECT
      count(*)                                                        AS buyers,
      count(*) FILTER (WHERE cu."phone" IS NOT NULL)                  AS with_phone_col,
      count(*) FILTER (WHERE coalesce(array_length(cu."phones",1),0)>0) AS with_phones_array,
      count(*) FILTER (WHERE cu."phone" IS NULL
                         AND coalesce(array_length(cu."phones",1),0)=0) AS no_phone_at_all
    FROM buyers b JOIN "customer" cu ON cu."id" = b.id
  `)

  await q('2. what the stored strings actually look like', `
    WITH buyers AS (
      SELECT DISTINCT d."customerId" AS id FROM "deal" d
      WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    ), p AS (
      SELECT cu."phone" AS raw FROM buyers b JOIN "customer" cu ON cu."id"=b.id
      WHERE cu."phone" IS NOT NULL
    )
    SELECT
      length(regexp_replace(raw,'[^0-9]','','g')) AS digits,
      count(*)                                     AS rows,
      count(*) FILTER (WHERE raw ~ '^\\+')         AS starts_plus,
      count(*) FILTER (WHERE raw ~ '[ ()-]')       AS has_separator,
      min(raw)                                     AS example
    FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12
  `)

  await q('3a. duplicate BUYER groups — raw phone equality (the spec method)', `
    WITH buyers AS (
      SELECT DISTINCT d."customerId" AS id FROM "deal" d
      WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    ), k AS (
      SELECT cu."id", cu."phone" AS key FROM buyers b JOIN "customer" cu ON cu."id"=b.id
      WHERE cu."phone" IS NOT NULL
    )
    SELECT count(*) AS dup_groups, sum(n) AS rows_in_groups, sum(n-1) AS collapsible
    FROM (SELECT key, count(*) AS n FROM k GROUP BY key HAVING count(*)>1) g
  `)

  await q('3b. duplicate BUYER groups — normalised phone column', `
    WITH buyers AS (
      SELECT DISTINCT d."customerId" AS id FROM "deal" d
      WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    ), k AS (
      SELECT cu."id", ${KEY.replace('$COL$', 'cu."phone"')} AS key
      FROM buyers b JOIN "customer" cu ON cu."id"=b.id
    )
    SELECT count(*) AS dup_groups, sum(n) AS rows_in_groups, sum(n-1) AS collapsible
    FROM (SELECT key, count(*) AS n FROM k WHERE key IS NOT NULL GROUP BY key HAVING count(*)>1) g
  `)

  await q('3c. duplicate BUYER groups — ANY normalised number in the phones array', `
    WITH buyers AS (
      SELECT DISTINCT d."customerId" AS id FROM "deal" d
      WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
    ), k AS (
      SELECT DISTINCT cu."id", ${KEY.replace('$COL$', 'n')} AS key
      FROM buyers b
      JOIN "customer" cu ON cu."id"=b.id
      CROSS JOIN LATERAL unnest(coalesce(nullif(cu."phones",'{}'), array[cu."phone"])) AS n
    )
    SELECT count(*) AS dup_groups, sum(n) AS rows_in_groups, sum(n-1) AS collapsible
    FROM (SELECT key, count(*) AS n FROM k WHERE key IS NOT NULL GROUP BY key HAVING count(*)>1) g
  `)

  await q('4. what it costs the matrix — first WON purchase per identity vs per row', `
    WITH won AS (
      SELECT d."customerId" AS id, d."closedAt" AS at
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status"='WON'
        AND d."customerId" IS NOT NULL AND d."closedAt" IS NOT NULL
    ), ident AS (
      SELECT cu."id",
             coalesce(min(${KEY.replace('$COL$', 'n')}), 'row:'||cu."id") AS ident
      FROM "customer" cu
      LEFT JOIN LATERAL unnest(coalesce(nullif(cu."phones",'{}'), array[cu."phone"])) AS n ON true
      GROUP BY cu."id"
    )
    SELECT
      count(DISTINCT w.id)                        AS cohort_members_today,
      count(DISTINCT i.ident)                     AS cohort_members_by_identity,
      count(DISTINCT w.id) - count(DISTINCT i.ident) AS phantom_new_customers
    FROM won w JOIN ident i ON i."id" = w.id
  `)

  await c.end()
}

void main()
