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

import { PrismaClient } from '../src/generated/prisma/client'
import { provisionUser, setPassword } from '../src/server/auth/provisioning'

const DATABASE_URL = process.env.DATABASE_URL
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const ADMIN_NAME = process.env.ADMIN_NAME ?? 'Administrator'

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set.')

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

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const result = await provisionUser({
      name: ADMIN_NAME,
      email,
      password,
      role: 'ADMIN',
    })

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
