// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ScopeBadge } from '@/components/layout/ScopeBadge'
import type { Viewer } from '@/lib/viewer'

/**
 * «Sizga nima koʻrinadi» (2026-10-19): a narrowed account is told which
 * screens it reads and whose rows its «Oʻz boʻlimi» screens are cut to —
 * Malika's ROP account, six people, RNP company-wide.
 */

afterEach(cleanup)

const MALIKA: Viewer = {
  userId: 'u-malika',
  role: 'SALES',
  sections: ['confirmation', 'logistics', 'sellers', 'rnp', 'structure', 'margin'],
  dataScope: 'TEAM',
  wideSections: ['rnp'],
  canManageUsers: false,
}

const TEAM = [
  { id: 'e264', fullName: '264 Malika Rahmonova' },
  { id: 'e265', fullName: '265 Ruxshona Qilichova' },
  { id: 'e266', fullName: '266 Stajoʻr' },
  { id: 'e267', fullName: 'Haydarova 267 Muhabbat' },
  { id: 'e268', fullName: '268 Shirin Jaloliddinova' },
  { id: 'e269', fullName: 'Ashurmatova 269 Ruxsora' },
]

function open() {
  fireEvent.click(screen.getByTestId('scope-badge'))
  return screen.getByTestId('scope-panel')
}

describe('ScopeBadge', () => {
  it('draws nothing for a company-wide account', () => {
    const { container } = render(
      <ScopeBadge viewer={{ ...MALIKA, dataScope: 'ALL' }} members={null} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('names the team and its size on the chip', () => {
    render(<ScopeBadge viewer={MALIKA} members={TEAM} />)
    const chip = screen.getByTestId('scope-badge')
    expect(chip.textContent).toContain('Oʻz jamoangiz')
    expect(chip.textContent).toContain('6')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
  })

  it('lists each screen the rail shows with how much of it is read', () => {
    render(<ScopeBadge viewer={MALIKA} members={TEAM} />)
    const rows = within(within(open()).getByTestId('scope-sections')).getAllByRole('listitem')
    const read = Object.fromEntries(
      rows.map((li) => [li.firstChild!.textContent, li.lastChild!.textContent]),
    )
    expect(read).toEqual({
      'Tasdiqlash navbati': 'Oʻz jamoangiz',
      'Logistika natijasi': 'Oʻz jamoangiz',
      'RNP jadvali': 'Butun kompaniya',
      'Kadrlar tuzilmasi': 'Butun kompaniya',
      'Sotuvchilar reytingi': 'Butun kompaniya',
    })
    // «Yalpi marja» is company-only and not wide here: the rail hides it, so
    // the panel must not promise it either.
    expect(screen.getByTestId('scope-sections').textContent).not.toMatch('Yalpi marja')
  })

  it('lists the people of the team', () => {
    render(<ScopeBadge viewer={MALIKA} members={TEAM} />)
    const names = within(within(open()).getByTestId('scope-members'))
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(names).toEqual(TEAM.map((m) => m.fullName))
    expect(screen.getByTestId('scope-panel').textContent).toContain('Jamoangiz · 6 kishi')
  })

  it('says «Faqat oʻzingiz» to an OWN account and lists nobody', () => {
    render(
      <ScopeBadge
        viewer={{ ...MALIKA, dataScope: 'OWN', wideSections: [] }}
        members={[TEAM[0]!]}
      />,
    )
    expect(screen.getByTestId('scope-badge').textContent).toContain('Faqat oʻzingiz')
    expect(open().textContent).not.toMatch('Jamoangiz')
    expect(screen.queryByTestId('scope-members')).toBeNull()
  })

  it('shows a loading line, never a zero, before the people arrive', () => {
    render(<ScopeBadge viewer={MALIKA} members={undefined} />)
    expect(screen.getByTestId('scope-badge').textContent).not.toMatch(/\d/)
    expect(open().textContent).toContain('Yuklanmoqda…')
  })

  it('closes on Escape and gives focus back to the chip', () => {
    render(<ScopeBadge viewer={MALIKA} members={TEAM} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('scope-panel')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('scope-badge'))
  })
})
