/**
 * Provision the administrator account.
 *
 *     npm run db:seed:users
 *
 * This deployment has exactly one login. The credential comes from
 * ADMIN_EMAIL and ADMIN_PASSWORD in the environment — never from a literal in
 * this file, because a password committed to a repository is a password that
 * has to be assumed public.
 *
 * The password is hashed through better-auth's own path rather than written
 * directly, so the stored hash always matches what sign-in verifies against.
 * Hand-rolling the hash is how a seeded account ends up unable to log in.
 *
 * Idempotent: re-running converges the role and the credential without
 * resetting a password that already works. Pass `--reset-password` to change
 * it deliberately.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

import { PrismaClient } from '../src/generated/prisma/client'
import { provisionUser, setPassword } from '../src/server/auth/provisioning'

const DATABASE_URL = process.env.DATABASE_URL
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const ADMIN_NAME = process.env.ADMIN_NAME ?? 'Administrator'

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set.')

/** Narrowed once, so the guard above holds inside every function below. */
const dbUrl: string = DATABASE_URL

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('\n  ADMIN_EMAIL va ADMIN_PASSWORD .env da boʻlishi kerak.\n')
  console.error('  Masalan:')
  console.error('    ADMIN_EMAIL=siz@example.com')
  console.error('    ADMIN_PASSWORD=<kuchli parol>\n')
  process.exit(1)
}

/**
 * A short password on the one account that can see everything is not a
 * trade-off worth offering, so it is refused rather than warned about.
 */
if (ADMIN_PASSWORD.length < 12) {
  console.error('\n  ADMIN_PASSWORD kamida 12 belgidan iborat boʻlsin.\n')
  process.exit(1)
}

const email: string = ADMIN_EMAIL
const password: string = ADMIN_PASSWORD

/**
 * Wait for a connection slot rather than fail the deployment over one.
 *
 * This runs as a POST_DEPLOY job, which is the one moment the database is
 * busiest: the outgoing web container still holds its pool while the new one
 * fills its own, the sync worker holds six, and the managed instance allows
 * twenty-two. Deploy 9915de8 built cleanly and was rolled back because this
 * script hit "remaining connection slots are reserved" once, at 12:05:54,
 * and exited — for an account that already existed.
 *
 * The old container drains within a minute or two; twelve tries ten seconds
 * apart outlast that. Anything that is NOT a connection shortage is rethrown
 * at once: a wrong password policy or a schema mismatch must still fail loudly.
 */
async function whenASlotFrees<T>(run: () => Promise<T>): Promise<T> {
  const attempts = 12
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      const code = (error as { code?: string }).code
      const message = String((error as Error).message ?? '')
      const tooMany =
        code === 'P2037' || /too many (database )?connections|connection slots/i.test(message)
      if (!tooMany || attempt >= attempts) throw error
      console.log(`  baza band (${attempt}/${attempts}) — 10 soniyadan keyin qayta urinaman`)
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
  }
}

async function main() {
  // ONE connection. A one-shot script has no business holding a pool of ten
  // on an instance that allows twenty-two, least of all during a deploy.
  const pool = new Pool(poolConfig(dbUrl, { caCert: caCertFromEnv(), max: 1 }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const result = await whenASlotFrees(() =>
      provisionUser({
        name: ADMIN_NAME,
        email,
        password,
        role: 'ADMIN',
      }),
    )

    if (process.argv.includes('--reset-password')) {
      await setPassword(result.id, password)
      console.log(`\n  ✓ ${result.email} — parol yangilandi\n`)
    } else {
      console.log(
        `\n  ✓ ${result.email} — ${result.created ? 'yaratildi' : 'allaqachon mavjud'} (ADMIN)\n`,
      )
    }

    /**
     * Any other account is a leftover, and a leftover login on a
     * single-administrator deployment is an open door nobody is watching.
     */
    const others = await prisma.user.findMany({
      where: { email: { not: email.toLowerCase() } },
      select: { email: true, role: true, isActive: true },
    })

    if (others.length > 0) {
      console.log('  Boshqa hisoblar topildi — bu tizim bir kishi uchun moʻljallangan:')
      for (const user of others) {
        console.log(`    · ${user.email} (${user.role}${user.isActive ? '' : ', faol emas'})`)
      }
      console.log('  Oʻchirish:  npm run db:seed:users -- --remove-others\n')

      if (process.argv.includes('--remove-others')) {
        const removed = await prisma.user.deleteMany({
          where: { email: { not: email.toLowerCase() } },
        })
        console.log(`  ✓ ${removed.count} ta hisob oʻchirildi\n`)
      }
    }
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('\n  Xato:', error, '\n')
  process.exit(1)
})
