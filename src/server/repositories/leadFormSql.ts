import { FORM_BRAND_PATTERNS } from '@/server/domain/leads/leadSources'
import { LEAD_SOURCE_VOCABULARY } from '@/server/integrations/crm/bitrix24/mapping'

/**
 * THE CRM FORM OF A РЕГИСТРАЦИЯ LEAD, IN SQL — one home for every screen that
 * reads it («Roistat», «Lidlar», «RNP jadvali»), so a lead cannot be a form
 * lead on one and brandless on another.
 *
 * THE TITLE IS NOT ENOUGH (measured on the portal, 01–06.10.2026). A
 * returning contact's form lead is renamed «Такрор - обработка» by the
 * portal's robot, and its form survives only in SOURCE_DESCRIPTION
 * (`metadata.utm`): 1 750 of 6 320 Регистрация deals that week, which read
 * as formless — no targetolog, no brand. The description comes in three
 * spellings, tried in order after the title:
 *
 *   «Qayta zayavka (forma akt #…) Заполнена CRM-форма "<form>"» — the form
 *       whole (1 259 of them);
 *   «AI targetolog YF / forma: <form> / <campaign>» — the AI targetolog's
 *       own integration, which never writes a CRM-form title (43);
 *   «<short name>» — the name Meta knows the form by, which an ordinary
 *       form deal also carries beside its title: `form_alias` maps it back
 *       to that title (452). Only for a «Ген лид» deal — what a form files
 *       under — and only a short name that names ONE form in the scan: an
 *       «Исход» or a DM-page lead never borrows a form, and two targetologs
 *       naming their Meta forms alike make the name nobody's.
 *
 * 31 of the week's «Ген лид» deals were left with no form — typed in by hand.
 * The result is a TITLE that `formNameOf` reads, null when no form is named.
 */

/** The deal's SOURCE_DESCRIPTION, as the sync keeps it (`dealUtm`). */
export function sourceDescriptionSql(deal: string): string {
  return `${deal}."metadata"->'utm'->>'SOURCE_DESCRIPTION'`
}

/**
 * A «QAYTA ZAYAVKA» DEAL'S FORM ACT NUMBER — null on any other deal.
 *
 * Since 2026-10-05 16:20 the portal's robot opens a Регистрация deal for a
 * returning contact's form fill, described «Qayta zayavka (forma akt #N)
 * Заполнена CRM-форма "<form>"». It polls about once a minute, so the act
 * numbers rise with the deals' creation (~50 a minute). That evening, 18:00–
 * 20:00, it also opened 1 071 deals for acts filled days earlier (#4660500
 * on): forms that never reached the portal as deals when they were filled,
 * all landing on 05.10 and doubling that day's leads. A deal whose act is
 * lower than one already opened before it is such a late copy — not a lead
 * of the day it was opened (`RnpRepository.registrationDaysSql`).
 */
export function replayActSql(sd: string): string {
  return `substring(${sd} from '^Qayta zayavka \\(forma akt #([0-9]+)\\)')::bigint`
}

/**
 * The `replayed` CTE (without `WITH`): the ids of the late «Qayta zayavka»
 * copies among `rows` — a relation aliased `q0` with the Регистрация deals'
 * `id`, `created` and `act` (`replayActSql`). Live, the robot opens deals in
 * act order, so a deal whose act is below one opened before it is a late
 * copy. The running maximum starts from the day before `from` (the window's
 * first instant, naive UTC), so a window that opens inside such a burst does
 * not take its first copy for live. One home for «RNP jadvali» and «Lidlar».
 */
export function replayedCteSql(rows: string, from: string): string {
  return `replayed AS (
        SELECT q.id
        FROM (
          SELECT q0.id, q0.act,
                 max(q0.act) OVER (ORDER BY q0.created, q0.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before
          FROM ${rows}
          WHERE q0.act IS NOT NULL
        ) q
        WHERE q.act < GREATEST(q.before, (
          SELECT max(${replayActSql(sourceDescriptionSql('pd'))})
          FROM "deal" pd
          JOIN "pipeline" pp ON pp."id" = pd."pipelineId" AND pp."role" = 'LEAD'
          WHERE pd."createdAtSource" >= ${from} - interval '1 day' AND pd."createdAtSource" < ${from}
        ))
      )`
}

/**
 * The `form_alias` CTE (without `WITH`) over `rows` — a relation aliased
 * `fd` with an `sd` and a `title` column, Регистрация deals only: each
 * unambiguous short name of a form.
 */
export function formAliasOverSql(rows: string): string {
  return `form_alias AS MATERIALIZED (
        SELECT fd.sd, min(fd.title) AS title
        FROM ${rows}
        WHERE fd.title LIKE '%CRM-форм%' AND fd.sd IS NOT NULL
        GROUP BY 1
        -- One form per short name, its NBSP and quote spellings folded; an ambiguous name is nobody's.
        HAVING count(DISTINCT btrim(translate(substring(fd.title from 'CRM-форм[аы][[:space:]]*[«"“]([^»"”]+)'), chr(160), ' '))) = 1
      )`
}

/** The `form_alias` CTE (without `WITH`) from the Регистрация deals created in [`from`, `to`). */
export function formAliasCteSql(from: string, to: string): string {
  return formAliasOverSql(`(
          SELECT ${sourceDescriptionSql('ad')} AS sd, ad."title" AS title
          FROM "deal" ad
          JOIN "pipeline" ap ON ap."id" = ad."pipelineId" AND ap."role" = 'LEAD'
          WHERE ad."createdAtSource" >= ${from} AND ad."createdAtSource" < ${to}
            AND ad."title" LIKE '%CRM-форм%'
        ) fd`)
}

/** `LEFT JOIN form_alias <alias>` on a deal's description. */
export function formAliasJoinSql(deal: string, alias: string): string {
  return `LEFT JOIN form_alias ${alias} ON ${alias}.sd = ${sourceDescriptionSql(deal)}`
}

/**
 * The form title expression. `title`, `sd` and `sourceId` (the portal
 * SOURCE_ID) are SQL expressions; `aliasTitle` is the joined alias's title.
 */
export function leadFormTitleSql(title: string, sd: string, sourceId: string, aliasTitle: string): string {
  return `CASE
            WHEN ${title} LIKE '%CRM-форм%' THEN ${title}
            WHEN ${sd} LIKE '%CRM-форм%' THEN ${sd}
            WHEN ${sd} ILIKE 'AI targetolog%forma:%'
              THEN 'CRM-формы «AI targetolog · ' || btrim(substring(${sd} from '[Ff]orma:([^/]*)')) || '»'
            WHEN ${sourceId} = '${LEAD_SOURCE_VOCABULARY.generated}' THEN ${aliasTitle}
          END`
}

/** The form title of deal `deal` (its source joined as `source`), with `form_alias` joined as `alias`. */
export function dealFormTitleSql(deal: string, source: string, alias: string): string {
  return leadFormTitleSql(`${deal}."title"`, sourceDescriptionSql(deal), `${source}."externalId"`, `${alias}.title`)
}

/**
 * The brand a form TITLE's form name states — `formNameBrand` in SQL, off
 * the same `FORM_BRAND_PATTERNS`: 'Zextra', 'Collagen', or NULL (no title, or
 * a name that names neither). Only the name between the quotes is read, cut
 * out once; the space before the quote may be a no-break one, as JS `\s`
 * allows (`formNameOf`) and `[[:space:]]` under a C locale does not.
 */
export function formBrandOfTitleSql(title: string): string {
  const arms = FORM_BRAND_PATTERNS.map(([brand, pattern]) => `WHEN fbn.name ~* '${pattern}' THEN '${brand}'`).join(' ')
  return `(SELECT CASE ${arms} END
            FROM (SELECT substring(${title} from 'CRM-форм[аы][[:space:]\u00a0]*[«"“]([^»"”]+)') AS name) fbn)`
}

/** How far before a sales deal its ORIGIN LEAD may have opened (Roistat's join, and every sale's brand). */
export const ORIGIN_LEAD_DAYS = 30

/**
 * Which of a contact's leads is a sale's origin: a WON one first («Сделка
 * успешна» opens the sales deal), then the latest, then the id — so two leads
 * opened in the same second resolve to the same one on every screen.
 */
export const originLeadOrderSql = (lead: string): string =>
  `(${lead}."status" = 'WON') DESC, ${lead}."createdAtSource" DESC, ${lead}."id" DESC`

/**
 * A SALE'S FORM TITLE: its origin lead's form when it has an origin lead
 * (`leadFound`), else the sales deal's own title when that names a form —
 * Roistat's rule (a lead found decides, empty or not). Without `form_alias`:
 * a lead known only by a form's short name reads as formless here, and its
 * sale falls through to the product (`saleBrand`).
 */
export function saleFormTitleSql(leadFound: string, leadTitle: string, leadSd: string, saleTitle: string): string {
  return `CASE
            WHEN ${leadFound} THEN ${leadFormTitleSql(leadTitle, leadSd, 'NULL::text', 'NULL::text')}
            WHEN ${saleTitle} LIKE '%CRM-форм%' THEN ${saleTitle}
          END`
}

/**
 * THE BRAND OF A SALE'S CRM FORM (the client, 2026-10-15: «shundan kelgani
 * demak oʻsha collagen boʻldi» — an order from a «…-collagen» form's lead is
 * Collagen's), for sales deal `sale`: its ORIGIN LEAD is Roistat's — the same
 * contact's Регистрация deal opened up to `ORIGIN_LEAD_DAYS` before the sales
 * deal, a WON one first («Сделка успешна» is what opens the sales deal), then
 * the latest — and the brand is `formBrandOfTitleSql` over
 * `saleFormTitleSql`. NULL when no form names a brand: `saleBrand` then reads
 * the product, then the team. One indexed probe of `deal("customerId")` per
 * sale. Measured on the portal for the orders opened 10–14.10: 155 of 345
 * came from a form lead (Collagen 113, Zextra 41, one unnamed), 123 from a
 * formless one (Исход, a hand-typed «Ген лид», DM, Telegram, a call) and 67
 * had no lead in the 30 days (База, repeat customers).
 */
export function originFormBrandSql(sale: string): string {
  // Aliases of its own (ofb_*): a caller's alias named «l» or «ol» would otherwise be shadowed silently.
  return `(SELECT ${formBrandOfTitleSql(
    saleFormTitleSql('ofb_lead."id" IS NOT NULL', 'ofb_lead."title"', 'ofb_lead.sd', `${sale}."title"`),
  )}
          FROM (SELECT 1) ofb_one
          LEFT JOIN LATERAL (
            SELECT ofb_l."id", ofb_l."title", ${sourceDescriptionSql('ofb_l')} AS sd
            FROM "deal" ofb_l
            JOIN "pipeline" ofb_lp ON ofb_lp."id" = ofb_l."pipelineId" AND ofb_lp."role" = 'LEAD'
            WHERE ${sale}."customerId" IS NOT NULL
              AND ofb_l."customerId" = ${sale}."customerId"
              AND ofb_l."createdAtSource" <= ${sale}."createdAtSource"
              AND ofb_l."createdAtSource" > ${sale}."createdAtSource" - interval '${ORIGIN_LEAD_DAYS} days'
            ORDER BY ${originLeadOrderSql('ofb_l')}
            LIMIT 1
          ) ofb_lead ON true)`
}
