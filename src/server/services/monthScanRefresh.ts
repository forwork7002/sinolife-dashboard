/**
 * ROISTAT'S CLOSED MONTHS ARE READ HERE, IN THE SYNC WORKER, AND STORED
 * (2026-10-28). See `RoistatService` («THE CLOSED MONTHS ARE READ FROM THE
 * SYNC WORKER'S STORE») for why; this file decides which months, how often,
 * and reads them one at a time.
 *
 * WHICH MONTHS (`storedMonthQuestions`). The scan (`bitrix`) of every closed
 * month from January of LAST year — «Shu yil»'s tiles compare against the
 * same days a year before — and the FAKT (`fakt`, «Kunlar boʻyicha» alone) of
 * this year's closed months and the month just closed. Each stored scan is
 * the widest read (every grouping set, brand-keyed) folded to its brands
 * (`foldBitrixToBrand`), so one row per month answers every shape and brand
 * slice the screens ask (`bitrixRowsOfShape`).
 *
 * HOW OFTEN (`monthScanEvery`). A month whose leads' sales still open
 * (`monthSettling`) every half hour of the working day (`WARM_HOURS`) and
 * every three hours outside it, as «Mijoz qaytishi»; an older one twice a
 * day — what still moves it is a late delivery or a refund. At most
 * `MONTH_SCAN_PER_PASS` months a pass, newest first, so the first fill after
 * a deploy is spread over the worker's ticks instead of holding the one core
 * for twenty minutes.
 *
 * Started beside the Bitrix24 loop, never inside it, like the cohorts: a
 * month's widest scan is up to a minute on the one-core database.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { type Period, calendarMonth, zonedMonthKey } from '@/server/domain/period/period'
import { InsightsRepository } from '@/server/repositories/insightsRepository'
import { MonthScanRepository } from '@/server/repositories/monthScanRepository'
import { RoistatRepository, bitrixRowsOfShape } from '@/server/repositories/roistatRepository'

import { WARM_HOURS, withinHours } from './rnpWarmer'
import { foldBitrixToBrand, monthScanKey, monthSettling } from './roistatService'

export const MONTH_SCAN_SETTLING_MS = 30 * 60_000
export const MONTH_SCAN_SETTLING_NIGHT_MS = 3 * 3_600_000
export const MONTH_SCAN_SETTLED_MS = 12 * 3_600_000
/** Months read per pass — one pass per worker tick at most (`syncWorker.ts`). */
export const MONTH_SCAN_PER_PASS = 3
/** One statement's limit here: a bound on a statement gone wrong, not a budget. */
export const MONTH_SCAN_WORKER_STATEMENT_TIMEOUT_MS = 5 * 60_000

/** One stored month question. */
export interface MonthQuestion {
  readonly key: string
  readonly kind: 'bitrix' | 'fakt'
  readonly month: Period
}

/** Every month question the store keeps at `now`, the newest month first. */
export function storedMonthQuestions(now: Date, timeZone: string): MonthQuestion[] {
  const thisYear = Number(zonedMonthKey(now, timeZone).slice(0, 4))
  const questions: MonthQuestion[] = []
  for (let offset = -1; ; offset -= 1) {
    const { start, end } = calendarMonth(now, timeZone, offset)
    const key = zonedMonthKey(start, timeZone)
    const year = Number(key.slice(0, 4))
    if (year < thisYear - 1) break
    const month = Object.freeze({ start, end, timeZone, preset: 'custom' as const })
    questions.push({ key: monthScanKey('bitrix', key), kind: 'bitrix', month })
    if (year === thisYear || offset === -1) questions.push({ key: monthScanKey('fakt', key), kind: 'fakt', month })
  }
  return questions
}

/** How long a stored month may stand before it is read again. */
export function monthScanEvery(month: Period, now: Date): number {
  if (!monthSettling(month.end, now)) return MONTH_SCAN_SETTLED_MS
  return withinHours(now, month.timeZone, WARM_HOURS) ? MONTH_SCAN_SETTLING_MS : MONTH_SCAN_SETTLING_NIGHT_MS
}

/** The questions due at `now` — missing, or older than `monthScanEvery` — newest month first. */
export function dueMonthQuestions(questions: readonly MonthQuestion[], built: ReadonlyMap<string, Date>, now: Date): MonthQuestion[] {
  return questions.filter((q) => {
    const at = built.get(q.key)
    return at === undefined || now.getTime() - at.getTime() >= monthScanEvery(q.month, now)
  })
}

/** One stored month, as the pass read it. */
export interface MonthBuilt {
  readonly key: string
  readonly ms: number
  readonly rows: number
}

/**
 * Reads and stores the due months, at most `MONTH_SCAN_PER_PASS`, one at a
 * time — never side by side. A month that fails keeps its old row and does
 * not stop the others; the failures come back with the built ones, for the
 * log. Its `now` is the instant the read starts, stored as `builtAt`: the
 * scan read sales up to it, and the screen relies on that (`bitrixRows`).
 */
export async function refreshMonthScans(input: {
  prisma: PrismaClient
  timeZone: string
  stopping: () => boolean
  now?: () => Date
  perPass?: number
}): Promise<{ built: MonthBuilt[]; failed: { key: string; error: string }[] }> {
  const now = input.now ?? (() => new Date())
  const store = new MonthScanRepository(input.prisma)
  const roistat = new RoistatRepository(input.prisma)
  const insights = new InsightsRepository(input.prisma)
  const at = now()
  const due = dueMonthQuestions(storedMonthQuestions(at, input.timeZone), await store.builtAt(), at).slice(
    0,
    input.perPass ?? MONTH_SCAN_PER_PASS,
  )
  const built: MonthBuilt[] = []
  const failed: { key: string; error: string }[] = []
  for (const question of due) {
    if (input.stopping()) break
    const started = now()
    try {
      let rows: readonly unknown[]
      if (question.kind === 'bitrix') {
        const scan = foldBitrixToBrand(await roistat.bitrix(question.month, started, 'all', true, MONTH_SCAN_WORKER_STATEMENT_TIMEOUT_MS))
        // «Kunlar boʻyicha»'s part first: the scan's own row is what `dueMonthQuestions` reads as built.
        const days = monthScanKey('bitrix-days', zonedMonthKey(question.month.start, input.timeZone))
        await store.write(days, bitrixRowsOfShape(scan, 'days', true), started, now().getTime() - started.getTime())
        rows = scan
      } else {
        rows = await insights.rnpTeamDays(question.month, true, MONTH_SCAN_WORKER_STATEMENT_TIMEOUT_MS)
      }
      const ms = now().getTime() - started.getTime()
      await store.write(question.key, rows, started, ms)
      built.push({ key: question.key, ms, rows: rows.length })
    } catch (error) {
      failed.push({ key: question.key, error: error instanceof Error ? error.message.trim().split('\n').pop()! : String(error) })
    }
  }
  return { built, failed }
}
