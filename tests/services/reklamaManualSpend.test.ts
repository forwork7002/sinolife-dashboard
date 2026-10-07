import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
  The repository reads `env` at module scope — the same preamble
  reklamaService.test.ts explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { ReklamaRepository } = await import('@/server/repositories/reklamaRepository')

describe('ReklamaRepository — the hand-typed ad money («Telegram»)', () => {
  const poolWaitMs = Number(
    /connectionTimeoutMillis: ([\d_]+)/
      .exec(readFileSync(resolve(process.cwd(), 'src/server/db/prisma.ts'), 'utf8'))![1]!
      .replaceAll('_', ''),
  )

  it('upserts cents for a typed day, deletes a cleared one, in one transaction that waits the pool’s 20 s', async () => {
    const calls: unknown[] = []
    const options: unknown[] = []
    const client = {
      reklamaManualSpend: {
        upsert: (args: unknown) => calls.push(['upsert', args]),
        deleteMany: (args: unknown) => calls.push(['delete', args]),
      },
      $transaction: async (work: unknown, o: unknown) => {
        options.push(o)
        return work
      },
    }
    const repo = new ReklamaRepository(client as never)
    await repo.saveManualSpend(
      [
        { day: '2026-10-06', project: 'Zextra', channel: 'telegram', cents: 25_490 },
        { day: '2026-10-07', project: 'Zextra', channel: 'telegram', cents: null },
      ],
      'u1',
    )
    const day = new Date('2026-10-06T00:00:00Z')
    expect(calls).toEqual([
      [
        'upsert',
        {
          where: { day_project_channel: { day, project: 'Zextra', channel: 'telegram' } },
          create: { day, project: 'Zextra', channel: 'telegram', amountCents: 25_490, updatedBy: 'u1' },
          update: { amountCents: 25_490, updatedBy: 'u1' },
        },
      ],
      ['delete', { where: { day: new Date('2026-10-07T00:00:00Z'), project: 'Zextra', channel: 'telegram' } }],
    ])
    expect(options).toEqual([{ maxWait: poolWaitMs }])
  })

  it('reads the window’s rows back as day keys and cents', async () => {
    const client = {
      reklamaManualSpend: {
        findMany: async () => [{ day: new Date('2026-10-06T00:00:00Z'), project: 'Zextra', channel: 'telegram', amountCents: 25_490 }],
      },
    }
    const repo = new ReklamaRepository(client as never)
    expect(await repo.manualSpend('2026-10-01', '2026-10-31')).toEqual([{ day: '2026-10-06', project: 'Zextra', channel: 'telegram', amountCents: 25_490 }])
  })
})
