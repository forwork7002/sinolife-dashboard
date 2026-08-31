import { writeFileSync, mkdirSync } from 'node:fs'
import { prisma } from '@/server/db/prisma'
import { commandCentreService } from '@/server/services/container'
import type { Period } from '@/server/domain/period/period'

const OUT = process.env.CAPTURE_OUT ?? '/tmp/capture'
mkdirSync(OUT, { recursive: true })

const captured: { sql: string; params: unknown[] }[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any
p.$queryRawUnsafe = async (sql: string, ...params: unknown[]) => {
  captured.push({ sql, params })
  return []
}
p.$queryRaw = async (...args: unknown[]) => {
  captured.push({ sql: JSON.stringify(args), params: [] })
  return []
}

const period: Period = {
  start: new Date('2026-07-31T19:00:00.000Z'),
  end: new Date('2026-08-31T19:00:00.000Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'this_month',
}

async function main() {
  try {
    await commandCentreService.load(period, 'UZS')
  } catch (e) {
    console.error('post-processing threw (expected):', (e as Error).message)
  }
  console.error('captured', captured.length, 'queries')
  captured.forEach((c, i) => {
    writeFileSync(`${OUT}/q${String(i + 1).padStart(2, '0')}.sql`, c.sql)
    writeFileSync(`${OUT}/q${String(i + 1).padStart(2, '0')}.params.json`, JSON.stringify(c.params, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2))
  })
  process.exit(0)
}
void main()
