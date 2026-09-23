/**
 * Meta Ads spend, per ad account per day, into `meta_ad_daily`.
 *
 * READ-ONLY BY CONSTRUCTION. The token the client handed over carries
 * `ads_management` as well as `ads_read`; this module issues GET requests and
 * nothing else — there is no code path here that could pause a campaign or
 * change a budget, and `get()` is the only function that touches the network.
 *
 * WHAT IT COSTS META. One `me/adaccounts` call and, per account, two Insights
 * calls per page of daily rows — the account grain and the campaign grain —
 * about forty requests an hour for eighteen accounts. Both are the
 * `ads_insights` budget. Nothing here reads `/ads` or `/campaigns`: those are
 * the `ads_management` budget, which this app holds at development tier, and
 * one pass over the ads' creatives exhausted it on 2026-09-23 («too many calls
 * to this ad-account»). Everything the screen needs — objective, name,
 * conversations — comes back on the Insights row itself.
 *
 * WHICH DAYS. An empty table reads from `META_HISTORY_FROM`; after that the
 * last `META_REFRESH_DAYS` days are re-read every run, because Meta keeps
 * revising a day's spend and leads for several days after it ends.
 */

import type { PrismaClient } from '@/generated/prisma/client'

import { META_ACCOUNT_OWNERS } from './accounts'

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
  readonly campaign_id?: string
  readonly campaign_name?: string
  readonly objective?: string
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

/**
 * People who started an Instagram / Messenger conversation from the ad —
 * the DM campaigns' result, and «Кол мурожат» as far as Meta can see it.
 */
export function metaConversations(row: InsightRow): number {
  const started = row.actions?.find(
    (a) => a.action_type === 'onsite_conversion.messaging_conversation_started_7d',
  )
  return started ? Number(started.value) : 0
}

const CAMPAIGN_SLICE_DAYS = 31

/**
 * `[since, until]` cut into consecutive inclusive windows of at most `days`
 * days. Bare `YYYY-MM-DD` strings in and out, stepped as UTC dates.
 */
export function dateSlices(since: string, until: string, days: number): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = []
  const last = new Date(`${until}T00:00:00Z`).getTime()
  for (let start = new Date(`${since}T00:00:00Z`).getTime(); start <= last; start += days * 86_400_000) {
    const end = Math.min(start + (days - 1) * 86_400_000, last)
    out.push({
      since: new Date(start).toISOString().slice(0, 10),
      until: new Date(end).toISOString().slice(0, 10),
    })
  }
  return out
}

/** First day to (re)read: the history start on an empty table, else a week back. */
function sinceOf(latest: Date | null): string {
  const since = latest
    ? new Date(latest.getTime() - META_REFRESH_DAYS * 86_400_000).toISOString().slice(0, 10)
    : META_HISTORY_FROM
  return since < META_HISTORY_FROM ? META_HISTORY_FROM : since
}

export interface MetaImportResult {
  readonly accounts: number
  readonly rows: number
  /** Campaign-day rows written into `meta_campaign_daily`. */
  readonly campaignRows: number
  /** Accounts Meta refused this run, with its message — stale until the next. */
  readonly failed: readonly string[]
  readonly since: string
  readonly until: string
}

export async function importMetaSpend(
  prisma: PrismaClient,
  token: string,
  today: string,
): Promise<MetaImportResult> {
  const [latest, latestCampaign] = await Promise.all([
    prisma.metaAdDaily.aggregate({ _max: { date: true } }),
    prisma.metaCampaignDaily.aggregate({ _max: { date: true } }),
  ])
  const from = sinceOf(latest._max.date)
  /*
    Its own start: the campaign table arrived after the account table, so on
    its first run it backfills from the history start while the account table
    only refreshes its week.
  */
  const campaignFrom = sinceOf(latestCampaign._max.date)

  const accounts = await listAccounts(prisma, token)
  const failed: string[] = []

  let rows = 0
  let campaignRows = 0
  for (const account of accounts) {
    try {
      const imported = await importAccount(prisma, token, account, { from, campaignFrom, today })
      rows += imported.rows
      campaignRows += imported.campaignRows
    } catch (error) {
      /*
        One account refused is one account stale for an hour, not every
        account stale: the rows of the others are already written, each in
        its own transaction.
      */
      failed.push(`${account.name}: ${(error as Error).message}`)
    }
  }

  if (failed.length === accounts.length && accounts.length > 0) {
    throw new Error(`hech bir akkaunt oʻqilmadi — ${failed[0]}`)
  }
  return { accounts: accounts.length, rows, campaignRows, failed, since: from, until: today }
}

/**
 * The ad accounts behind the token — and, when Meta will not list them, the
 * ones we already know.
 *
 * `me/adaccounts` is an `ads_management` call, and Meta refuses it WHOLE as
 * soon as any one account behind the token is over that budget. On
 * 2026-09-23 four new accounts (Collagen AI targetolog, Zextra Kamron 2 and 3,
 * Zextra Umar 3) sat at 101–103% of it all morning — something else drives
 * them through this app — and the hourly import failed on the listing
 * without reading a single row, although the Insights budget it actually
 * spends was untouched. So a refused listing falls back to every account in
 * `meta_ad_daily` plus the mapped ones, which is the same set minus any
 * account created since the last good listing.
 */
async function listAccounts(prisma: PrismaClient, token: string): Promise<Account[]> {
  try {
    return await getAll<Account>(
      `${GRAPH}/me/adaccounts?${query({ fields: 'account_id,name', limit: '200' }, token)}`,
    )
  } catch (error) {
    const known = await prisma.metaAdDaily.findMany({
      distinct: ['accountId'],
      select: { accountId: true, accountName: true },
      orderBy: [{ accountId: 'asc' }, { date: 'desc' }],
    })
    const byId = new Map(known.map((k) => [k.accountId, k.accountName]))
    for (const id of Object.keys(META_ACCOUNT_OWNERS)) if (!byId.has(id)) byId.set(id, id)
    if (byId.size === 0) throw error
    return [...byId.entries()].map(([account_id, name]) => ({
      account_id,
      name,
    }))
  }
}

async function importAccount(
  prisma: PrismaClient,
  token: string,
  account: Account,
  window: { from: string; campaignFrom: string; today: string },
): Promise<{ rows: number; campaignRows: number }> {
  const { from, campaignFrom, today } = window

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

  /*
    In slices of a month: the first run backfills from July, and a
    campaign × day request that wide on a fifty-campaign account is the
    kind Meta answers with a 500 («reduce the amount of data»).
  */
  const campaigns: InsightRow[] = []
  for (const slice of dateSlices(campaignFrom, today, CAMPAIGN_SLICE_DAYS)) {
    campaigns.push(
      ...(await getAll<InsightRow>(
        `${GRAPH}/act_${account.account_id}/insights?${query(
          {
            level: 'campaign',
            fields: 'campaign_id,campaign_name,objective,spend,impressions,clicks,actions',
            time_range: JSON.stringify(slice),
            time_increment: '1',
            limit: '500',
          },
          token,
        )}`,
      )),
    )
  }

  await prisma.$transaction([
    prisma.metaCampaignDaily.deleteMany({
      where: {
        accountId: account.account_id,
        date: { gte: new Date(`${campaignFrom}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) },
      },
    }),
    prisma.metaCampaignDaily.createMany({
      data: campaigns
        .filter((row) => row.campaign_id)
        .map((row) => ({
          accountId: account.account_id,
          accountName: account.name,
          campaignId: row.campaign_id!,
          campaignName: row.campaign_name ?? '',
          objective: row.objective ?? '',
          date: new Date(`${row.date_start}T00:00:00Z`),
          spendMicroUsd: microUsd(row.spend),
          impressions: BigInt(row.impressions ?? '0'),
          clicks: BigInt(row.clicks ?? '0'),
          leads: metaLeads(row),
          conversations: metaConversations(row),
        })),
    }),
  ])

  return { rows: insights.length, campaignRows: campaigns.length }
}
