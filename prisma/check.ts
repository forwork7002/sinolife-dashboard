/**
 * Post-seed data integrity check.
 *
 * Verifies invariants that the schema alone cannot express, against the real
 * database. Run after seeding, or any time the import path changes:
 *
 *     npm run db:check
 *
 * Exits non-zero if any invariant is violated, so it is usable in CI.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

import { PrismaClient } from '../src/generated/prisma/client'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set.')

/** Narrowed once, so the guard above holds inside every function below. */
const dbUrl: string = DATABASE_URL

interface Check {
  readonly name: string
  /** Returns the number of violations. Zero means healthy. */
  run: (prisma: PrismaClient) => Promise<number>
}

const checks: Check[] = [
  {
    name: 'every deal amount equals the sum of its line items',
    async run(prisma) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from (
          select d.id
          from deal d
          join deal_item i on i."dealId" = d.id
          group by d.id, d."amountMinor"
          having d."amountMinor" <> sum(i."totalMinor")
        ) x`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'no deal is paid more than its value',
    async run(prisma) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from (
          select d.id
          from deal d
          join payment p on p."dealId" = d.id
          group by d.id, d."amountMinor"
          having sum(p."amountMinor") > d."amountMinor"
        ) x`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'payments belong only to won deals',
    async run(prisma) {
      return prisma.payment.count({ where: { deal: { status: { not: 'WON' } } } })
    },
  },
  {
    name: 'deal status agrees with its stage category',
    async run(prisma) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n
        from deal d
        join deal_stage s on s.id = d."stageId"
        where (s.category = 'WON'  and d.status <> 'WON')
           or (s.category = 'LOST' and d.status <> 'LOST')
           or (s.category in ('NEW','IN_PROGRESS') and d.status <> 'OPEN')`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'resolved deals have a close date, open deals do not',
    async run(prisma) {
      const closedButOpen = await prisma.deal.count({
        where: { status: 'OPEN', closedAt: { not: null } },
      })
      const resolvedWithoutDate = await prisma.deal.count({
        where: { status: { in: ['WON', 'LOST'] }, closedAt: null },
      })
      return closedButOpen + resolvedWithoutDate
    },
  },
  {
    name: 'no deal closes before it was created',
    async run(prisma) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from deal
        where "closedAt" is not null and "closedAt" < "createdAtSource"`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'no duplicate external ids per source',
    async run(prisma) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from (
          select "externalSource", "externalId" from deal
          where "externalId" is not null
          group by 1, 2 having count(*) > 1
        ) x`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'every deal has a resolvable employee and stage',
    async run(prisma) {
      // Foreign keys make orphans impossible, so a non-zero count here would
      // mean the constraints themselves are missing.
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from deal d
        left join employee e on e.id = d."employeeId"
        left join deal_stage s on s.id = d."stageId"
        where e.id is null or s.id is null`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'every KPI target is positive',
    async run(prisma) {
      return prisma.kpi.count({ where: { targetValue: { lte: 0n } } })
    },
  },
  {
    // REGRESSION GUARD: KPI window boundaries are part of the natural key, so
    // changing how they are computed orphans the old rows instead of updating
    // them. That doubled the target count once and made the containment lookup
    // match two windows at the same instant.
    name: 'no employee has two KPI windows covering the same instant',
    async run(prisma) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n
        from kpi a
        join kpi b
          on a."employeeId" = b."employeeId"
         and a.metric = b.metric
         and a.id < b.id
         and a."periodStart" < b."periodEnd"
         and b."periodStart" < a."periodEnd"
        where a."isActive" and b."isActive"`
      return Number(rows[0]?.n ?? 0)
    },
  },
  {
    name: 'no sync run finished as FAILED',
    async run(prisma) {
      return prisma.syncLog.count({ where: { status: 'FAILED' } })
    },
  },
]

async function main() {
  const pool = new Pool(poolConfig(dbUrl, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  let violations = 0

  try {
    console.log('\nData integrity checks\n')

    for (const check of checks) {
      const count = await check.run(prisma)
      const ok = count === 0
      if (!ok) violations++
      console.log(`  ${ok ? '✓' : '✗'} ${check.name}${ok ? '' : ` — ${count} violation(s)`}`)
    }

    const [deals, items, payments, employees, kpis] = await Promise.all([
      prisma.deal.count(),
      prisma.dealItem.count(),
      prisma.payment.count(),
      prisma.employee.count(),
      prisma.kpi.count(),
    ])

    const revenue = await prisma.deal.aggregate({
      where: { status: 'WON' },
      _sum: { amountMinor: true },
      _count: { _all: true },
    })

    console.log(
      `\n  ${deals} deals · ${items} line items · ${payments} payments · ` +
        `${employees} employees · ${kpis} KPI targets`,
    )
    console.log(
      `  ${revenue._count._all} won, total ` +
        `${((revenue._sum.amountMinor ?? 0n) / 100n).toLocaleString('en-US')} UZS`,
    )

    if (violations > 0) {
      console.error(`\n  ✗ ${violations} check(s) failed\n`)
      process.exitCode = 1
    } else {
      console.log('\n  ✓ All integrity checks passed\n')
    }
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('\nCheck failed:', error)
  process.exit(1)
})
