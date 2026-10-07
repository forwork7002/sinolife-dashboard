// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A FAILED «LID MANBALARI» OVERVIEW TAKES DOWN ONLY ITS OWN BLOCKS.
 *
 * The tiles and the three tables are `/leads/overview`; the split card and
 * «Kimga qancha lid kelayapti» placed between them are the ROP cards, on their
 * own day and their own request (`/registration/overview`). The error card
 * used to stand in for the whole section, so one failed period read hid two
 * cards with nothing wrong with them.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(''),
}))

// The shell's header, filters and meta line are not what is under test.
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const { LeadsPage } = await import('@/features/leads/LeadsPage')

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/leads/overview')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Kutilmagan xatolik yuz berdi.' } }),
        }
      }
      // The ROP cards' own read has not answered yet.
      return new Promise(() => {})
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('«Lid manbalari» when its overview fails with nothing to keep', () => {
  it('prints the error once and keeps the ROP cards, which read their own day', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
    render(
      <QueryClientProvider client={client}>
        <LeadsPage />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Kutilmagan xatolik yuz berdi.')).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'Qayta urinish' })).toHaveLength(1)
    expect(screen.getByText('Lidlar qanday boʻlinadi')).toBeTruthy()
    expect(screen.getByText('Kimga qancha lid kelayapti')).toBeTruthy()
  })
})
