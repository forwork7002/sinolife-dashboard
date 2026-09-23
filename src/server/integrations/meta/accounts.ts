/**
 * Which targetolog, and which product, each Meta ad account belongs to.
 *
 * The client's «Лид база» sheet has one column per targetolog per product.
 * Meta knows neither — an account is only an id and a name somebody typed —
 * so the mapping is stated here, checked against that sheet on 2026-09-19:
 * July 2026 per account against the sheet's July totals. Exact for Элдор
 * (Collagen 13 283,9 $ = «Collagen marine Eldor» + «Sinolife family Eldor»;
 * Zextra 3 368,3 $), Umar (5 100,3 $ / 1 206,2 $), Sobirjon Zextra
 * (3 544,7 $) and Kamron (4 462,6 $). Timur's two columns did NOT reconcile
 * (Zextra 4 846,7 $ here against 5 353,4 $ in the sheet) — to be checked with
 * the client; the first days of the month match to the cent.
 *
 * Read at query time, never stored: correcting a row here corrects history
 * without a re-import. An account missing from this list is still counted —
 * under «Boshqa», by its own name — so a new account cannot silently vanish
 * from the spend total.
 *
 * The sheet also has columns no account behind this token covers: Аббос
 * (Zextra), Sobirjon's July Collagen spend, «Organic» and «Telegram».
 */

import type { TargetProduct } from '@/server/domain/types'

/** «Boshqa» — an account nobody has mapped yet, still counted. */
export type MetaProduct = TargetProduct | 'Boshqa'

export interface MetaAccountOwner {
  readonly product: MetaProduct
  readonly targetolog: string
}

export const META_ACCOUNT_OWNERS: Readonly<Record<string, MetaAccountOwner>> = Object.freeze({
  '1383613729264521': { product: 'Collagen', targetolog: 'Элдор' }, // Collagen marine Eldor
  '714191238260025': { product: 'Collagen', targetolog: 'Элдор' }, // Sinolife family Eldor
  '1794735288825705': { product: 'Collagen', targetolog: 'Элдор' }, // Collagen Eldor
  '990016692137088': { product: 'Collagen', targetolog: 'Umar' }, // Umar - 64
  '1312865112943517': { product: 'Collagen', targetolog: 'Umar' }, // Umar 63
  '918980186027789': { product: 'Collagen', targetolog: 'Timur' }, // Timuro - Sinolife 32
  '811360967277832': { product: 'Collagen', targetolog: 'Timur' }, // Timuro - Sinolife 56
  '2804901113001448': { product: 'Collagen', targetolog: 'Sobirjon' }, // Collagen Sobirjon #2
  '440763388459898': { product: 'Zextra', targetolog: 'Элдор' }, // Zextra Eldor
  '1397516862583896': { product: 'Zextra', targetolog: 'Элдор' }, // Zextra Eldor (2)
  '440073592484616': { product: 'Zextra', targetolog: 'Umar' }, // Zextra Umar
  '658227179132894': { product: 'Zextra', targetolog: 'Timur' }, // Timuro - zextra - 66
  '4401744916740587': { product: 'Zextra', targetolog: 'Sobirjon' }, // Zextra Sobirjon
  '926218346480236': { product: 'Zextra', targetolog: 'Kamron' }, // Zextra Kamron 1
})

export function ownerOf(accountId: string, accountName: string): MetaAccountOwner {
  return META_ACCOUNT_OWNERS[accountId] ?? { product: 'Boshqa', targetolog: accountName }
}

/**
 * Which of the client's sheets a campaign's money belongs on.
 *
 *   form   — «Отчёт Т», the targetolog's lead-form campaigns (OUTCOME_LEADS).
 *            Checked against the sheet on 02–04.09.2026: Umar's two Collagen
 *            accounts' OUTCOME_LEADS spend is 189.1 / 229.9 / 200.1 $ against
 *            the sheet's 189.0 / 229.8 / 200.0 $.
 *   dm     — «DM», the Instagram-message campaigns (OUTCOME_ENGAGEMENT).
 *            Checked on 01–04.08.2026: Collagen's DM spend less the hiring
 *            campaign is 142.6 / 232.8 / 185.1 / 159.5 $ against the sheet's
 *            142.7 / 231.7 / 184.7 / 159.0 $ — within Meta's own later
 *            revisions of a day.
 *   hiring — a DM campaign that recruits staff, not customers
 *            («EX - Sinolife (vakansiya) - DM»). On neither sheet; that one
 *            campaign is exactly the gap between Meta's DM total and the
 *            sheet's on 01.08 (7.4 $).
 *   other  — traffic, awareness, sales objectives: on neither sheet, still
 *            counted in the grand total so no dollar vanishes.
 *
 * Read at query time from the objective and name stored per row, so moving a
 * campaign between sheets corrects history without a re-import.
 */
export type CampaignChannel = 'form' | 'dm' | 'hiring' | 'other'

const HIRING = /vakans|вакан|ishga\s+olish|\bhr\b/i

export function campaignChannel(objective: string, name: string): CampaignChannel {
  if (HIRING.test(name)) return 'hiring'
  if (objective === 'OUTCOME_LEADS' || objective === 'LEAD_GENERATION') return 'form'
  if (objective === 'OUTCOME_ENGAGEMENT' || objective === 'MESSAGES') return 'dm'
  return 'other'
}

/**
 * The Instagram page a product's DM money is shown against, by portal
 * SOURCE_ID. The «DM» sheet puts all of Collagen's DM spend on «sinolifeuz»
 * and none on «sinolife_otziv». It leaves «zextrauzb» at 0 $, though Umar
 * runs a Zextra DM campaign (~100 $ in August); that money is shown on
 * «zextrauzb» rather than dropped. The ads cannot say which page they ran on
 * without the `ads_management` budget (see metaImport.ts), so the page is
 * stated here. An unmapped account's DM money has no page and is reported
 * as such, never folded into one.
 */
export const DM_PAGE_OF_PRODUCT: Readonly<Record<TargetProduct, string>> = Object.freeze({
  Collagen: 'UC_1X1J24', // sinolifeuz
  Zextra: 'UC_A8LE21', // zextrauzb
})
