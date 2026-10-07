// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
  The page imports `useDashboardFilters`, which reads the address bar. The
  cell itself does not, but importing it pulls the module in — the same stub
  `confirmationHistory.test.tsx` installs for `OutcomeCell`.
*/
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

afterEach(cleanup)

const { DailyNumber } = await import('@/features/confirmation/ConfirmationPage')

/**
 * № AS THE FLOOR WRITES IT, AND NOTHING WHERE THE BOARD HAS NONE.
 *
 * The backlog board receives `dailyNo: null` — its cohort holds only the
 * orders still waiting, so any number minted over it would be a leftover's.
 * `String(null).padStart(3, '0')` prints «null», a word in a column of
 * identifiers that every reader would take for a broken row.
 */
describe('the № cell', () => {
  it('pads the day’s number to three digits', () => {
    const { container } = render(<DailyNumber value={6} />)
    expect(container.textContent).toBe('006')
  })

  it('prints an em dash where the server sends no number', () => {
    const { container } = render(<DailyNumber value={null} />)
    expect(container.textContent).toBe('—')
  })
})
