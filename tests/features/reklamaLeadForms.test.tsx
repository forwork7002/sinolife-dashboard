// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { LeadFormTable } from '@/features/reklama/LeadFormSection'
import type { LeadFormDto } from '@/features/reklama/reklamaApi'

/**
 * «Formalar · Meta» (2026-10-13, in «Kampaniyalar»' place) — every form as
 * Facebook lists it: page, status, created, Meta's all-time leads, then the
 * window. A quiet form is a row; a figure a form lacks sinks either way.
 */

beforeAll(() => {
  // DataTable's pinned columns measure with one; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // jsdom has no matchMedia: a desk-sized window, so both identity columns are pinned.
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

const form = (o: Partial<LeadFormDto> & Pick<LeadFormDto, 'id' | 'name'>): LeadFormDto => ({
  pageName: 'Collagen.marine',
  pageId: '505586455975439',
  status: 'ACTIVE',
  createdTime: '2026-10-02T09:00:00.000Z',
  totalLeads: 166,
  targetolog: null,
  product: 'Boshqa',
  accounts: [],
  campaigns: 0,
  spendUsd: 0,
  metaLeads: 0,
  costPerLeadUsd: null,
  impressions: 0,
  clicks: 0,
  ctrPercent: null,
  activeDays: 0,
  lastActive: null,
  crm: null,
  ...o,
})

const FORMS = [
  form({ id: 'f1', name: 'Collagen FULL (UMAR)', targetolog: 'Umar', product: 'Collagen', accounts: ['Umar - 64'], spendUsd: 40, metaLeads: 20 }),
  form({ id: 'f2', name: 'Zextra qisqa forma', pageName: 'Zextra Uzbekistan', pageId: '1262982140221068', totalLeads: 25 }),
  form({ id: 'f3', name: 'Lipps eski', status: 'ARCHIVED', createdTime: null, totalLeads: null }),
  form({ id: '', name: '', pageName: null, pageId: null, status: null, createdTime: null, totalLeads: null, spendUsd: 5 }),
]

const order = () =>
  screen
    .getAllByRole('rowheader')
    .map((cell) => ['Collagen FULL', 'Zextra qisqa', 'Lipps eski', 'Forma aniqlanmagan'].find((n) => cell.textContent?.startsWith(n)))

const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement

describe('LeadFormSection — the forms as Facebook lists them', () => {
  it('reads like SinoTarget: Sahifa, Forma nomi, Holati, Yaratilgan sana, Jami lidlar — a quiet form included', () => {
    render(<LeadFormTable forms={FORMS} status="ready" />)
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '')
    expect(heads.slice(0, 5).map((h) => h.trim())).toEqual(['Sahifa', 'Forma nomi', 'Holati', 'Yaratilgan sana', 'Jami lidlar'])
    for (const h of ['Sarf', 'Kval narxi']) expect(heads.some((text) => text.startsWith(h))).toBe(true)
    const zextra = screen.getAllByRole('row').find((tr) => tr.textContent?.includes('Zextra qisqa forma'))!
    expect(zextra.textContent).toContain('Zextra Uzbekistan')
    expect(zextra.textContent).toContain('1262982140221068')
    expect(zextra.textContent).toContain('Faol')
    expect(zextra.textContent).toContain('25')
    const archived = screen.getAllByRole('row').find((tr) => tr.textContent?.includes('Lipps eski'))!
    expect(archived.textContent).toContain('Faol emas')
  })

  it('opens on «Tartib: Holati» — every Faol form first, the newest on top', () => {
    const newer = form({ id: 'f4', name: 'Zextra yangi', createdTime: '2026-10-08T09:00:00.000Z' })
    render(<LeadFormTable forms={[...FORMS, newer]} status="ready" />)
    expect(select('Tartib').value).toBe('status')
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent ?? '')
    expect(names[0]).toContain('Zextra yangi')
    expect(names.slice(0, 3).every((n) => !n.includes('Lipps eski'))).toBe(true)
    expect(names.at(-1)).toContain('Forma aniqlanmagan')
  })

  it('narrows by status and by page, offering only what is present', () => {
    render(<LeadFormTable forms={FORMS} status="ready" />)
    expect([...select('Holati').options].map((o) => o.text)).toEqual(['Hammasi', 'Faol', 'Faol emas'])
    fireEvent.change(select('Holati'), { target: { value: 'ARCHIVED' } })
    expect(order()).toEqual(['Lipps eski'])
    fireEvent.change(select('Holati'), { target: { value: 'all' } })
    fireEvent.change(select('Sahifa'), { target: { value: '1262982140221068' } })
    expect(order()).toEqual(['Zextra qisqa'])
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '1 ta forma')).toBeTruthy()
  })

  it('falls back to «Hammasi» when a new answer no longer has the chosen status', () => {
    const { rerender } = render(<LeadFormTable forms={FORMS} status="ready" />)
    fireEvent.change(select('Holati'), { target: { value: 'ARCHIVED' } })
    rerender(<LeadFormTable forms={FORMS.filter((f) => f.status !== 'ARCHIVED')} status="ready" />)
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '3 ta forma')).toBeTruthy()
    expect(select('Holati').value).toBe('all')
  })

  it('keeps a form with no Meta count last on «Jami lidlar», whichever way it is sorted', () => {
    render(<LeadFormTable forms={FORMS} status="ready" />)
    fireEvent.change(select('Tartib'), { target: { value: 'total' } }) // most first
    expect(order().slice(0, 2)).toEqual(['Collagen FULL', 'Zextra qisqa'])
    expect(order().slice(2).sort()).toEqual(['Forma aniqlanmagan', 'Lipps eski'])
    fireEvent.click(screen.getByRole('button', { name: /Jami lidlar/ }))
    expect(order().slice(0, 2)).toEqual(['Zextra qisqa', 'Collagen FULL'])
  })
})
