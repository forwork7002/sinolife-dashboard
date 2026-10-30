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
 * Per account, never one date for the table (see `importMetaSpend`). The
 * worker also asks, once a night, for a `META_DEEP_REFRESH_DAYS` window — the
 * 28-day attribution Meta revises a day under, and a week over.
 *
 * AND EVERYTHING BEFORE IT (2026-10-22). The client: «hammasini, eskilarini
 * ham torta olishi kerak». `historyMs` walks each account back from
 * `META_HISTORY_FROM` to `metaHistoryFloor` — as far as Insights answers —
 * a bounded step a pass, remembered in `meta_history_read` (see
 * `backfillAccount`), so an account with no older spend is asked once and
 * never again.
 */

import type { PrismaClient } from '@/generated/prisma/client'

import { META_ACCOUNT_OWNERS } from './accounts'

export const GRAPH = 'https://graph.facebook.com/v21.0'

/** Where the history starts: the sheet's first month. */
const META_HISTORY_FROM = '2026-07-01'
const META_REFRESH_DAYS = 7
/** The nightly re-read: Meta's 28-day click attribution, and a week over. */
export const META_DEEP_REFRESH_DAYS = 37
/**
 * How far back Insights answers: 37 months, Meta says, and a start past it is
 * a 400 for the whole request. 36 from the first of the month stays inside.
 */
const META_FLOOR_MONTHS = 36

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
export async function getAll<T>(url: string): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  while (next) {
    const response: Response = await fetch(next, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const body = (await response.json()) as Page<T>
    if (!response.ok || body.error) {
      // The message only: the URL carries the token and must never be logged — nor a token Meta's own text echoes.
      const message = (body.error?.message ?? 'nomaʼlum xato').replace(/EAA[\w-]{20,}/g, '[token]')
      throw new Error(`Meta API ${response.status}: ${message}`)
    }
    out.push(...(body.data ?? []))
    next = body.paging?.next
  }
  return out
}

export function query(params: Record<string, string>, token: string): string {
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

/** Accounts read side by side in one pass — see `importMetaSpend`. */
const META_ACCOUNTS_AT_ONCE = 4

/** `fn` over `items`, at most `width` at a time; the answers in `items`' order. */
async function mapAtMost<T, R>(items: readonly T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane))
  return out
}

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
  refreshDays: number = META_REFRESH_DAYS,
  /**
   * The pass's day and each account's latest account-grain day. Given, an
   * account that has not spent since the history start reads only the refresh
   * window — see `refreshFloor`.
   */
  quiet?: { readonly today: string; readonly adMax: ReadonlyMap<string, Date | null> },
): (accountId: string) => string {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return (accountId) => {
    const have = grain.get(accountId)
    const adStart = adMin.get(accountId) ?? null
    const historyStart = adStart && day(adStart) > META_HISTORY_FROM ? day(adStart) : META_HISTORY_FROM
    if (!have?.min || !have.max) {
      /*
        NO ROWS BECAUSE NOTHING WAS SPENT (2026-10-28). An account whose last
        spend is before the history start — or that never spent — has nothing
        at this grain to backfill, and read from the history start it was
        read July → today on every pass, a month or two weeks a call: the
        pass took 212–242 s every 15 minutes, the log pinned at «2026-07-01 –».
        Its account grain says when it spends again; that pass writes its
        first rows here and the next one backfills them (the signature below).
      */
      if (quiet) {
        const latest = quiet.adMax.get(accountId) ?? null
        if (!latest || day(latest) < historyStart) return refreshFloor(quiet.today, refreshDays)
      }
      return historyStart
    }
    /*
      ONLY THE INTERRUPTED-RUN SIGNATURE: rows that start late AND cover no
      more than one refresh window. An account whose older campaigns (or ads)
      Meta no longer reports at that level (deleted ones) also starts late, but
      after one backfill its span is long — without the span test it would be
      re-read from July every hour, forever.
    */
    const span = (have.max.getTime() - have.min.getTime()) / 86_400_000
    if (day(have.min) > historyStart && span <= META_REFRESH_DAYS + 1) return historyStart
    return sinceOf(have.max, refreshDays)
  }
}

/** `refreshDays` back from `day`, never before the history start. */
export function refreshFloor(today: string, refreshDays: number = META_REFRESH_DAYS): string {
  const floor = new Date(new Date(`${today}T00:00:00Z`).getTime() - refreshDays * 86_400_000).toISOString().slice(0, 10)
  return floor < META_HISTORY_FROM ? META_HISTORY_FROM : floor
}

const latestOf = (a: string, b: string): string => (a > b ? a : b)

/** First day to (re)read: the history start with no rows yet, else `refreshDays` back from the latest. */
function sinceOf(latest: Date | null, refreshDays: number = META_REFRESH_DAYS): string {
  const since = latest
    ? new Date(latest.getTime() - refreshDays * 86_400_000).toISOString().slice(0, 10)
    : META_HISTORY_FROM
  return since < META_HISTORY_FROM ? META_HISTORY_FROM : since
}

/** The first of the month `META_FLOOR_MONTHS` before `today`'s: the oldest day Insights is asked for. */
export function metaHistoryFloor(today: string): string {
  const [year, month] = today.split('-').map(Number)
  const index = year! * 12 + (month! - 1) - META_FLOOR_MONTHS
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/**
 * The next window to read walking BACK from `readFrom` (every day from it on
 * is in) towards `target`: at most `days` days ending the day before
 * `readFrom`, never before `target`. Null once `readFrom` has reached it.
 */
export function backfillSlice(readFrom: string, target: string, days: number): { since: string; until: string } | null {
  if (readFrom <= target) return null
  const start = new Date(`${readFrom}T00:00:00Z`).getTime()
  const until = new Date(start - 86_400_000).toISOString().slice(0, 10)
  const since = new Date(start - days * 86_400_000).toISOString().slice(0, 10)
  return { since: since < target ? target : since, until }
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
  /** Rows of every grain written by the walk back past the history start (`historyMs`). */
  readonly historyRows: number
  /** Accounts whose walk back is not finished — the next pass carries on. */
  readonly historyPending: number
  /**
   * «<account> <first day>» for each account some grain of which was read from
   * before the refresh window — a backfill, a refusal caught up, or (before
   * 2026-10-28) a quiet account re-read every pass. The worker logs them.
   */
  readonly wide: readonly string[]
  /**
   * «<account>: N kun / kampaniya / eʼlon» — what a read left in place because
   * Meta no longer answered for it (2026-10-30): deleted, or access taken
   * away. The worker logs them.
   */
  readonly kept: readonly string[]
}

export interface MetaImportOptions {
  /**
   * Days re-read back from each account's latest — `META_REFRESH_DAYS` by
   * default, `META_DEEP_REFRESH_DAYS` on the nightly pass.
   */
  readonly refreshDays?: number
  /**
   * Time this pass may spend walking accounts back past the history start
   * (`backfillAccount`). 0, the default, does not walk at all.
   */
  readonly historyMs?: number
  /**
   * The last `today` each account's grain was read through without a
   * refusal, keyed `account:` / `campaign:` / `ad:` + the account id — the
   * worker keeps one across passes, and this pass updates it. Absent: every
   * window starts at the rows alone.
   */
  readonly readThrough?: Map<string, string>
}

export async function importMetaSpend(
  prisma: PrismaClient,
  token: string,
  today: string,
  options: MetaImportOptions = {},
): Promise<MetaImportResult> {
  const refreshDays = options.refreshDays ?? META_REFRESH_DAYS
  /*
    THE WALK'S TIME IS ITS OWN (2026-10-22). It was a deadline from the pass's
    start, and the forward read of 28 accounts takes ~300 s — so on the first
    live passes the deadline had passed before the first account's walk:
    «eski tarix: 0 qator» every time. Now only time spent walking is spent.
  */
  let historyLeft = options.historyMs ?? 0
  const floor = metaHistoryFloor(today)
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
  /*
    NO EARLIER THAN A WEEK BEFORE THE LAST GOOD READ (2026-10-28,
    `readThrough`). A window starts at an account's last ROW, and an account
    that stopped spending keeps its last row: each pass re-read from a week
    before it to today — four months for one quiet since July, every 15
    minutes. An account read through today last pass starts a refresh window
    before that; one refused since keeps its own last week, as before.
  */
  const bounded = (key: string, from: string): string => {
    const through = options.readThrough?.get(key)
    return through ? latestOf(from, refreshFloor(through, refreshDays)) : from
  }
  const fromOf = (accountId: string) => bounded(`account:${accountId}`, sinceOf(adMax.get(accountId) ?? null, refreshDays))
  const spans = (grain: typeof campaignSpans) =>
    new Map(grain.map((c) => [c.accountId, { min: c._min.date, max: c._max.date }]))
  const campaignFromOf = grainStarts(adMin, spans(campaignSpans), refreshDays, { today, adMax })
  const adFromOf = grainStarts(adMin, spans(adInsightSpans), refreshDays, { today, adMax })

  const accounts = await listAccounts(prisma, token)
  const failed: string[] = []

  let rows = 0
  let campaignRows = 0
  let adRows = 0
  let unread = 0
  let historyRows = 0
  let historyPending = 0
  /*
    The run's window in the worker's log: the earliest day an account WITH
    rows was read from. One read from the history start because it has none —
    new to the token, or never spent and so asked from July every hour —
    pinned the line at «2026-07-01 – today» for good; it sets the window only
    when no account has rows yet, on the first run.
  */
  let since: string | null = null
  let earliest = today
  const windowStart = refreshFloor(today, refreshDays)
  const wide: string[] = []
  const kept: string[] = []
  /*
    FOUR ACCOUNTS AT A TIME (2026-10-28). One after another, 28 accounts' three
    grains were ~84 Graph calls end to end: 136 s a pass on a week's window,
    every 15 minutes. Meta throttles insights per ad account, and the pass
    makes the same calls as before, only side by side; each account's rows
    are still written in its own transactions. Every account's outcome is
    gathered in the accounts' own order, so the log reads as it did.
  */
  const outcomes = await mapAtMost(accounts, META_ACCOUNTS_AT_ONCE, async (account) => {
    const out = { rows: 0, campaignRows: 0, adRows: 0, failed: [] as string[], wide: [] as string[], kept: [] as string[], read: false }
    const keep = (note: string) => void out.kept.push(note)
    let spentNow = false
    try {
      const from = fromOf(account.account_id)
      if (from < earliest) earliest = from
      if (adMax.get(account.account_id) && (since === null || from < since)) since = from
      const campaignFrom = bounded(`campaign:${account.account_id}`, campaignFromOf(account.account_id))
      const first = from < campaignFrom ? from : campaignFrom
      if (first < windowStart) out.wide.push(`${account.name} ${first}`)
      const imported = await importAccount(prisma, token, account, { from, campaignFrom, today }, keep)
      out.rows = imported.rows
      out.campaignRows = imported.campaignRows
      out.read = true
      spentNow = imported.rows > 0
      options.readThrough?.set(`account:${account.account_id}`, today)
      options.readThrough?.set(`campaign:${account.account_id}`, today)
    } catch (error) {
      /*
        One account refused is one account stale for an hour, not every
        account stale: the rows of the others are already written, each in
        its own transaction.
      */
      out.failed.push(`${account.name}: ${(error as Error).message}`)
      return out
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
    if (adMin.get(account.account_id) || spentNow) {
      try {
        const adFrom = bounded(`ad:${account.account_id}`, adFromOf(account.account_id))
        if (adFrom < windowStart) out.wide.push(`${account.name} · eʼlon ${adFrom}`)
        out.adRows = await importAccountAds(prisma, token, account, { from: adFrom, today }, keep)
        options.readThrough?.set(`ad:${account.account_id}`, today)
      } catch (error) {
        out.failed.push(`${account.name} · eʼlon darajasi: ${(error as Error).message}`)
      }
    }
    return out
  })

  for (const [i, account] of accounts.entries()) {
    const out = outcomes[i]!
    rows += out.rows
    campaignRows += out.campaignRows
    adRows += out.adRows
    failed.push(...out.failed)
    wide.push(...out.wide)
    kept.push(...out.kept)
    if (!out.read) {
      unread += 1
      continue
    }

    /*
      The walk back, last and inside the pass's own time: today's numbers
      come first, and an account Meta refused above was passed over. One
      account at a time — its time is the pass's budget (`historyLeft`).
      A refusal here costs only the walk — it resumes from its marker.
    */
    if (!options.historyMs) continue
    if (historyLeft <= 0) {
      historyPending += 1
      continue
    }
    const walkStarted = Date.now()
    try {
      const walked = await backfillAccount(prisma, token, account, floor, walkStarted + historyLeft)
      historyRows += walked.rows
      if (!walked.done) historyPending += 1
    } catch (error) {
      historyPending += 1
      failed.push(`${account.name} · eski tarix: ${(error as Error).message}`)
    }
    historyLeft -= Date.now() - walkStarted
  }

  if (unread === accounts.length && accounts.length > 0) {
    throw new Error(`hech bir akkaunt oʻqilmadi — ${failed[0]}`)
  }
  return {
    accounts: accounts.length,
    rows,
    campaignRows,
    adRows,
    failed,
    since: since ?? earliest,
    until: today,
    wide,
    kept,
    historyRows,
    historyPending,
  }
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
  keep?: (note: string) => void,
): Promise<{ rows: number; campaignRows: number }> {
  const { from, campaignFrom, today } = window
  const rows = await importAccountGrain(prisma, token, account, { from, until: today }, keep)
  const campaignRows = await importCampaignGrain(prisma, token, account, { from: campaignFrom, until: today }, keep)
  return { rows, campaignRows }
}

/** The account grain for one account, `[from, until]`, replacing that window. */
async function importAccountGrain(
  prisma: PrismaClient,
  token: string,
  account: Account,
  window: { from: string; until: string },
  keep?: (note: string) => void,
): Promise<number> {
  const { from, until } = window

  const insights = await getAll<InsightRow>(
    `${GRAPH}/act_${account.account_id}/insights?${query(
      {
        level: 'account',
        fields: 'spend,impressions,clicks,actions',
        time_range: JSON.stringify({ since: from, until }),
        time_increment: '1',
        limit: '500',
      },
      token,
    )}`,
  )

  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) }
  /*
    WHAT META NO LONGER ANSWERS IS KEPT (2026-10-30). A targetolog who leaves
    takes his access with him — Tursunbek's «Zextra» answered «#200 … has NOT
    grant ads_read» that day, its 05.10 spend still ours — and an account or
    a campaign he deletes can come back as an empty answer, not a refusal.
    Replacing the window with nothing would wipe the history the dashboard
    already holds. So an empty answer over a window that holds spend writes
    nothing and deletes nothing; any answer at all replaces the window, so a
    day Meta has since zeroed (a refunded spend) does not linger.
  */
  if (insights.length === 0) {
    const held = await prisma.metaAdDaily.count({ where: { accountId: account.account_id, date: range, spendMicroUsd: { gt: 0n } } })
    if (held > 0) {
      keep?.(`${account.name}: ${held} kun`)
      return 0
    }
  }

  await prisma.$transaction([
    prisma.metaAdDaily.deleteMany({
      where: {
        accountId: account.account_id,
        date: range,
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
  return insights.length
}

/** The campaign grain for one account, `[from, until]`, replacing that window. */
async function importCampaignGrain(
  prisma: PrismaClient,
  token: string,
  account: Account,
  window: { from: string; until: string },
  keep?: (note: string) => void,
): Promise<number> {
  const { from, until } = window

  /*
    In slices of a month: the first run backfills from July, and a
    campaign × day request that wide on a fifty-campaign account is the
    kind Meta answers with a 500 («reduce the amount of data»).
  */
  const campaigns: InsightRow[] = []
  for (const slice of dateSlices(from, until, CAMPAIGN_SLICE_DAYS)) {
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

  /*
    Only the campaigns Meta answered for are replaced (2026-10-30): one it no
    longer reports — deleted, or behind access since taken away — keeps the
    days the dashboard already holds. See `importAccountGrain`.
  */
  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) }
  const answered = [...new Set(campaigns.flatMap((row) => (row.campaign_id ? [row.campaign_id] : [])))]
  const held = await prisma.metaCampaignDaily.findMany({
    where: { accountId: account.account_id, date: range, spendMicroUsd: { gt: 0n }, campaignId: { notIn: answered } },
    distinct: ['campaignId'],
    select: { campaignId: true },
  })
  if (held.length > 0) keep?.(`${account.name}: ${held.length} kampaniya`)

  await prisma.$transaction([
    prisma.metaCampaignDaily.deleteMany({
      where: {
        accountId: account.account_id,
        date: range,
        campaignId: { in: answered },
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
  return campaigns.length
}

type HistoryGrain = 'account' | 'campaign' | 'ad'

/**
 * One account walked back past `META_HISTORY_FROM`, as far as `deadline`
 * allows, each step written and then remembered in `meta_history_read`.
 *
 * WHY A MARKER AND NOT THE ROWS. An account that never spent before August
 * has no row before August whether it was asked or not; read off the rows,
 * it would be asked for three empty years every pass, forever. The marker
 * is «every day from `readFrom` on has been asked at this grain»; a missing
 * one means `META_HISTORY_FROM`, which the forward pass has always covered.
 *
 * THE ORDER. The account grain first, in one request — a row a day at most,
 * so three years is a few pages — down to the floor. Its earliest row is
 * then the account's first day of spend, and the campaign and ad grains walk
 * only down to it, a month and a fortnight a request as the forward pass
 * slices them: a year of nothing costs one call, not thirty.
 */
async function backfillAccount(
  prisma: PrismaClient,
  token: string,
  account: Account,
  floor: string,
  deadline: number,
): Promise<{ rows: number; done: boolean }> {
  const accountId = account.account_id
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const marks = await prisma.metaHistoryRead.findMany({ where: { accountId } })
  const readFrom = new Map<HistoryGrain, string>(
    (['account', 'campaign', 'ad'] as const).map((g) => {
      const mark = marks.find((m) => m.grain === g)
      return [g, mark ? iso(mark.readFrom) : META_HISTORY_FROM]
    }),
  )
  const remember = (grain: HistoryGrain, day: string) =>
    prisma.metaHistoryRead.upsert({
      where: { accountId_grain: { accountId, grain } },
      create: { accountId, grain, readFrom: new Date(`${day}T00:00:00Z`) },
      update: { readFrom: new Date(`${day}T00:00:00Z`) },
    })

  let rows = 0
  const accountFrom = readFrom.get('account')!
  if (accountFrom > floor) {
    rows += await importAccountGrain(prisma, token, account, {
      from: floor,
      until: new Date(new Date(`${accountFrom}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10),
    })
    await remember('account', floor)
  }

  const first = await prisma.metaAdDaily.aggregate({ where: { accountId }, _min: { date: true } })
  // Never spent at all: nothing below the history start to read at a finer grain.
  if (!first._min.date) return { rows, done: true }
  const target = iso(first._min.date) < floor ? floor : iso(first._min.date)

  const grains = [
    ['campaign', CAMPAIGN_SLICE_DAYS, importCampaignGrain],
    ['ad', AD_SLICE_DAYS, (p: PrismaClient, t: string, a: Account, w: { from: string; until: string }) =>
      importAccountAds(p, t, a, { from: w.from, today: w.until })],
  ] as const
  for (const [grain, days, read] of grains) {
    let from = readFrom.get(grain)!
    while (from > target) {
      /*
        ONLY WHERE THE ACCOUNT SPENT (2026-10-22). Walked a month at a time
        regardless, the first live passes spent their whole budget asking
        Meta for empty months between July and an account's last older
        spend — «eski tarix: 0 qator» pass after pass. The account grain
        already says which days had any: each slice ends on the newest such
        day below what is read, and a stretch with none is skipped unasked.
      */
      const last = await prisma.metaAdDaily.findFirst({
        where: { accountId, date: { gte: new Date(`${target}T00:00:00Z`), lt: new Date(`${from}T00:00:00Z`) } },
        orderBy: { date: 'desc' },
        select: { date: true },
      })
      if (!last) {
        await remember(grain, target)
        break
      }
      const slice = backfillSlice(new Date(last.date.getTime() + 86_400_000).toISOString().slice(0, 10), target, days)!
      if (Date.now() >= deadline) return { rows, done: false }
      rows += await read(prisma, token, account, { from: slice.since, until: slice.until })
      await remember(grain, slice.since)
      from = slice.since
    }
  }
  return { rows, done: true }
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
  keep?: (note: string) => void,
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
  // Only the ads Meta answered for are replaced (2026-10-30) — see `importCampaignGrain`.
  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) }
  const answered = [...new Set(data.map((row) => row.adId))]
  const held = await prisma.metaAdInsightDaily.findMany({
    where: { accountId: account.account_id, date: range, spendMicroUsd: { gt: 0n }, adId: { notIn: answered } },
    distinct: ['adId'],
    select: { adId: true },
  })
  if (held.length > 0) keep?.(`${account.name}: ${held.length} eʼlon`)
  await prisma.$transaction([
    prisma.metaAdInsightDaily.deleteMany({
      where: {
        accountId: account.account_id,
        date: range,
        adId: { in: answered },
      },
    }),
    prisma.metaAdInsightDaily.createMany({ data }),
  ])
  return data.length
}
