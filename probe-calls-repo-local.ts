/**
 * Runs the REAL repository method against the local database.
 *
 * The local `call_record` is empty, so this proves the statement parses and
 * the row shaping holds on an empty result — not that the numbers are right.
 * Production is where the numbers are checked (Task 13).
 */
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from './src/generated/prisma/client'
import { resolvePeriod } from './src/server/domain/period/period'
import { InsightsRepository } from './src/server/repositories/insightsRepository'

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  })
  const repo = new InsightsRepository(prisma)

  const period = resolvePeriod('this_month', { timeZone: 'Asia/Tashkent' })
  console.log('period', period.start.toISOString(), '→', period.end.toISOString())

  const t = Date.now()
  const activity = await repo.callActivity({ period })
  console.log(`callActivity ${Date.now() - t}ms`)
  console.log(JSON.stringify(activity, null, 2))

  const t2 = Date.now()
  const durationBands = await repo.callDurationBands({ period })
  console.log(`callDurationBands ${Date.now() - t2}ms`, JSON.stringify(durationBands))

  const t3 = Date.now()
  const customerBands = await repo.callCustomerBands({ period })
  console.log(`callCustomerBands ${Date.now() - t3}ms`, JSON.stringify(customerBands))

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
