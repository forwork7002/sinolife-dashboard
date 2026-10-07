// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * ⌘K HITS ANSWER WHAT IS IN THE BOX, OR THEY ARE NOT OPENED.
 *
 * Shell keeps the previous search's answer while the next one loads
 * (`placeholderData`), and query-core hands that answer to ANY pending query,
 * a disabled one included. So, until 2026-10-06:
 * - a term cut to «zz» kept «dilnoza»'s orders on screen, listed as matches,
 *   with the «Kamida 3 ta harf» hint suppressed — and Enter opened one;
 * - a phone number pasted and entered at once opened the PREVIOUS lookup's
 *   customer, because no section matched the digits and row 0 was that hit;
 * - Esc and ⌘K again showed the old hits under an empty box.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))

const DILNOZA = {
  query: 'dilnoza',
  tooShort: false,
  groups: [
    {
      key: 'deals',
      label: 'Buyurtmalar',
      items: [{ id: 'deal-d1', label: 'Dilnoza', hint: 'ID 925842', href: '/confirmation?preset=this_year&q=925842' }],
    },
  ],
}

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: (path: string, params?: Record<string, unknown>) => {
    if (path === '/search') {
      // Any other term is still being looked up when the test acts.
      return params?.q === 'dilnoza' ? Promise.resolve({ data: DILNOZA }) : new Promise(() => {})
    }
    if (path === '/meta/filters') return Promise.resolve({ data: { employees: [], departments: [], sources: [], viewer: null } })
    return Promise.resolve({ data: {} })
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/lib/authClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authClient')>()),
  useSession: () => ({ data: undefined, isPending: true }),
  signOut: async () => {},
}))

const { Shell } = await import('@/components/layout/Shell')
const { ViewerProvider } = await import('@/lib/viewer')

beforeAll(() => {
  // The palette keeps the selection in view; jsdom has no layout to scroll.
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  router.push.mockClear()
})

/** Past the palette's 220 ms debounce, with React's updates flushed. */
const pastDebounce = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)))

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  render(
    <QueryClientProvider client={client}>
      <ViewerProvider
        value={{ userId: 'u1', role: 'ADMIN', sections: ['confirmation'], dataScope: 'ALL', canManageUsers: false }}
      >
        <Shell>page</Shell>
      </ViewerProvider>
    </QueryClientProvider>,
  )
}

function openPalette(): HTMLElement {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
  return screen.getByRole('combobox')
}

/** Opens the palette on a fresh shell, types, and waits out the 220 ms debounce for «dilnoza»'s answer. */
async function searchDilnoza(): Promise<HTMLElement> {
  renderShell()
  const box = openPalette()
  fireEvent.change(box, { target: { value: 'dilnoza' } })
  const hit = await screen.findByRole('option', { name: /Dilnoza/ })
  expect(hit.getAttribute('aria-disabled')).toBeNull()
  return box
}

describe('the ⌘K search hits', () => {
  it('leave with a term too short to search, and the hint says why', async () => {
    const box = await searchDilnoza()

    fireEvent.change(box, { target: { value: 'zz' } })
    expect(screen.queryByRole('option', { name: /Dilnoza/ })).toBeNull()
    expect(screen.getByText('Kamida 3 ta harf yozing')).toBeTruthy()

    fireEvent.keyDown(box, { key: 'Enter' })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('are drawn but never opened while the next lookup runs', async () => {
    const box = await searchDilnoza()

    fireEvent.change(box, { target: { value: '+998 90 123 45 67' } })
    // Kept on screen, so the list does not blink empty — and inert.
    expect(screen.getByRole('option', { name: /Dilnoza/ }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(box, { key: 'Enter' })

    // Past the debounce, the phone's own lookup is in flight; the old hit is still not it.
    await pastDebounce()
    expect(screen.getByRole('option', { name: /Dilnoza/ }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(router.push).not.toHaveBeenCalled()
  })

  it('do not come back under an empty box when the palette is opened again', async () => {
    const box = await searchDilnoza()

    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('combobox')).toBeNull()

    const reopened = openPalette()
    expect((reopened as HTMLInputElement).value).toBe('')
    await pastDebounce()
    expect(screen.queryByRole('option', { name: /Dilnoza/ })).toBeNull()
  })

  it('open the order once they answer the box', async () => {
    const box = await searchDilnoza()

    fireEvent.keyDown(box, { key: 'Enter' })
    expect(router.push).toHaveBeenCalledWith('/confirmation?preset=this_year&q=925842')
  })
})
