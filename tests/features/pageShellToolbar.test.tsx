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
    const header = container.querySelector('header')!
    expect(header.querySelector('p')).toBeNull()
  })

  it('still reserves the line for a page that will print its dates', () => {
    const { container } = renderShell({
      title: 'Savdo dinamikasi',
      children: null,
    })

    expect(container.querySelector('header p')).not.toBeNull()
  })

  /*
    WHERE THE ROW SITS IS A PAGE'S DECISION, AND IT IS ONE ROW EITHER WAY.

    `controlsAlign="end"` moves the whole control row into the title's line —
    the television board asked for it with four chips, the confirmation board
    with a window, a search box, two selects and a button, both to get a line
    of the page back. The failure this pins is not a misplaced row, it is a
    SECOND one: rendered in the header as well as under the title, the page
    would look almost right, carry two search boxes with one URL between them,
    and hand a keyboard reader the same five controls twice.
  */
  it('seats the whole control row in the header when the page asks for it', () => {
    renderShell({
      title: 'Tasdiqlash navbati',
      description: null,
      controlsAlign: 'end',
      filters: { search: true },
      toolbar: <button type="button">Статистика</button>,
      children: null,
    })

    const search = screen.getByRole('searchbox')
    expect(search.closest('header')).not.toBeNull()
    // The page's own control travels with it, in the same row as before.
    expect(screen.getByRole('button', { name: 'Статистика' }).closest('header')).not.toBeNull()
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })

  it('leaves the row under the title by default', () => {
    renderShell({
      title: 'Tasdiqlash navbati',
      description: null,
      filters: { search: true },
      toolbar: <button type="button">Статистика</button>,
      children: null,
    })

    expect(screen.getByRole('searchbox').closest('header')).toBeNull()
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  })
})
