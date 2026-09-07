/**
 * Who a «Faqat oʻz boʻlimi» account can be anchored to, and what that buys.
 *
 * WHY THIS IS ITS OWN FILE. `userAdminService` asks the database two questions
 * and then does a fair amount of reasoning over the answers — one row per
 * PERSON rather than per unit, how many units sit beneath each headed one,
 * which of them are sales teams, and what order an administrator wants to read
 * them in. All of that is decidable from the two answers alone, so it lives
 * here where a test can reach it without a database, exactly as `roles.ts`
 * beside it holds the rule for who counts as a seller.
 *
 * WHAT IS NOT HERE, DELIBERATELY: the team SIZE. That is the resolved scope,
 * and it has exactly one definition — `ScopeRepository.teamEmployeeIds` — which
 * a second implementation here would quietly compete with. The two would agree
 * until the day they did not, and neither would error. The service asks the
 * real resolver and attaches the number afterwards.
 */

import type { SectionValue } from '@/lib/sections'
import type { DataScopeValue } from '@/server/domain/types'
import { isSalesTeamName } from './roles'

/** One unit in the tree. Only the edge matters here. */
export interface DepartmentNode {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
}

/** A unit the portal names but nobody heads. */
export interface HeadlessUnit {
  readonly id: string
  readonly name: string
}

/** A unit that names a head, with that head's record attached. */
export interface HeadedDepartment {
  readonly id: string
  readonly name: string
  readonly head: {
    readonly id: string
    readonly fullName: string
    readonly isActive: boolean
    /** The unit the portal FILED them in — not necessarily one they head. */
    readonly homeDepartmentName: string | null
    readonly account: DepartmentHeadAccount | null
  } | null
}

/** The login already linked to a head, when there is one. */
export interface DepartmentHeadAccount {
  readonly id: string
  readonly username: string | null
  readonly isActive: boolean
  readonly dataScope: DataScopeValue
  readonly sections: readonly SectionValue[]
}

/**
 * One unit a person heads.
 *
 * `descendants` is on the row because heading a branch is not the same offer as
 * heading a team: the scope descends from headship, so «Тошкент онлайн» hands
 * over nine teams while «Lola(ROP)» hands over one. An administrator choosing
 * between those two names deserves to see the difference before they choose.
 */
export interface DepartmentHeadUnit {
  readonly id: string
  readonly name: string
  /** The portal's «…(ROP)» convention: this unit is a sales team. */
  readonly isSalesTeam: boolean
  /** Units beneath this one, to any depth. Zero for a leaf team. */
  readonly descendants: number
  /**
   * The TOP of the tree, which makes this grant the whole company.
   *
   * Not a footnote. Headship descends to any depth, so «Faqat oʻz boʻlimi»
   * given to whoever runs the root resolves to every employee on the portal —
   * the same reach as «Butun kompaniya» under a label that says the opposite.
   * On this portal that is one real person, and an administrator handing them
   * a «ROP» account would be handing over the firm believing they handed over
   * a team. Said on the row, in words, before the choice is made.
   */
  readonly isRoot: boolean
}

/** A person who heads at least one unit. Never carries an empty `heads`. */
export interface DepartmentHead {
  readonly employeeId: string
  readonly fullName: string
  /** The employee record, not the account. A head who left is still a head. */
  readonly isActive: boolean
  readonly homeDepartmentName: string | null
  readonly heads: readonly DepartmentHeadUnit[]
  readonly account: DepartmentHeadAccount | null
}

/**
 * Everything beneath a unit, to any depth.
 *
 * Iterative and `seen`-guarded rather than recursive, for the same reason the
 * scope query uses `UNION` and not `UNION ALL`: `parentId` is a nullable
 * self-reference and nothing in the schema forbids a cycle, so a walk that
 * trusted the data would hang the administrator's screen instead of returning
 * a number.
 */
function descendantCounter(units: readonly DepartmentNode[]): (id: string) => number {
  const childrenOf = new Map<string, string[]>()
  for (const unit of units) {
    if (!unit.parentId) continue
    const siblings = childrenOf.get(unit.parentId)
    if (siblings) siblings.push(unit.id)
    else childrenOf.set(unit.parentId, [unit.id])
  }

  return (id) => {
    const seen = new Set<string>([id])
    const stack: string[] = [id]
    let count = 0

    while (stack.length > 0) {
      for (const child of childrenOf.get(stack.pop()!) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        stack.push(child)
        count += 1
      }
    }

    return count
  }
}

/**
 * The heads, one row each, in the order an administrator wants them.
 *
 * ONE ROW PER PERSON, NOT PER UNIT. `Department.headId` gives each unit one
 * head, but nothing stops one person heading several — and somebody picking a
 * name wants one entry for that name carrying every unit it brings with it,
 * rather than the same person twice with two different scopes, neither of them
 * what they would actually get.
 *
 * SALES TEAMS FIRST, then everybody else, each block by name. The screen is
 * called ROP and the «(ROP)» heads are what the word means on this floor; the
 * branch and back-office heads are offerable — the client asked for them, and
 * headship descending is what makes a branch head a useful grant — but they
 * are not what the administrator came looking for.
 */
export function departmentHeads(
  units: readonly DepartmentNode[],
  headed: readonly HeadedDepartment[],
): DepartmentHead[] {
  const descendantsOf = descendantCounter(units)
  const roots = new Set(units.filter((unit) => unit.parentId === null).map((unit) => unit.id))
  const byEmployee = new Map<string, DepartmentHead & { heads: DepartmentHeadUnit[] }>()

  for (const unit of headed) {
    /*
      A unit whose head no longer resolves is skipped, not guessed at. `headId`
      is `SetNull` on delete, but a row read mid-resync can still name somebody
      who is not there yet — and a head row with no person on it would render
      as a nameless offer to scope an account to nothing.
    */
    const head = unit.head
    if (!head) continue

    let row = byEmployee.get(head.id)
    if (!row) {
      row = {
        employeeId: head.id,
        fullName: head.fullName,
        isActive: head.isActive,
        homeDepartmentName: head.homeDepartmentName,
        heads: [],
        account: head.account,
      }
      byEmployee.set(head.id, row)
    }

    row.heads.push({
      id: unit.id,
      name: unit.name,
      isSalesTeam: isSalesTeamName(unit.name),
      descendants: descendantsOf(unit.id),
      isRoot: roots.has(unit.id),
    })
  }

  return [...byEmployee.values()].sort((a, b) => {
    const aSales = a.heads.some((unit) => unit.isSalesTeam)
    const bSales = b.heads.some((unit) => unit.isSalesTeam)
    if (aSales !== bSales) return aSales ? -1 : 1
    /*
      'ru', matching `branches.ts` where the same names are already sorted.

      Not a stylistic choice: 'uz' collation puts the digraphs Sh and Ch at the
      END of the alphabet, which is correct Uzbek and would file «Charos(ROP)»
      below «Sevinch(ROP)» in a list an administrator scans by eye — while this
      portal's units and half its people are spelled in Cyrillic anyway. One
      collation for every roster on this dashboard beats two that disagree.
    */
    return a.fullName.localeCompare(b.fullName, 'ru')
  })
}

/**
 * The units nobody heads, named so the administrator is not left guessing.
 *
 * A department with no `UF_HEAD` cannot appear on the ROP list — there is
 * nobody to anchor an account to — and the portal really does have such units:
 * «Тошкент онлайн» carries nine sales teams and names no head at all. Without
 * this line the administrator searches a list of seventeen for a name that
 * cannot be there, concludes the screen is broken, and files a ticket against
 * the dashboard for a field that has to be filled in Bitrix24.
 */
export function headlessUnits(
  units: readonly DepartmentNode[],
  headed: readonly HeadedDepartment[],
): HeadlessUnit[] {
  const named = new Set(headed.filter((unit) => unit.head !== null).map((unit) => unit.id))
  return units
    .filter((unit) => !named.has(unit.id))
    .map((unit) => ({ id: unit.id, name: unit.name }))
}
