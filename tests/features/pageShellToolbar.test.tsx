// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * THE PAGE'S OWN CONTROLS BELONG IN THE FILTER ROW, AND THE ROW HAS TO OPEN
 * FOR THEM ON ITS OWN.
 *
 * `actions` puts a control in the header beside the title, right-aligned —
 * the place for a page-level ACTION, which is what Foydalanuvchilar' «+ Yangi
 * hisob» is. The confirmation board's РОП, status and Статистика are not
 * actions, they are filters, and passing them as `actions` put them on the far
 * right of the header while the window and the search box sat on the left: one
 * screen, two toolbars a metre apart, and the reader crossing the page to
 * narrow one table.
 *
 * Two things are pinned here because both have a way of being quietly lost.
 *
 * The ORDER: the shell's own controls first — the window, then the search —
 * and the page's after them, with «Filtrlarni tozalash» last of all. The clear
 * button used to be the final child of the `anyFilter` fragment, so a toolbar
 * appended after it would have planted the button between the search box and
 * the controls it also clears.
 *
 * The GUARD: the row used to render only for `period || anyFilter`, so a page
 * whose only controls were its own would have had them dropped on the floor —
 * not rendered somewhere wrong, not erroring, simply absent. No page is in
 * that position today (the confirmation board enables a search box in every
 * mode, so `anyFilter` opens its row even in backlog, where `period` is
 * false), which is exactly why it is pinned here rather than left to be
 * noticed: the first page that passes a toolbar and nothing else is the one
 * that would find out.
 */

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

const { PageShell } = await import('@/features/shared/PageShell')

/*
  THE PAGE'S HEADER, NOT THE APP'S.

  PageShell renders inside `Shell`, which has a `<header>` of its own — so a
  bare `querySelector('header')` returns the top bar, and an assertion about
  what is or is not under the title quietly becomes an assertion about the
  chrome. Anchor on the `<h1>`, which only the page has.
*/
function pageHeader(container: HTMLElement) {
  return container.querySelector('h1')!.closest('header')!
}

function renderShell(props: Parameters<typeof PageShell>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PageShell {...props} />
    </QueryClientProvider>,
  )
}

describe('PageShell toolbar', () => {
  it('renders the page controls after the shell ones and before the clear button', () => {
    renderShell({
      title: 'Tasdiqlash navbati',
      description: null,
      filters: { search: true },
      toolbar: <button type="button">Статистика</button>,
      children: null,
    })

    const stats = screen.getByRole('button', { name: 'Статистика' })
    const search = screen.getByRole('searchbox')

    // Same row, and the page's control comes after the shell's search box.
    expect(stats.parentElement).toBe(search.closest('div')?.parentElement)
    expect(
      search.closest('div')!.compareDocumentPosition(stats) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('opens the filter row for a toolbar on a page with no window and no filters', () => {
    renderShell({
      title: 'Tasdiqlash navbati',
      description: null,
      period: false,
      toolbar: <button type="button">Статистика</button>,
      children: null,
    })

    // Backlog mode: no preset row, no search box, and the board still has to
    // be able to pick a ROP and open Статистика.
    expect(screen.getByRole('button', { name: 'Статистика' })).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('gives the row its own line by default and the title\u2019s line on request', () => {
    /*
      ONE ROW, ONE PLACE IN THE DOM. `controlsBesideTitle` is a class on the
      row, not a second copy of it rendered somewhere else — so the tab order
      is the same on both settings and there is no way for the two to drift.
      `basis-full` is what claims the line; without it the row sits beside the
      title and `ml-auto` pushes it to the right edge.
    */
    const stacked = renderShell({
      title: 'Savdo dinamikasi',
      filters: { search: true },
      children: null,
    })
    const stackedRow = pageHeader(stacked.container).lastElementChild!
    expect(stackedRow.className).toContain('basis-full')
    expect(stackedRow.className).not.toContain('ml-auto')

    const inline = renderShell({
      title: 'Tasdiqlash navbati',
      description: null,
      filters: { search: true },
      controlsBesideTitle: true,
      children: null,
    })
    const inlineRow = pageHeader(inline.container).lastElementChild!
    expect(inlineRow.className).toContain('ml-auto')
    expect(inlineRow.className).not.toContain('basis-full')
    // Still the header's own last child either way — the row never moves out.
    expect(inlineRow.querySelector('input[type="search"]')).not.toBeNull()
  })

  it('draws no line under the title when the page passes description={null}', () => {
    const { container } = renderShell({
      title: 'Tasdiqlash navbati',
      description: null,
      children: null,
    })

    /*
      NOT THE SAME AS OMITTING THE PROP. Undefined leaves the paragraph in
      place — a page that prints `meta.period`'s dates has to claim the height
      before the first response lands — and on this board that reserved twenty
      pixels plus its margin for text that could never arrive, above the
      densest table in the application.
    */
    expect(pageHeader(container).querySelector('p')).toBeNull()
  })

  it('still reserves the line for a page that will print its dates', () => {
    const { container } = renderShell({
      title: 'Savdo dinamikasi',
      children: null,
    })

    expect(pageHeader(container).querySelector('p')).not.toBeNull()
  })
})
