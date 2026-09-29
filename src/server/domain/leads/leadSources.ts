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
 * In the order the screen reads them: the ad channels, then the ones nobody
 * paid for, then «Исход» last — an operator's own call is not a lead that
 * came in, so it stands apart from both (and from the non-ad total below).
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
 * The channels «Boshqa kanallar · Jami» adds up: every lead that came in on
 * its own. Not `form` or `page` — those are «Reklama lidlari» already — and
 * not `outbound`: the client decided on 2026-09-29 that «Исход» gets its own
 * tile and stays out of this total, since the operator dialled it.
 */
export const NON_AD_CHANNELS: readonly LeadChannel[] = Object.freeze(['inbound', 'manual', 'telegram', 'smm', 'other'])

/**
 * The non-ad total from per-channel counts, bucket by bucket. A channel
 * missing from the map counts as zero, so the total is always whole.
 */
export function nonAdTotal<B extends string>(
  byChannel: ReadonlyMap<LeadChannel, Readonly<Record<B, number>>>,
  buckets: readonly B[],
): Record<B, number> {
  const total = Object.fromEntries(buckets.map((b) => [b, 0])) as Record<B, number>
  for (const channel of NON_AD_CHANNELS) {
    const counts = byChannel.get(channel)
    if (counts) for (const b of buckets) total[b] += counts[b]
  }
  return total
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
  /** «Ген лид» — what a CRM form writes, and what operators type leads under by hand. */
  readonly generated: string
}

const FORM_TITLE = /CRM-формы\s*[«"“]([^»"”]+)[»"”]/

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

/*
  Names as the targetologs type them into their form titles. «Элдор» is
  Cyrillic because `META_ACCOUNT_OWNERS` spells it so; the rest are Latin
  there too.
*/
const FORM_TARGETOLOGS: readonly (readonly [RegExp, string])[] = [
  [/eldor|элдор/i, 'Элдор'],
  [/umar|умар/i, 'Umar'],
  [/kamron|камрон/i, 'Kamron'],
  [/sobirjon|собиржон/i, 'Sobirjon'],
  [/timur|тимур/i, 'Timur'],
]

/**
 * Whose form this is, from its name — or null when the name names nobody.
 *
 * The product is Zextra only when the name says so: every form that week
 * without «zextra» in it sold the collagen.
 */
export function formOwner(formName: string): FormOwner | null {
  const hit = FORM_TARGETOLOGS.find(([pattern]) => pattern.test(formName))
  if (!hit) return null
  return { targetolog: hit[1], product: /zextra/i.test(formName) ? 'Zextra' : 'Collagen' }
}
