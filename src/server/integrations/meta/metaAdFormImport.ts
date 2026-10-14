/**
 * Which lead form each lead-form ad points at, into `meta_ad_form` — read
 * once per ad off its creative (2026-10-14).
 *
 * WHY. «Formalar · Facebook» lists the forms the token's pages list and
 * files an ad's money under the form its own leads name (`meta_lead`). The
 * ads also run forms on pages the token is not assigned to — measured that
 * day: 70 forms on 16 pages (Sinolife.uzb alone 23) — and Meta refuses
 * both the page's form list and the form itself, so neither route reached
 * them and their money stood under «Forma aniqlanmagan». The creative names
 * the form (`lead_gen_form_id`) and the page (`actor_id` /
 * `object_story_spec.page_id`), and the creative is an AD-ACCOUNT read.
 *
 * WHAT IT COSTS META. The creative is the `ads_management` budget, which one
 * pass over every ad's creative exhausted on 2026-09-23 (metaImport.ts). So
 * an ad is read ONCE — the row stays, `formId` '' when the creative names no
 * form — only lead-form ads that spent and no read lead already maps, newest
 * spend first, `MAX_ADS` a pass, `BATCH` ads per request through the
 * account's own `ads` edge filtered by id (Graph's `?ids=` is refused since
 * v26). An ad the account no longer returns is stored with no form, so it is
 * not asked again. A refusal stops the pass; the next hour carries on.
 *
 * READ-ONLY, like the rest of this directory: GET requests and nothing else.
 */

import type { PrismaClient } from '@/generated/prisma/client'

import { GRAPH, getAll, query } from './metaImport'

const BATCH = 50
const MAX_ADS = 300

/** Every delivery state, so a paused, archived or deleted ad is still answered. */
const EVERY_STATUS = [
  'ACTIVE',
  'PAUSED',
  'DELETED',
  'ARCHIVED',
  'CAMPAIGN_PAUSED',
  'ADSET_PAUSED',
  'DISAPPROVED',
  'WITH_ISSUES',
  'IN_PROCESS',
  'PENDING_REVIEW',
  'PREAPPROVED',
  'PENDING_BILLING_INFO',
]

/** The form and page an ad's creative names; `formId` '' when it names none. */
export function adFormOf(ad: unknown): { formId: string; pageId: string } {
  const creative = (ad as { creative?: Record<string, unknown> } | null)?.creative
  if (!creative) return { formId: '', pageId: '' }
  const text = JSON.stringify(creative)
  // Wherever the creative keeps it: a link ad's call to action, a video's, a dynamic creative's asset feed.
  const formId = /"lead_gen_form_id":"(\d+)"/.exec(text)?.[1] ?? ''
  const spec = creative.object_story_spec as { page_id?: string } | undefined
  const pageId = spec?.page_id ?? (typeof creative.actor_id === 'string' ? creative.actor_id : '')
  return { formId, pageId }
}

export interface MetaAdFormImportResult {
  /** Ads read this pass. */
  readonly ads: number
  /** Of them, the ones whose creative names a form. */
  readonly withForm: number
  readonly failed: readonly string[]
}

export async function importMetaAdForms(prisma: PrismaClient, token: string): Promise<MetaAdFormImportResult> {
  const pending = await prisma.$queryRaw<{ adId: string; accountId: string }[]>`
    SELECT a."adId", min(a."accountId") AS "accountId"
    FROM "meta_ad_insight_daily" a
    WHERE a."objective" IN ('OUTCOME_LEADS', 'LEAD_GENERATION')
      AND a."spendMicroUsd" > 0
      AND NOT EXISTS (SELECT 1 FROM "meta_ad_form" f WHERE f."adId" = a."adId")
      AND NOT EXISTS (SELECT 1 FROM "meta_lead" m WHERE m."adId" = a."adId")
    GROUP BY a."adId"
    ORDER BY max(a."date") DESC, a."adId"
    LIMIT ${MAX_ADS}
  `
  const byAccount = new Map<string, string[]>()
  for (const p of pending) byAccount.set(p.accountId, [...(byAccount.get(p.accountId) ?? []), p.adId])

  const failed: string[] = []
  let ads = 0
  let withForm = 0
  outer: for (const [accountId, adIds] of byAccount) {
    for (let i = 0; i < adIds.length; i += BATCH) {
      const ids = adIds.slice(i, i + BATCH)
      let rows: { id: string; creative?: unknown }[]
      try {
        rows = await getAll<{ id: string; creative?: unknown }>(
          `${GRAPH}/act_${accountId}/ads?${query(
            {
              fields: 'id,creative{actor_id,object_story_spec,asset_feed_spec}',
              filtering: JSON.stringify([
                { field: 'id', operator: 'IN', value: ids },
                { field: 'effective_status', operator: 'IN', value: EVERY_STATUS },
              ]),
              limit: String(BATCH),
            },
            token,
          )}`,
        )
      } catch (error) {
        // A refused budget or a dead request: stop here, the rest is asked next hour.
        failed.push((error as Error).message.slice(0, 300))
        break outer
      }
      const found = new Map(rows.map((r) => [r.id, adFormOf(r)]))
      const data = ids.map((adId) => ({ adId, ...(found.get(adId) ?? { formId: '', pageId: '' }) }))
      await prisma.metaAdForm.createMany({ data, skipDuplicates: true })
      ads += data.length
      withForm += data.filter((d) => d.formId !== '').length
    }
  }
  return { ads, withForm, failed }
}
