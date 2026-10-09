/**
 * «Лид назорати» — the watch block on «Lidlar»: seven things that go wrong
 * with a lead in the first minutes of its life, each as a list of the rows it
 * is wrong for, and the working day's intake hour by hour. Pure: rows in, a
 * DTO out — no framework, no database, no clock of its own.
 *
 * Asked for on 2026-10-09. The screens beside it count what HAPPENED over a
 * period; this one says what is WAITING right now, so it has no period and no
 * brand switch — always today, in the app's time zone, the whole company.
 *
 * WHO IS WATCHED. Every deal-based check reads one population: deals in
 * Регистрация created today, still OPEN, and not «Исход» — an operator's own
 * outgoing call opens a deal that nobody is waiting on. The caller hands them
 * in already narrowed (`WatchLead`, `open`); the intake chart and «Канал
 * стоп» count the same leads whatever became of them.
 *
 * EVERY THRESHOLD COMES FROM `LEAD_WATCH_SETTINGS` (src/lib), handed in as an
 * argument — the client asked for one file to change them in, and the page
 * colours its timers from the same numbers. Nothing here is a literal.
 *
 * A ROW BECOMES A PROBLEM STRICTLY PAST ITS `warn` MINUTES AND RED AT ITS
 * `critical` MINUTES EXACTLY. «10 daqiqadan oshdi» is the eleventh minute's
 * business; «30 daqiqa» is red the moment the timer reads 30:00, because the
 * page draws that same timer from the same number and the two must turn
 * together.
 *
 * The wire shapes below are mirrored for the client in
 * `src/features/leads/leadWatchApi.ts`. Nothing checks the mirror — edit both.
 */

import type { LeadWatchSettings as SettingsFile } from '@/lib/leadWatchSettings'

import { phoneKey } from '../calls/inboundCalls'
import { zonedHour, zonedHourStart } from '../period/period'
import type { LeadChannel, LeadTile } from './leadSources'

type Loose<T> = T extends number ? number : { readonly [K in keyof T]: Loose<T[K]> }

/**
 * The settings file's shape with its numbers as numbers. The file is declared
 * `as const`, so its own type pins every threshold to the literal it holds
 * today (`maxRows: 300`) — and nothing but that one object would fit it, not
 * a test's settings and not a later override. `LEAD_WATCH_SETTINGS` is still
 * assignable here, and a field renamed there still fails to compile here.
 */
export type LeadWatchSettings = Loose<SettingsFile>

// ---------------------------------------------------------------------------
// Wire shapes — `GET /api/v1/leads/watch`
// ---------------------------------------------------------------------------

/** The four channels the client filters by; everything else is `other`. «Исход» is never here. */
export type WatchChannel = 'generated' | 'smm' | 'inbound' | 'telegram' | 'other'
export const WATCH_CHANNELS: readonly WatchChannel[] = Object.freeze(['generated', 'smm', 'inbound', 'telegram', 'other'])

export type WatchSeverity = 'ok' | 'warn' | 'critical'

export type WatchIssueKind = 'unassigned' | 'idle' | 'chats' | 'missedCalls' | 'channelStop' | 'uneven' | 'noProject'

/** Every kind, in the order the page draws its cards — and the order `issues` is sent in. */
export const WATCH_ISSUE_KINDS: readonly WatchIssueKind[] = Object.freeze([
  'unassigned',
  'idle',
  'chats',
  'missedCalls',
  'channelStop',
  'uneven',
  'noProject',
])

export type WatchBrand = 'Collagen' | 'Zextra'

export interface LeadWatchRowDto {
  /** Unique within its issue. */
  readonly key: string
  /** Bitrix24 deal id for the «Ochish» link; null when the row is not a deal (a call with no deal, a form, a ROP). */
  readonly dealId: string | null
  /** The customer's name, else the deal title, a phone number, a form or a ROP. */
  readonly title: string
  readonly channel: WatchChannel | null
  readonly brand: WatchBrand | null
  /** «Ответственный». */
  readonly owner: string | null
  /** «РОП (Первичка)». */
  readonly rop: string | null
  /** ISO instant the waiting counts from; null when the row has no timer (uneven split, arrival rate). */
  readonly since: string | null
  /** One short Uzbek line under the title: the form, the line, «reja 20 · keldi 31». */
  readonly note: string | null
}

export interface LeadWatchIssueDto {
  readonly kind: WatchIssueKind
  /** The real count, even when `rows` is capped. */
  readonly count: number
  readonly severity: WatchSeverity
  /** The longest wait among the rows, ISO; null when nothing waits. */
  readonly oldestSince: string | null
  /** A ready Uzbek sub-line for cards without a timer («1 forma», «2 ROP»); null → the client shows the longest wait. */
  readonly summary: string | null
  readonly byChannel: Readonly<Record<WatchChannel, number>>
  /** Longest waiting first. */
  readonly rows: readonly LeadWatchRowDto[]
}

export interface LeadWatchFlowHourDto {
  /** Tashkent hour the bar starts at: 9 is 09:00–10:00. */
  readonly hour: number
  readonly counts: Readonly<Record<WatchChannel, number>>
  /** The same hour's average over the history days, every channel together. */
  readonly average: number
  /** False for an hour that has not started yet. */
  readonly past: boolean
}

export interface LeadWatchStopDto {
  /** The hour the silence began in — the first bar the band covers. */
  readonly fromHour: number
  /** EXCLUSIVE: the band covers the bars `fromHour` … `toHour` − 1, the last being the hour now running. */
  readonly toHour: number
  /** «Ген лид · Umar formasi · 60 daq lead yoʻq». */
  readonly label: string
}

export interface LeadWatchDto {
  /** ISO instant the answer was computed. */
  readonly generatedAt: string
  /** ISO instant of the oldest feed under it (deals sync, calls, chats); null when never synced. */
  readonly dataAsOf: string | null
  /** How many issues are `critical`. */
  readonly critical: number
  readonly issues: readonly LeadWatchIssueDto[]
  readonly flow: {
    readonly hours: readonly LeadWatchFlowHourDto[]
    readonly stops: readonly LeadWatchStopDto[]
  }
}

/** `GET /api/v1/leads/watch/summary` — what the sidebar badge and the tab title need. */
export interface LeadWatchSummaryDto {
  readonly critical: number
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * A lead's channel as the watch files it: the tile «Lid manbalari» counts it
 * on (`leadTile` over the client's written SOURCE_ID list of 2026-10-09), so
 * a chip here and a tile there are the same leads. «Сммщик ии» is «СММ»;
 * «Веб сайт» and a source the list does not name are «other». Null for
 * «Исход» — an operator's own call is not a lead that came in, form or not.
 */
export function watchChannel(tile: LeadTile): WatchChannel | null {
  switch (tile) {
    case 'generated':
    case 'inbound':
    case 'telegram':
      return tile
    case 'aiSmm':
      return 'smm'
    case 'outbound':
      return null
    case 'web':
    case 'sarafan':
    case 'other':
      return 'other'
  }
}

/** A feed «Канал стоп» watches: one lead form, or one SMM page. */
export interface WatchFeed {
  /** `form|<name>` or `source|<SOURCE_ID>` — «Lid manbalari»'s own line key. */
  readonly key: string
  /** The form's name, or the page's as the portal names its source. */
  readonly name: string
  readonly channel: 'generated' | 'smm'
  readonly brand: WatchBrand | null
}

/**
 * The feed a lead came through, or null when it has none worth watching: a
 * form by its name, an ad page or an SMM source by its source. A hand-typed
 * «Ген лид», a call, a Telegram line have no hourly rhythm to fall silent.
 */
export function watchFeed(
  channel: LeadChannel,
  formName: string | null,
  sourceId: string | null,
  sourceName: string | null,
  brand: WatchBrand | null,
): WatchFeed | null {
  if (channel === 'form' && formName !== null) return { key: `form|${formName}`, name: formName, channel: 'generated', brand }
  if ((channel === 'page' || channel === 'smm') && sourceId !== null) {
    return { key: `source|${sourceId}`, name: sourceName ?? sourceId, channel: 'smm', brand }
  }
  return null
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A Регистрация deal created today — «Исход» already left out by the caller. */
export interface WatchLead {
  /** The Bitrix24 deal id. */
  readonly dealId: string
  readonly title: string
  readonly customerName: string | null
  /** `createdAtSource` — every deal timer counts from it. */
  readonly createdAt: Date
  /** Status OPEN and not parked in «Дубликат (лид)». Only an open lead can be a problem; a closed one still counts in the intake. */
  readonly open: boolean
  /** Still on one of Регистрация's intake stages (`REGISTRATION_INTAKE_STAGE_IDS`). */
  readonly firstStage: boolean
  readonly channel: WatchChannel
  readonly brand: WatchBrand | null
  readonly feed: WatchFeed | null
  /** The form, else the source — the row's note. */
  readonly origin: string | null
  /** «Ответственный». */
  readonly owner: string | null
  /** «РОП (Первичка)», else «ROP KVAL LID», by name. */
  readonly rop: string | null
  /** Either of the two is filled. */
  readonly ropAssigned: boolean
  /** «Проект» is filled. */
  readonly projectFilled: boolean
  /**
   * The newest call today on the deal or on its contact that means somebody
   * WORKED the lead: an outgoing call (answered or not), or any call that
   * connected. The customer's own unanswered ring is not one.
   */
  readonly lastCallAt: Date | null
  /**
   * A late «Qayta zayavka» copy (`leadFormSql.ts`): a form filled days ago
   * whose deal the portal's robot opened today. It IS an open deal somebody
   * must take, so it can be a row of any issue — but it is no lead of this
   * hour, so the intake chart and «Канал стоп» leave it out, as «Lidlar» does.
   */
  readonly replayed: boolean
}

/** One feed's — or one feedless channel's — leads in one clock hour of one past day. */
export interface FeedHourRow {
  /** `YYYY-MM-DD` in the app's time zone. */
  readonly day: string
  /** 0–23, the app's time zone. */
  readonly hour: number
  readonly channel: WatchChannel
  readonly feed: WatchFeed | null
  readonly leads: number
}

/** An open-line chat a person holds open, with the deal it belongs to. */
export interface WatchChat {
  /** The activity's portal id. */
  readonly key: string
  /** Null when the chat's deal is not imported (yet). */
  readonly dealId: string | null
  readonly title: string
  readonly channel: WatchChannel | null
  readonly brand: WatchBrand | null
  /** The chat's responsible — not the deal's. */
  readonly owner: string | null
  readonly rop: string | null
  readonly openedAt: Date
  /** The open line's name, from the activity's subject. */
  readonly line: string | null
}

export interface WatchInboundCall {
  /** As the PBX wrote it. */
  readonly phone: string | null
  readonly startedAt: Date
  /** The call got through: a second of conversation, as «Qoʻngʻiroqlar» counts it. */
  readonly talked: boolean
  readonly customerId: string | null
  /** Whose line it rang on. */
  readonly operator: string | null
}

/** An outgoing call to a number, `phoneKey`ed. */
export interface WatchOutboundCall {
  readonly key: string
  readonly startedAt: Date
}

/** What the CRM holds for a caller. */
export interface WatchContact {
  readonly name: string | null
  /** The contact's most recent deal, any pipeline: the Bitrix24 id and the brand it names. */
  readonly dealId: string | null
  readonly brand: WatchBrand | null
}

/** A targetolog's lead forms over yesterday and today: what Meta counted, what reached the portal. */
export interface WatchArrival {
  readonly key: string
  readonly targetolog: string
  readonly brand: WatchBrand | null
  readonly metaLeads: number
  readonly leads: number
}

/** Today's handed-out leads per ROP team, as «Lidlar qanday boʻlinadi» reads them (`buildLeadSplit`). */
export interface WatchSplit {
  /** Every lead handed out today, the ones given to nobody's team included. */
  readonly total: number
  /** A split is saved for today. */
  readonly planned: boolean
  readonly rops: readonly {
    readonly rop: string
    readonly received: number
    /** The team's share of the day as leads; null when no split is saved. */
    readonly planLeads: number | null
    readonly brand: WatchBrand | null
  }[]
}

export interface LeadWatchInput {
  readonly now: Date
  readonly timeZone: string
  readonly settings: LeadWatchSettings
  /** Today's Регистрация leads, every status, «Исход» left out. */
  readonly leads: readonly WatchLead[]
  /** The same population over the `historyDays` days before today, by clock hour. */
  readonly history: readonly FeedHourRow[]
  readonly chats: readonly WatchChat[]
  /** Today's inbound calls, and the outgoing calls to the numbers that were missed. */
  readonly inbound: readonly WatchInboundCall[]
  readonly outbound: readonly WatchOutboundCall[]
  /** By `customerId`. */
  readonly contacts: ReadonlyMap<string, WatchContact>
  readonly arrivals: readonly WatchArrival[]
  /** Null when the split could not be read: «Notekis» is then quiet, never guessed. */
  readonly split: WatchSplit | null
  /** When each feed under the watch was last read whole; null for one that never was. */
  readonly feedsAsOf: { readonly deals: Date | null; readonly calls: Date | null; readonly chats: Date | null }
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000

const channelZero = (): Record<WatchChannel, number> => ({ generated: 0, smm: 0, inbound: 0, telegram: 0, other: 0 })

/** A row before it is cut for the wire: its timer as an instant, and how it sorts when it has none. */
interface Candidate {
  readonly row: Omit<LeadWatchRowDto, 'since'>
  readonly since: Date | null
  /** Larger first, among rows with no timer. */
  readonly weight?: number
}

/**
 * An issue from its rows: longest waiting first (a row with no timer after
 * every row that has one, heaviest first), the real count, the channels
 * counted over EVERY row, and only then the cap.
 */
function issueOf(
  kind: WatchIssueKind,
  candidates: readonly Candidate[],
  severity: WatchSeverity,
  summary: string | null,
  maxRows: number,
): LeadWatchIssueDto {
  const sorted = [...candidates].sort((a, b) => {
    if (a.since !== null && b.since !== null) return a.since.getTime() - b.since.getTime()
    if (a.since !== null) return -1
    if (b.since !== null) return 1
    return (b.weight ?? 0) - (a.weight ?? 0)
  })
  const byChannel = channelZero()
  for (const c of sorted) if (c.row.channel !== null) byChannel[c.row.channel] += 1
  const oldest = sorted[0]?.since ?? null
  return {
    kind,
    count: sorted.length,
    severity: sorted.length === 0 ? 'ok' : severity,
    oldestSince: oldest?.toISOString() ?? null,
    summary: sorted.length === 0 ? null : summary,
    byChannel,
    rows: sorted.slice(0, maxRows).map((c) => ({ ...c.row, since: c.since?.toISOString() ?? null })),
  }
}

/**
 * An issue whose rows each wait from an instant: kept when they have waited
 * strictly longer than `warnMin`, critical when the oldest has waited
 * `criticalMin` or more.
 */
function waitingIssue(
  kind: WatchIssueKind,
  candidates: readonly (Candidate & { readonly since: Date })[],
  now: Date,
  limits: { readonly warnMin: number; readonly criticalMin: number },
  maxRows: number,
): LeadWatchIssueDto {
  const waiting = candidates.filter((c) => now.getTime() - c.since.getTime() > limits.warnMin * MINUTE_MS)
  const longest = waiting.reduce((ms, c) => Math.max(ms, now.getTime() - c.since.getTime()), 0)
  return issueOf(kind, waiting, longest >= limits.criticalMin * MINUTE_MS ? 'critical' : 'warn', null, maxRows)
}

const leadRow = (lead: WatchLead): Candidate & { readonly since: Date } => ({
  row: {
    key: lead.dealId,
    dealId: lead.dealId,
    title: lead.customerName?.trim() || lead.title,
    channel: lead.channel,
    brand: lead.brand,
    owner: lead.owner,
    rop: lead.rop,
    note: lead.origin,
  },
  since: lead.createdAt,
})

// ---------------------------------------------------------------------------
// 1 · «РОП (Первичка)» empty
// ---------------------------------------------------------------------------

/** Open leads nobody was routed to a ROP for, past `unassigned.warnMin`. */
export function unassignedIssue(leads: readonly WatchLead[], now: Date, settings: LeadWatchSettings): LeadWatchIssueDto {
  return waitingIssue(
    'unassigned',
    leads.filter((l) => l.open && !l.ropAssigned).map(leadRow),
    now,
    settings.unassigned,
    settings.maxRows,
  )
}

// ---------------------------------------------------------------------------
// 2 · On the first stage, no call
// ---------------------------------------------------------------------------

/**
 * Open leads still on the first stage that nobody has rung since they were
 * created, past `idle.warnMin`.
 *
 * AN ATTEMPT COUNTS, ANSWERED OR NOT — the spec asks for a completed call
 * activity, and an OUTGOING call nobody picked up is one: the lead was
 * worked. So does any call that connected, whoever dialled. What does NOT is
 * the customer's own ring that nobody answered: that is the lead asking
 * again, and it must not take the lead off this list (the repository folds
 * only the calls that count — `todayLeadsSql`).
 * AND A CALL TO THE CONTACT COUNTS. Measured on the portal on 2026-10-09: the
 * telephony's rows are linked to the CONTACT, almost never to the deal (and
 * PORTAL_NUMBER is one constant, so the line says nothing either). So
 * `lastCallAt` is the newest call on the deal OR on its contact, and a call
 * made before the deal existed — an old conversation with a returning
 * contact — is not a call about this lead.
 */
export function idleIssue(leads: readonly WatchLead[], now: Date, settings: LeadWatchSettings): LeadWatchIssueDto {
  const called = (l: WatchLead) => l.lastCallAt !== null && l.lastCallAt.getTime() >= l.createdAt.getTime()
  return waitingIssue(
    'idle',
    leads.filter((l) => l.open && l.firstStage && !called(l)).map(leadRow),
    now,
    settings.idle,
    settings.maxRows,
  )
}

// ---------------------------------------------------------------------------
// 3 · Open-line chats left open
// ---------------------------------------------------------------------------

/** A person's open-line chats that have stood open past `chats.warnMin`. The bot's are never read. */
export function chatsIssue(chats: readonly WatchChat[], now: Date, settings: LeadWatchSettings): LeadWatchIssueDto {
  return waitingIssue(
    'chats',
    chats.map((c) => ({
      row: {
        key: c.key,
        dealId: c.dealId,
        title: c.title,
        channel: c.channel,
        brand: c.brand,
        owner: c.owner,
        rop: c.rop,
        note: c.line,
      },
      since: c.openedAt,
    })),
    now,
    settings.chats,
    settings.maxRows,
  )
}

// ---------------------------------------------------------------------------
// 4 · Missed inbound calls nobody rang back
// ---------------------------------------------------------------------------

/** A number whose latest calls in were not answered and that nobody has rung since. */
export interface MissedCaller {
  /** `phoneKey` — the last nine digits. */
  readonly key: string
  /** As the PBX wrote it on the latest missed call. */
  readonly phone: string
  /** The first missed call of the run still unanswered. */
  readonly since: Date
  readonly customerId: string | null
  /** Whose line the latest missed call rang on. */
  readonly operator: string | null
}

/**
 * The numbers still waiting to be rung back, each from its first unanswered
 * call.
 *
 * A NUMBER IS THE UNIT, as on «Qoʻngʻiroqlar» (`phoneKey`, the last nine
 * digits). Its calls are walked in time order, in and out together: a missed
 * call starts the wait (a second miss does not restart it), and the wait ends
 * the moment the caller GETS THROUGH on a later call or ANYBODY RINGS THEM —
 * an attempt that was not picked up is still a callback, the caller was not
 * forgotten. A caller who then rings again and is missed again waits anew.
 *
 * NOT `unansweredCallers`, though it is its sibling and shares its key. That
 * one answers «who never got a second of conversation in the window» for
 * «Qoʻngʻiroqlar»'s list — so a client answered at nine and missed at eleven
 * is not on it. Here the eleven o'clock call is exactly the one that matters.
 *
 * A call with no usable number (none, or an internal extension) cannot be
 * rung back and is left out.
 */
export function missedCallers(
  inbound: readonly WatchInboundCall[],
  outbound: readonly WatchOutboundCall[],
): MissedCaller[] {
  type Event =
    | { readonly at: number; readonly kind: 'in'; readonly call: WatchInboundCall }
    | { readonly at: number; readonly kind: 'out' }
  /*
    Two records in one instant — one ring with an answered and an unanswered
    leg (a queue trying two operators) — are read unanswered FIRST: the leg
    that got through, or the call made out, then ends the wait. The other way
    round the answered caller would be left «waiting», by the order of a sort.
  */
  const settles = (event: Event) => (event.kind === 'out' || event.call.talked ? 1 : 0)
  const byKey = new Map<string, Event[]>()
  const eventsOf = (key: string): Event[] => {
    const found = byKey.get(key)
    if (found) return found
    const made: Event[] = []
    byKey.set(key, made)
    return made
  }
  for (const call of inbound) {
    const key = phoneKey(call.phone)
    if (key === null || key.length < 9) continue
    eventsOf(key).push({ at: call.startedAt.getTime(), kind: 'in', call })
  }
  // An outgoing call only matters for a number that rang in.
  for (const call of outbound) byKey.get(call.key)?.push({ at: call.startedAt.getTime(), kind: 'out' })

  const out: MissedCaller[] = []
  for (const [key, events] of byKey) {
    events.sort((a, b) => a.at - b.at || settles(a) - settles(b))
    // `as`: declared `… | null = null`, the loop's own assignment narrows it to `never` where it reads itself.
    let waiting = null as { since: Date; latest: WatchInboundCall } | null
    // The number's contact: the first one ANY of its calls names — a first call the sync could not link yet must not lose it.
    let customerId: string | null = null
    for (const event of events) {
      if (event.kind === 'out') {
        waiting = null
        continue
      }
      customerId ??= event.call.customerId
      if (event.call.talked) waiting = null
      else waiting = { since: waiting?.since ?? event.call.startedAt, latest: event.call }
    }
    if (waiting === null) continue
    out.push({
      key,
      phone: waiting.latest.phone ?? key,
      since: waiting.since,
      customerId,
      operator: waiting.latest.operator,
    })
  }
  return out
}

/**
 * Missed inbound calls nobody rang back, past `missedCalls.warnMin`.
 *
 * THE LINE IS NOT ON THE CALL. The portal's telephony is one external
 * application (PORTAL_NUMBER is `REST_APP:64` on every row), so which brand's
 * number the client dialled cannot be read. The brand is the caller's most
 * recent deal's when they have one — and the note says so when they do not.
 */
export function missedCallsIssue(
  inbound: readonly WatchInboundCall[],
  outbound: readonly WatchOutboundCall[],
  contacts: ReadonlyMap<string, WatchContact>,
  now: Date,
  settings: LeadWatchSettings,
): LeadWatchIssueDto {
  return waitingIssue(
    'missedCalls',
    missedCallers(inbound, outbound).map((caller) => {
      const contact = caller.customerId === null ? undefined : contacts.get(caller.customerId)
      const brand = contact?.brand ?? null
      return {
        row: {
          key: caller.key,
          dealId: contact?.dealId ?? null,
          title: contact?.name?.trim() || caller.phone,
          channel: 'inbound' as const,
          brand,
          owner: caller.operator,
          rop: null,
          note: `${caller.phone} · ${brand === null ? 'liniya aniqlanmadi' : `liniya: ${brand}`}`,
        },
        since: caller.since,
      }
    }),
    now,
    settings.missedCalls,
    settings.maxRows,
  )
}

// ---------------------------------------------------------------------------
// 5 · «Канал стоп»
// ---------------------------------------------------------------------------

const CHANNEL_LABEL: Readonly<Record<WatchFeed['channel'], string>> = { generated: 'Ген лид', smm: 'СММ' }

/** Whether `now` is inside the working hours [from, to) of its own day. */
function workingHour(now: Date, timeZone: string, hours: LeadWatchSettings['workHours']): number | null {
  const hour = zonedHour(now, timeZone)
  return hour >= hours.from && hour < hours.to ? hour : null
}

interface Stop {
  readonly feed: WatchFeed
  readonly since: Date
  /** The feed's average in the clock hour now running, over the history days. */
  readonly usual: number
}

/**
 * The feeds that have fallen silent in an hour they usually deliver in.
 *
 * ONLY IN WORKING HOURS — a form that is quiet at three in the morning is a
 * form. Inside them a feed is silent when its last lead of the WORKING day
 * (or, with none yet, the start of it — a night's quiet is not held against
 * it, and a lead that came in the night does not shorten it) is `silentMin`
 * or more behind `now`; and it is a STOP only when
 * the clock hour now running brought it `usualPerHour` leads or more on
 * average over the `historyDays` days before today — a day the feed brought
 * nothing counts as zero, so a form that ran twice last week is not «usual».
 * A late «Qayta zayavka» copy is no sign of life from its form.
 */
export function silentFeeds(
  leads: readonly WatchLead[],
  history: readonly FeedHourRow[],
  now: Date,
  timeZone: string,
  settings: LeadWatchSettings,
): Stop[] {
  const hour = workingHour(now, timeZone, settings.workHours)
  if (hour === null) return []
  const { silentMin, historyDays, usualPerHour } = settings.channelStop

  const usual = new Map<string, { feed: WatchFeed; leads: number }>()
  for (const row of history) {
    if (row.feed === null || row.hour !== hour) continue
    const held = usual.get(row.feed.key)
    if (held) held.leads += row.leads
    else usual.set(row.feed.key, { feed: row.feed, leads: row.leads })
  }

  const last = new Map<string, Date>()
  for (const lead of leads) {
    if (lead.feed === null || lead.replayed) continue
    const held = last.get(lead.feed.key)
    if (!held || lead.createdAt > held) last.set(lead.feed.key, lead.createdAt)
  }

  const workStart = zonedHourStart(now, timeZone, settings.workHours.from)
  const stops: Stop[] = []
  for (const { feed, leads: total } of usual.values()) {
    const average = total / historyDays
    if (average < usualPerHour) continue
    /*
      Never before the working day opened: a night's quiet is not held against
      a feed, whether or not it brought a lead in the night. A form whose last
      lead came at 02:30 has been silent, as far as the watch is concerned,
      since 09:00 — not «390 daq» at 09:00:01.
    */
    const lastToday = last.get(feed.key)
    const since = lastToday !== undefined && lastToday > workStart ? lastToday : workStart
    if (now.getTime() - since.getTime() < silentMin * MINUTE_MS) continue
    stops.push({ feed, since, usual: average })
  }
  return stops
}

/** «Yetib keldi» of one targetolog — Bitrix24 leads ÷ Meta leads, per cent — or null with no Meta lead to divide by. */
export function arrivalPercent(arrival: WatchArrival): number | null {
  return arrival.metaLeads > 0 ? (arrival.leads / arrival.metaLeads) * 100 : null
}

/**
 * «Канал стоп»: the feeds gone silent (`silentFeeds`) and the targetologs
 * whose Meta leads are not arriving in the portal.
 *
 * «YETIB KELDI» IS «LID MANBALARI»'S OWN FIGURE — a targetolog's Регистрация
 * leads over Meta's lead count for their lead forms — taken over yesterday
 * and today, so a form unlinked this morning shows by noon and yesterday's
 * late Meta rows do not swing it. Under `arrivalMinMetaLeads` there is too
 * little to judge a percentage on; below `arrivalWarnPct` it is a row, below
 * `arrivalCriticalPct` the card is red. A silent feed is always red.
 */
export function channelStopIssue(
  leads: readonly WatchLead[],
  history: readonly FeedHourRow[],
  arrivals: readonly WatchArrival[],
  now: Date,
  timeZone: string,
  settings: LeadWatchSettings,
): { readonly issue: LeadWatchIssueDto; readonly stops: readonly LeadWatchStopDto[] } {
  const { arrivalWarnPct, arrivalCriticalPct, arrivalMinMetaLeads } = settings.channelStop
  const silent = silentFeeds(leads, history, now, timeZone, settings).sort((a, b) => a.since.getTime() - b.since.getTime())

  const low = arrivals.flatMap((arrival) => {
    const percent = arrivalPercent(arrival)
    return percent !== null && arrival.metaLeads >= arrivalMinMetaLeads && percent < arrivalWarnPct ? [{ arrival, percent }] : []
  })

  const candidates: Candidate[] = [
    ...silent.map((stop) => ({
      row: {
        key: stop.feed.key,
        dealId: null,
        title: stop.feed.name,
        channel: stop.feed.channel,
        brand: stop.feed.brand,
        owner: null,
        rop: null,
        note: `odatda shu soatda ~${Math.round(stop.usual)} ta`,
      },
      since: stop.since,
    })),
    ...low.map(({ arrival, percent }) => ({
      row: {
        key: `arrival|${arrival.key}`,
        dealId: null,
        title: arrival.targetolog,
        channel: 'generated' as const,
        brand: arrival.brand,
        owner: null,
        rop: null,
        note: `Yetib keldi ${Math.round(percent)}% · Meta ${arrival.metaLeads} · Bitrix ${arrival.leads}`,
      },
      since: null,
      // The lowest arrival first.
      weight: -percent,
    })),
  ]

  const forms = silent.filter((s) => s.feed.channel === 'generated').length
  const pages = silent.length - forms
  const summary = [
    forms > 0 ? `${forms} forma` : null,
    pages > 0 ? `${pages} sahifa` : null,
    low.length > 0 ? `${low.length} targetolog` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const critical = silent.length > 0 || low.some(({ percent }) => percent < arrivalCriticalPct)
  const nowHour = zonedHour(now, timeZone)
  return {
    issue: issueOf('channelStop', candidates, critical ? 'critical' : 'warn', summary, settings.maxRows),
    stops: silent.map((stop) => ({
      fromHour: Math.max(settings.workHours.from, zonedHour(stop.since, timeZone)),
      toHour: nowHour + 1,
      label: `${CHANNEL_LABEL[stop.feed.channel]} · ${stop.feed.name} · ${Math.floor((now.getTime() - stop.since.getTime()) / MINUTE_MS)} daq lead yoʻq`,
    })),
  }
}

// ---------------------------------------------------------------------------
// 6 · Uneven hand-out
// ---------------------------------------------------------------------------

/**
 * ROP teams whose share of today's handed-out leads is off.
 *
 * Judged only once `uneven.minLeads` leads have been handed out today — the
 * first ten of a morning are uneven by arithmetic. Then a team is a row when
 * EITHER
 *
 *   · a split is saved for today («Taqsimotni belgilash») and the team is
 *     more than `planDeviationPct` per cent off the leads its share comes to,
 *     above or below — a team given leads against a share of nothing is as
 *     far off as it can be; or
 *   · it got more than `timesAverage` times the average team.
 *
 * THE AVERAGE IS OVER THE TEAMS IN PLAY: those that got a lead today or hold
 * a share of today's split. The split card always lists the client's nine
 * teams, and averaging over the ones standing at zero by design would call
 * every working team «above average».
 *
 * AND, EITHER WAY, IT IS `minDiffLeads` LEADS OR MORE OFF — off the plan, or
 * above the average. A per cent alone turns small numbers red: a plan of 3
 * and 5 received is +67 %, and two leads.
 *
 * Critical at twice either threshold. A team off its plan says so in plan
 * terms; one caught by the average alone, in those.
 */
export function unevenIssue(split: WatchSplit | null, settings: LeadWatchSettings): LeadWatchIssueDto {
  const { timesAverage, planDeviationPct, minLeads, minDiffLeads } = settings.uneven
  if (split === null || split.total < minLeads) return issueOf('uneven', [], 'ok', null, settings.maxRows)

  const inPlay = split.rops.filter((r) => r.received > 0 || (r.planLeads ?? 0) > 0)
  const average = inPlay.length === 0 ? 0 : inPlay.reduce((sum, r) => sum + r.received, 0) / inPlay.length

  let critical = false
  const candidates: Candidate[] = []
  for (const team of inPlay) {
    const plan = split.planned ? (team.planLeads ?? 0) : null
    // Per cent off the plan; a team given leads with no share is infinitely off it.
    const deviation = plan === null ? null : plan > 0 ? ((team.received - plan) / plan) * 100 : team.received > 0 ? Infinity : 0
    // Both rules also need `minDiffLeads` whole leads of difference: plan 3, got 5 is +67 % and two leads.
    const offPlan = deviation !== null && Math.abs(deviation) > planDeviationPct && Math.abs(team.received - plan!) >= minDiffLeads
    const times = average > 0 ? team.received / average : 0
    const aboveAverage = times > timesAverage && team.received - average >= minDiffLeads
    if (!offPlan && !aboveAverage) continue

    if ((offPlan && Math.abs(deviation!) >= 2 * planDeviationPct) || (aboveAverage && times >= 2 * timesAverage)) critical = true
    const sign = deviation !== null && deviation > 0 ? '+' : ''
    candidates.push({
      row: {
        key: team.rop,
        dealId: null,
        title: team.rop,
        channel: null,
        brand: team.brand,
        owner: null,
        rop: team.rop,
        note: offPlan
          ? `reja ${plan} · keldi ${team.received}${Number.isFinite(deviation!) ? ` (${sign}${Math.round(deviation!)}%)` : ''}`
          : `oʻrtacha ${Math.round(average)} · keldi ${team.received}`,
      },
      since: null,
      // The furthest off first: by leads off the plan, else off the average.
      weight: Math.abs(team.received - (offPlan ? plan! : average)),
    })
  }
  return issueOf('uneven', candidates, critical ? 'critical' : 'warn', `${candidates.length} ROP`, settings.maxRows)
}

// ---------------------------------------------------------------------------
// 7 · «Проект» empty
// ---------------------------------------------------------------------------

/**
 * Open leads with no «Проект». No waiting time: the field decides the lead's
 * brand on every screen («Lidlar», RNP), so one is already a warning, and
 * `noProject.criticalCount` of them is a desk that has stopped filling it.
 */
export function noProjectIssue(leads: readonly WatchLead[], settings: LeadWatchSettings): LeadWatchIssueDto {
  const rows = leads.filter((l) => l.open && !l.projectFilled).map(leadRow)
  return issueOf('noProject', rows, rows.length >= settings.noProject.criticalCount ? 'critical' : 'warn', null, settings.maxRows)
}

// ---------------------------------------------------------------------------
// The intake, hour by hour
// ---------------------------------------------------------------------------

/**
 * One bar per working hour: today's leads by channel, and what that hour
 * brought on average over the `historyDays` days before — every channel
 * together, «Исход» left out, whatever became of the leads. An hour is `past`
 * once it has started; the hour now running is one of them, its bar still
 * growing.
 */
export function flowHours(
  leads: readonly WatchLead[],
  history: readonly FeedHourRow[],
  now: Date,
  timeZone: string,
  settings: LeadWatchSettings,
): LeadWatchFlowHourDto[] {
  const { from, to } = settings.workHours
  const nowHour = zonedHour(now, timeZone)

  const today = new Map<number, Record<WatchChannel, number>>()
  for (const lead of leads) {
    if (lead.replayed) continue
    const hour = zonedHour(lead.createdAt, timeZone)
    const counts = today.get(hour) ?? channelZero()
    counts[lead.channel] += 1
    today.set(hour, counts)
  }

  const before = new Map<number, number>()
  for (const row of history) before.set(row.hour, (before.get(row.hour) ?? 0) + row.leads)

  const hours: LeadWatchFlowHourDto[] = []
  for (let hour = from; hour < to; hour++) {
    hours.push({
      hour,
      counts: today.get(hour) ?? channelZero(),
      average: Math.round(((before.get(hour) ?? 0) / settings.channelStop.historyDays) * 10) / 10,
      past: hour <= nowHour,
    })
  }
  return hours
}

// ---------------------------------------------------------------------------
// The whole answer
// ---------------------------------------------------------------------------

/**
 * How old the data under the watch is: the OLDEST of its three feeds — a
 * fresh deal sync says nothing for calls read ten minutes ago. Null when any
 * of them has never been read: «no call», «no chat» cannot be told from «not
 * read yet», and the page must say so rather than show a clean board.
 */
export function oldestFeed(feeds: LeadWatchInput['feedsAsOf']): Date | null {
  const { deals, calls, chats } = feeds
  if (deals === null || calls === null || chats === null) return null
  return new Date(Math.min(deals.getTime(), calls.getTime(), chats.getTime()))
}

/** «Лид назорати», whole: always all seven issues, in `WATCH_ISSUE_KINDS`' order. */
export function buildLeadWatch(input: LeadWatchInput): LeadWatchDto {
  const { now, timeZone, settings, leads } = input
  const channelStop = channelStopIssue(leads, input.history, input.arrivals, now, timeZone, settings)

  const byKind: Readonly<Record<WatchIssueKind, LeadWatchIssueDto>> = {
    unassigned: unassignedIssue(leads, now, settings),
    idle: idleIssue(leads, now, settings),
    chats: chatsIssue(input.chats, now, settings),
    missedCalls: missedCallsIssue(input.inbound, input.outbound, input.contacts, now, settings),
    channelStop: channelStop.issue,
    uneven: unevenIssue(input.split, settings),
    noProject: noProjectIssue(leads, settings),
  }
  const issues = WATCH_ISSUE_KINDS.map((kind) => byKind[kind])

  return {
    generatedAt: now.toISOString(),
    dataAsOf: oldestFeed(input.feedsAsOf)?.toISOString() ?? null,
    critical: issues.filter((issue) => issue.severity === 'critical').length,
    issues,
    flow: {
      hours: flowHours(leads, input.history, now, timeZone, settings),
      stops: channelStop.stops,
    },
  }
}
