/**
 * Meta Ads spend, per ad account per day, into `meta_ad_daily` — and the same
 * spend per campaign (`meta_campaign_daily`) and per ad, with its ad set and
 * campaign (`meta_ad_insight_daily`).
 *
 * READ-ONLY BY CONSTRUCTION. The token the client handed over carries
 * `ads_management` as well as `ads_read`; this module issues GET requests and
 * nothing else — there is no code path here that could pause a campaign or
 * change a budget, and `get()` is the only function that touches the network.
 *
 * WHAT IT COSTS META. One `me/adaccounts` call and, per account, three
 * Insights calls per page of daily rows — the account grain, the campaign
 * grain and the ad grain — about sixty requests an hour for eighteen to
 * twenty-two accounts, plus a few more per account while the ad grain is
 * backfilled (fourteen-day slices from the history start, about seven — the
 * first pass after the deploy reads ~150 of them inline, so that tick's
 * Bitrix24 pass waits a few minutes). An account that has never spent is not
 * asked for its ads at all. All
 * three are the `ads_insights` budget, all GET. Nothing here reads `/ads`,
 * `/adsets` or `/campaigns`: those are the `ads_management` budget, which this
 * app holds at development tier, and one pass over the ads' creatives
 * exhausted it on 2026-09-23 («too many calls to this ad-account»). Everything
 * the screens need — objective, the campaign / ad set / ad names,
 * conversations, reach — comes back on the Insights row itself.
 *
 * WHICH DAYS. An account with no rows yet reads from `META_HISTORY_FROM`;
 * after that its last `META_REFRESH_DAYS` days are re-read every run, because
 * Meta keeps revising a day's spend and leads for several days after it ends.
 * Per account, never one date for the table (see `importMetaSpend`).
 */

import type { PrismaClient } from '@/generated/prisma/client'

import { META_ACCOUNT_OWNERS } from './accounts'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Where the history starts: the sheet's first month. */
const META_HISTORY_FROM = '2026-07-01'
const META_REFRESH_DAYS = 7

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
  readonly adset_id?: string
  readonly adset_name?: string
  readonly ad_id?: string
  readonly ad_name?: string
  readonly spend?: string
  readonly impressions?: string
  readonly reach?: string
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
/*
  Ad × day is the widest request this module makes — an account running
  eighty ads answers ~1 100 rows a fortnight — so the ad grain reads half the
  campaign grain's month, to stay well clear of Meta's «reduce the amount of
  data» 500.
*/
const AD_SLICE_DAYS = 14

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

/**
 * Where each account's rows of a FINER grain start being read — the campaign
 * grain (`meta_campaign_daily`) and the ad grain (`meta_ad_insight_daily`),
 * each called with its own table's spans. Per account, never one date for all.
 *
 * One table-wide «latest» broke the first backfill on 2026-09-23: the hourly
 * pass started it at 07:06 UTC, a deploy killed the worker at 07:08 with some
 * accounts written back to July and the rest untouched, and the next pass saw
 * a non-empty table and read one week for everybody. The untouched accounts
 * would never have had their history.
 *
 * So an account whose grain rows begin LATER than its own account-grain
 * rows (`meta_ad_daily`, which has the full history) and span only one
 * refresh window is missing its start and is read from there; one with no
 * grain rows at all from the history start; anyone else refreshes its last
 * week, as before. The ad grain arrived on 2026-10-05 into an empty table, so
 * its first pass is exactly the «no rows» case: every account from its own
 * history start.
 */
export function grainStarts(
  adMin: ReadonlyMap<string, Date | null>,
  grain: ReadonlyMap<string, { min: Date | null; max: Date | null }>,
): (accountId: string) => string {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return (accountId) => {
    const have = grain.get(accountId)
    const adStart = adMin.get(accountId) ?? null
    const historyStart = adStart && day(adStart) > META_HISTORY_FROM ? day(adStart) : META_HISTORY_FROM
    if (!have?.min || !have.max) return historyStart
    /*
      ONLY THE INTERRUPTED-RUN SIGNATURE: rows that start late AND cover no
      more than one refresh window. An account whose older campaigns (or ads)
      Meta no longer reports at that level (deleted ones) also starts late, but
      after one backfill its span is long — without the span test it would be
      re-read from July every hour, forever.
    */
    const span = (have.max.getTime() - have.min.getTime()) / 86_400_000
    if (day(have.min) > historyStart && span <= META_REFRESH_DAYS + 1) return historyStart
    return sinceOf(have.max)
  }
}

/** First day to (re)read: the history start with no rows yet, else a week back from the latest. */
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
  /** Ad-day rows written into `meta_ad_insight_daily`. */
  readonly adRows: number
  /**
   * Accounts Meta refused this run, with its message — stale until the next.
   * An ad-grain refusal is listed on its own line («… · eʼlon darajasi»): that
   * account's account and campaign rows were still written.
   */
  readonly failed: readonly string[]
  /** The run's refresh window for the worker's log — see `importMetaSpend`. */
  readonly since: string
  readonly until: string
}

export async function importMetaSpend(
  prisma: PrismaClient,
  token: string,
  today: string,
): Promise<MetaImportResult> {
  const [adSpans, campaignSpans, adInsightSpans] = await Promise.all([
    prisma.metaAdDaily.groupBy({ by: ['accountId'], _min: { date: true }, _max: { date: true } }),
    prisma.metaCampaignDaily.groupBy({ by: ['accountId'], _min: { date: true }, _max: { date: true } }),
    prisma.metaAdInsightDaily.groupBy({ by: ['accountId'], _min: { date: true }, _max: { date: true } }),
  ])
  const adMin = new Map(adSpans.map((a) => [a.accountId, a._min.date]))
  /*
    THE ACCOUNT GRAIN STARTS PER ACCOUNT TOO (2026-10-06). It read from the
    TABLE's latest day less a week, so an account the token gained after the
    table had filled — Zextra Kamron 2 and 3 and Umar 3 joined after 19.09 —
    or one Meta refused for more than a week while the others moved that day
    on, never had its earlier days asked for: `meta_campaign_daily` held them
    from July (`grainStarts`), `meta_ad_daily` — what /target reads — only
    from the week before it appeared. An account with no rows reads from the
    history start, any other its own last week. One that has never spent is
    asked from July every hour: one paged account-level call.
  */
  const adMax = new Map(adSpans.map((a) => [a.accountId, a._max.date]))
  const fromOf = (accountId: string) => sinceOf(adMax.get(accountId) ?? null)
  const spans = (grain: typeof campaignSpans) =>
    new Map(grain.map((c) => [c.accountId, { min: c._min.date, max: c._max.date }]))
  const campaignFromOf = grainStarts(adMin, spans(campaignSpans))
  const adFromOf = grainStarts(adMin, spans(adInsightSpans))

  const accounts = await listAccounts(prisma, token)
  const failed: string[] = []

  let rows = 0
  let campaignRows = 0
  let adRows = 0
  let unread = 0
  /*
    The run's window in the worker's log: the earliest day an account WITH
    rows was read from. One read from the history start because it has none —
    new to the token, or never spent and so asked from July every hour —
    pinned the line at «2026-07-01 – today» for good; it sets the window only
    when no account has rows yet, on the first run.
  */
  let since: string | null = null
  let earliest = today
  for (const account of accounts) {
    let spentNow = false
    try {
      const from = fromOf(account.account_id)
      if (from < earliest) earliest = from
      if (adMax.get(account.account_id) && (since === null || from < since)) since = from
      const campaignFrom = campaignFromOf(account.account_id)
      const imported = await importAccount(prisma, token, account, { from, campaignFrom, today })
      rows += imported.rows
      campaignRows += imported.campaignRows
      spentNow = imported.rows > 0
    } catch (error) {
      /*
        One account refused is one account stale for an hour, not every
        account stale: the rows of the others are already written, each in
        its own transaction.
      */
      failed.push(`${account.name}: ${(error as Error).message}`)
      unread += 1
      continue
    }

    /*
      The ad grain AFTER the other two have committed, and in a try of its
      own: it is the widest request and the likeliest to be refused, and a
      refusal here must not cost the account its spend and campaign rows,
      which /target, «Reklama samarasi», «Lidlar» and RNP read. Not counted
      in `unread` — the account WAS read.
    */
    /*
      AN ACCOUNT THAT HAS NEVER SPENT IS NOT ASKED FOR ITS ADS. Its ad rows
      would start nowhere, so every hour would re-read it from the history
      start — seven empty slices for «Zapas Collagen» and Newgen_davi01,
      forever. It is asked the hour its account grain first shows a day.
    */
    if (!adMin.get(account.account_id) && !spentNow) continue
    try {
      adRows += await importAccountAds(prisma, token, account, { from: adFromOf(account.account_id), today })
    } catch (error) {
      failed.push(`${account.name} · eʼlon darajasi: ${(error as Error).message}`)
    }
  }

  if (unread === accounts.length && accounts.length > 0) {
    throw new Error(`hech bir akkaunt oʻqilmadi — ${failed[0]}`)
  }
  return { accounts: accounts.length, rows, campaignRows, adRows, failed, since: since ?? earliest, until: today }
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

/**
 * One ad-grain Insights row as a `meta_ad_insight_daily` row — or null for a
 * row Meta sent without an `ad_id`, which has no key to be stored under.
 */
export function adInsightRow(account: Account, row: InsightRow) {
  if (!row.ad_id) return null
  return {
    accountId: account.account_id,
    accountName: account.name,
    campaignId: row.campaign_id ?? '',
    campaignName: row.campaign_name ?? '',
    objective: row.objective ?? '',
    adsetId: row.adset_id ?? '',
    adsetName: row.adset_name ?? '',
    adId: row.ad_id,
    adName: row.ad_name ?? '',
    date: new Date(`${row.date_start}T00:00:00Z`),
    spendMicroUsd: microUsd(row.spend),
    impressions: BigInt(row.impressions || '0'),
    // Per day: summing it over a window overstates unique reach (schema.prisma).
    reach: BigInt(row.reach || '0'),
    clicks: BigInt(row.clicks || '0'),
    leads: metaLeads(row),
  }
}

/** The ad grain for one account, `[from, today]`, replacing that window. */
async function importAccountAds(
  prisma: PrismaClient,
  token: string,
  account: Account,
  window: { from: string; today: string },
): Promise<number> {
  const { from, today } = window

  // Every slice read before anything is deleted: a refusal halfway through
  // leaves the previous run's rows standing rather than a hole.
  const ads: InsightRow[] = []
  for (const slice of dateSlices(from, today, AD_SLICE_DAYS)) {
    ads.push(
      ...(await getAll<InsightRow>(
        `${GRAPH}/act_${account.account_id}/insights?${query(
          {
            level: 'ad',
            fields:
              'campaign_id,campaign_name,objective,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,actions',
            time_range: JSON.stringify(slice),
            time_increment: '1',
            limit: '500',
          },
          token,
        )}`,
      )),
    )
  }

  const data = ads.flatMap((row) => adInsightRow(account, row) ?? [])
  await prisma.$transaction([
    prisma.metaAdInsightDaily.deleteMany({
      where: {
        accountId: account.account_id,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) },
      },
    }),
    prisma.metaAdInsightDaily.createMany({ data }),
  ])
  return data.length
}
