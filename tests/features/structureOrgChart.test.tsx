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
    workingHeadcount: 9,
    subordinateCount: 13,
    memberCount: 14,
    memberNames: ['Usmonova 199 Sevinch'],
    childCount: 0,
    sortOrder: 100,
    isViewerDepartment: false,
    deals: 34,
    revenue: { amountMinor: '1240000000', amount: 12_400_000, currency: 'UZS' },
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
      index={1}
      total={6}
      tabbable
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
   * MONEY IS WITHHELD, NOT ZEROED.
   *
   * An OWN-scoped salesperson is meant to open this screen — it is what the
   * client asked it to be wired to the floor for — and the service sends null
   * for every money field. A «0 soʻm» beside a department that closed a
   * billion is a lie, and a «—» still says the figure exists.
   */
  it('renders no money line at all when the reader may not see money', () => {
    const { container } = paint({ revenue: null, deals: null })
    expect(container.querySelector('.org-card-money')).toBeNull()
    expect(screen.queryByText(/soʻm|mln|bitim/)).toBeNull()
  })

  it('renders the money line when the reader may see it', () => {
    const { container } = paint()
    expect(container.querySelector('.org-card-money')).toBeTruthy()
    expect(screen.getByText(/bitim/)).toBeTruthy()
  })

  /**
   * Zero revenue is a MEASUREMENT and says so; null is an absence and says
   * nothing. The two must not render the same way — that distinction is the
   * whole reason the DTO carries null rather than 0.
   */
  it('distinguishes a unit that earned nothing from one whose money is hidden', () => {
    paint({ revenue: { amountMinor: '0', amount: 0, currency: 'UZS' }, deals: 0 })
    expect(screen.getByText('Davr ichida tushum yoʻq')).toBeTruthy()
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
