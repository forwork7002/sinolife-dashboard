// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FaktTrendPointDto } from '@/lib/api'
import { t } from '@/lib/messages'

/**
 * THE CAPTIONS AROUND THE TWO TRENDS, AS THEY ARE PRINTED.
 *
 * `trendGranularity` reads the bucket size off the widest gap, and
 * `trendGranularity.test.tsx` pins that reading and the rate chart's own
 * legend. What it could not see is the three captions that SAY it, which live
 * in the section and the page: hard-coding the heading back to «kunlar
 * kesimida» left every test green. These render the text a reader reads, over
 * weekly points whose first bucket is clipped to one day — the shape that
 * fooled the first-gap reading.
 */

/*
  The two charts are `next/dynamic` chunks, and what is asserted is the text
  around them. Stubbed, so no test waits on — or races — recharts loading.
*/
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/charts/FaktTrendChart', () => ({ FaktTrendChart: () => null }))

/* The board is a second request; these captions read only the trend. */
vi.mock('@/features/sales/ConfirmationFaktSection', () => ({
  useFaktBoard: () => ({
    query: { isPlaceholderData: false, error: null, refetch: () => {} },
    data: undefined,
    status: 'loading',
  }),
  FaktHeadline: () => null,
  ConfirmationFaktSection: () => null,
}))
vi.mock('@/features/sales/ForecastSection', () => ({ ForecastSection: () => null }))
vi.mock('@/features/sales/DeliveryBoardSection', () => ({ DeliveryBoardSection: () => null }))
vi.mock('@/features/shared/BrandSwitch', () => ({ DashboardBrandSwitch: () => null }))
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children }: { children?: unknown }) => <div>{children as React.ReactNode}</div>,
}))
vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({ apiParams: {} }),
}))

const trend = vi.hoisted(() => ({ points: [] as unknown[] }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async () => ({ data: trend.points }),
}))

afterEach(cleanup)

const { ConfirmationOutcomeSection } = await import('@/features/sales/ConfirmationOutcomeSection')
const { SalesPage } = await import('@/features/sales/SalesPage')

const DAY = 86_400_000

/**
 * Sunday 8 March, then whole Monday weeks: [8, 9), [9, 16), [16, 23), [23, 30)
 * — «Sana» over 8–29 March, every bucket emitted, the first clipped.
 */
function weeks(): FaktTrendPointDto[] {
  const confirmedOf = [1, 9, 7, 8]
  const cohortOf = [1, 10, 10, 10]
  const starts = [0, 1, 8, 15].map((days) => Date.parse('2026-03-07T19:00:00.000Z') + days * DAY)
  return starts.map((at, i) => ({
    date: new Date(at).toISOString(),
    fakt1: 0,
    fakt2: 0,
    orders: confirmedOf[i]!,
    cohortOrders: cohortOf[i]!,
    byOutcome: {
      CONFIRM_NEW: 0,
      NO_ANSWER: 0,
      CONFIRMED: confirmedOf[i]!,
      REJECTED: cohortOf[i]! - confirmedOf[i]!,
      UNCONFIRMED_SHIPPED: 0,
    },
  })) as unknown as FaktTrendPointDto[]
}

describe('the confirmation-rate block over weekly points', () => {
  it('heads, captions and spreads in weeks, never in days', () => {
    const { container } = render(
      <ConfirmationOutcomeSection points={weeks()} trendStatus="ready" onRetry={() => {}} />,
    )

    expect(screen.getByText('Тасдиқланиш % haftalar kesimida')).toBeTruthy()
    expect(container.textContent).toContain('haftalar oʻrtachasi emas')
    // 70% on the week of 16 March is the low; the one-day first bucket the high.
    expect(container.textContent).toContain('(16-mar haftasi, 10 ta buyurtma)')
    expect(container.textContent).toContain('(8-mar haftasi, 1 ta buyurtma)')
    expect(container.textContent).not.toContain('kunlar')
  })
})

describe('Savdo dinamikasi over weekly points', () => {
  it('captions the FAKT chart in weeks although its first gap is one day', async () => {
    trend.points = weeks()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <SalesPage />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(`${t.chart.faktTrendBasis}, haftalar kesimida`)).toBeTruthy()
    // The rate block below reads the same points the same way.
    expect(screen.getByText('Тасдиқланиш % haftalar kesimida')).toBeTruthy()
    expect(screen.queryByText(/kunlar kesimida/)).toBeNull()
  })
})
