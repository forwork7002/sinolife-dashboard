// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Page identity, the half TypeScript writes.
 *
 * globals.css re-declares --accent-soft / -line / -ink on `.page-container`
 * so they resolve against the PAGE's accent (`designTokens.test.ts` holds that
 * half). It only works while PageShell puts the inline --accent on that very
 * element: on a wrapper above it, the derivatives would resolve on
 * `.page-container` from the inherited :root value and every page would be
 * series-1 blue again, with nothing on screen saying why.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/structure',
  useSearchParams: () => new URLSearchParams(''),
}))

const { PageShell } = await import('@/features/shared/PageShell')

function renderShell(accent?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PageShell title="Kadrlar tuzilmasi" description={null} period={false} accent={accent}>
        {null}
      </PageShell>
    </QueryClientProvider>,
  )
}

describe('the page accent', () => {
  it('is set on the .page-container element itself', () => {
    const { container } = renderShell('var(--series-6)')
    const page = container.querySelector<HTMLElement>('.page-container')

    expect(page).not.toBeNull()
    expect(page!.style.getPropertyValue('--accent')).toBe('var(--series-6)')
  })

  it('is left to :root when a page names none', () => {
    const { container } = renderShell()

    expect(container.querySelector<HTMLElement>('.page-container')!.style.getPropertyValue('--accent')).toBe('')
  })
})
