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
 * and their «Jami»: Ген лид, Входящий, Телеграм, Сммщик ии, Веб сайт — and
 * «Сарафан», until 2026-10-08 (see `leadTile`).
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
 */
export type LeadTile = 'generated' | 'inbound' | 'telegram' | 'aiSmm' | 'web' | 'outbound' | 'other'

export const LEAD_TILES: readonly LeadTile[] = Object.freeze([
  'generated',
  'inbound',
  'telegram',
  'aiSmm',
  'web',
  'outbound',
  'other',
])

/** The tiles shown on their own row and left out of «Jami» (the client, 2026-10-02). */
export const LEAD_TILES_APART: ReadonlySet<LeadTile> = new Set<LeadTile>(['outbound', 'other'])

/**
 * The tile a Регистрация deal counts on — one, always. The AI's mark wins over
 * every source, «Ген лид» and «Исход» included, so a qualified sinolif_tg chat
 * is «Сммщик ии», not «Телеграм» — no lead is counted twice in «Jami». The
 * portal fills the mark since 2026-09-14; before that the tile reads 0.
 * «Сммщик ии»'s own count is not these leads: since 2026-10-02 it is the
 * portal's «ИИ квал сана» filter (`aiQualifiedStages`), as the client checks it.
 */
export function leadTile(sourceId: string | null, aiQualified: boolean, vocabulary: LeadSourceVocabulary): LeadTile {
  if (aiQualified) return 'aiSmm'
  if (sourceId === null) return 'other'
  if (sourceId === vocabulary.generated) return 'generated'
  if (vocabulary.inbound.has(sourceId)) return 'inbound'
  if (vocabulary.telegram.has(sourceId)) return 'telegram'
  if (vocabulary.web.has(sourceId)) return 'web'
  // «Сарафан маркетинг» is «Boshqa»: its tile went on 2026-10-08 (the client — a
  // Bitrix deal on that source is not wanted on the row; from 2026-10-05 it had
  // read the Ecommerce pipeline's deals alone, outside «Jami»).
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
  if (value === null) return null
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
]

/** Targetologs whose every Meta account is Zextra: a form of theirs that names no product sold the Zextra. */
export const ZEXTRA_ONLY_TARGETOLOGS: ReadonlySet<string> = new Set(['Kamron', 'Tursunbek'])

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
  const hit = FORM_TARGETOLOGS.find(([pattern]) => pattern.test(formName))
  if (!hit) return null
  const product: TargetProduct = /zextra/i.test(formName)
    ? 'Zextra'
    : /collagen|коллаген/i.test(formName)
      ? 'Collagen'
      : ZEXTRA_ONLY_TARGETOLOGS.has(hit[1])
        ? 'Zextra'
        : 'Collagen'
  return { targetolog: hit[1], product }
}
