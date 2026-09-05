// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { StructureDto } from '@/lib/api'

/**
 * THREE THINGS THE CANVAS GETS WRONG WHEN NOBODY IS WATCHING.
 *
 * The chart is twenty absolutely-positioned cards inside one transformed
 * stage, so every one of these fails silently rather than throwing: a control
 * that needs two clicks, a search box that eats a keystroke, a tree a screen
 * reader cannot walk. All three were live in the first version of this file.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/structure',
  useSearchParams: () => new URLSearchParams(''),
}))

const { OrgChart } = await import('@/features/structure/OrgChart')

function unit(
  id: string,
  name: string,
  depth: number,
  children: StructureDto[] = [],
  isViewerDepartment = false,
): StructureDto {
  return {
    id,
    name,
    depth,
    headName: null,
    head: null,
    ownHeadcount: 1,
    headcount: 1,
    activeHeadcount: 1,
    workingHeadcount: 0,
    subordinateCount: 1,
    memberCount: 1,
    memberNames: [name],
    childCount: children.length,
    sortOrder: 100,
    isViewerDepartment,
    deals: null,
    revenue: null,
    inScope: true,
    children,
  }
}

/** The portal's own shape in miniature: a root, a branch that folds, a leaf. */
const TREE = [
  unit('root', 'NEWGEN', 0, [
    unit('toshkent', 'Тошкент онлайн', 1, [
      unit('me', 'Azizbek(ROP)', 2, [], true),
      unit('other', 'Saida(ROP)', 2),
    ]),
    unit('operatsion', 'Операцион', 1),
  ]),
]

const ids = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-card-id]')].map((e) => e.getAttribute('data-card-id'))

async function frames() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

describe('org chart behaviour', () => {
  /**
   * «Meni topish» USED TO NEED TWO CLICKS.
   *
   * The second level starts folded, so the reader's own unit is usually not in
   * the layout at all when the button is pressed. The reveal read the positions
   * map it had closed over — the one from before the unfold — found nothing,
   * and did nothing; the second press worked because by then the branch was
   * open. That is exactly what somebody reports as "the button is broken".
   */
  it('finds the reader own unit inside a folded branch on the FIRST click', async () => {
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId="me" />,
    )

    // Folded by default: the reader's unit is not drawn yet.
    expect(ids(container)).not.toContain('me')

    await act(async () => {
      fireEvent.click(screen.getByText('Meni topish'))
    })
    await frames()

    expect(ids(container)).toContain('me')
  })

  it('offers no find-me control to an account with no linked employee', () => {
    render(<OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />)
    expect(screen.queryByText('Meni topish')).toBeNull()
  })

  /**
   * SPACE IS A CHARACTER IN THE SEARCH BOX AND A SELECTION ON A CARD.
   *
   * The tree's key handler lives on the canvas, and the search box is inside
   * it. Unscoped, Space in the box was swallowed and selected a department
   * instead of typing, and Home / End / the arrow keys moved the tree rather
   * than the text cursor — on a page whose whole job is finding a name.
   */
  it('leaves the search box its own keys', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={onSelect} viewerDepartmentId={null} />,
    )
    const box = container.querySelector('input[type="search"]')!

    for (const key of [' ', 'ArrowRight', 'ArrowDown', 'Home', 'End', 'Enter']) {
      const notPrevented = fireEvent.keyDown(box, { key })
      expect(notPrevented, `${key} was swallowed by the tree`).toBe(true)
    }
    expect(onSelect).not.toHaveBeenCalled()
  })

  /**
   * `role="tree"` OWNS ITS `treeitem`s.
   *
   * The cards used to sit inside positioning wrappers, so the tree's own
   * children were generic divs — a relationship some screen readers do not
   * follow, which turns a navigable tree into a pile of buttons. The
   * coordinates go on the treeitem itself.
   */
  it('puts treeitems directly under the tree', () => {
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />,
    )
    const tree = container.querySelector('[role="tree"]')!
    expect([...tree.children].map((c) => c.getAttribute('role'))).toEqual(
      Array.from({ length: tree.children.length }, () => 'treeitem'),
    )
    expect(tree.children.length).toBeGreaterThan(0)
  })

  /**
   * ARROW KEYS HAVE TO MOVE DOM FOCUS, NOT JUST THE HIGHLIGHT.
   *
   * The focus effect reached for `.org-card-hit`, which was a button until the
   * card was restructured to satisfy `role="tree"`. As a plain div, `focus()`
   * on it is a no-op — so every arrow key moved the visual state while a
   * screen reader stayed where it was and read nothing.
   */
  it('moves real focus onto the treeitem when the arrow keys move', async () => {
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />,
    )
    const first = container.querySelector('[data-card-id="root"]') as HTMLElement
    first.focus()
    expect(document.activeElement).toBe(first)

    await act(async () => {
      fireEvent.keyDown(first, { key: 'ArrowDown' })
    })
    await frames()

    expect((document.activeElement as HTMLElement)?.getAttribute('data-card-id')).toBe('toshkent')
  })

  /**
   * The panel is docked INSIDE the canvas, which is what keeps the chart from
   * resizing when it opens — and which put it behind the canvas's own
   * pointerdown handler. Every press in the roster started a pan and captured
   * the pointer, so the close button and any attempt to select a name went to
   * the canvas instead.
   */
  it('does not start a pan from inside the department panel', () => {
    const { container } = render(
      <OrgChart
        roots={TREE}
        selectedId="root"
        onSelect={() => {}}
        viewerDepartmentId={null}
        panel={<aside className="org-panel">roster</aside>}
      />,
    )
    const canvas = container.querySelector('.org-canvas') as HTMLElement
    const panel = container.querySelector('.org-panel') as HTMLElement
    // jsdom has no pointer capture; the handler must bail before reaching it.
    canvas.setPointerCapture = () => {}

    fireEvent.pointerDown(panel, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    expect(canvas.dataset.panning).toBeUndefined()

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 10, clientY: 10 })
    expect(canvas.dataset.panning).toBe('true')
  })

  /**
   * A «?dep=» LINK HAS TO SHOW THE CARD, NOT JUST THE PANEL.
   *
   * "This is the team, look" is a link somebody pastes into a chat. The
   * selection used to reach only the panel: the recipient got a roster over the
   * default folded tree, with the unit it described nowhere on screen and
   * nothing selected anywhere in the chart.
   */
  it('unfolds and selects a department that arrived in the URL', () => {
    const { container } = render(
      <OrgChart roots={TREE} selectedId="me" onSelect={() => {}} viewerDepartmentId={null} />,
    )
    expect(ids(container)).toContain('me')
    expect(container.querySelector('[data-card-id="me"]')!.getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  /**
   * SEARCHING A PERSON IS THE POINT OF THE SCREEN.
   *
   * The client asked for this page so the floor could see who works under whom,
   * and the first thing a seller types is their own name. Matching only the
   * unit and its head answered «topilmadi» over a dimmed company while their
   * row sat two clicks away in the panel.
   */
  it('finds a department by one of its people', async () => {
    const withPeople = [
      unit('root', 'NEWGEN', 0, [
        { ...unit('sales', 'Sevinch(ROP)', 1), memberNames: ['Malika Mahmudova'] },
        unit('ops', 'Операцион', 1),
      ]),
    ]
    const { container, unmount } = render(
      <OrgChart roots={withPeople} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />,
    )
    const box = container.querySelector('input[type="search"]')!

    await act(async () => {
      fireEvent.change(box, { target: { value: 'malika' } })
      // SearchInput debounces by 350 ms before it commits.
      await new Promise((r) => setTimeout(r, 420))
    })

    expect(container.querySelector('[data-card-id="sales"]')!.getAttribute('data-matched')).toBe(
      'true',
    )
    expect(container.querySelector('[data-card-id="ops"]')!.getAttribute('data-dimmed')).toBe('true')

    // Unmounted here rather than left to cleanup: the debounce timer outlives
    // the assertions, and a commit landing after the next test has rendered
    // empties ITS container instead of this one.
    unmount()
  })

  /**
   * «Hammasini ochish» used to be one-way: fully open, this portal's tree is
   * 4 332 units wide, and the only way back to the readable default was
   * folding twenty units by hand.
   */
  it('turns the expand-all control into a fold-back control', async () => {
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />,
    )
    const button = () =>
      [...container.querySelectorAll('button')].find((b) =>
        /Hammasini/.test(b.textContent ?? ''),
      )!

    expect(button().textContent).toContain('Hammasini ochish')
    await act(async () => {
      fireEvent.click(button())
    })

    expect(ids(container)).toContain('me')
    expect(button().textContent).toContain('Hammasini yopish')

    await act(async () => {
      fireEvent.click(button())
    })
    expect(ids(container)).not.toContain('me')
  })

  /**
   * CLICKING A CARD MUST NOT MOVE THE CHART UNDER THE CURSOR.
   *
   * The layout effect flies to a selection it has not seen before, which is
   * what makes a pasted «?dep=» link land on its card. A click sets the same
   * state, so without claiming it the chart also flew to the card the reader
   * had just clicked — sliding the whole tree sideways and, on a full-height
   * canvas, pushing the root up behind the floating toolbar.
   */
  it('leaves the viewport alone when a card is clicked', async () => {
    const { container, rerender } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />,
    )
    const stage = container.querySelector('.org-stage') as HTMLElement
    const before = stage.style.transform

    await act(async () => {
      fireEvent.click(container.querySelector('[data-card-id="operatsion"]')!)
    })
    // The page re-renders with the selection the click asked for.
    rerender(
      <OrgChart roots={TREE} selectedId="operatsion" onSelect={() => {}} viewerDepartmentId={null} />,
    )
    await frames()

    expect(stage.style.transform).toBe(before)
  })

  /** One tab stop for the whole chart, wherever the selection currently is. */
  it('keeps exactly one card in the tab order', () => {
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={() => {}} viewerDepartmentId={null} />,
    )
    const stops = [...container.querySelectorAll('[role="treeitem"]')].filter(
      (e) => e.getAttribute('tabindex') === '0',
    )
    expect(stops).toHaveLength(1)
  })

  /**
   * The fold control and the card are two intentions.
   *
   * Clicking «2 boʻlim» opens the branch; it must not also open the panel, or
   * every attempt to look inside a branch would replace the chart's right-hand
   * third with a roster the reader did not ask for.
   */
  it('folds a branch without selecting it', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <OrgChart roots={TREE} selectedId={null} onSelect={onSelect} viewerDepartmentId={null} />,
    )
    const foot = container.querySelector('[data-card-id="toshkent"] .org-card-foot-btn')!

    fireEvent.click(foot)
    expect(onSelect).not.toHaveBeenCalled()
    expect(ids(container)).toContain('me')
  })
})
