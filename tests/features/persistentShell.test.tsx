// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * THE RAIL AND THE HEADER ARE DRAWN ONCE, BY THE `(app)` LAYOUT (2026-10-20).
 *
 * The client: «page dan page o'tishim … silliq … qotmasdan». Every page used
 * to draw the shell through `PageShell`, so each click on the rail tore the
 * whole application down and built it again around the next screen. Now the
 * layout draws it and the page only tells it two facts about itself — whether
 * it has a reporting window and which source its figures came from — through
 * `shellChrome`. These pin both halves: a page frame draws no rail of its own
 * (a second one would be drawn inside the first), and the facts the shell
 * reads are always the OPEN page's.
 */

const nav = vi.hoisted(() => ({ path: '/margin' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async () => ({ data: {} }),
}))

vi.mock('@/lib/authClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authClient')>()),
  useSession: () => ({ data: undefined, isPending: true }),
  signOut: async () => {},
}))

const { PageShell } = await import('@/features/shared/PageShell')
const { Shell } = await import('@/components/layout/Shell')
const { useAnnounceShellChrome, useShellChrome } = await import('@/components/layout/shellChrome')
const { default: AppLayout } = await import('@/app/(app)/layout')

afterEach(() => {
  cleanup()
  nav.path = '/margin'
})

function Reader() {
  const chrome = useShellChrome()
  return <output>{`${chrome.periodAware}|${chrome.dataSource ?? '-'}`}</output>
}

function Page({ period, source }: { period: boolean; source?: 'DEMO' | 'BITRIX24' }) {
  useAnnounceShellChrome(period, source)
  return null
}

describe('the (app) layout', () => {
  it('draws the shell around whatever page it is given', () => {
    const child = <p>page</p>
    const element = AppLayout({ children: child })
    expect(element.type).toBe(Shell)
    expect(element.props.children).toBe(child)
  })
})

describe('the shell, kept from one screen to the next', () => {
  it('opens a new screen at its top, and a filter change where the reader is', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    const view = (page: string) => (
      <QueryClientProvider client={client}>
        <Shell>{page}</Shell>
      </QueryClientProvider>
    )
    nav.path = '/margin'
    const { container, rerender } = render(view('margin'))
    const main = container.querySelector<HTMLElement>('#main')!
    // jsdom lays nothing out, so the scroll offset is a plain property here.
    Object.defineProperty(main, 'scrollTop', { value: 640, writable: true })

    rerender(view('margin, filtered'))
    expect(main.scrollTop).toBe(640)

    nav.path = '/rnp'
    rerender(view('rnp'))
    expect(container.querySelector('#main')).toBe(main)
    expect(main.scrollTop).toBe(0)
  })
})

describe('the drawer and the palette, on a shell that outlives the page', () => {
  function shell() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    const view = () => (
      <QueryClientProvider client={client}>
        <Shell>page</Shell>
      </QueryClientProvider>
    )
    const result = render(view())
    return { ...result, again: () => result.rerender(view()) }
  }

  it('closes the phone drawer when the screen changes by any road — a back press included', () => {
    const { again } = shell()
    fireEvent.click(screen.getByRole('button', { name: 'Menyuni ochish' }))
    expect(screen.getByRole('dialog', { name: 'Menyu' })).toBeTruthy()
    nav.path = '/rnp' // not through the drawer's own links
    again()
    expect(screen.queryByRole('dialog', { name: 'Menyu' })).toBeNull()
  })

  it('closes the ⌘K palette the same way', () => {
    const { again } = shell()
    fireEvent.click(screen.getByRole('button', { name: 'Qidiruv' }))
    expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0)
    nav.path = '/rnp'
    again()
    expect(screen.queryAllByRole('dialog')).toHaveLength(0)
  })
})

describe('PageShell', () => {
  it('draws the page and no rail or header of its own', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <PageShell title="Yalpi marja">{null}</PageShell>
        <Reader />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Yalpi marja' })).toBeTruthy()
    expect(container.querySelector('aside')).toBeNull()
    expect(container.querySelector('#main')).toBeNull()
    // …and tells the shell it has a window.
    expect(screen.getByRole('status').textContent).toBe('true|-')
  })
})

describe('shellChrome', () => {
  it('reads the open page’s facts, follows them, and drops them when the page goes', () => {
    const { rerender } = render(
      <>
        <Page period source="BITRIX24" />
        <Reader />
      </>,
    )
    expect(screen.getByRole('status').textContent).toBe('true|BITRIX24')

    // The confirmation board drops its window in backlog mode, without leaving.
    rerender(
      <>
        <Page period={false} source="BITRIX24" />
        <Reader />
      </>,
    )
    expect(screen.getByRole('status').textContent).toBe('false|BITRIX24')

    // A screen that says nothing (the account screen) has no window and no source of its own.
    rerender(<Reader />)
    expect(screen.getByRole('status').textContent).toBe('false|-')
  })

  it('takes the NEW page’s word when one page replaces another in one commit', () => {
    function Router() {
      const [at, setAt] = useState<'a' | 'b'>('a')
      return (
        <>
          <button type="button" onClick={() => setAt('b')}>
            keyingi
          </button>
          {at === 'a' ? <Page key="a" period source="DEMO" /> : <Page key="b" period source="BITRIX24" />}
        </>
      )
    }
    render(
      <>
        <Router />
        <Reader />
      </>,
    )
    expect(screen.getByRole('status').textContent).toBe('true|DEMO')
    fireEvent.click(screen.getByRole('button', { name: 'keyingi' }))
    expect(screen.getByRole('status').textContent).toBe('true|BITRIX24')
  })
})
