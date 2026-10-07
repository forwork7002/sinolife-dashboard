// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RopReportDto } from '@/features/leads/leadSplitApi'

/**
 * A REFUSAL TAKES EVERY BLOCK DOWN, NOT ONLY THE ONES THAT ASK `statusOf`.
 *
 * Six blocks — /rnp's sheet, the ROP split cards, «Guruhlar», «ROP otchet»
 * and /kpi's hero — spelled the rule inline as `isError && !data`. That agrees
 * with `statusOf` on a failed background poll and disagrees on a 401/403: the
 * inline blocks kept their figures while the blocks beside them drew the
 * card, so /kpi's hero read last week's plan over CountCards saying «sign in».
 * They all ask `statusOf` now; «ROP otchet» is driven through a real query
 * client here, and the source pin keeps the inline spelling from coming back.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(''),
}))

const { RopReport } = await import('@/features/leads/RopReport')

const zero = { amount: 0, amountMinor: '0', currency: 'UZS' }
const cells = {
  leads: 0,
  plan: zero,
  fakt1: zero,
  deviation: zero,
  fakt1Orders: 0,
  conversionPercent: null,
  fakt2: zero,
  fakt2Orders: 0,
  connectedCalls: null,
  talkSec: null,
}
const REPORT: RopReportDto = { day: '2026-10-06', groups: [], total: cells }
const QUIET_DAY = 'Bu kunda ROP jamoalarida hech kim yoʻq — lid ham, buyurtma ham.'

/** What the server answers, flipped by each test. */
let answer: 'ok' | 'fail' | 'signed-out' = 'ok'

beforeEach(() => {
  answer = 'ok'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (answer === 'fail') {
        return { ok: false, status: 502, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Server xatosi' } }) }
      }
      if (answer === 'signed-out') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: { code: 'UNAUTHENTICATED', message: 'Tizimga kirish talab qilinadi.' } }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ data: REPORT, meta: { dataSource: 'DEMO', generatedAt: '2026-10-06T06:00:00.000Z' } }) }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function drawThenPoll(next: typeof answer) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  render(
    <QueryClientProvider client={client}>
      <RopReport day="2026-10-06" onDay={() => {}} colors={new Map()} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByText(QUIET_DAY)).toBeTruthy())

  answer = next
  await act(async () => {
    await client.refetchQueries()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('«ROP otchet» after a poll', () => {
  it('keeps its figures when the poll merely failed', async () => {
    await drawThenPoll('fail')

    expect(screen.getByText(QUIET_DAY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Qayta urinish' })).toBeNull()
  })

  it('draws the card when the poll was refused, figures or not', async () => {
    await drawThenPoll('signed-out')

    expect(screen.queryByText(QUIET_DAY)).toBeNull()
    expect(screen.getByText('Tizimga kirish talab qilinadi.')).toBeTruthy()
  })
})

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('the inline spelling of the rule', () => {
  it('is gone from every feature — each block asks statusOf', () => {
    const inline = /\.isError\s*&&\s*!data\b|!data\s*&&\s*\w+\.isError\b/
    const offenders = sources(join(process.cwd(), 'src/features')).filter((path) => inline.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })
})
