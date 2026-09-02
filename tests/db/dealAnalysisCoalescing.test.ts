import { describe, expect, it, vi } from 'vitest'

import { DealRepository } from '@/server/repositories/dealRepository'
import { resolvePeriod } from '@/server/domain/period/period'
import type { PrismaClient } from '@/generated/prisma/client'

/**
 * Identical concurrent analysis reads share one query; different ones never do.
 *
 * The sales screen opens five endpoints at once and three need the same fetch,
 * so the sharing is worth having — but the map's KEY is what stands between a
 * SALES-scoped caller and the whole company's rows, which is why the dangerous
 * cases get the tests: a different scope, a different window, and the entry
 * being gone once the promise settles (this is coalescing, not a cache).
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-02T09:00:00.000Z')
const period = resolvePeriod('today', { timeZone: TZ, now: NOW })

function fakePrisma() {
  const findMany = vi.fn(
    () =>
      new Promise((resolve) =>
        // Settled on the next tick, so concurrent callers genuinely overlap.
        setTimeout(() => resolve([]), 5),
      ),
  )
  return { prisma: { deal: { findMany } } as unknown as PrismaClient, findMany }
}

describe('findForAnalysis coalescing', () => {
  it('shares one query across identical concurrent calls', async () => {
    const { prisma, findMany } = fakePrisma()
    const repo = new DealRepository(prisma)

    await Promise.all([
      repo.findForAnalysis([period]),
      repo.findForAnalysis([period]),
      repo.findForAnalysis([period]),
    ])

    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('never shares across different authorisation scopes', async () => {
    const { prisma, findMany } = fakePrisma()
    const repo = new DealRepository(prisma)

    await Promise.all([
      repo.findForAnalysis([period], { restrictToEmployeeId: 'emp-1' }),
      repo.findForAnalysis([period], { restrictToEmployeeId: 'emp-2' }),
      repo.findForAnalysis([period]),
    ])

    expect(findMany).toHaveBeenCalledTimes(3)
  })

  it('never shares across different windows or filters', async () => {
    const { prisma, findMany } = fakePrisma()
    const repo = new DealRepository(prisma)
    const yesterday = resolvePeriod('yesterday', { timeZone: TZ, now: NOW })

    await Promise.all([
      repo.findForAnalysis([period]),
      repo.findForAnalysis([yesterday]),
      repo.findForAnalysis([period], { employeeIds: ['emp-1'] }),
    ])

    expect(findMany).toHaveBeenCalledTimes(3)
  })

  it('runs a fresh query once the previous one has settled', async () => {
    const { prisma, findMany } = fakePrisma()
    const repo = new DealRepository(prisma)

    await repo.findForAnalysis([period])
    await repo.findForAnalysis([period])

    // Sequential, not concurrent: nothing may be served from memory.
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('hands each caller its own array', async () => {
    const { prisma } = fakePrisma()
    const repo = new DealRepository(prisma)

    const [a, b] = await Promise.all([
      repo.findForAnalysis([period]),
      repo.findForAnalysis([period]),
    ])

    // Same rows, different top-level arrays — a caller's sort must stay its own.
    expect(a).not.toBe(b)
  })
})
