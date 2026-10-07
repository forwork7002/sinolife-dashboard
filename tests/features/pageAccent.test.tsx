// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * THE POOL — globals.css «Page identity»: slots 1, 2, 3, 5, 6 and 7. Amber (4)
 * is too light to carry a mark on a grid track, and red (8) sits 4.1 ΔE from
 * --status-critical. The confirmation board wore amber for six weeks — set the
 * day before the pool was written down — and its focus ring read 2.87:1.
 */
const ACCENT_POOL = new Set(['1', '2', '3', '5', '6', '7'])

describe('every page accent comes from the pool', () => {
  const features = join(process.cwd(), 'src/features')
  const pages = (readdirSync(features, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => [file, readFileSync(join(features, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')] as const)
    .filter(([, source]) => source.includes('<PageShell'))

  it('finds the pages to check', () => {
    expect(pages.length).toBeGreaterThanOrEqual(15)
  })

  it('names a pool slot, literally, wherever a page sets one', () => {
    for (const [file, source] of pages) {
      for (const [, value] of source.matchAll(/(?<![\w-])accent=(\S+)/g)) {
        const slot = /^"var\(--series-(\d)\)"/.exec(value!)?.[1]
        expect(slot, `${file}: accent=${value}`).toBeDefined()
        expect(ACCENT_POOL.has(slot!), `${file}: --series-${slot}`).toBe(true)
      }
    }
  })
})
