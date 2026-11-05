import type { PrismaClient } from '@/generated/prisma/client'
import type { LateDay } from '@/server/domain/payroll/lateFine'

/** A `YYYY-MM-DD` as the UTC-midnight Date a `@db.Date` column wants. */
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)
const dayOf = (date: Date) => date.toISOString().slice(0, 10)

/** One linked person's late days over a window, keyed by the ISH employee. */
export interface LateRead {
  /** ISH employee id → the days TimePay says they were late on. */
  readonly days: ReadonlyMap<string, readonly LateDay[]>
  /** Every ISH employee linked to a TimePay person — a seller NOT here has no attendance, which is not «on time». */
  readonly linked: ReadonlySet<string>
  /** The newest write of any stored day; null — nothing synced yet. */
  readonly syncedAt: Date | null
}

export interface TimepayPersonRow {
  readonly timepayId: number
  readonly fullName: string
  readonly department: string | null
  readonly position: string | null
  readonly employeeId: string | null
  readonly linkSource: string | null
  readonly linkedBy: string | null
  readonly lastSeen: string
}

/** `timepay_employee` / `timepay_day` — what the sync worker wrote from TimePay. */
export class TimepayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** The late days `[from, to]` (Tashkent calendar days, inclusive) of every linked person. */
  async lateDays(from: string, to: string): Promise<LateRead> {
    const [people, rows, newest] = await Promise.all([
      this.prisma.timepayEmployee.findMany({
        where: { employeeId: { not: null } },
        select: { timepayId: true, employeeId: true },
      }),
      this.prisma.timepayDay.findMany({
        where: { day: { gte: dateOf(from), lte: dateOf(to) }, lateMinutes: { gt: 0 } },
        select: { timepayId: true, day: true, checkIn: true, lateMinutes: true, holiday: true, onLeave: true },
      }),
      this.prisma.timepayDay.aggregate({ _max: { syncedAt: true } }),
    ])
    const employeeOf = new Map(people.map((p) => [p.timepayId, p.employeeId!]))
    const days = new Map<string, LateDay[]>()
    for (const r of rows) {
      const employeeId = employeeOf.get(r.timepayId)
      if (employeeId === undefined) continue
      const day: LateDay = { day: dayOf(r.day), checkIn: r.checkIn, lateMinutes: r.lateMinutes, holiday: r.holiday, onLeave: r.onLeave }
      const list = days.get(employeeId)
      if (list) list.push(day)
      else days.set(employeeId, [day])
    }
    return { days, linked: new Set(employeeOf.values()), syncedAt: newest._max.syncedAt }
  }

  /** Every TimePay person, for the link list. */
  async people(): Promise<TimepayPersonRow[]> {
    const rows = await this.prisma.timepayEmployee.findMany({ orderBy: { fullName: 'asc' } })
    return rows.map((r) => ({
      timepayId: r.timepayId,
      fullName: r.fullName,
      department: r.department,
      position: r.position,
      employeeId: r.employeeId,
      linkSource: r.linkSource,
      linkedBy: r.linkedBy,
      lastSeen: dayOf(r.lastSeen),
    }))
  }

  /** Active employees — who a TimePay person may be linked to. */
  async employees(): Promise<{ id: string; fullName: string }[]> {
    return this.prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    })
  }

  async employeeExists(id: string): Promise<boolean> {
    return (await this.prisma.employee.count({ where: { id } })) > 0
  }

  async personExists(timepayId: number): Promise<boolean> {
    return (await this.prisma.timepayEmployee.count({ where: { timepayId } })) > 0
  }

  /**
   * An administrator's decision: `timepayId` IS `employeeId`, or (null) is
   * nobody here. Manual either way, so the name match never undoes it. An
   * employee linked to somebody else moves: that other person becomes a
   * manual «nobody» — the administrator said whose the employee is.
   */
  async setLink(timepayId: number, employeeId: string | null, by: string): Promise<void> {
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      if (employeeId !== null) {
        await tx.timepayEmployee.updateMany({
          where: { employeeId, timepayId: { not: timepayId } },
          data: { employeeId: null, linkSource: 'manual', linkedBy: by, linkedAt: now },
        })
      }
      await tx.timepayEmployee.update({
        where: { timepayId },
        data: { employeeId, linkSource: 'manual', linkedBy: by, linkedAt: now },
      })
    })
  }
}
