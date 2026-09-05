/**
 * The caller's row scope, resolved once per request.
 *
 * `rowScopeFor` in `auth/rbac` decides the POLICY and is pure. This is the one
 * thing it cannot do for a TEAM account: ask the department tree who is on the
 * team. That answer is the same for every request a person makes and changes
 * only when the portal moves somebody, so it is memoised — and the memo is the
 * dangerous part of this file, not the query.
 *
 * THE KEY IS THE WHOLE QUESTION. It is one employee id because the answer
 * depends on exactly one employee id and the tree. A key that omitted an
 * argument here would not serve a slightly stale scope, it would serve ANOTHER
 * ACCOUNT'S — the same rule the command centre's cache key is written to, with
 * a worse failure than a wrong number on a tile.
 *
 * SIXTY SECONDS, and the number comes from the sync worker: it ticks once a
 * minute, reference data (departments and employees among it) reloads every
 * thirty ticks, so a scope can be at most a minute behind a move that itself
 * took half an hour to arrive. The alternative is a recursive query on every
 * request from every screen — `/meta/alerts` alone is one per page per minute.
 *
 * A REJECTION IS NEVER CACHED. Storing a failed lookup would turn one bad
 * minute into sixty seconds of them, and here "bad" means every screen the
 * account opens comes back empty rather than erroring, which reads as "you
 * have no data" instead of "we could not tell".
 */

import { NO_EMPLOYEE_LINKED, type Principal, type RowScope, rowScopeFor, scopeNeedsTeam } from '@/server/auth/rbac'
import type { ScopeRepository } from '@/server/repositories/scopeRepository'

const TEAM_TTL_MS = 60_000

interface Entry {
  readonly at: number
  readonly ids: readonly string[]
}

export class ScopeService {
  private readonly memo = new Map<string, Entry>()

  constructor(private readonly repository: ScopeRepository) {}

  /**
   * The scope to spread into every repository call this request makes.
   *
   * ALL and OWN are decided by the session row alone and cost no query; only
   * TEAM reaches the database, and then at most once a minute per account.
   */
  async resolve(principal: Principal, now: Date = new Date()): Promise<RowScope> {
    if (!scopeNeedsTeam(principal)) return rowScopeFor(principal)

    /*
      An account scoped to a team with nobody linked to it is a provisioning
      mistake the admin screen refuses to create. Failing closed here rather
      than querying for a null id keeps the two paths agreeing: no link means
      no rows, exactly as OWN behaves.
    */
    if (!principal.employeeId) return rowScopeFor(principal, [NO_EMPLOYEE_LINKED])

    return rowScopeFor(principal, await this.teamOf(principal.employeeId, now))
  }

  private async teamOf(employeeId: string, now: Date): Promise<readonly string[]> {
    const cached = this.memo.get(employeeId)
    if (cached && now.getTime() - cached.at < TEAM_TTL_MS) return cached.ids

    const ids = await this.repository.teamEmployeeIds(employeeId)
    this.memo.set(employeeId, { at: now.getTime(), ids })
    return ids
  }
}
