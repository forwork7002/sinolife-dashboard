// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «LIDLAR» JOINED `SHALLOW_ROUTES` ON 2026-10-06 (the audit). Its server page,
 * `src/app/leads/page.tsx`, is `requireSection` plus a client component and
 * reads no `searchParams`, yet every period chip and every press of the brand
 * switch on «Lid manbalari» went through `router.replace`: an RSC round trip
 * (a session lookup on the busy database) before the address committed and
 * `/leads/overview` was even asked. `confirmationInstantFilters.test.tsx`
 * carries the measurement and the mechanism.
 */

const nav = vi.hoisted(() => ({ search: '', routed: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (url: string) => nav.routed.push(url),
    push: (url: string) => nav.routed.push(url),
  }),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const { useDashboardFilters } = await import('@/features/shared/useDashboardFilters')

/** Every native address write — the spy records and still moves the address bar, as the browser would. */
const shallow: string[] = []
const realReplaceState = window.history.replaceState.bind(window.history)
vi.spyOn(window.history, 'replaceState').mockImplementation((state: unknown, title: string, url?: string | URL | null) => {
  realReplaceState(state, title, url)
  if (url == null) return
  shallow.push(String(url))
  nav.search = String(url).split('?')[1] ?? ''
})

beforeEach(() => {
  nav.search = 'preset=today'
  window.history.pushState(null, '', '/leads?preset=today')
  shallow.length = 0
  nav.routed = []
})

describe('«Lidlar» writes its address without asking the server', () => {
  it('answers a period chip and the brand switch with replaceState, never router.replace', () => {
    const { result, rerender } = renderHook(() => useDashboardFilters())

    act(() => result.current.setPeriod({ preset: 'yesterday' }))
    rerender()
    act(() => result.current.update({ brand: 'Collagen' }))

    expect(nav.routed).toEqual([])
    expect(shallow).toHaveLength(2)
    const address = new URLSearchParams(shallow[1]!.split('?')[1])
    expect(address.get('preset')).toBe('yesterday')
    expect(address.get('brand')).toBe('Collagen')
  })
})
