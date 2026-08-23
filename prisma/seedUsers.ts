/**
 * Demo user accounts.
 *
 * Separate from the data seed because these are credentials, not CRM records.
 * Run with `npm run db:seed:users`.
 *
 * Passwords are hashed through better-auth's own sign-up path rather than
 * written directly, so the stored hash always matches what the sign-in path
 * expects — hand-rolling the hash is how a seeded account ends up unable to
 * log in.
 *
 * These credentials are for the DEMO deployment. Anything reachable from
 * outside gets real accounts with real passwords; the console warning below
 * says so on every run.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { provisionUser } from '../src/server/auth/provisioning'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set.')

interface SeedUser {
  readonly name: string
  readonly email: string
  readonly password: string
  readonly role: 'ADMIN' | 'MANAGER' | 'SALES'
  /** Link a SALES login to a salesperson so own-data scoping has something to scope to. */
  readonly linkToEmployeeIndex?: number
}

const USERS: SeedUser[] = [
  { name: 'Admin', email: 'admin@sinolife.uz', password: 'demo1234', role: 'ADMIN' },
  { name: 'Menejer', email: 'manager@sinolife.uz', password: 'demo1234', role: 'MANAGER' },
  {
    name: 'Savdo xodimi',
    email: 'sales@sinolife.uz',
    password: 'demo1234',
    role: 'SALES',
    linkToEmployeeIndex: 0,
  },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    console.log('\nSeeding demo accounts\n')

    // Pick a salesperson with real activity, so the scoped view is not empty.
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    })

    for (const user of USERS) {
      const employeeId =
        user.linkToEmployeeIndex !== undefined
          ? (employees[user.linkToEmployeeIndex]?.id ?? null)
          : null

      const saved = await provisionUser({
        name: user.name,
        email: user.email,
        password: user.password,
        role: user.role,
        employeeId,
      })

      const linked = saved.employeeId
        ? ` → ${employees.find((e) => e.id === saved.employeeId)?.fullName ?? saved.employeeId}`
        : ''

      console.log(
        `  ${saved.created ? '+' : '·'} ${saved.email.padEnd(26)} ${saved.role.padEnd(8)}${linked}`,
      )
    }

    console.log('\n  Parol / password: demo1234')
    console.log('  ⚠  Demo credentials. Replace before any deployment reachable from outside.\n')
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('\nUser seeding failed:', error)
  process.exit(1)
})
