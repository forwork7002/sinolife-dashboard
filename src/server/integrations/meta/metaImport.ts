/**
 * Meta Ads spend, per ad account per day, into `meta_ad_daily`.
 *
 * READ-ONLY BY CONSTRUCTION. The token the client handed over carries
 * `ads_management` as well as `ads_read`; this module issues GET requests and
 * nothing else — there is no code path here that could pause a campaign or
 * change a budget, and `get()` is the only function that touches the network.
 *
 * WHAT IT COSTS META. One `me/adaccounts` call and, per account, one Insights
 * call per page of daily rows — about fifteen requests an hour for fourteen
 * accounts. Meta's own limits are per ad account and count in thousands.
 *
 * WHICH DAYS. An empty table reads from `META_HISTORY_FROM`; after that the
 * last `META_REFRESH_DAYS` days are re-read every run, because Meta keeps
 * revising a day's spend and leads for several days after it ends.
 */

import type { PrismaClient } from '@/generated/prisma/client'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Where the history starts: the sheet's first month. */
export const META_HISTORY_FROM = '2026-07-01'
export const META_REFRESH_DAYS = 7

const REQUEST_TIMEOUT_MS = 30_000

interface Page<T> {
  readonly data?: T[]
  readonly paging?: { readonly next?: string }
  readonly error?: { readonly message?: string; readonly code?: number }
}

interface Account {
  readonly account_id: string
  readonly name: string
}

interface InsightRow {
  readonly date_start: string
  readonly spend?: string
  readonly impressions?: string
  readonly clicks?: string
  readonly actions?: readonly { readonly action_type: string; readonly value: string }[]
}

/** The one network call in this module — a GET, every page followed. */
async function getAll<T>(url: string): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  while (next) {
    const response: Response = await fetch(next, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const body = (await response.json()) as Page<T>
    if (!response.ok || body.error) {
      // The message only: the URL carries the token and must never be logged.
      throw new Error(`Meta API ${response.status}: ${body.error?.message ?? 'nomaʼlum xato'}`)
    }
    out.push(...(body.data ?? []))
    next = body.paging?.next
  }
  return out
}

function query(params: Record<string, string>, token: string): string {
  return new URLSearchParams({ ...params, access_token: token }).toString()
}

/** Dollars as text («80.36») to micro-dollars, without a float in between. */
export function microUsd(spend: string | undefined): bigint {
  if (!spend) return 0n
  const [whole, fraction = ''] = spend.split('.')
  return BigInt(whole || '0') * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
}

/** Meta's own lead count — the `lead` action, which already sums its sources. */
export function metaLeads(row: InsightRow): number {
  const lead = row.actions?.find((a) => a.action_type === 'lead')
  return lead ? Number(lead.value) : 0
}

export interface MetaImportResult {
  readonly accounts: number
  readonly rows: number
  readonly since: string
  readonly until: string
}

export async function importMetaSpend(
  prisma: PrismaClient,
  token: string,
  today: string,
): Promise<MetaImportResult> {
  const latest = await prisma.metaAdDaily.aggregate({ _max: { date: true } })
  const since = latest._max.date
    ? new Date(latest._max.date.getTime() - META_REFRESH_DAYS * 86_400_000).toISOString().slice(0, 10)
    : META_HISTORY_FROM
  const from = since < META_HISTORY_FROM ? META_HISTORY_FROM : since

  const accounts = await getAll<Account>(
    `${GRAPH}/me/adaccounts?${query({ fields: 'account_id,name', limit: '200' }, token)}`,
  )

  let rows = 0
  for (const account of accounts) {
    const insights = await getAll<InsightRow>(
      `${GRAPH}/act_${account.account_id}/insights?${query(
        {
          level: 'account',
          fields: 'spend,impressions,clicks,actions',
          time_range: JSON.stringify({ since: from, until: today }),
          time_increment: '1',
          limit: '500',
        },
        token,
      )}`,
    )

    // One statement per account: replace the window, so a day Meta has since
    // zeroed (a refunded spend) does not linger from the previous run.
    await prisma.$transaction([
      prisma.metaAdDaily.deleteMany({
        where: {
          accountId: account.account_id,
          date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) },
        },
      }),
      prisma.metaAdDaily.createMany({
        data: insights.map((row) => ({
          accountId: account.account_id,
          accountName: account.name,
          date: new Date(`${row.date_start}T00:00:00Z`),
          spendMicroUsd: microUsd(row.spend),
          impressions: BigInt(row.impressions ?? '0'),
          clicks: BigInt(row.clicks ?? '0'),
          leads: metaLeads(row),
        })),
      }),
    ])
    rows += insights.length
  }

  return { accounts: accounts.length, rows, since: from, until: today }
}
