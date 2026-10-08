/**
 * Meta lead-form LEADS into `meta_lead` — each with the campaign and ad that
 * brought it and the phone it was filed under, so «Reklama samarasi» can
 * count a campaign's kval (`ReklamaRepository.campaignLeads`).
 *
 * READ-ONLY, like `metaImport.ts`: GET requests through its `getAll`, nothing
 * else. None of it is an ad-account call — pages, their forms and the forms'
 * leads are the PAGE's budget, so this cannot starve the Insights import.
 *
 * WHAT THE TOKEN NEEDS. `leads_retrieval` and `pages_show_list` (with
 * `pages_read_engagement` / `pages_manage_ads`), and a role on the page. A
 * page or form the token cannot read is listed in `failed` and skipped: its
 * campaigns then show fewer leads read than Meta counted, never a wrong kval.
 *
 * WHICH LEADS. A form with no rows yet is read whole — Meta keeps a lead for
 * 90 days — and after that only what was filed since its newest row, less an
 * hour's overlap (a lead is never revised, so `skipDuplicates` settles the
 * overlap). A form that is no longer active is read once, on the first run
 * (while the table is empty), and then left. A run stops asking after
 * `RUN_BUDGET_MS` and the next one carries on: a form is written whole or not
 * at all, so nothing read short is ever taken for read.
 */

import type { PrismaClient } from '@/generated/prisma/client'

import { GRAPH, getAll, query } from './metaImport'

const OVERLAP_MS = 3_600_000
/** Rows per page: a lead carries every answer, and 500 of them is the size Meta refuses. */
const LEADS_PER_PAGE = '200'

interface PageRow {
  readonly id: string
  readonly name?: string
  readonly access_token?: string
}

interface FormRow {
  readonly id: string
  readonly name?: string
  readonly status?: string
}

export interface LeadRow {
  readonly id: string
  readonly created_time?: string
  readonly campaign_id?: string
  readonly adset_id?: string
  readonly ad_id?: string
  readonly field_data?: readonly { readonly name?: string; readonly values?: readonly string[] }[]
}

/*
  The form's own phone question («phone_number») and the ones targetologs
  write themselves («telefon_raqamingiz?», «Телефон номер»). Both are kept:
  the portal files the deal under one of them, and they can differ.
*/
const PHONE_FIELD = /phone|telefon|\btel\b|телефон|raqam|рақам|ракам|номер|nomer|whatsapp|контакт/i
/** «Karta raqami», «pasport nomeri»: a number, and not one this table may keep. */
const NOT_A_PHONE = /kart|card|карт|pasport|passport|паспорт|inn|инн|pinfl|жшшир/i

/** Every phone a lead carries, as its last nine digits — how the portal's numbers are matched. */
export function leadPhoneKeys(lead: LeadRow): string[] {
  const keys = new Set<string>()
  for (const field of lead.field_data ?? []) {
    const name = field.name ?? ''
    if (!PHONE_FIELD.test(name) || NOT_A_PHONE.test(name)) continue
    for (const value of field.values ?? []) {
      const digits = value.replace(/\D/g, '')
      if (digits.length >= 9) keys.add(digits.slice(-9))
    }
  }
  return [...keys]
}

/** One Meta lead as a `meta_lead` row — or null without the time that dates it. */
export function metaLeadRow(page: { id: string }, form: { id: string; name: string }, lead: LeadRow) {
  const created = lead.created_time ? new Date(lead.created_time) : null
  if (!created || Number.isNaN(created.getTime())) return null
  return {
    id: lead.id,
    pageId: page.id,
    formId: form.id,
    formName: form.name,
    campaignId: lead.campaign_id ?? '',
    adsetId: lead.adset_id ?? '',
    adId: lead.ad_id ?? '',
    phoneKeys: leadPhoneKeys(lead),
    createdTime: created,
  }
}

/** A refusal as one bounded log line: page and form names are Meta's text, written by whoever made the form. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, 300)
}

export interface MetaLeadImportResult {
  readonly pages: number
  readonly forms: number
  /** Leads written this run (new ones only). */
  readonly leads: number
  /** Pages and forms Meta refused, with its message. */
  readonly failed: readonly string[]
}

/**
 * How long one run may read before it leaves the rest to the next: the worker
 * awaits it inside its tick, and the portal's sync waits behind it. A whole
 * first read measured 130 s (2026-10-08: 48 forms, 14 955 leads).
 */
const RUN_BUDGET_MS = 300_000

export async function importMetaLeads(
  prisma: PrismaClient,
  token: string,
  budgetMs: number = RUN_BUDGET_MS,
): Promise<MetaLeadImportResult> {
  const deadline = Date.now() + budgetMs
  const pages = await getAll<PageRow>(
    `${GRAPH}/me/accounts?${query({ fields: 'id,name,access_token', limit: '100' }, token)}`,
  )
  const newest = new Map(
    (await prisma.metaLead.groupBy({ by: ['formId'], _max: { createdTime: true } })).map((f) => [
      f.formId,
      f._max.createdTime,
    ]),
  )

  // Past the first run a closed form with nothing stored has nothing to give: asking it every hour is a call for no row.
  const firstRun = newest.size === 0
  const failed: string[] = []
  let forms = 0
  let leads = 0
  let outOfTime = false
  for (const page of pages) {
    if (outOfTime) break
    const pageName = page.name ?? page.id
    // A page the token only lists, with no token of its own, has no forms to give.
    if (!page.access_token) continue
    let pageForms: FormRow[]
    try {
      pageForms = await getAll<FormRow>(
        `${GRAPH}/${page.id}/leadgen_forms?${query({ fields: 'id,name,status', limit: '100' }, page.access_token)}`,
      )
    } catch (error) {
      failed.push(oneLine(`${pageName}: ${(error as Error).message}`))
      continue
    }

    for (const form of pageForms) {
      const latest = newest.get(form.id) ?? null
      if (form.status !== 'ACTIVE' && (latest || !firstRun)) continue
      if (Date.now() >= deadline) {
        failed.push('vaqt tugadi — qolgan formalar keyingi oʻqishda')
        outOfTime = true
        break
      }
      forms += 1
      const formName = form.name ?? form.id
      try {
        const rows = await getAll<LeadRow>(
          `${GRAPH}/${form.id}/leads?${query(
            {
              fields: 'created_time,campaign_id,adset_id,ad_id,field_data',
              limit: LEADS_PER_PAGE,
              ...(latest
                ? {
                    filtering: JSON.stringify([
                      {
                        field: 'time_created',
                        operator: 'GREATER_THAN',
                        value: Math.floor((latest.getTime() - OVERLAP_MS) / 1000),
                      },
                    ]),
                  }
                : {}),
            },
            page.access_token,
          )}`,
        )
        const data = rows.flatMap((lead) => metaLeadRow(page, { id: form.id, name: formName }, lead) ?? [])
        if (data.length === 0) continue
        const written = await prisma.metaLead
          .createMany({ data, skipDuplicates: true })
          // Its name only: a database error's text can quote the row, and the row holds phone keys.
          .catch((error: unknown) => Promise.reject(new Error(`yozilmadi (${(error as Error).name})`)))
        leads += written.count
      } catch (error) {
        failed.push(oneLine(`${pageName} · ${formName}: ${(error as Error).message}`))
      }
    }
  }
  return { pages: pages.length, forms, leads, failed }
}
