/**
 * «Lid manbalari» — where a Регистрация lead came from, in the portal's own
 * vocabulary. Pure: no framework, no database.
 *
 * Measured on the live portal for 18–24.09.2026 through the read-only Bitrix24
 * MCP, and every rule below comes from that week:
 *
 *   LEAD FORMS. A Meta lead form lands in Регистрация as SOURCE_ID
 *   `REPEAT_SALE` («Ген лид») with the title «Заполнение CRM-формы "<form>"».
 *   The FORM names the targetolog — «Sinolife Collagen - 30.04 Eldor» (730
 *   that week), «Sinolife (UMAR) 777» (369), «Kamron 6 etap filt forma 05.07»
 *   (266) — which is what the client's «Отчёт Т» counts per targetolog and
 *   what the Bitrix targetolog field (filled on one lead in twenty) never
 *   could. The same title is copied onto a Первичный отдел deal once the lead
 *   is qualified (263 of 263 twins were WON in Регистрация, median three hours
 *   earlier), so ONLY Регистрация is read, or every kval would count twice.
 *
 *   DM. Every Instagram conversation opens a deal in «ИИ обработка» titled
 *   «<username> - sinolifeuz instagram», on the page's SOURCE_ID (4 686 that
 *   week). That is the client's «Кол мурожат» (~23k a month) far better than
 *   Meta's conversation count (~11.7k): a 50-contact sample of them had no
 *   Регистрация deal at all, so the two are different people, not copies.
 *
 *   UTM_* was empty on all 2 892 ad-source deals — a lead cannot be tied to
 *   its campaign, only to its form or its page.
 */

import type { TargetProduct } from '../types'

/** How a Регистрация deal reached the portal. */
export type LeadChannel = 'form' | 'page' | 'inbound' | 'manual' | 'telegram' | 'smm' | 'other' | 'outbound'

/**
 * In the order «Barcha manbalar» reads them: the ad channels, then the ones
 * nobody paid for, then «Исход» last — an operator's own call is not a lead
 * that came in, so it stands apart from both.
 */
export const LEAD_CHANNELS: readonly LeadChannel[] = Object.freeze([
  'form',
  'page',
  'inbound',
  'manual',
  'telegram',
  'smm',
  'other',
  'outbound',
])

/**
 * «Boshqa kanallar lidlari» — the client's list of 2026-10-01, one tile each
 * and their «Jami»: Ген лид, Входящий, Телеграм, Сммщик ии, Веб сайт, Сарафан.
 * A cut of Регистрация of its own, beside the channels above rather than made
 * of them: the client asked for «Ген лид» whole (forms and by hand), and for
 * «Сммщик ии» as every lead the AI qualified out of the DMs — which mostly
 * come in on the DM pages, so this row overlaps «Targetologlar» and «DM
 * sahifalar» by design.
 *
 * «ИСХОД» AND «BOSHQA» CAME BACK ON 2026-10-02. Without them «Jami» fell
 * short of «Жами лидлар» above it and the client read it as a miscount
 * («Жами тугри келмаяпти»): 01.10 had 897 Регистрация leads, 741 on the six
 * tiles, 154 «Исход» and 2 Instagram. So every lead now has exactly one tile —
 * the ad pages the AI did not qualify, the human SMM sources, a lead with no
 * source and the rest are «Boshqa».
 *
 * THEY LEFT «JAMI» LATER THAT DAY: the client asked for «Jami» to be the six
 * channels alone, with «Исход» and «Boshqa» on a row of their own beneath —
 * see `LEAD_TILES_APART`. Every lead still has exactly one tile.
 *
 * BY SOURCE ALONE SINCE 2026-10-09 (the client's written list of SOURCE_IDs):
 * «Сммщик ии» is the Instagram / Telegram bot accounts and the SMM sources
 * (`LeadTileVocabulary.smm`) by the day the deal was created — it read the
 * «ИИ квал сана» filter, any creation day, so «Jami» could not meet «Жами
 * лидлар». The AI's mark moves no lead between tiles any more, and «Жами /
 * Янги / Дубль лидлар» above are these tiles' «Jami»: «Исход» is an
 * operator's own call, not a lead, and is in neither.
 *
 * THE CARD READS THE AI'S DATE AGAIN SINCE 2026-10-15 (the client): «Сммщик
 * ии» prints `tiles.ai`, «ИИ квал сана» in Регистрация. This tile is still
 * what «Jami» sums — by source and creation day — and is a line under it.
 */
export type LeadTile = 'generated' | 'inbound' | 'telegram' | 'aiSmm' | 'web' | 'sarafan' | 'outbound' | 'other'

export const LEAD_TILES: readonly LeadTile[] = Object.freeze([
  'generated',
  'inbound',
  'telegram',
  'aiSmm',
  'web',
  'sarafan',
  'outbound',
  'other',
])

/** The tiles shown on their own row and left out of «Jami» (the client, 2026-10-02). */
export const LEAD_TILES_APART: ReadonlySet<LeadTile> = new Set<LeadTile>(['outbound', 'other'])

/**
 * «Сарафан» is NOT Регистрация alone: it counts «Сарафан маркетинг» deals of
 * EVERY pipeline since 2026-10-10 (the client; Ecommerce alone from
 * 2026-10-05, which read 0). Most are no lead of «Жами лидлар», so the tile
 * stays in its place but out of «Jami», and a Регистрация lead on that source
 * still counts under «Boshqa» as well (`leadTile`) — both are outside «Jami».
 */
export const LEAD_TILES_OUTSIDE_REGISTRATION: ReadonlySet<LeadTile> = new Set<LeadTile>(['sarafan'])

/**
 * The portal's SOURCE_IDs by the TILE they count on — the client's list of
 * 2026-10-09, apart from `LeadSourceVocabulary` (the tables' channels), which
 * files «sinolif_tg» under Telegram and the ad pages under «page».
 * `mapping.ts` holds the one copy, as `LEAD_TILE_SOURCES`.
 */
export interface LeadTileVocabulary {
  readonly generated: string
  readonly inbound: ReadonlySet<string>
  readonly telegram: ReadonlySet<string>
  /** The Instagram / Telegram bot accounts and the «Сммщик» sources. */
  readonly smm: ReadonlySet<string>
  readonly web: ReadonlySet<string>
  readonly outbound: ReadonlySet<string>
}

/**
 * The tile a Регистрация deal counts on — one, always, by its source alone.
 * A source the client's list does not name (none, «Сарафан маркетинг» — its
 * tile reads every pipeline, `LEAD_TILES_OUTSIDE_REGISTRATION`) is «Boshqa».
 */
export function leadTile(sourceId: string | null, vocabulary: LeadTileVocabulary): LeadTile {
  if (sourceId === null) return 'other'
  if (sourceId === vocabulary.generated) return 'generated'
  if (vocabulary.inbound.has(sourceId)) return 'inbound'
  if (vocabulary.telegram.has(sourceId)) return 'telegram'
  if (vocabulary.smm.has(sourceId)) return 'aiSmm'
  if (vocabulary.web.has(sourceId)) return 'web'
  if (vocabulary.outbound.has(sourceId)) return 'outbound'
  return 'other'
}

/**
 * The portal's SOURCE_IDs by what they mean, handed in rather than imported:
 * the domain does not read integration vocabulary (see eslint.config.mjs).
 * `mapping.ts` holds the one copy, as `LEAD_SOURCE_VOCABULARY`.
 */
export interface LeadSourceVocabulary {
  /** The ad pages — the target SOURCE_IDs «Reklama samarasi» reads. */
  readonly pages: ReadonlySet<string>
  /** A customer ringing in. */
  readonly inbound: ReadonlySet<string>
  /** An operator's own outgoing call opening a deal. */
  readonly outbound: ReadonlySet<string>
  /** Telegram that is not an ad page: the bot, the open line, the brand's own channel. */
  readonly telegram: ReadonlySet<string>
  /** Leads the SMM managers («Сммщик») bring in from the brand's pages. */
  readonly smm: ReadonlySet<string>
  /** «Веб-сайт» — the brands' own sites. */
  readonly web: ReadonlySet<string>
  /** «Сарафан маркетинг» — word of mouth. */
  readonly sarafan: ReadonlySet<string>
  /** «Ген лид» — what a CRM form writes, and what operators type leads under by hand. */
  readonly generated: string
}

/*
  The closing quote is optional (2026-10-02): a title can arrive without it,
  and deal 1038510 («Заполнение CRM-формы "Sinolifecollgen marine», a kval of
  01.10) lost its form — and with it its brand — to the missing quote.
  «CRM-форма» too (2026-10-06): a repeat lead's SOURCE_DESCRIPTION reads
  «Qayta zayavka (forma akt #…) Заполнена CRM-форма "<form>"».
*/
const FORM_TITLE = /CRM-форм[аы]\s*[«"“]([^»"”]+)(?:[»"”]|$)/

/** The CRM form's name from a deal title, or null when the deal was not a form. */
export function formNameOf(title: string | null | undefined): string | null {
  const match = title ? FORM_TITLE.exec(title) : null
  const name = match?.[1]?.replace(/\s+/g, ' ').trim()
  return name ? name : null
}

/**
 * The words a CRM form's NAME states its brand with, «zextra» asked first —
 * POSIX patterns, read by JS (`formNameBrand`, case-insensitive) and by SQL
 * (`formBrandOfTitleSql`, `~*`). Every Cyrillic letter is spelled with both
 * its cases: `~*` on Cyrillic follows the database's ctype and under a C
 * locale folds nothing, so only this spelling matches alike on both sides.
 */
export const FORM_BRAND_PATTERNS: readonly (readonly [TargetProduct, string])[] = [
  // The Cyrillic spellings too: form 110 «Аббос янги таргетолог Зехтра» is live on the portal (2026-10-16).
  ['Zextra', 'zextra|zekstra|[Зз][Ее][Кк][Сс][Тт][Рр][Аа]|[Зз][Ее][Хх][Тт][Рр][Аа]'],
  ['Collagen', 'collagen|kollagen|colagen|kolagen|[Кк][Оо][Лл][Лл][Аа][Гг][Ее][Нн]|[Кк][Оо][Лл][Аа][Гг][Ее][Нн]'],
]

const FORM_BRAND_REGEXES = FORM_BRAND_PATTERNS.map(([brand, pattern]) => [brand, new RegExp(pattern, 'i')] as const)

/**
 * A CRM FORM IS KNOWN BY ITS NAME TODAY (2026-10-16, the client: «toʻgʻri
 * chiqarsin, xato boʻlmasin»). A deal and a fill keep the form's name AS IT
 * WAS when the form was filled, and the portal's forms were renamed
 * «<targetolog>-collagen …» / «<targetolog>-zextra …» on 29.09 — so a lead
 * from before carries the old name, and one form wore the wrong word for a
 * week. Each old name below was read back to its form's id off the portal's
 * fill activities (`crm.activity` CRM_WEBFORM, PROVIDER_TYPE_ID):
 *
 *   «Sobirjon-collagen I.S | Short form new 14.09» — form 198, 29.09–05.10
 *       (42 leads); «Sobirjon-zextra …» since 06.10. All 43 leads under the
 *       new name carry «Проект» Zextra sure, and the one sale the old name's
 *       leads made sold Zextra sure.
 *   «Kamron 6 etap», «Kamron 6 etap filt forma 05.07» — form 144; 4 of its
 *       leads whose «Проект» said Collagen Marine read the form's Zextra now.
 *   the rest only gained their targetolog's prefix; they are here so that a
 *   window across 29.09 knows the two names for one form (`form_alias`).
 *
 * Keyed by the name with its spaces folded (`foldFormName`).
 */
export const FORM_RENAMED: ReadonlyMap<string, string> = new Map([
  ['Sobirjon-collagen I.S | Short form new 14.09', 'Sobirjon-zextra I.S | Short form new 14.09'],
  ['Kamron 6 etap', 'Kamron-zextra Zextra 6 etapli filtr forma 05.07'],
  ['Kamron 6 etap filt forma 05.07', 'Kamron-zextra Zextra 6 etapli filtr forma 05.07'],
  ['Sinolife (UMAR) 777', 'Umar-collagen Sinolife (UMAR) 777'],
  ['Sinolife Collagen - 30.04 Eldor', 'Eldor-collagen Sinolife Collagen - 30.04'],
  ['Collagen (Umar)', 'Umar-collagen Collagen (UMAR)'],
  ['zextra - 27 / 09 Варианты', 'Timur-zextra zextra - 27 / 09 Варианты'],
])

/**
 * FORMS WHOSE NAME NAMES NO BRAND EVEN TODAY, by what the sales of their
 * leads sold (portal, 2026-10-16):
 *
 *   «Sobirjon» — form 140, 31.07–17.09 (804 leads): 40 of 40 sales read
 *       Zextra sure, where the old guess in `leadBrand` filed them under the
 *       collagen.
 *   «I.S | Short form | 01.08.2026», «Umar Sinolife (UMAR) TEST-1»,
 *       «Sinolife (UMAR) TEST-2» — forms 170 / 166 / 168: every sale read
 *       (15, 15, 4) the collagen.
 */
export const UNNAMED_FORM_BRANDS: ReadonlyMap<string, TargetProduct> = new Map<string, TargetProduct>([
  ['Sobirjon', 'Zextra'],
  ['I.S | Short form | 01.08.2026', 'Collagen'],
  ['Umar Sinolife (UMAR) TEST-1', 'Collagen'],
  ['Sinolife (UMAR) TEST-2', 'Collagen'],
])

/** The name the portal gives a form today (`FORM_RENAMED`), from any name it carried — folded. */
export function currentFormName(name: string): string {
  const folded = foldFormName(name)
  return FORM_RENAMED.get(folded) ?? folded
}

/** A form's name with every run of spaces — no-break ones and line breaks too — one space, trimmed. */
export function foldFormName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

/**
 * The brand a CRM form's name states, or null when it names neither.
 *
 * THE CLIENT'S RULE OF 2026-10-15: every Collagen / Zextra split reads the
 * CRM form's name FIRST («crm-forma nomlariga qarab … hamma yerda»). The
 * portal's forms were renamed for it — «<targetolog>-collagen …» /
 * «<targetolog>-zextra …»: on 14.10 all 946 form leads named their brand, and
 * where «Проект» was filled too (804) it agreed on every one. A lead's form
 * decides its brand (`leadBrand`), a sale's is its origin lead's
 * (`saleBrand`, `originFormBrandSql`).
 */
export function formNameBrand(formName: string | null): TargetProduct | null {
  if (formName === null) return null
  const name = currentFormName(formName)
  const unnamed = UNNAMED_FORM_BRANDS.get(name)
  if (unnamed) return unnamed
  for (const [brand, pattern] of FORM_BRAND_REGEXES) if (pattern.test(name)) return brand
  return null
}

/** A form on the WEBSITE («collagen form web») — the «Sayt» campaigns' leads land there, not on a Meta form. */
const WEBSITE_FORM = /\bweb\b|website|\bsite\b|sayt|сайт/i

/** A vacancy's or the cosmetics line's form: Meta's form leads leave hiring and Kosmetika Eldor out of both brands. */
const NOT_A_CUSTOMER_FORM = /vakans|вакан|vacanc|ishga\s+olish|\bhr\b|kosmetik|косметик/i

/** Whether a CRM form takes customers' leads at all — not a vacancy's, not the cosmetics line's. */
export function isCustomerForm(formName: string): boolean {
  return !NOT_A_CUSTOMER_FORM.test(formName)
}

/**
 * The brand a CRM-form FILL counts for on «Target tahlili» (2026-10-15) — or
 * null when it answers no Collagen / Zextra form campaign. A fill carries its
 * form's name and nothing else (no «Проект», no source), so where a deal
 * falls back to those, a fill stops at the form: the name's brand, else its
 * targetolog's (`formOwner`), else none — never the «any other form is the
 * collagen» guess, which would file an unnamed HR or cosmetics form under it.
 */
export function formFillBrand(formName: string): TargetProduct | null {
  // The website's too: «Target tahlili»'s Meta figure leaves the «Sayt» campaigns out (`isSiteCampaign`).
  if (WEBSITE_FORM.test(formName) || !isCustomerForm(formName)) return null
  return formNameBrand(formName) ?? formOwner(formName)?.product ?? null
}

/**
 * A form wins over its source: a form deal is «Ген лид» by source, and the
 * handful a form files under a page's source are still that form's leads.
 * «Ген лид» WITHOUT a form title is an operator typing a lead in by hand.
 */
export function leadChannel(
  sourceId: string | null,
  formName: string | null,
  vocabulary: LeadSourceVocabulary,
): LeadChannel {
  if (formName !== null) return 'form'
  if (sourceId === null) return 'other'
  if (vocabulary.pages.has(sourceId)) return 'page'
  if (vocabulary.inbound.has(sourceId)) return 'inbound'
  if (vocabulary.outbound.has(sourceId)) return 'outbound'
  if (vocabulary.telegram.has(sourceId)) return 'telegram'
  if (vocabulary.smm.has(sourceId)) return 'smm'
  if (sourceId === vocabulary.generated) return 'manual'
  return 'other'
}

export interface FormOwner {
  /** Spelled as `META_ACCOUNT_OWNERS` spells it, so a form and its accounts meet on one key. */
  readonly targetolog: string
  readonly product: TargetProduct
}

/** The client's AI targetolog, spelled as `META_ACCOUNT_OWNERS` spells its account's owner. */
export const AI_TARGETOLOG = 'AI targetolog'

/**
 * The deal's own «Таргетолог» field, spelled as the ad account map spells
 * its owner. The portal's list says «AI» for the AI targetolog (2026-10-06:
 * its leads sat in a row of their own beside its spend).
 */
export function targetologOfField(value: string | null): string | null {
  if (value == null) return null
  return /^ai$/i.test(value.trim()) ? AI_TARGETOLOG : value
}

/*
  Names as the targetologs type them into their form titles. «Элдор» is
  Cyrillic because `META_ACCOUNT_OWNERS` spells it so; the rest are Latin
  there too.
*/
const FORM_TARGETOLOGS: readonly (readonly [RegExp, string])[] = [
  // First: the AI's forms are named by the AI, not by a person.
  [/ai\s*targetolog/i, AI_TARGETOLOG],
  [/eldor|элдор/i, 'Элдор'],
  [/umar|умар/i, 'Umar'],
  [/kamron|камрон/i, 'Kamron'],
  [/sobirjon|собиржон/i, 'Sobirjon'],
  [/timur|тимур/i, 'Timur'],
  // Zextra forms since 05.10.2026 («Tursunbek-zextra Zextra filtr savol»).
  [/tursunbek|турсунбек/i, 'Tursunbek'],
  // Otabek, a new Zextra targetolog (live-read 2026-10-22, «Otabek Zextra»).
  [/otabek|отабек/i, 'Otabek'],
]

/** Targetologs whose every Meta account is Zextra: a form of theirs that names no product sold the Zextra. */
export const ZEXTRA_ONLY_TARGETOLOGS: ReadonlySet<string> = new Set(['Kamron', 'Tursunbek', 'Otabek'])

/**
 * Whose form this is, from its name — or null when the name names nobody.
 *
 * The product is RNP's `leadBrand` rule for a form: what the name says
 * («zextra», then «collagen»), else Zextra for a Kamron or Tursunbek form (their Meta
 * accounts are all Zextra), else the collagen — every other form that week
 * without «zextra» in it sold the collagen. Until 2026-10-05 a Kamron form
 * fell to Collagen here, so its leads sat on a «Collagen · Kamron» owner
 * apart from his own Zextra spend.
 */
export function formOwner(formName: string): FormOwner | null {
  // By its name today: «zextra - 27 / 09 Варианты» named nobody until it gained Timur's prefix (`FORM_RENAMED`).
  const name = currentFormName(formName)
  const hit = FORM_TARGETOLOGS.find(([pattern]) => pattern.test(name))
  if (!hit) return null
  const product: TargetProduct = formNameBrand(formName) ?? (ZEXTRA_ONLY_TARGETOLOGS.has(hit[1]) ? 'Zextra' : 'Collagen')
  return { targetolog: hit[1], product }
}
