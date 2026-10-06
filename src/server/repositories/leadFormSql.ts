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
 * The `form_alias` CTE (without `WITH`): each unambiguous short name of a
 * form, from the Регистрация form deals created in [`from`, `to`).
 */
export function formAliasCteSql(from: string, to: string): string {
  const sd = sourceDescriptionSql('fd')
  return `form_alias AS MATERIALIZED (
        SELECT ${sd} AS sd, min(fd."title") AS title
        FROM "deal" fd
        JOIN "pipeline" fp ON fp."id" = fd."pipelineId" AND fp."role" = 'LEAD'
        WHERE fd."createdAtSource" >= ${from} AND fd."createdAtSource" < ${to}
          AND fd."title" LIKE '%CRM-форм%'
          AND ${sd} IS NOT NULL
        GROUP BY 1
        -- One form per short name, its NBSP and quote spellings folded; an ambiguous name is nobody's.
        HAVING count(DISTINCT btrim(translate(substring(fd."title" from 'CRM-форм[аы][[:space:]]*[«"“]([^»"”]+)'), chr(160), ' '))) = 1
      )`
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
