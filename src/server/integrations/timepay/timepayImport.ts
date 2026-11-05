/**
 * TimePay → `timepay_day` / `timepay_employee`, for «Sotuvchilar oyligi»'s
 * lateness fine (2026-11-05, the owner: «har bir kechikkan minutiga 1 somdan
 * jarima»). Run by the sync worker beside the Bitrix24 loop — TimePay is not
 * the portal, so this costs the portal nothing.
 *
 * WHICH DAYS A PASS ASKS FOR:
 *   - today, every pass — the morning's arrivals land within the pass interval;
 *   - the last three days when `refreshRecent` — TimePay's past days still
 *     change (an application approved, a mark corrected by hand);
 *   - every day from the first of the PREVIOUS month that is not stored yet,
 *     at most `MAX_BACKFILL` a pass — so a fresh table fills over a few passes
 *     and the month a payroll is closed on is always whole.
 *
 * A DAY IS REPLACED WHOLE, never merged: its rows are deleted and written in
 * one transaction, so a mark TimePay took back does not linger. An EMPTY reply
 * for a day in the kept window is TimePay failing (it lists every employee
 * every day, days off included) — the stored day is kept and the pass fails.
 *
 * THE LINK. A person not decided yet (`linkSource` null) is linked to the ISH
 * employee whose name is theirs (`exactNameLinks` — unique on both sides). A
 * link an administrator set or cleared (`manual`) is never touched.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { exactNameLinks } from '@/server/domain/timepay/names'

import type { TimepayDailyRow } from './timepayClient'

export interface TimepaySource {
  dailyAttendance(day: string): Promise<TimepayDailyRow[]>
}

/** Days filled per pass from the backlog. 12 calls at 4 a second. */
export const MAX_BACKFILL = 12
const RECENT_DAYS = 3

export interface TimepayImportResult {
  readonly days: readonly string[]
  readonly rows: number
  readonly linked: number
  /** Days of the kept window still missing after this pass. */
  readonly missing: number
}

/** `YYYY-MM-DD` ± n days. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The first day of the month before `day`'s. */
export function keptFrom(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 2, 1, 12)).toISOString().slice(0, 10)
}

/** The days one pass asks for, in that order: today, the recent ones, then the backlog oldest first. */
export function daysToPull(today: string, stored: ReadonlySet<string>, refreshRecent: boolean): { days: string[]; missing: number } {
  const out = [today]
  if (refreshRecent) for (let i = 1; i <= RECENT_DAYS; i++) out.push(shiftDay(today, -i))
  const backlog: string[] = []
  for (let d = keptFrom(today); d < today; d = shiftDay(d, 1)) if (!stored.has(d) && !out.includes(d)) backlog.push(d)
  const taken = backlog.slice(0, MAX_BACKFILL)
  return { days: [...out, ...taken], missing: backlog.length - taken.length }
}

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)
const dayOf = (date: Date) => date.toISOString().slice(0, 10)

/** A department / position as TimePay sends it — an object with a name, or a string. */
function named(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }
  return null
}

/** «08:31:12» → «08:31»; anything else → null. */
export function hhmm(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value) ? value.slice(0, 5).padStart(5, '0') : null
}

/** The stored facts of one TimePay row — what `lateFine` reads. */
export function dayRowOf(row: TimepayDailyRow): { checkIn: string | null; lateMinutes: number; holiday: boolean; onLeave: boolean } {
  const s = row.stats ?? {}
  const minutes = typeof s.late_minutes === 'number' && Number.isFinite(s.late_minutes) ? Math.max(0, Math.floor(s.late_minutes)) : 0
  return {
    checkIn: hhmm(s.first_check_in),
    lateMinutes: s.late === true ? minutes : 0,
    holiday: s.is_holiday === true,
    onLeave: s.on_leave === true,
  }
}

export async function importTimepay(
  prisma: PrismaClient,
  source: TimepaySource,
  opts: { readonly today: string; readonly refreshRecent: boolean },
): Promise<TimepayImportResult> {
  const floor = keptFrom(opts.today)
  const storedRows = await prisma.timepayDay.groupBy({ by: ['day'], where: { day: { gte: dateOf(floor) } } })
  const stored = new Set(storedRows.map((r) => dayOf(r.day)))
  const { days, missing } = daysToPull(opts.today, stored, opts.refreshRecent)

  let rows = 0
  /* Each person as of the NEWEST day this pass read them on. */
  const seen = new Map<number, { fullName: string; department: string | null; position: string | null; day: string }>()
  for (const day of days) {
    const list = (await source.dailyAttendance(day)).filter((r) => Number.isInteger(r.id))
    if (list.length === 0) throw new Error(`TimePay ${day}: boʻsh javob — saqlangan kun oʻzgartirilmadi`)
    const now = new Date()
    await prisma.$transaction([
      prisma.timepayDay.deleteMany({ where: { day: dateOf(day) } }),
      prisma.timepayDay.createMany({
        data: list.map((r) => ({ timepayId: r.id, day: dateOf(day), ...dayRowOf(r), syncedAt: now })),
        skipDuplicates: true,
      }),
    ])
    rows += list.length
    for (const r of list) {
      const fullName = (r.full_name ?? '').trim()
      const held = seen.get(r.id)
      if (fullName && (!held || held.day < day)) {
        seen.set(r.id, { fullName, department: named(r.department), position: named(r.position), day })
      }
    }
  }

  /*
    THE PEOPLE, WRITTEN ONLY WHEN SOMETHING CHANGED — a new person, a newer
    day, a renamed team. A past day re-read never rolls a name back.
  */
  const known = new Map(
    (
      await prisma.timepayEmployee.findMany({
        select: { timepayId: true, fullName: true, department: true, position: true, lastSeen: true },
      })
    ).map((p) => [p.timepayId, p]),
  )
  const now = new Date()
  for (const [timepayId, p] of seen) {
    const held = known.get(timepayId)
    const facts = { fullName: p.fullName, department: p.department, position: p.position, lastSeen: dateOf(p.day), syncedAt: now }
    if (!held) {
      await prisma.timepayEmployee.create({ data: { timepayId, ...facts } })
    } else if (dayOf(held.lastSeen) < p.day || (dayOf(held.lastSeen) === p.day && (held.fullName !== p.fullName || held.department !== p.department || held.position !== p.position))) {
      await prisma.timepayEmployee.update({ where: { timepayId }, data: facts })
    }
  }

  return { days, rows, linked: await linkByName(prisma), missing }
}

/** Links every undecided person whose name settles it. Returns how many were linked. */
export async function linkByName(prisma: PrismaClient): Promise<number> {
  const [people, linked, employees] = await Promise.all([
    prisma.timepayEmployee.findMany({ where: { linkSource: null }, select: { timepayId: true, fullName: true } }),
    prisma.timepayEmployee.findMany({ where: { employeeId: { not: null } }, select: { employeeId: true } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true } }),
  ])
  if (people.length === 0) return 0
  const taken = new Set(linked.map((r) => r.employeeId))
  const links = exactNameLinks(
    people,
    employees.filter((e) => !taken.has(e.id)),
  )
  const now = new Date()
  let n = 0
  for (const [timepayId, employeeId] of links) {
    const r = await prisma.timepayEmployee.updateMany({
      where: { timepayId, linkSource: null },
      data: { employeeId, linkSource: 'name', linkedAt: now },
    })
    n += r.count
  }
  return n
}
