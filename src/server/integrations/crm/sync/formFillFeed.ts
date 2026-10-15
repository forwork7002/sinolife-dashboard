import type { PrismaClient } from '@/generated/prisma/client'
import type { ExternalSourceValue } from '@/server/domain/types'
import type { RawFormFill } from '@/server/integrations/crm/CrmProvider'

import type { FeedClock } from './leadWatchFeeds'

/**
 * EVERY CRM-FORM FILL, AS THE PORTAL RECORDED IT — the Bitrix24 side of
 * «Meta leadlari · forma» on «Target tahlili» (2026-10-15).
 *
 * Meta counts each form fill as a lead, on the day it was filled. The portal
 * opens a Регистрация deal only for SOME of them: a returning contact's fill
 * is filed as an activity on the contact's old deal, and the robot that opens
 * «Qayta zayavka» deals for those skips many and ran late on 05.10. Counted
 * by deals, 01–15.10.2026 read 83 % of Meta while the fills themselves —
 * `crm.activity` with PROVIDER_ID CRM_WEBFORM — were 99.6 %, every day
 * 97–103 %. The client: Bitrix24 must count «huddi shu kombinatsiyada».
 *
 * READ IN ID ORDER, APPENDED, NEVER DELETED. Activity ids rise with time, so
 * a floor (the newest id written) is the whole bookmark. A fill happened even
 * if its deal is later removed — Meta keeps counting it — so nothing here
 * deletes, and the read throws on any row it did not ask for
 * (`Bitrix24CrmProvider.fetchFormFills`).
 *
 * WHAT IT COSTS THE PORTAL: one request a pass (~1 100 fills a day, fifty a
 * page), every `FORM_FILLS_MS` in the worker. The first pass finds its floor
 * with ONE dated read (`firstIdSince`, ~0.2 s on 2026-10-15) and backfills
 * from `FORM_FILLS_FROM_MONTH`, `FORM_FILL_PAGES` pages a pass, the next pass at
 * once until it has caught up — about 1 500 pages, an hour and a bit.
 */

/** The month (`YYYY-MM`, Tashkent) the backfill starts at. Windows that start earlier are counted by deals. */
export const FORM_FILLS_FROM_MONTH = '2026-08'

/** Pages of fifty one pass may read: ~20 s at the worker's 2 requests a second. */
export const FORM_FILL_PAGES = 40

/** The feed's bookmark (`lead_watch_sync` row 'forms'). */
export interface FormFillsState {
  /** Fills are read above this activity id. */
  readonly floor: string
  /** The instant the backfill started at — what «counted from» means on the read side. */
  readonly from: Date
}

const NUMERIC = /^\d+$/

export function parseFormFillsState(json: unknown): FormFillsState | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const { floor, from } = json as Record<string, unknown>
  const at = typeof from === 'string' ? new Date(from) : null
  if (typeof floor !== 'string' || !NUMERIC.test(floor) || !at || Number.isNaN(at.getTime())) return null
  return { floor, from: at }
}

/** The `crm_form_fill` table, as the pass needs it. */
export interface FormFillStore {
  /** Write the fills; one already held is skipped. Returns how many were new. */
  insert(fills: readonly RawFormFill[]): Promise<number>
}

/** The most of a SUBJECT that is kept: a form name, not a document. */
export const FORM_FILL_SUBJECT_MAX = 500

export function prismaFormFillStore(prisma: PrismaClient, source: ExternalSourceValue): FormFillStore {
  return {
    async insert(fills) {
      if (fills.length === 0) return 0
      const { count } = await prisma.crmFormFill.createMany({
        data: fills.map((f) => ({
          externalSource: source,
          externalId: f.externalId,
          subject: f.subject.slice(0, FORM_FILL_SUBJECT_MAX),
          filledAt: f.filledAt,
          ownerTypeId: f.ownerTypeId,
          ownerExternalId: f.ownerExternalId,
        })),
        skipDuplicates: true,
      })
      return count
    },
  }
}

export interface FormFillsResult {
  readonly floor: string
  readonly read: number
  readonly written: number
  /** The walk reached the newest fill: the table is whole up to this pass. */
  readonly complete: boolean
  /** This pass found the first floor with the dated read. */
  readonly bootstrap: boolean
}

/**
 * How far back of the newest fill every pass reads again. Activity ids are
 * handed out before a row commits, so a fill can become visible after one
 * with a larger id was already read; a floor at the largest id read would
 * step over it for good. The floor stops at the newest fill this much older
 * than the pass, and the unique key makes the re-read free (~8 fills).
 */
export const FORM_FILL_OVERLAP_MS = 10 * 60_000

/**
 * One pass: the fills above the floor, a page at a time, each page written
 * as it is read, and the floor moved up to the newest fill that is
 * `FORM_FILL_OVERLAP_MS` old.
 *
 * THE CLOCK SAYS «WHOLE UP TO HERE». A pass that reached the newest fill is a
 * success (`lastSuccessAt` = the instant it started reading); one that
 * stopped at `maxPages`, or because the worker is stopping, only remembers its
 * floor. So the read side counts fills only once a pass has caught up — a
 * half-done backfill would print a week of fills as a month's leads.
 *
 * A PAGE THAT FAILS keeps what came before it: the floor reached so far is
 * remembered, then the error goes on to the worker. Forty pages of a
 * backfill are not read twice for one refusal on the forty-first.
 *
 * THE FIRST FLOOR: one under the first activity created at `from` — any
 * provider's, the ids are one sequence. Written before the walk, so a pass
 * that dies mid-walk does not ask the dated question again. A dated read that
 * fails or finds nothing throws: there is no safe guess (`'0'` would walk the
 * portal's whole history), and the next pass asks again.
 */
export async function refreshFormFills(deps: {
  readonly clock: FeedClock
  readonly store: FormFillStore
  /** ONE page of fills above `afterId`, and whether it was the last (`fetchFormFills(afterId, 1)`). */
  readonly fetch: (afterId: string) => Promise<{ fills: RawFormFill[]; complete: boolean }>
  readonly firstIdSince: (since: Date) => Promise<string | null>
  /** The first instant of `FORM_FILLS_FROM_MONTH` in the app's time zone. */
  readonly from: Date
  readonly now: Date
  readonly maxPages?: number
  /** The worker's shutdown flag: the walk ends between two pages. */
  readonly stopping?: () => boolean
}): Promise<FormFillsResult> {
  let state = parseFormFillsState(await deps.clock.read('forms'))
  let bootstrap = false
  if (state === null) {
    const first = await deps.firstIdSince(deps.from)
    if (first === null || !NUMERIC.test(first)) {
      throw new Error('forma toʻldirishlari: boshlanish nuqtasi topilmadi — keyingi oʻtishda yana soʻraladi')
    }
    state = { floor: String(Math.max(0, Number(first) - 1)), from: deps.from }
    bootstrap = true
    await deps.clock.remember('forms', stateJson(state))
  }

  const settled = deps.now.getTime() - FORM_FILL_OVERLAP_MS
  const maxPages = deps.maxPages ?? FORM_FILL_PAGES
  let cursor = state.floor
  let floor = state.floor
  let read = 0
  let written = 0
  let complete = false
  try {
    for (let page = 0; page < maxPages; page++) {
      const answer = await deps.fetch(cursor)
      written += await deps.store.insert(answer.fills)
      read += answer.fills.length
      for (const fill of answer.fills) {
        cursor = fill.externalId
        if (fill.filledAt.getTime() <= settled) floor = fill.externalId
      }
      if (answer.complete) {
        complete = true
        break
      }
      if (deps.stopping?.()) break
    }
  } catch (error) {
    if (floor !== state.floor) await deps.clock.remember('forms', stateJson({ ...state, floor }))
    throw error
  }

  const next: FormFillsState = { ...state, floor }
  if (complete) await deps.clock.succeeded('forms', stateJson(next), deps.now)
  else await deps.clock.remember('forms', stateJson(next))
  return { floor, read, written, complete, bootstrap }
}

function stateJson(state: FormFillsState): unknown {
  return { floor: state.floor, from: state.from.toISOString() }
}
