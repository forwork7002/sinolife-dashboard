/**
 * «Sotuvchilar oyligi → TimePay bogʻlash» — which ISH employee each TimePay
 * (FaceID) person is, for the lateness fine (2026-11-05).
 *
 * The worker links the people whose name settles it (`exactNameLinks`); the
 * rest are here for an administrator, with the nearest employee name as a
 * SUGGESTION (`nameSimilarity`) — never applied by itself, because a wrong
 * link fines the wrong person. A seller not linked is fined nothing, and the
 * payroll counts them out loud.
 */

import { nameSimilarity } from '@/server/domain/timepay/names'
import { ApiError } from '@/server/http/errors'
import type { TimepayRepository } from '@/server/repositories/timepayRepository'

/** A suggestion is offered from this similarity up. */
const SUGGEST_FROM = 0.75

export interface TimepayLinkPersonDto {
  readonly timepayId: number
  readonly fullName: string
  readonly department: string | null
  readonly position: string | null
  readonly employeeId: string | null
  readonly employeeName: string | null
  /** 'name' — the worker's exact match · 'manual' — an administrator's · null — undecided. */
  readonly source: 'name' | 'manual' | null
  readonly linkedBy: string | null
  /** The last day TimePay listed them, `YYYY-MM-DD`. */
  readonly lastSeen: string
  /** For an unlinked person: the nearest free employee name, if near enough. */
  readonly suggestion: { readonly employeeId: string; readonly fullName: string } | null
}

/** Mirrored in `src/lib/api.ts` — edit both. */
export interface TimepayLinksDto {
  readonly people: readonly TimepayLinkPersonDto[]
  /** Active employees, for the picker; `linked` — already somebody's. */
  readonly employees: readonly { readonly id: string; readonly fullName: string; readonly linked: boolean }[]
}

export class TimepayLinkService {
  constructor(private readonly repo: Pick<TimepayRepository, 'people' | 'employees' | 'personExists' | 'employeeExists' | 'setLink'>) {}

  async links(): Promise<TimepayLinksDto> {
    const [people, employees] = await Promise.all([this.repo.people(), this.repo.employees()])
    const nameOf = new Map(employees.map((e) => [e.id, e.fullName]))
    const taken = new Set(people.flatMap((p) => (p.employeeId === null ? [] : [p.employeeId])))
    const free = employees.filter((e) => !taken.has(e.id))
    const rows = people.map((p): TimepayLinkPersonDto => {
      let suggestion: TimepayLinkPersonDto['suggestion'] = null
      if (p.employeeId === null) {
        let best = SUGGEST_FROM
        for (const e of free) {
          const score = nameSimilarity(p.fullName, e.fullName)
          if (score >= best) {
            best = score
            suggestion = { employeeId: e.id, fullName: e.fullName }
          }
        }
      }
      return {
        timepayId: p.timepayId,
        fullName: p.fullName,
        department: p.department,
        position: p.position,
        employeeId: p.employeeId,
        employeeName: p.employeeId === null ? null : (nameOf.get(p.employeeId) ?? null),
        source: p.linkSource === 'name' || p.linkSource === 'manual' ? p.linkSource : null,
        linkedBy: p.linkedBy,
        lastSeen: p.lastSeen,
        suggestion,
      }
    })
    // The undecided first — what is left to do — then by team and name.
    rows.sort(
      (a, b) =>
        Number(a.employeeId !== null) - Number(b.employeeId !== null) ||
        (a.department ?? '').localeCompare(b.department ?? '', 'ru') ||
        a.fullName.localeCompare(b.fullName, 'ru'),
    )
    return {
      people: rows,
      employees: employees.map((e) => ({ id: e.id, fullName: e.fullName, linked: taken.has(e.id) })),
    }
  }

  /** An administrator's link (or «nobody», `employeeId: null`). */
  async link(timepayId: number, employeeId: string | null, by: string): Promise<void> {
    if (!(await this.repo.personExists(timepayId))) throw ApiError.notFound('Bu odam TimePay roʻyxatida yoʻq.')
    if (employeeId !== null && !(await this.repo.employeeExists(employeeId))) throw ApiError.validation('Bunday xodim yoʻq.')
    await this.repo.setLink(timepayId, employeeId, by)
  }
}
