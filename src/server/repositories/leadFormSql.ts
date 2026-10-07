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
