// @vitest-environment jsdom
import { useQuery } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/providers'

/**
 * A SCREEN READ TEN MINUTES AGO OPENS ON ITS LAST FIGURES, NOT ON SKELETONS.
 *
 * There is no dashboard layout, so a page's queries lose their last reader on
 * every navigation. Under the library's five-minute `gcTime` the entry was
 * then deleted, and a return after a longer stay elsewhere drew skeletons and
 * waited the whole round trip. Rendered under the REAL `Providers`, because
 * the setting under test is the application's default and a client built here
 * would be the test checking its own fixture.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Screen({ read }: { read: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['revisit', 'screen'], queryFn: read })
  return <p>{query.data ?? 'skeleton'}</p>
}

/** The page under the one client, mounted or navigated away from. */
function App({ open, read }: { open: boolean; read: () => Promise<string> }) {
  return <Providers>{open ? <Screen read={read} /> : <p>elsewhere</p>}</Providers>
}

describe('the query cache', () => {
  it('still holds a screen’s answer when the reader comes back after six minutes elsewhere', async () => {
    const first = async () => 'FAKT 1 · 106 432 000'
    const { rerender } = render(<App open read={first} />)
    expect(await screen.findByText('FAKT 1 · 106 432 000')).toBeTruthy()

    vi.useFakeTimers()
    rerender(<App open={false} read={first} />)
    await act(async () => {
      vi.advanceTimersByTime(6 * 60_000)
    })

    // The server has not answered yet: whatever is drawn comes from the cache.
    const never = () => new Promise<string>(() => {})
    rerender(<App open read={never} />)

    expect(screen.getByText('FAKT 1 · 106 432 000')).toBeTruthy()
    expect(screen.queryByText('skeleton')).toBeNull()
  })
})
