// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { QualitySection } from '@/features/reklama/QualitySection'
import type { LeadFormDto, QualityBlockDto, QualityCellsDto } from '@/features/reklama/reklamaApi'

/**
 * «LID SIFATI» — ONE CARD, TWO TABS (2026-10-13, the user: «ikkisini
 * birlashtirib yubor»). «Kunlik — barcha sahifalar» and «Formalar · Meta»
 * were two sections; they are now the two readings of one card. The day
 * table keeps the client's sheet columns and gains a share bar; the forms
 * tab says out loud when Meta's form leads are not being read, rather than
 * drawing one «Forma aniqlanmagan» row of dashes.
 */

afterEach(cleanup)

// jsdom has no ResizeObserver; DataTable measures its sticky rows with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const cells = (over: Partial<QualityCellsDto> = {}): QualityCellsDto => ({
  leads: 72,
  noAnswer: 5,
  lowQuality: 9,
  success: 18,
  duplicate: 17,
  open: 23,
  successPercent: 25,
  ...over,
})

// 01.10.2026 on the portal: 72 leads, 5 / 9 / 18 / 17 / 23.
const QUALITY: QualityBlockDto = {
  total: cells(),
  days: [{ date: '2026-10-01', ...cells() }],
  pages: [
    {
      key: 'UC_1X1J24',
      name: 'sinolifeuz',
      product: 'Collagen',
      total: cells(),
      days: [{ date: '2026-10-01', ...cells() }],
    },
  ],
  stages: [{ stage: 'Сделка успешна', bucket: 'success', leads: 18 }],
}

const form = (over: Partial<LeadFormDto> = {}): LeadFormDto => ({
  id: '',
  name: '',
  targetolog: 'Timur',
  product: 'Collagen',
  accounts: ['Timuro - Sinolife 32'],
  campaigns: 4,
  spendUsd: 19835,
  metaLeads: 14009,
  costPerLeadUsd: 1.42,
  impressions: 9_000_000,
  clicks: 121746,
  ctrPercent: 1.3,
  activeDays: 13,
  lastActive: '2026-10-13',
  crm: null,
  ...over,
})

describe('Lid sifati', () => {
  it('opens on the day table, with the sheet columns and a share bar per row', () => {
    render(<QualitySection quality={QUALITY} forms={[form()]} status="ready" />)
    expect(screen.getByText('Kunlik — barcha sahifalar')).toBeTruthy()
    for (const header of [
      'Недозвон',
      'Sifatsiz',
      'Kval (успешный)',
      'Dubl',
      'Jarayonda',
      'Jami lid',
      'Kval %',
      'Taqsimot',
    ]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0)
    }
    // The bar states every share, so it reads without colour.
    const bars = screen.getAllByRole('img')
    expect(bars[0]!.getAttribute('aria-label')).toBe(
      'Kval 25.0%, Недозвон 6.9%, Sifatsiz 12.5%, Dubl 23.6%, Jarayonda 31.9%',
    )
  })

  it('switches to the forms and says why every form row is dashes when no Meta form lead was read', () => {
    render(<QualitySection quality={QUALITY} forms={[form()]} status="ready" />)
    fireEvent.click(screen.getByRole('button', { name: 'Formalar · Meta (1)' }))
    expect(screen.queryByText('Kunlik — barcha sahifalar')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Meta’dan forma lidlari oʻqilmayapti.')
    expect(screen.getByText('Forma aniqlanmagan')).toBeTruthy()
  })

  it('says nothing of the token once a form lead was read', () => {
    const crm = form({
      id: '123',
      name: 'Sinolife (UMAR) 777',
      crm: {} as LeadFormDto['crm'],
    })
    render(<QualitySection quality={QUALITY} forms={[crm, form()]} status="ready" />)
    fireEvent.click(screen.getByRole('button', { name: 'Formalar · Meta (2)' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
