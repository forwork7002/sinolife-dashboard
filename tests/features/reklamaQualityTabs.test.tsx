// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LeadFormSection } from '@/features/reklama/LeadFormSection'
import { QualitySection } from '@/features/reklama/QualitySection'
import type { LeadFormDto, QualityBlockDto, QualityCellsDto } from '@/features/reklama/reklamaApi'

/**
 * «LID SIFATI» AND «FORMALAR · FACEBOOK». The forms were the card's second
 * tab on 2026-10-13 and are their own section under it since 2026-10-14 (the
 * user: «forma deb alohida pastda koʻrsatib turishing kerak»). The day table
 * keeps the client's sheet columns and a share bar; the forms section opens
 * on four tiles and says out loud when no form has been read yet, rather
 * than drawing one «Forma aniqlanmagan» row of dashes.
 */

afterEach(cleanup)

// jsdom has no ResizeObserver; DataTable measures its sticky rows with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
// …nor matchMedia; the forms table pins its identity columns from a tablet up.
window.matchMedia ??= ((query: string) => ({
  matches: true,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia

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
  pageName: null,
  pageId: null,
  status: null,
  createdTime: null,
  totalLeads: null,
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
    render(<QualitySection quality={QUALITY} status="ready" />)
    expect(screen.getByText('Kunlik — barcha sahifalar')).toBeTruthy()
    expect(screen.queryByText('Formalar · Facebook')).toBeNull()
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

})

describe('Formalar · Facebook', () => {
  it('stands on its own: four tiles over the table, counting listed forms only', () => {
    const listed = [
      form({ id: '1', name: 'Collagen FULL', pageId: 'p1', pageName: 'Collagen.marine', status: 'ACTIVE', totalLeads: 166 }),
      form({ id: '2', name: 'Zextra eski', pageId: 'p2', pageName: 'Zextra.uz', status: 'ARCHIVED', totalLeads: 34 }),
    ]
    render(<LeadFormSection forms={[...listed, form()]} status="ready" />)
    // The tiles come before the table, whose headers and chips repeat two of these words.
    const tile = (label: string) => screen.getAllByText(label)[0]!.closest('.card')!.textContent ?? ''
    expect(screen.getByText('Formalar · Facebook')).toBeTruthy()
    expect(tile('Jami formalar')).toContain('2')
    expect(tile('Jami formalar')).toContain('2 ta sahifada')
    expect(tile('Faol emas')).toContain('1')
    expect(tile('Jami lidlar')).toContain('200')
    expect(screen.getByText('Forma aniqlanmagan')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('counts a form found only on an ad under «Ruxsat yoʻq» and names it by its id', () => {
    const closed = form({ id: '2052029759508941', pageId: '468913109633234', pageName: 'Sinolife.uzb', status: 'NO_ACCESS' })
    render(<LeadFormSection forms={[closed]} status="ready" />)
    const tile = (label: string) => screen.getAllByText(label)[0]!.closest('.card')!.textContent ?? ''
    expect(tile('Ruxsat yoʻq')).toContain('1')
    expect(tile('Faol emas')).toContain('0')
    expect(screen.getByText('Nomi oʻqilmadi')).toBeTruthy()
    expect(screen.getByText('2052029759508941')).toBeTruthy()
    // In the page select and on the row.
    expect(screen.getAllByText('Sinolife.uzb').length).toBe(2)
  })

  it('says the forms are not read yet when no row was listed or matched', () => {
    render(<LeadFormSection forms={[form()]} status="ready" />)
    expect(screen.getByRole('status').textContent).toContain('Facebook formalari hali oʻqilmagan.')
  })

  it('says nothing of the token once a form lead was read', () => {
    const crm = form({
      id: '123',
      name: 'Sinolife (UMAR) 777',
      crm: {} as LeadFormDto['crm'],
    })
    render(<LeadFormSection forms={[crm, form()]} status="ready" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
