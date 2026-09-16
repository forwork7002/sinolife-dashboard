/**
 * Runs the REAL repository methods against PRODUCTION and checks the
 * invariants the spec names. Read-only: three SELECT statements.
 */
import { readFileSync } from 'node:fs'

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from './src/generated/prisma/client'
import { resolvePeriod } from './src/server/domain/period/period'
import { InsightsRepository } from './src/server/repositories/insightsRepository'

const DIR = '/tmp/claude-1000/-home-smack-Work/15fecd8a-5380-4f8b-b747-473d10d5fa0b/scratchpad'
const RAW = readFileSync(`${DIR}/dburi`, 'utf8').trim()
const ca = readFileSync(`${DIR}/db-ca.pem`, 'utf8')

function check(label: string, left: number, right: number) {
  const ok = left === right
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${left} ${ok ? '=' : '≠'} ${right}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: RAW.replace(/[?&]sslmode=[^&]*/, ''),
      ssl: { ca, rejectUnauthorized: true },
    }),
  })
  const repo = new InsightsRepository(prisma)

  const period = resolvePeriod('this_month', { timeZone: 'Asia/Tashkent' })
  console.log('asked', period.start.toISOString(), '→', period.end.toISOString())

  let t = Date.now()
  const a = await repo.callActivity({ period })
  console.log(`callActivity ${Date.now() - t}ms`)

  t = Date.now()
  const durationBands = await repo.callDurationBands({ period })
  console.log(`callDurationBands ${Date.now() - t}ms`)

  t = Date.now()
  const customerBands = await repo.callCustomerBands({ period })
  console.log(`callCustomerBands ${Date.now() - t}ms`)

  const sum = (xs: readonly number[]) => xs.reduce((x, y) => x + y, 0)

  console.log('\n— invariants —')
  check('operators[].calls = total.calls', sum(a.operators.map((r) => r.calls)), a.total.calls)
  check('teams[].calls = total.calls', sum(a.teams.map((r) => r.calls)), a.total.calls)
  check('series[].calls = total.calls', sum(a.series.map((r) => r.calls)), a.total.calls)
  check('sides[].calls = total.calls', sum(a.sides.map((r) => r.calls)), a.total.calls)
  check(
    'seriesBySide talkSec = total.talkSec',
    sum(a.seriesBySide.map((r) => r.talkSec)),
    a.total.talkSec,
  )
  check('durationBands[].calls = total.connected', sum(durationBands.map((b) => b.calls)), a.total.connected)
  check('series days are distinct', new Set(a.series.map((r) => r.key)).size, a.series.length)

  console.log('\n— total —')
  console.table([a.total])
  console.log('— sides —')
  console.table(a.sides)
  console.log('— series (first/last day must be Tashkent days ≥ 2026-09-13) —')
  console.table(a.series.map((r) => ({ day: r.key, calls: r.calls, hours: (r.talkSec / 3600).toFixed(1) })))
  console.log('— teams —')
  console.table(a.teams.map((r) => ({ team: r.label, calls: r.calls, connected: r.connected, median: r.medianSec })))
  console.log('— duration bands —')
  console.table(durationBands)
  console.log('— customer bands —')
  console.table(customerBands)
  console.log(`unlinkedCalls ${a.unlinkedCalls}, operators ${a.operators.length}`)

  console.log('\n— база split —')
  t = Date.now()
  const split = await repo.customerBaseSplit()
  console.log(`customerBaseSplit ${Date.now() - t}ms`, split)
  t = Date.now()
  const states = await repo.customerStates()
  console.log(`customerStates ${Date.now() - t}ms`, states)
  check('inBase + notInBase = customers', split.inBase + split.notInBase, split.customers)
  check('customerBaseSplit.customers = customerStates.customers', split.customers, states.customers)

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
