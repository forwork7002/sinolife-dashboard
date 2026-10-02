import { describe, expect, it } from 'vitest'

import { adBudgetProduct, ownerOf } from '@/server/integrations/meta/accounts'

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

  it('leaves out a hiring campaign, wherever it runs', () => {
    expect(adBudgetProduct(row({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'EX - Sinolife (vakansiya) - DM' }))).toBeNull()
    expect(adBudgetProduct(row({ objective: 'OUTCOME_ENGAGEMENT', campaignName: 'EX - TOF - Vacancy - 19.09' }))).toBeNull()
    expect(adBudgetProduct(row({ accountId: '1657709689205277', accountName: 'HR Eldor' }))).toBeNull()
  })

  it('leaves out an account that is neither Collagen nor Zextra', () => {
    expect(adBudgetProduct(row({ accountId: '1306271057053174', accountName: 'Newgen_davi01' }))).toBeNull()
    expect(adBudgetProduct(row({ accountId: '517245084208402', accountName: 'Kosmetika Eldor' }))).toBeNull()
  })
})
