/**
 * «Лид назорати» — the watch block on «Lidlar»: what is waiting right now.
 *
 * Asked for on 2026-10-09. Seven checks over today's Регистрация leads, the
 * open-line chats and the day's calls, plus the working day's intake hour by
 * hour — every rule and every reason is in `domain/leads/leadWatch.ts`, every
 * threshold in `src/lib/leadWatchSettings.ts`. This file only fetches the
 * rows, names each lead's channel and brand the way «Lid manbalari» does, and
 * memoises the answer.
 *
 * NO PERIOD, NO BRAND, NO SCOPE. Always today in the app's time zone, the
 * whole company: a Регистрация lead belongs to no sales team yet (that is
 * what the first check is about), so there is nothing to narrow by, and both
 * routes refuse a narrowed account like the rest of «Lidlar». That is what
 * makes ONE memoised answer safe to hand to every reader — see `watchCache`.
 *
 * WHERE THE FRESHNESS COMES FROM. Deals arrive on every worker tick. Calls and
 * open chats are read by the worker on the watch's own two-minute clock
 * (`integrations/crm/sync/leadWatchFeeds.ts`) and its clock is kept in
 * `lead_watch_sync`; `dataAsOf` is the oldest of the three, so the page can
 * say «Yangilanmayapti» instead of showing a clean board over a stopped feed.
 */

import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'
import { LEAD_SOURCE_VOCABULARY, REGISTRATION_DUPLICATE_STAGE_ID, REGISTRATION_INTAKE_STAGE_IDS, openLineSubject } from '@/server/integrations/crm/bitrix24/mapping'
import {
  type FeedHourRow,
  type LeadWatchDto,
  type LeadWatchSettings,
  type LeadWatchSummaryDto,
  type WatchArrival,
  type WatchChat,
  type WatchContact,
  type WatchInboundCall,
  type WatchLead,
  type WatchSplit,
  buildLeadWatch,
  chatChannel,
  missedCallers,
  watchChannel,
  watchFeed,
} from '@/server/domain/leads/leadWatch'
import { formNameOf, leadChannel } from '@/server/domain/leads/leadSources'
import { resolvePeriod, trailingDays, zonedDateKey } from '@/server/domain/period/period'
import { buildLeadSplit } from '@/server/domain/registration/leadSplit'
import { teamBrand } from '@/server/domain/rnp/rnpSheet'
import type { InboundCallsRepository } from '@/server/repositories/inboundCallsRepository'
import type { LeadWatchRepository, WatchChatRow, WatchFeedHourRow, WatchLeadRow } from '@/server/repositories/leadWatchRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'
import { processWide } from '@/server/processWide'

import type { LeadSourcesService } from './leadSourcesService'
import { leadBrand } from './rnpService'
import { OFF_HOURS, WARM_HOURS, type WarmOutcome, withinHours } from './rnpWarmer'
import { LIVE_CACHE, ttlCache } from './ttlCache'

/*
  ONE ANSWER FOR EVERYBODY, GOOD FOR A MINUTE.

  The page asks every two minutes (`refreshEveryMs`) and the sidebar badge
  asks `/leads/watch/summary` from every open tab of every account that holds
  «Lidlar» — the same snapshot, so both read this one memo and a badge can
  never disagree with the page behind it. Sixty seconds, not the other live
  memos' 120: a timer that starts at ten minutes should not be found two ticks
  late. Past the TTL the old answer is handed out for up to four minutes more
  while ONE rebuild runs behind the reader (`staleMs`), so nobody waits on a
  build and nothing shown is older than `staleAfterMin`.

  Keyed by the Tashkent day and the zone — the whole question; there is no
  scope to forget (see the header). On `globalThis` (`processWide`): the
  warmer and the routes are separate bundles in one process.
*/
const WATCH_TTL_MS = 60_000
const watchCache = processWide('sinolife.leadWatch.cache', () =>
  ttlCache<LeadWatchDto>(WATCH_TTL_MS, {
    staleMs: LEAD_WATCH_SETTINGS.staleAfterMin * 60_000 - WATCH_TTL_MS,
    onError: LIVE_CACHE.onError,
  }),
)

/*
  The week before today, by clock hour — «usually at this hour». Closed days:
  their intake does not move (a deleted deal aside), so half an hour is
  generous, and the seven-day scan is the one read here that is not small.
  Keyed by the day, so the first build after midnight reads the new week.
*/
const historyCache = processWide('sinolife.leadWatch.historyCache', () => ttlCache<WatchFeedHourRow[]>(30 * 60_000, LIVE_CACHE))

/*
  «Yetib keldi» per targetolog over yesterday and today. Meta's side moves
  once an hour (`SYNC_META_EVERY`), so ten minutes loses nothing — and read
  on every build it would be a two-day Регистрация scan a minute that only
  this screen asks for.
*/
const arrivalCache = processWide('sinolife.leadWatch.arrivalCache', () => ttlCache<WatchArrival[]>(10 * 60_000, LIVE_CACHE))

/** How often the warmer rebuilds the answer in the working day — the page's own cadence. */
export const LEAD_WATCH_WARM_EVERY_MS = LEAD_WATCH_SETTINGS.refreshEveryMs

const warnLater = (message: string, error: unknown): void =>
  // Loaded when needed: the logger reads the validated environment at import (see `LIVE_CACHE`).
  void import('@/server/logging/logger').then(({ logger }) => logger.warn({ err: error }, message))

/**
 * Today's Регистрация rows as the domain reads them: «Исход» left out, each
 * lead on the channel, brand and feed «Lid manbalari» would file it under.
 * Exported for its test.
 */
export function watchLeads(rows: readonly WatchLeadRow[]): WatchLead[] {
  const leads: WatchLead[] = []
  for (const row of rows) {
    const form = formNameOf(row.formTitle)
    const channel = leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY)
    const watch = watchChannel(channel)
    // «Исход»: an operator's own outgoing call is not a lead anybody is waiting on.
    if (watch === null) continue
    leads.push({
      dealId: row.dealId,
      title: row.title,
      customerName: row.customerName,
      createdAt: row.createdAt,
      // «Дубликат (лид)» is parked, not waiting: out of the problems, still in the intake.
      open: row.status === 'OPEN' && row.stageId !== REGISTRATION_DUPLICATE_STAGE_ID,
      firstStage: row.stageId !== null && REGISTRATION_INTAKE_STAGE_IDS.has(row.stageId),
      channel: watch,
      // The lead's own brand: its «Проект» first (`leadBrand`, the rule every screen shares).
      brand: leadBrand(row.sourceId, row.formTitle, row.productLine),
      // The feed's: a form's or a page's, whatever project one lead of it names.
      feed: watchFeed(channel, form, row.sourceId, row.source, leadBrand(row.sourceId, row.formTitle)),
      origin: form ?? row.source,
      owner: row.owner,
      rop: row.rop,
      ropAssigned: row.ropAssigned,
      projectFilled: row.productLine !== null,
      lastCallAt: row.lastCallAt,
      replayed: row.replayed,
    })
  }
  return leads
}

/** The week's grouped rows as the domain reads them — the same naming as `watchLeads`. Exported for its test. */
export function watchHistory(rows: readonly WatchFeedHourRow[]): FeedHourRow[] {
  const history: FeedHourRow[] = []
  for (const row of rows) {
    const form = formNameOf(row.formTitle)
    const channel = leadChannel(row.sourceId, form, LEAD_SOURCE_VOCABULARY)
    const watch = watchChannel(channel)
    if (watch === null) continue
    history.push({
      day: row.day,
      hour: row.hour,
      channel: watch,
      feed: watchFeed(channel, form, row.sourceId, row.source, leadBrand(row.sourceId, row.formTitle)),
      leads: row.leads,
    })
  }
  return history
}

/** The open chats as the domain reads them. Exported for its test. */
export function watchChats(rows: readonly WatchChatRow[]): WatchChat[] {
  return rows.map((row) => {
    const hasDeal = row.dealId !== null
    const { user, line } = openLineSubject(row.subject)
    return {
      key: row.chatId,
      dealId: row.dealId,
      // The contact, else the deal; a chat whose deal is not here yet still names who wrote, in its subject.
      title: row.customerName ?? row.dealTitle ?? user ?? row.subject,
      channel: hasDeal ? chatChannel(row.sourceId, formNameOf(row.formTitle), LEAD_SOURCE_VOCABULARY) : null,
      brand: hasDeal ? leadBrand(row.sourceId, row.formTitle, row.productLine) : null,
      owner: row.responsible,
      rop: row.rop,
      openedAt: row.openedAt,
      line,
    }
  })
}

export class LeadWatchService {
  constructor(
    private readonly repository: LeadWatchRepository,
    private readonly calls: InboundCallsRepository,
    private readonly registration: RegistrationRepository,
    private readonly reference: ReferenceRepository,
    private readonly leadSources: Pick<LeadSourcesService, 'targetologForms'>,
    private readonly settings: LeadWatchSettings = LEAD_WATCH_SETTINGS,
  ) {}

  /** `GET /leads/watch` — the memoised snapshot. */
  watch(now: Date, timeZone: string): Promise<LeadWatchDto> {
    return watchCache.get(this.key(now, timeZone), () => this.build(now, timeZone))
  }

  /** `GET /leads/watch/summary` — the same snapshot's count of red cards, for the sidebar badge. */
  async summary(now: Date, timeZone: string): Promise<LeadWatchSummaryDto> {
    return { critical: (await this.watch(now, timeZone)).critical }
  }

  /**
   * The warmer's tick (`src/instrumentation.ts`): a real rebuild, waited for
   * (`refresh` — `get` would hand back the old answer and time nothing), in
   * the working day only. Readers refresh the memo themselves whenever
   * anybody is looking; this is for the first look after a quiet spell and
   * after a deploy, which would otherwise wait on a cold build.
   */
  async warm(now: Date, timeZone: string): Promise<WarmOutcome> {
    if (!withinHours(now, timeZone, WARM_HOURS)) return OFF_HOURS
    await watchCache.refresh(this.key(now, timeZone), () => this.build(now, timeZone))
  }

  private key(now: Date, timeZone: string): string {
    return `${zonedDateKey(now, timeZone)}|${timeZone}`
  }

  private async build(now: Date, timeZone: string): Promise<LeadWatchDto> {
    const today = resolvePeriod('today', { timeZone, now })
    const day = zonedDateKey(now, timeZone)
    // `historyDays` whole days before today: [the first of them, today's first instant).
    const historyStart = trailingDays(this.settings.channelStop.historyDays + 1, { timeZone, now }).start

    /*
      IN TWO TURNS, NOT ALL AT ONCE. Nine statements side by side would take
      the web service's eight-connection pool for itself once a minute; behind
      a memo a second longer costs no reader anything. The heavier reads go
      first, together; the small ones after.
    */
    const [leadRows, historyRows, inboundRows] = await Promise.all([
      this.repository.todayLeads(today.start, today.end),
      historyCache.get(`${day}|${timeZone}`, () => this.repository.feedHours(historyStart, today.start)),
      this.calls.inboundCalls(today.start, today.end),
    ])
    const [chatRows, distributed, split, clocks, dealsAsOf, arrivals] = await Promise.all([
      this.repository.openChats(),
      this.registration.distributedDays(day, day),
      this.registration.split(day),
      this.repository.feedClocks(),
      this.reference.findLastSuccessfulSync(),
      this.arrivals(now, timeZone, day),
    ])

    const inbound: WatchInboundCall[] = inboundRows.map((call) => ({
      phone: call.phone,
      startedAt: call.startedAt,
      // A second of conversation, as «Qoʻngʻiroqlar» counts a call that got through.
      talked: call.durationSec > 0,
      customerId: call.customerId,
      operator: call.operator ?? null,
    }))
    /*
      The numbers with a miss standing BEFORE any callback is known — a
      superset of the ones still waiting — so the outgoing calls and the
      contacts are asked for those numbers alone, not for the day's every
      caller. The domain then walks the two together.
    */
    const missed = missedCallers(inbound, [])
    const customerIds = [...new Set(missed.map((m) => m.customerId).filter((id): id is string => id !== null))]
    const [outbound, cards, latest] = await Promise.all([
      this.calls.outboundTo(missed.map((m) => ({ key: m.key, after: m.since }))),
      this.calls.contactCards(customerIds),
      this.repository.latestDeals(customerIds),
    ])
    const latestOf = new Map(latest.map((deal) => [deal.customerId, deal]))
    const contacts = new Map<string, WatchContact>(
      customerIds.map((id) => {
        const deal = latestOf.get(id)
        return [
          id,
          {
            name: cards.get(id)?.name ?? null,
            dealId: deal?.dealId ?? null,
            // The line the client rang is not on the call; their latest deal's brand is the nearest thing.
            brand: deal ? leadBrand(deal.sourceId, deal.formTitle, deal.productLine) : null,
          },
        ]
      }),
    )

    /*
      Today's hand-out exactly as «Lidlar qanday boʻlinadi» reads it
      (`buildLeadSplit`): the same rows, the same team names, the same
      apportioned plan — the card and this check cannot disagree. One day of
      it, without the month grid and «Безквал» that card also draws.
    */
    const card = buildLeadSplit({ day, rows: distributed, bezkval: [], split, previous: null, canEdit: false })
    const watchSplit: WatchSplit = {
      total: card.total,
      planned: card.split !== null,
      rops: card.rops.map((r) => ({ rop: r.rop, received: r.received, planLeads: r.planLeads, brand: teamBrand(r.rop) })),
    }

    return buildLeadWatch({
      now,
      timeZone,
      settings: this.settings,
      leads: watchLeads(leadRows),
      history: watchHistory(historyRows),
      chats: watchChats(chatRows),
      inbound,
      outbound,
      contacts,
      arrivals,
      split: watchSplit,
      feedsAsOf: { deals: dealsAsOf, calls: clocks.calls, chats: clocks.chats },
    })
  }

  /**
   * «Yetib keldi» per targetolog over yesterday and today — «Targetologlar»'s
   * own `forms` block (`LeadSourcesService.targetologForms`), so the figure
   * is that card's to the lead: the Регистрация deals a targetolog's CRM
   * forms opened over Meta's lead count for their lead-form campaigns.
   *
   * SOFT. A failed Meta read must not take the watch down with it — six of
   * the seven checks do not read Meta at all — so it is logged and the
   * arrival rows are simply absent until the next build.
   */
  private arrivals(now: Date, timeZone: string, day: string): Promise<WatchArrival[]> {
    return arrivalCache
      .get(`${day}|${timeZone}`, async () => {
        const period = resolvePeriod('custom', {
          timeZone,
          now,
          customStart: resolvePeriod('yesterday', { timeZone, now }).start,
          customEnd: now,
        })
        const { forms } = await this.leadSources.targetologForms(period, timeZone)
        return forms.owners.map((owner) => ({
          key: owner.key,
          targetolog: owner.targetolog,
          brand: owner.product === 'Boshqa' ? null : owner.product,
          metaLeads: owner.metaLeads,
          leads: owner.outcome.leads,
        }))
      })
      .catch((error: unknown) => {
        warnLater('«Yetib keldi» read failed; Лид назорати answers without the arrival rows', error)
        return []
      })
  }
}
