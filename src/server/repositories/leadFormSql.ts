import { FORM_BRAND_PATTERNS, FORM_RENAMED, UNNAMED_FORM_BRANDS } from '@/server/domain/leads/leadSources'
import type { TargetProduct } from '@/server/domain/types'
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
 *       under — and only a short name ONE form holds in the scan
 *       (`formAliasOverSql`: every titled deal, or 95 % of them when every
 *       form sharing it is one brand): an «Исход» or a DM-page lead never
 *       borrows a form, and two brands' forms sharing a name make it
 *       nobody's.
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

/** A SQL string literal — the names and patterns are the code's own, never a reader's, but quoted all the same. */
const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`

/**
 * Every character JS `\s` reads as a space (`foldFormName`, `formNameOf`),
 * as one SQL bracket: `[[:space:]]` is only the ASCII six under a C locale,
 * so the no-break space and the other Unicode spaces are spelled out —
 * otherwise «Sobirjon\u00a0» would be a form in JS and nobody's in SQL.
 */
export const SPACE_CLASS_SQL = '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'

/** The form name a title carries, cut out between the quotes. */
const titleFormNameSql = (title: string): string =>
  `substring(${title} from 'CRM-форм[аы]${SPACE_CLASS_SQL}*[«"“]([^»"”]+)')`

/** `foldFormName` in SQL: every run of spaces one space, trimmed; an empty name is no name. NULL stays NULL. */
export function foldedFormNameSql(name: string): string {
  return `NULLIF(btrim(regexp_replace(${name}, '${SPACE_CLASS_SQL}+', ' ', 'g')), '')`
}

/**
 * `currentFormName` in SQL, over an already FOLDED name — pass a column, not
 * an expression: the CASE reads it in every arm and again in its ELSE.
 */
export function renamedFormNameSql(folded: string): string {
  if (FORM_RENAMED.size === 0) return folded
  const arms = [...FORM_RENAMED].map(([old, now]) => `WHEN ${literal(old)} THEN ${literal(now)}`).join(' ')
  return `CASE ${folded} ${arms} ELSE ${folded} END`
}

/**
 * `formNameBrand` in SQL, over a form's CURRENT name (a column): the forms
 * whose name names no brand first (`UNNAMED_FORM_BRANDS`), then
 * `FORM_BRAND_PATTERNS`: 'Zextra', 'Collagen', or NULL.
 */
function currentNameBrandSql(name: string): string {
  const unnamed = new Map<TargetProduct, string[]>()
  for (const [form, brand] of UNNAMED_FORM_BRANDS) unnamed.set(brand, [...(unnamed.get(brand) ?? []), literal(form)])
  const arms = [
    ...[...unnamed].map(([brand, names]) => `WHEN ${name} IN (${names.join(', ')}) THEN '${brand}'`),
    ...FORM_BRAND_PATTERNS.map(([brand, pattern]) => `WHEN ${name} ~* ${literal(pattern)} THEN '${brand}'`),
  ].join(' ')
  return `CASE ${arms} END`
}

/**
 * The `form_alias` CTE (without `WITH`) over `rows` — a relation aliased
 * `fd` with an `sd` and a `title` column, Регистрация deals only: each short
 * name of a form that ONE form holds.
 *
 * A form is its name today (`renamedFormNameSql`), so its old and new names
 * are one form — form 198 was «Sobirjon-collagen …» before 06.10 and
 * «Sobirjon-zextra …» after, and a window across the rename lost both. And
 * a short name every titled deal of which names one form is that form's, as
 * before; one that a form holds on 95 % of them is too, when every form
 * sharing it is that form's brand (2026-10-16, portal): «Sinolife Collagen -
 * 30.04» named Eldor's form on 909 deals of 01–16.10 and two hand-retitled
 * deals named two other collagen forms — the strict count made it nobody's,
 * and 230 repeat leads lost their form (66 with no «Проект» fell to
 * «Brendsiz»). Forms of two brands sharing a short name leave it nobody's
 * below 100 %, so a form's leads never outvote «Проект» for another brand;
 * a form whose name names no brand («Sinolifecollgen marine», one deal)
 * contradicts none.
 * The title printed is one under the form's name today, if any carries it.
 *
 * `OFFSET 0` fences each step: unfenced, the planner inlines the fold into
 * every place that reads it, and the CTE cost five times the strict one
 * (measured on PostgreSQL 18 over 60 000 titles).
 */
export function formAliasOverSql(rows: string, bucketed = false): string {
  /*
    `bucketed`: `rows` carries a `bucket` too, and each bucket learns its own
    short names — every column, group and partition below is per bucket
    (`formAliasByMonthCteSql`). Without it the statement is the one it always was.
  */
  const b = (alias: string) => (bucketed ? `${alias}.bucket, ` : '')
  const by = (alias: string) => (bucketed ? `${alias}.bucket, ${alias}.sd` : `${alias}.sd`)
  return `form_alias AS MATERIALIZED (
        SELECT ${b('fan')}fan.sd, fan.title
        FROM (
          SELECT ${b('fg')}fg.sd, fg.title, fg.deals,
                 sum(fg.deals) OVER (PARTITION BY ${by('fg')}) AS named,
                 row_number() OVER (PARTITION BY ${by('fg')} ORDER BY fg.deals DESC, fg.form) AS place,
                 -- min / max skip a form that names no brand: it contradicts none.
                 min(fg.brand) OVER (PARTITION BY ${by('fg')}) = max(fg.brand) OVER (PARTITION BY ${by('fg')}) AS one_brand
          FROM (
            SELECT ${b('fdn')}fdn.sd, fdn.form, ${currentNameBrandSql('fdn.form')} AS brand, count(*) AS deals,
                   COALESCE(min(fdn.title) FILTER (WHERE fdn.folded = fdn.form), min(fdn.title)) AS title
            FROM (
              SELECT ${b('fdf')}fdf.sd, fdf.title, fdf.folded, ${renamedFormNameSql('fdf.folded')} AS form
              FROM (
                SELECT ${b('fd')}fd.sd, fd.title, ${foldedFormNameSql(titleFormNameSql('fd.title'))} AS folded
                FROM ${rows}
                WHERE fd.title LIKE '%CRM-форм%' AND fd.sd IS NOT NULL
                OFFSET 0
              ) fdf
              -- A title the form name cannot be cut from names no form, as the strict count read it.
              WHERE fdf.folded IS NOT NULL
              OFFSET 0
            ) fdn
            GROUP BY ${by('fdn')}, fdn.form
          ) fg
        ) fan
        WHERE fan.place = 1 AND (fan.deals = fan.named OR (fan.one_brand AND fan.deals * 20 >= fan.named * 19))
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

/**
 * THE SAME CTE, ONE ALIAS TABLE PER CALENDAR MONTH OF THE WINDOW (2026-10-28,
 * Roistat). A window's short names are learned from the deals of [its start −
 * `ORIGIN_LEAD_DAYS` days, its scan end), so a lead of September read in
 * «Shu yil» was named from a year of deals and the same lead read in «Oʻtgan
 * oy» from two months of them — and a year was not the sum of its months.
 * Here each month the window touches (`buckets`, `YYYY-MM`) learns from its
 * own [piece start − `ORIGIN_LEAD_DAYS` days, the earlier of `to` and piece
 * end + `ORIGIN_LEAD_DAYS` days) — exactly what that month's piece learns
 * read as a window of its own — so a stored month and a live one add up to
 * the window. A window inside one month never comes here (`RoistatRepository.bitrix`).
 * Each piece's bounds are instants the server computed, written as literals —
 * UTC wall times, as the column stores them.
 */
export function formAliasByMonthCteSql(
  buckets: readonly { readonly bucket: string; readonly from: Date; readonly to: Date }[],
  from: string,
  to: string,
): string {
  const values = buckets
    // TIMESTAMP, never TIMESTAMPTZ: the column's own type, so `to` keeps the type the statement gives it everywhere else.
    .map((p) => `('${p.bucket}', '${p.from.toISOString()}'::timestamp, LEAST(${to}, '${p.to.toISOString()}'::timestamp))`)
    .join(', ')
  return formAliasOverSql(
    `(
          SELECT bk.bucket, ${sourceDescriptionSql('ad')} AS sd, ad."title" AS title
          FROM "deal" ad
          JOIN "pipeline" ap ON ap."id" = ad."pipelineId" AND ap."role" = 'LEAD'
          JOIN (VALUES ${values}) bk(bucket, a_from, a_to)
            ON ad."createdAtSource" >= bk.a_from AND ad."createdAtSource" < bk.a_to
          WHERE ad."createdAtSource" >= ${from} AND ad."createdAtSource" < ${to}
            AND ad."title" LIKE '%CRM-форм%'
        ) fd`,
    true,
  )
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
 * The brand a form TITLE's form name states — `formNameBrand` in SQL: the
 * form's name today, read against `UNNAMED_FORM_BRANDS`, then
 * `FORM_BRAND_PATTERNS`: 'Zextra', 'Collagen', or NULL (no title, or a name
 * that names neither). The name is cut out, folded and renamed ONCE —
 * `OFFSET 0` fences each step, or the planner inlines the caller's long title
 * expression (a sale's, `saleFormTitleSql`) into every arm.
 */
export function formBrandOfTitleSql(title: string): string {
  return `(SELECT ${currentNameBrandSql('fbn.name')}
            FROM (SELECT ${renamedFormNameSql('fbf.folded')} AS name
                  FROM (SELECT ${foldedFormNameSql('fbt.name')} AS folded
                        FROM (SELECT ${titleFormNameSql(title)} AS name OFFSET 0) fbt OFFSET 0) fbf OFFSET 0) fbn)`
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
