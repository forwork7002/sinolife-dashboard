import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'
import type { RawDealBirth } from '@/server/integrations/crm/CrmProvider'

import type { FeedClock } from './leadWatchFeeds'

/**
 * WHERE EVERY DEAL WAS BORN — the pipeline a deal opened in, which «Безквал»
 * counts by (the client's spec, 2026-10-22: a lead is a deal CREATED in
 * Регистрация or Первичный отдел).
 *
 * `deal.pipelineId` is where the deal stands NOW. Measured on the portal for
 * 21.10.2026: 4 845 deals were born that day — 2 713 in Регистрация (every one
 * still there), 260 in Первичный отдел (56 since moved on to Доставка and
 * Тасдиклаш under the same id) and 1 582 in «ИИ обработка» (102 since moved
 * into Регистрация). Only `crm.stagehistory`'s TYPE_ID 1 row — written when
 * the deal is created, with the CATEGORY_ID it opened in — says which.
 *
 * READ IN ID ORDER, APPENDED, NEVER DELETED, exactly as the form fills
 * (`formFillFeed.ts`): history ids rise with time, so a floor is the whole
 * bookmark (`lead_watch_sync` row 'births'), and the floor stops at the newest
 * birth `DEAL_BIRTH_OVERLAP_MS` old, so a row that committed after a larger id
 * was read is not stepped over; the unique key makes the re-read free.
 *
 * WHAT IT COSTS THE PORTAL: one batch a pass (`fetchDealBirths`, up to fifty
 * chained pages), every `DEAL_BIRTHS_MS` in the worker. The first pass finds
 * its floor with ONE dated read and walks from `DEAL_BIRTHS_FROM_MONTH`: ~400
 * 000 births to 2026-10-22, ~170 batches, `DEAL_BIRTH_BATCHES` a pass.
 *
 * THE SAME PASS READS WHERE DEALS MOVED (feed 'moves', 2026-10-26, «Безквал»
 * v2): the TYPE_ID 5 rows, a pipeline change each, into `crm_deal_move`, on
 * a bookmark of their own. An «ИИ обработка» deal the portal moves into
 * Регистрация is a lead of the day it moved (the spec's fact 2), and nothing
 * but these rows says when, or from where.
 */

/** The month (`YYYY-MM`, Tashkent) the backfill starts at — before «Безквал»'s month grid and its 30-day look-back. */
export const DEAL_BIRTHS_FROM_MONTH = '2026-08'

/** Batches one pass may read: up to 2 500 rows each. */
export const DEAL_BIRTH_BATCHES = 8

/** How far back of the newest birth every pass reads again — see the header and `FORM_FILL_OVERLAP_MS`. */
export const DEAL_BIRTH_OVERLAP_MS = 10 * 60_000

/** The feed's bookmark (`lead_watch_sync` row 'births'). */
export interface DealBirthsState {
  /** Births are read above this stage-history id. */
  readonly floor: string
  /** The instant the backfill started at: a deal created before it may have no birth row. */
  readonly from: Date
}

const NUMERIC = /^\d+$/

export function parseDealBirthsState(json: unknown): DealBirthsState | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const { floor, from } = json as Record<string, unknown>
  const at = typeof from === 'string' ? new Date(from) : null
  if (typeof floor !== 'string' || !NUMERIC.test(floor) || !at || Number.isNaN(at.getTime())) return null
  return { floor, from: at }
}

/** The `crm_deal_birth` table (or `crm_deal_move`), as the pass needs it. */
export interface DealBirthStore {
  /** Write the births; one already held is skipped. Returns how many were new. */
  insert(births: readonly RawDealBirth[]): Promise<number>
}

/** Which feed a pass walks: TYPE_ID 1 rows into `crm_deal_birth`, or TYPE_ID 5 rows into `crm_deal_move`. */
export type DealStageFeed = 'births' | 'moves'

export function prismaDealBirthStore(prisma: PrismaClient, source: ExternalSourceValue): DealBirthStore {
  return {
    async insert(births) {
      if (births.length === 0) return 0
      const { count } = await prisma.crmDealBirth.createMany({
        data: births.map((b) => ({
          externalSource: source,
          externalId: b.externalId,
          dealExternalId: b.dealExternalId,
          categoryId: b.categoryId,
          stageExternalId: b.stageExternalId,
          bornAt: b.bornAt,
        })),
        skipDuplicates: true,
      })
      return count
    },
  }
}

/** `crm_deal_move` — a move row's `bornAt` is the instant of the move. */
export function prismaDealMoveStore(prisma: PrismaClient, source: ExternalSourceValue): DealBirthStore {
  return {
    async insert(moves) {
      if (moves.length === 0) return 0
      const { count } = await prisma.crmDealMove.createMany({
        data: moves.map((m) => ({
          externalSource: source,
          externalId: m.externalId,
          dealExternalId: m.dealExternalId,
          categoryId: m.categoryId,
          stageExternalId: m.stageExternalId,
          movedAt: m.bornAt,
        })),
        skipDuplicates: true,
      })
      return count
    },
  }
}

export interface DealBirthsResult {
  readonly floor: string
  readonly read: number
  readonly written: number
  /** The walk reached the newest birth: the table is whole up to this pass. */
  readonly complete: boolean
  /** This pass found the first floor with the dated read. */
  readonly bootstrap: boolean
}

/**
 * One pass: the births above the floor, a batch at a time, each batch written
 * as it is read, and the floor moved up to the newest birth that is
 * `DEAL_BIRTH_OVERLAP_MS` old. The same clock and failure rules as
 * `refreshFormFills`: a pass that reached the newest birth is a success, one
 * that stopped at its cap only remembers its floor, a batch that fails keeps
 * what came before it, and a first floor that cannot be found throws.
 */
export async function refreshDealBirths(deps: {
  /** 'births' when omitted. */
  readonly feed?: DealStageFeed
  readonly clock: FeedClock
  readonly store: DealBirthStore
  /** ONE batch of births above `afterId`, and whether it reached the newest (`fetchDealBirths`). */
  readonly fetch: (afterId: string) => Promise<{ births: RawDealBirth[]; complete: boolean }>
  readonly firstIdSince: (since: Date) => Promise<string | null>
  /** The first instant of `DEAL_BIRTHS_FROM_MONTH` in the app's time zone. */
  readonly from: Date
  readonly now: Date
  readonly maxBatches?: number
  /** The worker's shutdown flag: the walk ends between two batches. */
  readonly stopping?: () => boolean
}): Promise<DealBirthsResult> {
  const feed = deps.feed ?? 'births'
  let state = parseDealBirthsState(await deps.clock.read(feed))
  let bootstrap = false
  if (state === null) {
    const first = await deps.firstIdSince(deps.from)
    if (first === null || !NUMERIC.test(first)) {
      throw new Error(`bitim ${feed === 'births' ? 'tugʻilishlari' : 'koʻchishlari'}: boshlanish nuqtasi topilmadi — keyingi oʻtishda yana soʻraladi`)
    }
    state = { floor: String(Math.max(0, Number(first) - 1)), from: deps.from }
    bootstrap = true
    await deps.clock.remember(feed, stateJson(state))
  }

  const settled = deps.now.getTime() - DEAL_BIRTH_OVERLAP_MS
  const maxBatches = deps.maxBatches ?? DEAL_BIRTH_BATCHES
  let cursor = state.floor
  let floor = state.floor
  let read = 0
  let written = 0
  let complete = false
  try {
    for (let batch = 0; batch < maxBatches; batch++) {
      const answer = await deps.fetch(cursor)
      written += await deps.store.insert(answer.births)
      read += answer.births.length
      for (const birth of answer.births) {
        cursor = birth.externalId
        if (birth.bornAt.getTime() <= settled) floor = birth.externalId
      }
      if (answer.complete || answer.births.length === 0) {
        complete = true
        break
      }
      if (deps.stopping?.()) break
    }
  } catch (error) {
    if (floor !== state.floor) await deps.clock.remember(feed, stateJson({ ...state, floor }))
    throw error
  }

  const next: DealBirthsState = { ...state, floor }
  if (complete) await deps.clock.succeeded(feed, stateJson(next), deps.now)
  else await deps.clock.remember(feed, stateJson(next))
  return { floor, read, written, complete, bootstrap }
}

function stateJson(state: DealBirthsState): unknown {
  return { floor: state.floor, from: state.from.toISOString() }
}
