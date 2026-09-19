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
