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
 * from the spend total. The product budgets are another matter: RNP's and
 * «Lidlar»'s count only Collagen and Zextra (`adBudgetProduct`), so a new
 * product account reaches them only once it is mapped here.
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
  /*
    Three accounts the token gained after 2026-09-19, mapped by the name their
    owner gave them (read through the Meta MCP on 2026-09-25). «Zextra Kamron
    3» was spending that week (~95 Meta leads). «Newgen_davi01» names nobody
    and stays «Boshqa» until the client says whose.
  */
  '1075542260705572': { product: 'Zextra', targetolog: 'Kamron' }, // Zextra Kamron 2
  '1356045995688768': { product: 'Zextra', targetolog: 'Kamron' }, // Zextra Kamron 3
  '1592588735796463': { product: 'Zextra', targetolog: 'Umar' }, // Zextra Umar 3
  /*
    Umar's fourth Zextra account (BM 000), seen on 2026-10-01: unmapped, it
    showed on «Lidlar» as a «Boshqa» row of its own beside Umar · Zextra.
  */
  '1766424904604300': { product: 'Zextra', targetolog: 'Umar' }, // Umar (Zextra)
  /*
    Tursunbek, a new Zextra targetolog (2026-10-06): lead forms since 05.10
    on both accounts (17.24 $ by 06.10), and his «Tursunbek-zextra …» form
    leads already on the portal. Unmapped, his money left the ad budget.
  */
  '2230777724410928': { product: 'Zextra', targetolog: 'Tursunbek' }, // Zextra (Tursunbek Targetolog)
  '1686836655304575': { product: 'Zextra', targetolog: 'Tursunbek' }, // Zextra 2 (Tursunbek TARGETOLOG)
  /*
    The client's own AI targetolog (2026-09-25: «collagen ai targetolog men bir
    ai targetolog yaratdim … hali uni ishlatmadim»). It runs on «Collagen AI
    Targetolog» (1052133867828964): Collagen lead forms since 29.09, 12.07 $ by
    02.10, which read as «Boshqa» — out of Collagen's ad budget — while the map
    named 4016900891780426. That account, «Collagen AI targetolog» on
    2026-09-25, is «Zapas Collagen» now with no campaigns at all, so it is left
    unmapped: should it ever spend, it shows as «Boshqa» under its own name
    until the client says whose it is.
  */
  '1052133867828964': { product: 'Collagen', targetolog: 'AI targetolog' }, // Collagen AI Targetolog
  /*
    Eldor's two accounts outside Collagen and Zextra, asked for on 2026-09-28
    («HR Eldor … kosmetika eldor shu larni tortaan … hr jadvalcha»). Neither
    is a product page's money: HR Eldor recruits staff, Kosmetika Eldor sells
    cosmetics. Each gets a narrow column of its own beside the ad sheets
    (`SIDE_COLUMNS`); a Kosmetika lead-form campaign still counts in «Отчёт
    Т» under «Boshqa», so no dollar leaves the totals.
  */
  '1657709689205277': { product: 'Boshqa', targetolog: 'Элдор' }, // HR Eldor
  '517245084208402': { product: 'Boshqa', targetolog: 'Элдор' }, // Kosmetika Eldor
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
 *   hiring — a campaign that recruits staff, not customers
 *            («EX - Sinolife (vakansiya) - DM», and since 19.09 Collagen
 *            Eldor's English «EX - TOF - Vacancy - 19.09»). On neither sheet;
 *            the first is exactly the gap between Meta's DM total and the
 *            sheet's on 01.08 (7.4 $). The name list was checked against all
 *            1 200 campaigns of the 21 readable accounts on 2026-10-02: it
 *            catches the 8 that recruit and nothing else — «Ambassador»
 *            campaigns sell the collagen and stay out.
 *   other  — traffic, awareness, sales objectives: on neither sheet, still
 *            counted in the grand total so no dollar vanishes.
 *
 * Read at query time from the objective and name stored per row, so moving a
 * campaign between sheets corrects history without a re-import.
 */
export type CampaignChannel = 'form' | 'dm' | 'hiring' | 'other'

const HIRING = /vakans|вакан|vacanc|ishga\s+olish|\bhr\b/i

/** Accounts that only ever recruit — every campaign on them is hiring, whatever its name. */
const HIRING_ACCOUNTS: ReadonlySet<string> = new Set(['1657709689205277']) // HR Eldor

export function campaignChannel(objective: string, name: string, accountId: string): CampaignChannel {
  if (HIRING_ACCOUNTS.has(accountId) || HIRING.test(name)) return 'hiring'
  if (objective === 'OUTCOME_LEADS' || objective === 'LEAD_GENERATION') return 'form'
  if (objective === 'OUTCOME_ENGAGEMENT' || objective === 'MESSAGES') return 'dm'
  return 'other'
}

/**
 * A lead campaign that sends people to the website, not to a Meta form.
 * Umar reports it apart from his forms (03.10.2026: «Rasxod 223.87$ · Lid
 * 248» and «Sayt rasxod 11.86$ · Lid 1» — Meta: lead campaigns 235.84 $ /
 * 249 leads, «Sayt-1» among them at 11.87 $ / 1). Meta's objective is the
 * same OUTCOME_LEADS, so only the name tells it apart. Read only among the
 * lead campaigns: a «Sayt» traffic or sales campaign is «other».
 */
const SITE = /sayt|сайт|\bsite\b|website/i

export function isSiteCampaign(name: string): boolean {
  return SITE.test(name)
}

/**
 * The product a campaign's money counts towards in the ad budget, or null
 * when it counts towards none: an unmapped («Boshqa») account, or a hiring
 * campaign. The RNP sheet's «Жами бюджет» and the «Квал лид нархи» tile on
 * «Lidlar» both divide this, so the two screens cannot price a kval apart.
 */
export function adBudgetProduct(c: {
  readonly accountId: string
  readonly accountName: string
  readonly objective: string
  readonly campaignName: string
}): TargetProduct | null {
  const { product } = ownerOf(c.accountId, c.accountName)
  if (product === 'Boshqa') return null
  if (campaignChannel(c.objective, c.campaignName, c.accountId) === 'hiring') return null
  return product
}

/**
 * The Instagram page a product's DM money is shown against, by portal
 * SOURCE_ID. The «DM» sheet puts all of Collagen's DM spend on «sinolifeuz»
 * and none on «sinolife_otziv». It leaves «zextrauzb» at 0 $, though Umar
 * runs a Zextra DM campaign (~100 $ in August); that money is shown on
 * «zextrauzb» rather than dropped. The ads cannot say which page they ran on
 * without the `ads_management` budget (see metaImport.ts), so the page is
 * stated here. An unmapped account's DM money has no page and is reported
 * as such, never folded into one. «collagen.marine», an ad page since
 * 2026-10-02, carries no DM money here either: its row shows its Bitrix24
 * leads and kval, like «sinolife_otziv». Which page Collagen's DM campaigns
 * point at is the client's to say; until then the money stays on sinolifeuz.
 */
export const DM_PAGE_OF_PRODUCT: Readonly<Record<TargetProduct, string>> = Object.freeze({
  Collagen: 'UC_1X1J24', // sinolifeuz
  Zextra: 'UC_A8LE21', // zextrauzb
})

/**
 * The narrow columns set beside the ad sheets — the client's own side table
 * («Сентябрь 269,0$ / Навой HR», one row a day). Checked 2026-09-28: the
 * sheet's «Навой HR» 02–18.09 is «EX - Sinolife (vakansiya) - DM - 23.04» on
 * Sinolife family Eldor to within a dollar a day (169,7 $ both); 21–26.09
 * (100 $) is Collagen Eldor's «EX - TOF - Vacancy - 19.09» and its copy
 * (103,38 $), which read as DM until `HIRING` learned the English «vacanc»
 * on 2026-10-02 — HR Eldor had never spent.
 *
 *   hr        — every hiring campaign on any account (`campaignChannel`).
 *   kosmetika — Kosmetika Eldor's other campaigns; its «Vakansiya» ones are HR.
 */
export type SideColumn = 'hr' | 'kosmetika'

const KOSMETIKA_ACCOUNTS: ReadonlySet<string> = new Set(['517245084208402']) // Kosmetika Eldor

export function sideColumn(channel: CampaignChannel, accountId: string): SideColumn | null {
  if (channel === 'hiring') return 'hr'
  if (KOSMETIKA_ACCOUNTS.has(accountId)) return 'kosmetika'
  return null
}
