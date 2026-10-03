import { describe, expect, it } from 'vitest'

import { adBudgetProduct, campaignChannel, ownerOf } from '@/server/integrations/meta/accounts'

/*
  The one filter behind two screens' ad budget: the RNP sheet's «Жами бюджет»
  and the «Квал лид нархи $» tile on «Lidlar».
*/
const row = (over: Partial<Parameters<typeof adBudgetProduct>[0]> = {}) => ({
  accountId: '1312865112943517', // Umar 63 · Collagen
  accountName: 'Umar 63',
  objective: 'OUTCOME_LEADS',
  campaignName: '11/09 A',
  ...over,
})

describe('adBudgetProduct', () => {
  it('counts a mapped account’s lead-form and DM money under its product', () => {
    expect(adBudgetProduct(row())).toBe('Collagen')
    expect(adBudgetProduct(row({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'DM' }))).toBe('Collagen')
  })

  it('puts the «Umar (Zextra)» account on Umar · Zextra, not a row of its own', () => {
    expect(ownerOf('1766424904604300', 'Umar (Zextra)')).toEqual({ product: 'Zextra', targetolog: 'Umar' })
    expect(adBudgetProduct(row({ accountId: '1766424904604300', accountName: 'Umar (Zextra)' }))).toBe('Zextra')
  })

  it('puts the client\'s AI targetolog on Collagen, not «Boshqa» (2026-10-02)', () => {
    expect(ownerOf('1052133867828964', 'Collagen AI Targetolog')).toEqual({ product: 'Collagen', targetolog: 'AI targetolog' })
    expect(adBudgetProduct(row({ accountId: '1052133867828964', accountName: 'Collagen AI Targetolog' }))).toBe('Collagen')
    // The account the map once named for it is a reserve now, and nobody's yet.
    expect(ownerOf('4016900891780426', 'Zapas Collagen')).toEqual({ product: 'Boshqa', targetolog: 'Zapas Collagen' })
  })

  it('leaves out a hiring campaign, wherever it runs', () => {
    expect(adBudgetProduct(row({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'EX - Sinolife (vakansiya) - DM' }))).toBeNull()
    expect(adBudgetProduct(row({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'EX - TOF - Vacancy - 19.09' }))).toBeNull()
    expect(adBudgetProduct(row({ accountId: '1657709689205277', accountName: 'HR Eldor' }))).toBeNull()
  })

  it("knows a vacancy named in English (2026-10-02: 123 $ of September sat in Collagen's budget)", () => {
    const eldor = { accountId: '1794735288825705', accountName: 'Collagen Eldor', objective: 'OUTCOME_ENGAGEMENT' }
    expect(adBudgetProduct(row({ ...eldor, campaignName: 'EX - TOF - Vacancy - 19.09' }))).toBeNull()
    expect(adBudgetProduct(row({ ...eldor, campaignName: 'EX - TOF - Vacancy - 19.09 — Копия' }))).toBeNull()
    expect(campaignChannel('OUTCOME_ENGAGEMENT', 'EX - TOF - Vacancy - 19.09', '1794735288825705')).toBe('hiring')
    // The Collagen campaigns of the same account still count.
    expect(adBudgetProduct(row({ ...eldor, campaignName: 'Collagen - DM - 29.09' }))).toBe('Collagen')
  })

  it("counts the client's AI targetolog account under Collagen (2026-10-02)", () => {
    expect(ownerOf('1052133867828964', 'Collagen AI Targetolog')).toEqual({ product: 'Collagen', targetolog: 'AI targetolog' })
    expect(adBudgetProduct(row({ accountId: '1052133867828964', accountName: 'Collagen AI Targetolog', campaignName: "Sinolife | Collagen | Barter blogger kakaoli ta'm | 29.09" }))).toBe('Collagen')
    // The id first mapped as its account is the spare «Zapas Collagen»: left unmapped until the client says whose it is.
    expect(ownerOf('4016900891780426', 'Zapas Collagen').product).toBe('Boshqa')
  })

  it('leaves out an account that is neither Collagen nor Zextra', () => {
    expect(adBudgetProduct(row({ accountId: '1306271057053174', accountName: 'Newgen_davi01' }))).toBeNull()
    expect(adBudgetProduct(row({ accountId: '517245084208402', accountName: 'Kosmetika Eldor' }))).toBeNull()
  })
})
