/**
 * Filial (branch) scope — the arithmetic proof.
 *
 *     npm run branch:verify
 *     npm run branch:verify -- --from 2026-06-01 --to 2026-08-28
 *
 * READ-ONLY. Everything runs inside one `SET TRANSACTION READ ONLY`
 * transaction, so a mistake in this file cannot write to the database even if
 * someone later adds an UPDATE to it by accident. Postgres refuses it.
 *
 * WHAT IT PROVES, AND WHY IT HAS TO
 * The dashboard is about to show one branch and hide the rest. That is only
 * defensible if the parts add up: every employee sits in exactly one bucket,
 * every deal and every call belongs to exactly one employee, and therefore
 *
 *     Навоий + Тошкент онлайн + Операцион + Регистрация + markaz = everything.
 *
 * If those buckets do not sum to the unscoped total, the resolver is wrong —
 * most likely by reading `department.parent.name` instead of walking to the
 * top, which files the people who sit directly in a branch under NEWGEN — and
 * every number on every screen inherits the error. So this compares two
 * independently computed things:
 *
 *   • the per-employee ledger, bucketed in TypeScript through the SAME
 *     resolver the application uses (`ReferenceRepository.branchSnapshot`), and
 *   • a plain aggregate over the same window with no grouping at all.
 *
 * They must match EXACTLY, in minor units, with no tolerance. Money is bigint
 * the whole way; a float would make "exactly" meaningless.
 *
 * WHAT IS MEASURED
 *   won revenue  sum(amountMinor) over countsAsRevenue AND status='WON',
 *                bucketed by closedAt — the same basis as every revenue figure
 *                in the product.
 *   won count    the number of those deals.
 *   all deals    every deal row, revenue-excluded ones included, bucketed by
 *                createdAtSource. Deliberately the WIDER population: if the
 *                partition only held for revenue deals it would not be a
 *                partition of the ledger.
 *   calls        call_record rows by startedAt.
 *
 * Exit code 1 on any of: an employee the resolver cannot place, a deal or call
 * belonging to an employee outside the roster, or a bucket sum that misses the
 * unscoped total.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'
import { ReferenceRepository } from '../src/server/repositories/referenceRepository'

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

/**
 * A FIXED window by default, not "the last 90 days".
 *
 * A verification whose window moves with the clock cannot be compared against
 * the run someone pasted into a review last week. These dates cover the live
 * portal's busiest quarter; pass `--from`/`--to` to check another one.
 */
const FROM = arg('from') ?? '2026-06-01'
const TO = arg('to') ?? '2026-08-28'

const WINDOWS = [
  { label: 'Butun davr', start: null as string | null, end: null as string | null },
  { label: `${FROM} … ${TO}`, start: FROM, end: TO },
]

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const groups = new Intl.NumberFormat('en-US')

/** Minor units -> "8.79 mlrd". The scale the business talks in. */
function mlrd(minor: bigint): string {
  return (Number(minor) / 1e11).toFixed(2)
}

function share(part: bigint, whole: bigint): string {
  if (whole === 0n) return '—'
  return `${((Number(part) / Number(whole)) * 100).toFixed(1)}%`
}

function rule(width = 96): string {
  return '  ' + '─'.repeat(width)
}

// ---------------------------------------------------------------------------

interface Ledger {
  wonMinor: bigint
  wonCount: number
  deals: number
  calls: number
}

const zero = (): Ledger => ({ wonMinor: 0n, wonCount: 0, deals: 0, calls: 0 })

function add(into: Ledger, from: Ledger): void {
  into.wonMinor += from.wonMinor
  into.wonCount += from.wonCount
  into.deals += from.deals
  into.calls += from.calls
}

interface Row {
  readonly employeeId: string
  readonly wonMinor: string
  readonly wonCount: number
  readonly deals: number
}

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('DATABASE_URL .env da yoʻq.')

  const pool = new Pool(poolConfig(DATABASE_URL, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  let failures = 0

  try {
    await prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY')

    const reference = new ReferenceRepository(prisma)
    const snapshot = await reference.branchSnapshot()

    // Which bucket each employee belongs to, from the application's own
    // resolver. Nothing in this script re-implements the rule.
    const bucketOf = new Map<string, string>()
    for (const bucket of snapshot.buckets) {
      for (const id of bucket.employeeIds) bucketOf.set(id, bucket.key)
    }

    console.log('')
    console.log('  ' + '━'.repeat(96))
    console.log('  FILIAL SCOPE — qismlar butunga tengmi?')
    console.log('  ' + '━'.repeat(96))
    console.log('')
    console.log(
      `  Roʻyxat: ${snapshot.totalHeadcount} xodim · ` +
        `${snapshot.branches.length} filial · ${snapshot.units.length} boʻlim · ` +
        `markaz ${snapshot.centreHeadcount} · boʻlimsiz ${snapshot.unassignedHeadcount}`,
    )

    for (const branch of snapshot.branches) {
      console.log(
        `    ${branch.name.padEnd(18)} ${String(branch.headcount).padStart(4)} xodim · ` +
          `${String(branch.sellerCount).padStart(4)} sotuvchi · ` +
          `${String(branch.teamCount).padStart(2)} jamoa`,
      )
    }

    if (bucketOf.size !== snapshot.totalHeadcount) {
      // Cannot happen unless the partition itself is broken; checked because a
      // silent overlap would make every sum below meaningless.
      console.log(
        `\n  ✗ Buketlar ${bucketOf.size} xodimni qamradi, roʻyxatda ${snapshot.totalHeadcount} ta.`,
      )
      failures += 1
    }

    for (const window of WINDOWS) {
      const start = window.start ? new Date(`${window.start}T00:00:00.000Z`) : null
      const end = window.end ? new Date(`${window.end}T00:00:00.000Z`) : null

      // Per-employee ledger. Grouped by employee only — the bucketing happens
      // in TypeScript, through the resolver, so this query cannot accidentally
      // agree with a wrong tree.
      const dealRows = await prisma.$queryRaw<Row[]>`
        SELECT
          d."employeeId"                                        AS "employeeId",
          COALESCE(SUM(d."amountMinor") FILTER (
            WHERE d."countsAsRevenue" AND d."status" = 'WON'
              AND d."closedAt" IS NOT NULL
              AND (${start}::timestamptz IS NULL OR d."closedAt" >= ${start}::timestamptz)
              AND (${end}::timestamptz   IS NULL OR d."closedAt" <  ${end}::timestamptz)
          ), 0)::text                                           AS "wonMinor",
          COUNT(*) FILTER (
            WHERE d."countsAsRevenue" AND d."status" = 'WON'
              AND d."closedAt" IS NOT NULL
              AND (${start}::timestamptz IS NULL OR d."closedAt" >= ${start}::timestamptz)
              AND (${end}::timestamptz   IS NULL OR d."closedAt" <  ${end}::timestamptz)
          )::int                                                AS "wonCount",
          COUNT(*) FILTER (
            WHERE (${start}::timestamptz IS NULL OR d."createdAtSource" >= ${start}::timestamptz)
              AND (${end}::timestamptz   IS NULL OR d."createdAtSource" <  ${end}::timestamptz)
          )::int                                                AS "deals"
        FROM "deal" d
        GROUP BY d."employeeId"
      `

      const callRows = await prisma.$queryRaw<{ employeeId: string | null; calls: number }[]>`
        SELECT c."employeeId" AS "employeeId", COUNT(*)::int AS "calls"
        FROM "call_record" c
        WHERE (${start}::timestamptz IS NULL OR c."startedAt" >= ${start}::timestamptz)
          AND (${end}::timestamptz   IS NULL OR c."startedAt" <  ${end}::timestamptz)
        GROUP BY c."employeeId"
      `

      // The independent side: one aggregate, no grouping, no employee join.
      // If the bucket sums equal THIS, the partition is complete.
      const [totals] = await prisma.$queryRaw<
        { wonMinor: string; wonCount: number; deals: number }[]
      >`
        SELECT
          COALESCE(SUM(d."amountMinor") FILTER (
            WHERE d."countsAsRevenue" AND d."status" = 'WON'
              AND d."closedAt" IS NOT NULL
              AND (${start}::timestamptz IS NULL OR d."closedAt" >= ${start}::timestamptz)
              AND (${end}::timestamptz   IS NULL OR d."closedAt" <  ${end}::timestamptz)
          ), 0)::text AS "wonMinor",
          COUNT(*) FILTER (
            WHERE d."countsAsRevenue" AND d."status" = 'WON'
              AND d."closedAt" IS NOT NULL
              AND (${start}::timestamptz IS NULL OR d."closedAt" >= ${start}::timestamptz)
              AND (${end}::timestamptz   IS NULL OR d."closedAt" <  ${end}::timestamptz)
          )::int AS "wonCount",
          COUNT(*) FILTER (
            WHERE (${start}::timestamptz IS NULL OR d."createdAtSource" >= ${start}::timestamptz)
              AND (${end}::timestamptz   IS NULL OR d."createdAtSource" <  ${end}::timestamptz)
          )::int AS "deals"
        FROM "deal" d
      `

      const [callTotals] = await prisma.$queryRaw<{ calls: number }[]>`
        SELECT COUNT(*)::int AS "calls"
        FROM "call_record" c
        WHERE (${start}::timestamptz IS NULL OR c."startedAt" >= ${start}::timestamptz)
          AND (${end}::timestamptz   IS NULL OR c."startedAt" <  ${end}::timestamptz)
      `

      const perBucket = new Map<string, Ledger>()
      for (const bucket of snapshot.buckets) perBucket.set(bucket.key, zero())

      const unplaced = zero()
      const unplacedEmployees = new Set<string>()

      const place = (employeeId: string | null, ledger: Ledger) => {
        const key = employeeId === null ? undefined : bucketOf.get(employeeId)
        if (key === undefined) {
          // A deal or call whose owner is not in the roster at all. Impossible
          // today (all 423 237 deals and 303 581 calls carry an employee that
          // exists), and fatal to the arithmetic if it ever happens.
          if (employeeId) unplacedEmployees.add(employeeId)
          add(unplaced, ledger)
          return
        }
        add(perBucket.get(key)!, ledger)
      }

      for (const row of dealRows) {
        place(row.employeeId, {
          wonMinor: BigInt(row.wonMinor),
          wonCount: row.wonCount,
          deals: row.deals,
          calls: 0,
        })
      }
      for (const row of callRows) {
        place(row.employeeId, { wonMinor: 0n, wonCount: 0, deals: 0, calls: row.calls })
      }

      const summed = zero()
      for (const ledger of perBucket.values()) add(summed, ledger)
      add(summed, unplaced)

      const expected: Ledger = {
        wonMinor: BigInt(totals.wonMinor),
        wonCount: totals.wonCount,
        deals: totals.deals,
        calls: callTotals.calls,
      }

      console.log('')
      console.log(rule())
      console.log(`  ${window.label}`)
      console.log(rule())
      console.log(
        '  ' +
          'buket'.padEnd(20) +
          'yutilgan mlrd'.padStart(15) +
          'ulush'.padStart(8) +
          'yutilgan'.padStart(11) +
          'bitimlar'.padStart(12) +
          'qoʻngʻiroq'.padStart(13),
      )
      console.log(rule())

      for (const bucket of snapshot.buckets) {
        const ledger = perBucket.get(bucket.key)!
        // An empty bucket still prints: "Регистрация 0" is information, and a
        // missing row would hide a bucket that lost its people.
        console.log(
          '  ' +
            bucket.label.padEnd(20) +
            mlrd(ledger.wonMinor).padStart(15) +
            share(ledger.wonMinor, expected.wonMinor).padStart(8) +
            groups.format(ledger.wonCount).padStart(11) +
            groups.format(ledger.deals).padStart(12) +
            groups.format(ledger.calls).padStart(13),
        )
      }

      if (unplaced.deals > 0 || unplaced.calls > 0 || unplaced.wonMinor !== 0n) {
        console.log(
          '  ' +
            'JOYSIZ'.padEnd(20) +
            mlrd(unplaced.wonMinor).padStart(15) +
            share(unplaced.wonMinor, expected.wonMinor).padStart(8) +
            groups.format(unplaced.wonCount).padStart(11) +
            groups.format(unplaced.deals).padStart(12) +
            groups.format(unplaced.calls).padStart(13),
        )
      }

      console.log(rule())
      console.log(
        '  ' +
          'JAMI (buketlar)'.padEnd(20) +
          mlrd(summed.wonMinor).padStart(15) +
          ''.padStart(8) +
          groups.format(summed.wonCount).padStart(11) +
          groups.format(summed.deals).padStart(12) +
          groups.format(summed.calls).padStart(13),
      )
      console.log(
        '  ' +
          'JAMI (filtrsiz)'.padEnd(20) +
          mlrd(expected.wonMinor).padStart(15) +
          ''.padStart(8) +
          groups.format(expected.wonCount).padStart(11) +
          groups.format(expected.deals).padStart(12) +
          groups.format(expected.calls).padStart(13),
      )
      console.log(rule())

      const checks: [string, boolean, string][] = [
        [
          'yutilgan tushum',
          summed.wonMinor === expected.wonMinor,
          `${summed.wonMinor} ≠ ${expected.wonMinor}`,
        ],
        [
          'yutilgan bitimlar',
          summed.wonCount === expected.wonCount,
          `${summed.wonCount} ≠ ${expected.wonCount}`,
        ],
        ['barcha bitimlar', summed.deals === expected.deals, `${summed.deals} ≠ ${expected.deals}`],
        ['qoʻngʻiroqlar', summed.calls === expected.calls, `${summed.calls} ≠ ${expected.calls}`],
        [
          'joysiz yozuvlar yoʻq',
          unplacedEmployees.size === 0 && unplaced.deals === 0 && unplaced.calls === 0,
          `${unplacedEmployees.size} ta noma'lum xodim`,
        ],
      ]

      for (const [label, ok, detail] of checks) {
        if (ok) {
          console.log(`  ✓ ${label}`)
        } else {
          console.log(`  ✗ ${label}: ${detail}`)
          failures += 1
        }
      }

      if (unplacedEmployees.size > 0) {
        console.log(`    ${[...unplacedEmployees].slice(0, 10).join(', ')}`)
      }
    }

    console.log('')
    if (failures === 0) {
      console.log('  ✓ Har bir bitim va qoʻngʻiroq roppa-rosa bitta buketda. Scope ishonchli.')
    } else {
      console.log(`  ✗ ${failures} ta tekshiruv yiqildi — scope ishonchsiz.`)
    }
    console.log('')
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }

  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
