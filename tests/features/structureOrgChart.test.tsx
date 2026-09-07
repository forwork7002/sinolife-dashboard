// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { StructureDto } from '@/lib/api'

/**
 * THE CARD IS A MIRROR OF A SCREEN THE CLIENT ALREADY READS.
 *
 * `/structure` reproduces `obey.bitrix24.kz/hr/structure/`, and the floor
 * checks its figures against that page. Three of its rules produce a
 * plausible-looking card when they break rather than an error, which is why
 * they are pinned here rather than left to the eye:
 *
 *  - a head the portal does not list IN the unit gets no head row at all;
 *  - the subordinate count is the portal's, not this dashboard's headcount;
 *  - money that the reader may not see is ABSENT, never zero.
 */

// The card reads no URL, but Controls and the shell it lives beside do; the
// mock keeps an accidental import from pulling the router into a unit test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/structure',
  useSearchParams: () => new URLSearchParams(''),
}))

const { OrgCard } = await import('@/features/structure/OrgCard')

function node(over: Partial<StructureDto> = {}): StructureDto {
  return {
    id: 'dep-1',
    name: 'Sevinch(ROP)',
    depth: 2,
    headName: 'Usmonova 199 Sevinch',
    head: {
      id: 'emp-58',
      name: 'Usmonova 199 Sevinch',
      position: 'Boʻlim boshligʻi',
      managesCount: 13,
    },
    ownHeadcount: 14,
    headcount: 14,
    activeHeadcount: 14,
    subordinateCount: 13,
    memberCount: 14,
    memberNames: ['Usmonova 199 Sevinch'],
    childCount: 0,
    sortOrder: 100,
    isViewerDepartment: false,
    inScope: true,
    children: [],
    ...over,
  }
}

function paint(over: Partial<StructureDto> = {}, props: Partial<Parameters<typeof OrgCard>[0]> = {}) {
  return render(
    <OrgCard
      node={node(over)}
      x={0}
      y={0}
      width={236}
      height={152}
      selected={false}
      collapsed={false}
      matched={false}
      dimmed={false}
      onSelect={() => {}}
      onToggle={() => {}}
      onHover={() => {}}
      index={1}
      total={6}
      tabbable
      onChain={false}
      {...props}
    />,
  )
}

describe('org chart card', () => {
  it('prints the portal subordinate count, not the dashboard headcount', () => {
    // 14 people are attached here and 13 of them report to the fourteenth.
    // The portal's card says «13 сотрудников»; printing `activeHeadcount`
    // would say 14 and be one out on every card on the screen.
    paint()
    expect(screen.getByText('13 xodim')).toBeTruthy()
    expect(screen.queryByText('14 xodim')).toBeNull()
  })

  it('shows the head with the number they manage across the whole branch', () => {
    paint()
    expect(screen.getByText('Usmonova 199 Sevinch')).toBeTruthy()
    expect(screen.getByText('13')).toBeTruthy()
  })

  /**
   * «Навоий» names UF_HEAD = Мурод Содиков, whose own two units are
   * «Kompaniya(ROP)» and «Тошкент онлайн». The portal draws that card with no
   * head row rather than seating him in a unit his own record does not name,
   * so the service sends `head: null` and the card has to honour it — even
   * though `headName` is still on the DTO for anyone who needs the raw field.
   */
  it('draws no head row for a head the portal does not list in the unit', () => {
    paint({ head: null, headName: 'Содиков Мурод' })
    expect(screen.queryByText('Содиков Мурод')).toBeNull()
    expect(screen.getByText('Rahbar tayinlanmagan')).toBeTruthy()
  })

  it('says a unit has no children rather than printing an empty control', () => {
    paint({ childCount: 0 })
    expect(screen.getByText('boʻysunuvchi boʻlim yoʻq')).toBeTruthy()

    paint({ childCount: 6 })
    expect(screen.getByText('6 boʻlim')).toBeTruthy()
  })

  /**
   * NO MONEY ANYWHERE ON THIS CARD, and it is a claim about the whole screen.
   *
   * The card carried the unit's revenue over the reporting window until the
   * client moved money onto Boshqaruv markazi and this page lost its window
   * with it. A figure in soʻm reappearing here would be a second, undated
   * statement of the company's revenue on the one screen the whole floor opens
   * — so this asserts on rendered text rather than on a class name, which a
   * rename would quietly satisfy.
   */
  it('prints no money at all', () => {
    const { container } = paint()
    expect(container.querySelector('.org-card-money')).toBeNull()
    expect(screen.queryByText(/soʻm|mln|mlrd|bitim/)).toBeNull()
  })

  /**
   * THE ROOM THE MONEY LEFT GOES TO THE PEOPLE.
   *
   * «har bir sotuvchi bilishi kerak kim kimlar borligini» is half of what this
   * page was asked for, and it was answered one unit at a time by opening a
   * panel. The names already ride the tree's payload for the search box, so
   * this costs no request — and the overflow is counted out loud, because five
   * faces over a unit of fourteen would be a wrong answer to the question the
   * strip exists to answer.
   */
  it('shows the team as faces, and says how many it did not fit', () => {
    // subordinateCount is 13 on this fixture: five faces shown, eight more.
    const { container } = paint({
      memberNames: ['Aziz', 'Bekzod', 'Charos', 'Dilnoza', 'Elyor', 'Farrux'],
      memberCount: 14,
    })
    expect(container.querySelectorAll('.org-card-chip')).toHaveLength(5)
    expect(screen.getByText('+8')).toBeTruthy()
  })

  /**
   * THE HEAD IS NOT ONE OF THE FACES, AND THE COUNT IS THE CAPTION'S.
   *
   * The head has their own row two lines up, and the caption over the strip
   * prints «Boʻysunuvchilar» — the portal's count, which excludes them. Drawn
   * straight from `memberNames` the strip showed the head's initials twice on
   * one card and one face more than the number printed above it.
   */
  it('leaves the head out of the strip and counts against the subordinate figure', () => {
    const { container } = paint({
      memberNames: ['Usmonova 199 Sevinch', 'Aziz', 'Bekzod'],
      memberCount: 3,
      subordinateCount: 2,
    })
    expect(container.querySelectorAll('.org-card-chip')).toHaveLength(2)
    expect(screen.queryByText(/^\+\d/)).toBeNull()
  })

  it('draws no strip and no overflow count for a unit with nobody in it', () => {
    const { container } = paint({ memberNames: [], memberCount: 0 })
    expect(container.querySelector('.org-card-people')).toBeNull()
  })

  /**
   * THE CHAIN OF COMMAND, DRAWN.
   *
   * `data-chain` lights every unit from the card the reader is pointing at up
   * to the company root. It is a separate state from `data-selected` and both
   * are in the forced-colours block for the same reason: the one thing this
   * screen exists to show is carried by colour, and colour is what that mode
   * discards.
   */
  it('marks a card that is on the highlighted chain', () => {
    const { container } = paint({}, { onChain: true })
    expect(container.querySelector('[data-chain]')).toBeTruthy()
    expect(container.querySelector('[data-selected]')).toBeNull()
  })

  it('carries the tree semantics a keyboard reader navigates by', () => {
    const { container } = paint({ childCount: 6 }, { collapsed: true })
    const item = container.querySelector('[role="treeitem"]')!
    expect(item.getAttribute('aria-level')).toBe('3')
    expect(item.getAttribute('aria-posinset')).toBe('1')
    expect(item.getAttribute('aria-setsize')).toBe('6')
    expect(item.getAttribute('aria-expanded')).toBe('false')
  })

  /** A leaf is not a collapsed branch: `aria-expanded` on it would announce a
   *  control that is not there. */
  it('omits aria-expanded on a unit with no children', () => {
    const { container } = paint({ childCount: 0 })
    expect(container.querySelector('[role="treeitem"]')!.hasAttribute('aria-expanded')).toBe(false)
  })

  /**
   * ROVING TABINDEX: one stop for the whole tree, not one per card.
   *
   * Twenty focusable cards would put twenty tab stops between the search box
   * and the zoom control. The arrow keys steer inside the tree; Tab reaches it
   * once and leaves.
   */
  it('takes an untabbable card out of the tab order entirely', () => {
    const { container } = paint({ childCount: 3 }, { tabbable: false })
    expect(container.querySelector('[role="treeitem"]')!.getAttribute('tabindex')).toBe('-1')
    // The fold control is never a tab stop: in a tree that is ArrowLeft/Right.
    for (const button of container.querySelectorAll('button')) {
      expect(button.getAttribute('tabindex')).toBe('-1')
    }
  })

  /**
   * THE TREEITEM IS THE FOCUSABLE ELEMENT, NOT A BUTTON INSIDE IT.
   *
   * A nested button is announced as a button, which throws away the level, the
   * position among siblings and the expanded state — everything that makes a
   * tree navigable. It also has to carry its own coordinates, because
   * `role="tree"` owns its treeitems and a positioning div between them is a
   * relationship some screen readers do not follow.
   */
  it('is itself the focusable, positioned element', () => {
    const { container } = paint({}, { tabbable: true })
    const item = container.querySelector('[role="treeitem"]') as HTMLElement
    expect(item.getAttribute('tabindex')).toBe('0')
    expect(item.style.position === '' || item.style.position === 'absolute').toBe(true)
    expect(item.getAttribute('data-card-id')).toBe('dep-1')
    // No focusable descendant competing with it for the one stop.
    expect(item.querySelector('[tabindex="0"]')).toBeNull()
  })

  it('badges the reader own unit', () => {
    paint({ isViewerDepartment: true })
    expect(screen.getByText('SIZ')).toBeTruthy()
  })
})
