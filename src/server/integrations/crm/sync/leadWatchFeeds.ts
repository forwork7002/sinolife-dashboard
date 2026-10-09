import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'
import type { FetchOptions, Page, RawCall, RawOpenLineChat } from '@/server/integrations/crm/CrmProvider'

/**
 * «ЛИД НАЗОРАТИ» NEEDS TWO FEEDS THE ORDINARY SYNC DOES NOT KEEP CURRENT.
 *
 * The lead watch on «Lidlar» (2026-10-09) says, minutes after it happens, that
 * a lead got no call, that a missed call was not rung back, that a chat was
 * left open. Deals arrive every tick. The other two did not:
 *
 *   CALLS    ride the three-hourly reference pass (`REFERENCE` in
 *            `scripts/syncWorker.ts`), so «no call since the lead was created»
 *            was true of every lead of the last three hours.
 *   CHATS    are not synced at all: an open-line chat is a `crm.activity`, and
 *            nothing here reads activities.
 *
 * So the worker reads both on the watch's own clock
 * (`LEAD_WATCH_SETTINGS.refreshEveryMs`, two minutes — in production, every
 * tick), AFTER the tick's ordinary entities and never instead of them.
 *
 * WHAT A PASS COSTS THE PORTAL. Measured 2026-10-09 through the read-only
 * MCP: `voximplant.statistic.get` answered 50 rows in 0.35 s, and the portal
 * takes ~12 400 calls a day — 20–40 in two minutes, so the twelve minutes a
 * pass re-reads are one or two pages; the open chats' read with an ID floor
 * answered in 1.0 s. An ordinary pass is therefore
 *
 *   calls   1 request, 2 invocations (the walk's narrow chain; a busy stretch
 *           past 100 rows widens it once: +1 request, +8 invocations),
 *   chats   1 request, 1 invocation,
 *
 * 2 requests and 3 invocations, ~90 invocations an hour. On top of it: the
 * calls' settle read twice an hour (≈3 requests, ≈42 invocations each — see
 * `CALLS_SETTLE_EVERY_MS`; a database's FIRST pass is one of these, not a
 * read of the whole day), the chats' anchor once an hour (1 invocation), and
 * one control read on the rare pass the chats come back empty over a table
 * that holds some (`refreshOpenLineChats`).
 * About 175 invocations in an ordinary hour, ~420 in the busiest, against the
 * ~500 of the ordinary sync and the 15 000 ceiling (`portalBudget.ts`).
 * `tests/integrations/leadWatchFeeds.test.ts` counts the ordinary pass
 * exactly; an estimate is not a test.
 *
 * Everything goes through the worker's own provider, so the rate limiter, the
 * hourly ceiling, the meter and the refusal gate apply as to any other call.
 * This module never talks to the portal itself — it is handed the reads.
 */

// ---------------------------------------------------------------------------
// The feeds' clock
// ---------------------------------------------------------------------------

export type LeadWatchFeed = 'calls' | 'chats'

/**
 * Where a feed keeps its bookmark and its clock — `lead_watch_sync`, one row
 * per feed. A seam, so the passes below are tested without a database.
 */
export interface FeedClock {
  /** The feed's saved bookmark, or null when it has never run. */
  read(feed: LeadWatchFeed): Promise<unknown>
  /** Keep a bookmark without calling the pass a success. */
  remember(feed: LeadWatchFeed, state: unknown): Promise<void>
  /**
   * The pass read the portal and wrote what it read: the clock «Лид назорати»
   * shows moves — to `at`, the instant the pass STARTED reading, because that
   * is how current the rows are.
   */
  succeeded(feed: LeadWatchFeed, state: unknown, at: Date): Promise<void>
  failed(feed: LeadWatchFeed, message: string, at: Date): Promise<void>
}

export function prismaFeedClock(prisma: PrismaClient): FeedClock {
  const json = (state: unknown) => state as Prisma.InputJsonValue
  return {
    async read(feed) {
      const row = await prisma.leadWatchSync.findUnique({ where: { id: feed }, select: { state: true } })
      return row?.state ?? null
    },
    async remember(feed, state) {
      await prisma.leadWatchSync.upsert({
        where: { id: feed },
        create: { id: feed, state: json(state) },
        update: { state: json(state) },
      })
    },
    async succeeded(feed, state, at) {
      await prisma.leadWatchSync.upsert({
        where: { id: feed },
        create: { id: feed, state: json(state), lastSuccessAt: at },
        update: { state: json(state), lastSuccessAt: at, lastError: null, lastErrorAt: null },
      })
    },
    async failed(feed, message, at) {
      // The caller's to make safe (`describeFeedError`); cut like `moysklad_sync`'s all the same.
      const lastError = message.slice(0, 500)
      await prisma.leadWatchSync.upsert({
        where: { id: feed },
        create: { id: feed, lastError, lastErrorAt: at },
        update: { lastError, lastErrorAt: at },
      })
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isoDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * A failure as it may be printed and stored (`lead_watch_sync."lastError"`,
 * the worker's console).
 *
 * The provider's own errors are already redacted where they are thrown
 * (`Bitrix24CrmProvider.call` — the webhook URL carries the token) and say
 * exactly what an operator needs, so they pass, capped. ANYTHING ELSE does
 * not go out verbatim: a database driver's message can carry a connection
 * string or the values of the statement that failed — a customer's name, a
 * phone. Those are reduced to the error's class and code, and one line of
 * its message with anything URL-shaped or key-shaped struck out.
 */
export function describeFeedError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'Bitrix24Error') return message.slice(0, 500)
  // Our own sentences (a held deletion, a walk that did not end) are plain `Error`s and carry no data.
  const rawCode = isRecord(error) ? error.code : undefined
  const code = typeof rawCode === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(rawCode) ? ` [${rawCode}]` : ''
  const line = (message.split('\n').find((l) => l.trim() !== '') ?? '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '‹url›')
    .replace(/\b(password|passwd|pwd|secret|token|key|authorization)\b\s*[=:]\s*\S+/gi, '$1=‹…›')
    .replace(/[A-Za-z0-9_\-]{24,}/g, '‹…›')
    .trim()
    .slice(0, 160)
  return `${name}${code}${line ? `: ${line}` : ''}`
}

// ---------------------------------------------------------------------------
// Recent calls
// ---------------------------------------------------------------------------

/**
 * How far behind its own last start a pass re-reads.
 *
 * `voximplant.statistic.get` lists a call while it is still ringing or being
 * spoken, with the duration so far and no code 200 yet (`callQuality.ts`
 * dates the weeks that cost). Ten minutes back, a call caught mid-conversation
 * is read again once it has ended — the median call is under a minute.
 */
export const CALLS_OVERLAP_MS = 10 * 60_000

/**
 * …AND TWICE AN HOUR THE PASS REACHES BACK PAST THE LONGEST CALL.
 *
 * A conversation longer than the overlap would keep its mid-call row —
 * `connected` false, a few seconds long — until the reference pass's
 * three-hour settle read, and on this screen that is a client who «was not
 * answered» for three hours: a false «Javobsiz qoʻngʻiroq», red. The longest
 * call measured is 3 600 s (`SETTLE_LOOKBACK_MS` in SyncEngine.ts), so
 * seventy minutes covers it: ~600 rows in the working day, three requests and
 * ~42 invocations, twice an hour.
 */
export const CALLS_SETTLE_EVERY_MS = 30 * 60_000
export const CALLS_SETTLE_REACH_MS = 70 * 60_000

/**
 * Pages one calls pass may take. The widest read is the settle reach —
 * seventy minutes, ~600 calls, a dozen pages; two hundred is a walk that is
 * not ending.
 */
const CALLS_MAX_PAGES = 200

/** The calls feed's bookmark: when its last pass started, and its last settle read. */
export interface CallsState {
  readonly passAt: Date
  readonly settledAt: Date | null
}

export function parseCallsState(json: unknown): CallsState | null {
  if (!isRecord(json)) return null
  const passAt = isoDate(json.passAt)
  return passAt ? { passAt, settledAt: isoDate(json.settledAt) } : null
}

/**
 * Where this pass starts reading.
 *
 * From the last pass's start less the overlap, and never earlier than the
 * start of TODAY — the watch reads today's calls only, and a worker that was
 * down overnight leaves the night to the reference pass, whose own cursor
 * covers it. A settle read reaches back `CALLS_SETTLE_REACH_MS` whatever the
 * day.
 *
 * A DATABASE'S FIRST PASS IS A SETTLE READ, NOT THE WHOLE DAY. It read from
 * midnight at first — ~12 400 calls by evening, ~250 invocations — to fetch
 * rows the three-hourly reference pass already holds: `call_record` is only
 * ever behind by what came since that pass, and its three-hour settle read
 * overlaps this one's seventy minutes on the next turn.
 */
export function recentCallsWindow(
  state: CallsState | null,
  now: Date,
  dayStart: Date,
): { readonly since: Date; readonly settle: boolean } {
  const settle = state === null || state.settledAt === null || now.getTime() - state.settledAt.getTime() >= CALLS_SETTLE_EVERY_MS
  const reach = now.getTime() - CALLS_SETTLE_REACH_MS
  if (state === null) return { since: new Date(reach), settle }
  const since = Math.max(state.passAt.getTime() - CALLS_OVERLAP_MS, dayStart.getTime())
  return { since: new Date(settle ? Math.min(since, reach) : since), settle }
}

export interface RecentCallsResult {
  readonly since: Date
  readonly settle: boolean
  readonly read: number
  readonly pages: number
  /** Calls the upsert rejected — the reference pass offers them again. */
  readonly failed: number
  /** The worker was stopping: the walk was cut short and the bookmark left where it was. */
  readonly stopped: boolean
}

/**
 * Read the calls started since the last pass and write them through `persist`
 * — the ordinary CALLS upsert (`engine.persistRecords`), fed by the ordinary
 * read (`provider.fetchCalls`): no second mapping, so a call written here and
 * by the reference pass is the same row either way.
 *
 * No `sync_log` row and no CALLS watermark: a CALLS / BACKFILL row would
 * settle the worker's one-off calls re-read, and moving the reference pass's
 * cursor would end its three-hour settle read. Throws when a read fails —
 * the bookmark then stays, and the next pass reads the same stretch again.
 * A worker told to stop ends the walk between two pages the same way: what
 * was written stays written (upserts), the bookmark does not move.
 */
export async function refreshRecentCalls(deps: {
  readonly clock: FeedClock
  readonly fetch: (options: FetchOptions) => Promise<Page<RawCall>>
  readonly persist: (calls: readonly RawCall[]) => Promise<{ readonly failed: number }>
  readonly now: Date
  /** The first instant of today in the app's time zone (`period.ts`). */
  readonly dayStart: Date
  /** The worker's shutdown flag: the platform allows thirty seconds to stop. */
  readonly stopping?: () => boolean
}): Promise<RecentCallsResult> {
  const state = parseCallsState(await deps.clock.read('calls'))
  const { since, settle } = recentCallsWindow(state, deps.now, deps.dayStart)

  let read = 0
  let failed = 0
  let pages = 0
  let cursor: string | undefined
  do {
    const page = await deps.fetch({ updatedSince: since, cursor })
    if (page.items.length > 0) {
      read += page.items.length
      failed += (await deps.persist(page.items)).failed
    }
    cursor = page.nextCursor
    if (++pages > CALLS_MAX_PAGES) throw new Error(`qoʻngʻiroqlar ${pages} sahifadan keyin ham tugamadi`)
    if (cursor && deps.stopping?.()) return { since, settle, read, pages, failed, stopped: true }
  } while (cursor)

  /*
    Advanced even when the upsert rejected a row. A rejected call is a database
    fault on that row, and holding the bookmark for it would re-read a stretch
    that grows by two minutes every pass — the whole day by evening, every two
    minutes. It is reported; the reference pass re-offers it through the engine.
  */
  await deps.clock.succeeded(
    'calls',
    {
      passAt: deps.now.toISOString(),
      settledAt: (settle ? deps.now : state?.settledAt)?.toISOString() ?? null,
    },
    deps.now,
  )
  return { since, settle, read, pages, failed, stopped: false }
}

// ---------------------------------------------------------------------------
// Open-line chats
// ---------------------------------------------------------------------------

/**
 * How far back the open chats are read: about a day.
 *
 * The read is bounded by an activity ID, not a date (a dated read took 12–16 s
 * a page on the live portal — `Bitrix24CrmProvider.fetchOpenLineChats`), and
 * the portal mints roughly 15 000 activity ids a day: every call is one. A
 * floor that stood still would have the portal step over a day's more ids on
 * every pass. A chat somebody has left open for more than a day is gone from
 * the watch — it stopped being a lead waiting for an answer long before.
 */
export const CHAT_WINDOW_MS = 24 * 60 * 60_000

/** How often the portal's newest activity id is noted, to become the floor a day later. */
export const CHAT_ANCHOR_EVERY_MS = 60 * 60_000

/**
 * How long a held deletion waits to be confirmed. A second pass inside this
 * that finds as many chats gone again deletes them — see `chatsGone`.
 */
const CHAT_HOLD_MS = 15 * 60_000

/** The open chats' bookmark. */
export interface ChatsState {
  /**
   * Chats are read above this activity id. Null until the first pass has
   * found one — see `refreshOpenLineChats` for how, and for `dated`.
   */
  readonly floor: string | null
  /** The one dated portal read was issued — never again, whatever came of it. */
  readonly dated: boolean
  /** The portal's newest activity id, noted about once an hour, oldest first. */
  readonly anchors: readonly { readonly id: string; readonly at: Date }[]
  /** A pass refused to delete this many chats at once, then. */
  readonly heldAt: Date | null
}

const NUMERIC = /^\d+$/

export function parseChatsState(json: unknown): ChatsState | null {
  if (!isRecord(json)) return null
  const floor = typeof json.floor === 'string' && NUMERIC.test(json.floor) ? json.floor : null
  const anchors = (Array.isArray(json.anchors) ? json.anchors : []).flatMap((a) => {
    const at = isRecord(a) ? isoDate(a.at) : null
    return isRecord(a) && typeof a.id === 'string' && NUMERIC.test(a.id) && at ? [{ id: a.id, at }] : []
  })
  return { floor, dated: json.dated === true, anchors, heldAt: isoDate(json.heldAt) }
}

function chatsStateJson(state: ChatsState): unknown {
  return {
    floor: state.floor,
    dated: state.dated,
    anchors: state.anchors.map((a) => ({ id: a.id, at: a.at.toISOString() })),
    heldAt: state.heldAt?.toISOString() ?? null,
  }
}

/** Whether the hour's anchor is owed: none yet, or the newest is `CHAT_ANCHOR_EVERY_MS` old. */
export function chatAnchorDue(state: ChatsState, now: Date): boolean {
  const newest = state.anchors[state.anchors.length - 1]
  return newest === undefined || now.getTime() - newest.at.getTime() >= CHAT_ANCHOR_EVERY_MS
}

/**
 * The bookmark after an anchor is (perhaps) noted and the floor moved up to
 * the newest anchor that is a whole window old.
 *
 * ONLY EVER UP. An anchor is the portal's newest id at an instant, so every
 * activity created after it has a larger id: reading above the anchor of 24
 * hours ago reads everything of the last 24 hours. Anchors older than the one
 * the floor now stands on are dropped — about twenty-five are kept.
 */
export function advanceChatWindow(state: ChatsState, head: string | null, now: Date): ChatsState {
  const anchors = head === null ? [...state.anchors] : [...state.anchors, { id: head, at: now }]
  const aged = anchors.filter((a) => now.getTime() - a.at.getTime() >= CHAT_WINDOW_MS)
  const reached = aged[aged.length - 1]
  const floor =
    reached !== undefined && (state.floor === null || Number(reached.id) > Number(state.floor)) ? reached.id : state.floor
  return {
    ...state,
    floor,
    anchors: reached === undefined ? anchors : anchors.filter((a) => a.at.getTime() >= reached.at.getTime()),
  }
}

/**
 * The most chats one pass may see closed at once before it holds the
 * deletion: ten, or half of what it held if that is more.
 *
 * Chats close all day — a handful between two passes. Most of the table gone
 * at once is far likelier an answer cut short, or a webhook user who lost
 * sight of the open lines (a permission change answers with an empty list,
 * not an error), than thirty conversations ended in two minutes.
 */
export function chatGoneLimit(stored: number): number {
  return Math.max(10, Math.ceil(stored / 2))
}

/**
 * The stored chats this answer no longer holds, and whether deleting them
 * must wait a pass.
 *
 * Unlike a deal, a chat that closed is the ordinary case and nothing else
 * will ever tell us about it — there is no nightly walk behind this table —
 * so a refusal cannot stand for ever, or the watch would show closed chats as
 * waiting for good. Past `chatGoneLimit` the deletion is HELD ONCE: the next
 * pass asks the portal again, and an answer that agrees is believed
 * (`confirming`). Rows under the floor are no part of the judgement: they
 * aged out of the window, which is why the portal was not asked about them.
 */
export function chatsGone(
  stored: readonly string[],
  live: ReadonlySet<string>,
  floor: string,
  confirming: boolean,
): { readonly gone: number; readonly hold: boolean } {
  const inWindow = stored.filter((id) => Number(id) > Number(floor))
  const gone = inWindow.filter((id) => !live.has(id)).length
  return { gone, hold: !confirming && gone > chatGoneLimit(inWindow.length) }
}

/** The most of a chat's SUBJECT that is kept. */
export const CHAT_SUBJECT_MAX = 500

/** The `open_line_chat` table, as the pass needs it. */
export interface ChatStore {
  /** The portal ids of every chat held now. */
  openIds(): Promise<string[]>
  /**
   * Write `chats` and — unless `keepMissing` — delete every row not among
   * them, in ONE transaction: a reader never sees the table half replaced.
   */
  replace(chats: readonly RawOpenLineChat[], at: Date, keepMissing: boolean): Promise<{ readonly deleted: number }>
}

export function prismaChatStore(prisma: PrismaClient, source: ExternalSourceValue): ChatStore {
  return {
    async openIds() {
      const rows = await prisma.openLineChat.findMany({ where: { externalSource: source }, select: { externalId: true } })
      return rows.map((r) => r.externalId)
    },
    async replace(chats, at, keepMissing) {
      const live = chats.map((c) => c.externalId)
      const fields = (c: RawOpenLineChat) => ({
        dealExternalId: c.dealExternalId,
        responsibleExternalId: c.responsibleExternalId ?? null,
        // Free text from the portal, shown as a title: capped, so one runaway subject is not a megabyte row.
        subject: c.subject.slice(0, CHAT_SUBJECT_MAX),
        openedAt: c.openedAt,
        lastSeenAt: at,
      })
      const [removed] = await prisma.$transaction([
        prisma.openLineChat.deleteMany({
          where: keepMissing
            ? // Nothing: the statement stays so the transaction's shape does not depend on the flag.
              { externalSource: source, externalId: { in: [] } }
            : { externalSource: source, externalId: { notIn: live } },
        }),
        ...chats.map((c) =>
          prisma.openLineChat.upsert({
            where: { externalSource_externalId: { externalSource: source, externalId: c.externalId } },
            create: { externalSource: source, externalId: c.externalId, ...fields(c) },
            update: fields(c),
          }),
        ),
      ])
      return { deleted: removed.count }
    },
  }
}

export interface OpenLineChatsResult {
  /** Chats the portal holds open now, a person's, inside the window. */
  readonly open: number
  readonly deleted: number
  /** Chats that looked closed but were kept for one more pass; 0 when nothing was held. */
  readonly held: number
  readonly floor: string
  /** How the floor was found, on the pass that found it. */
  readonly bootstrap: 'date' | 'head' | null
}

/**
 * One pass over the open chats: REPLACE the table with what the portal holds
 * open now.
 *
 * THE FLOOR, AND WHY THE DATED READ HAPPENS ONCE. Reading «the last day» by
 * date is the 12-second query, so the window is kept as an id:
 *
 *   every hour   the portal's newest activity id is noted (`newestId`, one
 *                unfiltered backwards step), and a day later that anchor
 *                becomes the floor (`advanceChatWindow`);
 *   first pass   there is no day-old anchor, so the portal is asked ONCE for
 *                the first activity created in the last day (`firstIdSince`,
 *                a dated read with no provider in it — its cost is not
 *                measured). `dated` is written BEFORE it is sent: a pass that
 *                dies on it — a timeout, a kill — never sends it again. If it
 *                fails, the floor is the newest id: the watch then starts with
 *                no chats and sees every one opened from now on. Degraded for
 *                a day, and never the expensive read on the two-minute clock.
 *
 * A PASS THAT FAILED WIPES NOTHING. Every read throws rather than answering
 * short (`fetchOpenLineChats`), and the table is only touched after the
 * answer is whole; what an answer that is whole but implausible may delete is
 * `chatsGone`'s to decide. A held pass is recorded as a failure, not a
 * success: «Лид назорати»'s clock must not say the chats are current while
 * rows it doubts are still on screen.
 *
 * AN EMPTY ANSWER IS NOT BELIEVED ON ITS OWN. «No person holds a chat open»
 * and «the webhook user can no longer see the open lines» are the same empty
 * list — a permission change answers with nothing, not with an error. So
 * when the answer is empty over a table that holds chats, ONE control read
 * is sent (`anyOpenChat`: the same floor and filter WITH the bot's chats, a
 * single page). The bot holds hundreds open all day, so rows there mean the
 * lines are visible and the people's chats really are all closed: the stored
 * rows go, with no hold. Empty there too means we are blind, and the pass
 * FAILS — nothing is wiped, the failure is recorded, the clock stays.
 */
export async function refreshOpenLineChats(deps: {
  readonly clock: FeedClock
  readonly store: ChatStore
  readonly fetchChats: (afterId: string) => Promise<RawOpenLineChat[]>
  readonly newestId: () => Promise<string | null>
  readonly firstIdSince: (since: Date) => Promise<string | null>
  /** Whether ANY open-line chat is open above `afterId`, the bot's included — the control read. */
  readonly anyOpenChat: (afterId: string) => Promise<boolean>
  readonly now: Date
}): Promise<OpenLineChatsResult> {
  const { clock, now } = deps
  let state: ChatsState = parseChatsState(await clock.read('chats')) ?? { floor: null, dated: false, anchors: [], heldAt: null }
  let bootstrap: OpenLineChatsResult['bootstrap'] = null

  if (state.floor === null) {
    let floor: string | null = null
    if (!state.dated) {
      state = { ...state, dated: true }
      await clock.remember('chats', chatsStateJson(state))
      try {
        const first = await deps.firstIdSince(new Date(now.getTime() - CHAT_WINDOW_MS))
        // One under the first activity of the window, so `>ID` includes it.
        if (first !== null) floor = String(Math.max(0, Number(first) - 1))
        if (floor !== null) bootstrap = 'date'
      } catch {
        // Fall through to the head: the dated read is not tried twice.
      }
    }
    if (floor === null) {
      const head = await deps.newestId()
      floor = head ?? '0'
      bootstrap = 'head'
      state = advanceChatWindow(state, head, now)
    }
    state = { ...state, floor }
    await clock.remember('chats', chatsStateJson(state))
  }

  /*
    The hour's anchor, before the read and not fatal to it: a refused anchor
    is owed again on the next pass, while the chats are what the screen shows.
  */
  if (chatAnchorDue(state, now)) {
    try {
      state = advanceChatWindow(state, await deps.newestId(), now)
    } catch {
      state = advanceChatWindow(state, null, now)
    }
  } else {
    state = advanceChatWindow(state, null, now)
  }

  const floor = state.floor ?? '0'
  const chats = await deps.fetchChats(floor)
  const live = new Set(chats.map((c) => c.externalId))
  const stored = await deps.store.openIds()
  let confirming = state.heldAt !== null && now.getTime() - state.heldAt.getTime() <= CHAT_HOLD_MS
  if (chats.length === 0 && stored.some((id) => Number(id) > Number(floor))) {
    if (!(await deps.anyOpenChat(floor))) {
      throw new Error('ochiq chatlar boʻsh qaytdi, nazorat soʻrovi ham boʻsh — ochiq liniyalar koʻrinmayapti, hech narsa oʻchirilmadi')
    }
    // The lines are visible and no person holds a chat: the empty answer is the truth, and needs no second pass.
    confirming = true
  }
  const { gone, hold } = chatsGone(stored, live, floor, confirming)

  const { deleted } = await deps.store.replace(chats, now, hold)
  state = { ...state, heldAt: hold ? now : null }

  if (hold) {
    await clock.remember('chats', chatsStateJson(state))
    await clock.failed(
      'chats',
      `${gone} ta ochiq chat birdan yoʻqoldi — oʻchirilmadi, keyingi oʻtishda tasdiqlansa oʻchiriladi`,
      now,
    )
    return { open: chats.length, deleted: 0, held: gone, floor, bootstrap }
  }

  await clock.succeeded('chats', chatsStateJson(state), now)
  return { open: chats.length, deleted, held: 0, floor, bootstrap }
}
