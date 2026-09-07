import { describe, expect, it } from 'vitest'

import {
  type DepartmentNode,
  type HeadedDepartment,
  departmentHeads,
  headlessUnits,
} from '@/server/domain/employees/departmentHeads'

/**
 * THE ROP TAB'S LIST, AND THE THREE THINGS IT GETS WRONG WHEN NOBODY LOOKS.
 *
 * An administrator picks a person here and that one click decides how much of
 * the company an account reads. What the row says about that person therefore
 * has to be true — and each of the failures below reads as a perfectly
 * ordinary list, which is why they are pinned rather than reviewed.
 */

const TREE: readonly DepartmentNode[] = [
  { id: 'root', name: 'NEWGEN', parentId: null },
  { id: 'branch', name: 'Тошкент онлайн', parentId: 'root' },
  { id: 'team-a', name: 'Charos(ROP)', parentId: 'branch' },
  { id: 'team-b', name: 'Sevinch(ROP)', parentId: 'branch' },
  { id: 'squad', name: 'Baza(ROP)', parentId: 'team-a' },
  { id: 'ops', name: 'Operatsion', parentId: 'root' },
]

function unit(id: string, name: string, headId: string | null, headName = 'Head'): HeadedDepartment {
  return {
    id,
    name,
    head:
      headId === null
        ? null
        : {
            id: headId,
            fullName: headName,
            isActive: true,
            homeDepartmentName: null,
            account: null,
          },
  }
}

describe('the heads a TEAM account can be anchored to', () => {
  /*
    ONE PERSON, ONE ROW.

    `Department.headId` is one head per unit, but nothing stops one person
    running two — and listed twice, the same name would appear with two
    different scopes, neither of which is what an account anchored to them
    would actually get (the scope is the UNION of both). The administrator
    would then pick whichever row they happened to read first.
  */
  it('gives a person who heads two units one row carrying both', () => {
    const rows = departmentHeads(TREE, [
      unit('team-a', 'Lola(ROP)', 'emp-1', 'Lola'),
      unit('team-b', 'Azizbek(ROP)', 'emp-1', 'Lola'),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].heads.map((u) => u.name)).toEqual(['Lola(ROP)', 'Azizbek(ROP)'])
  })

  /*
    THE DESCENDANT COUNT IS THE DIFFERENCE BETWEEN A TEAM AND A FLOOR.

    Heading a branch grants every unit beneath it, to any depth — the scope
    query descends from headship. A list that showed «Тошкент онлайн» and
    «Lola(ROP)» as two names of equal weight would let an administrator hand
    over nine teams believing they handed over one.
  */
  it('counts every unit beneath a headed one, to any depth', () => {
    const rows = departmentHeads(TREE, [
      unit('branch', 'Toshkent onlayn', 'emp-2'),
      unit('team-b', 'Azizbek(ROP)', 'emp-3'),
    ])

    const byUnit = new Map(rows.flatMap((r) => r.heads.map((u) => [u.name, u.descendants])))
    // branch → team-a, team-b, squad
    expect(byUnit.get('Toshkent onlayn')).toBe(3)
    expect(byUnit.get('Azizbek(ROP)')).toBe(0)
  })

  /*
    A CYCLE MUST RETURN A NUMBER, NOT HANG THE SCREEN.

    `parentId` is a nullable self-reference and the schema does not forbid a
    loop; the scope query guards the same data with `UNION` rather than
    `UNION ALL` for exactly this reason. An unguarded walk here would spin
    inside the administrator's browser with nothing on screen to say why.
  */
  it('terminates on a parent cycle', () => {
    const looped: DepartmentNode[] = [
      { id: 'a', name: 'A(ROP)', parentId: 'b' },
      { id: 'b', name: 'B(ROP)', parentId: 'a' },
    ]

    expect(departmentHeads(looped, [unit('a', 'A(ROP)', 'emp-4')])[0].heads[0].descendants).toBe(1)
  })

  /*
    SALES TEAMS FIRST — the word on the tab is ROP.

    Every department head is offerable, which is what the client asked for, but
    fifteen «(ROP)» names are what somebody opening this tab came to find and
    they must not be interleaved alphabetically with Регистрация and Операцион.
  */
  it('sorts the sales teams above every other head, then by name', () => {
    const rows = departmentHeads(TREE, [
      unit('ops', 'Operatsion', 'emp-a', 'Anvar'),
      unit('team-b', 'Sevinch(ROP)', 'emp-b', 'Sevinch'),
      unit('root', 'NEWGEN', 'emp-c', 'Bobur'),
      unit('team-a', 'Charos(ROP)', 'emp-d', 'Charos'),
    ])

    expect(rows.map((r) => r.fullName)).toEqual(['Charos', 'Sevinch', 'Anvar', 'Bobur'])
  })

  /*
    A UNIT WHOSE HEAD DOES NOT RESOLVE IS DROPPED, NOT GUESSED AT.

    `headId` is `SetNull` on delete, but a row read mid-resync can still name
    somebody who has not arrived. A nameless row here is an offer to scope an
    account to nobody, which the server would then refuse after the
    administrator had typed a password.
  */
  it('drops a unit whose head no longer resolves', () => {
    expect(departmentHeads(TREE, [unit('team-a', 'Lola(ROP)', null)])).toEqual([])
  })
})

describe('what the list says before the account exists', () => {
  /*
    HEADING THE ROOT IS «BUTUN KOMPANIYA» WEARING ANOTHER LABEL.

    Headship descends to any depth, so a TEAM scope over the top of the tree
    resolves to every employee on the portal. On this portal that is one real
    person — the head of NEWGEN — and an administrator giving them a «ROP»
    account would be handing over the firm believing they handed over a team.
    The flag is what lets the screen say so while it is still a choice.
  */
  it('marks a headed unit that is the top of the tree', () => {
    const rows = departmentHeads(TREE, [
      unit('root', 'NEWGEN', 'emp-boss'),
      unit('team-a', 'Charos(ROP)', 'emp-rop'),
    ])

    const byName = new Map(rows.flatMap((r) => r.heads.map((u) => [u.name, u.isRoot])))
    expect(byName.get('NEWGEN')).toBe(true)
    expect(byName.get('Charos(ROP)')).toBe(false)
  })

  /*
    A UNIT NOBODY HEADS HAS TO BE NAMED, NOT JUST ABSENT.

    «Тошкент онлайн» carries nine sales teams on this portal and names no head
    at all, so it cannot appear on a list of people. Left silent, the
    administrator searches for it, does not find it, and reports the screen —
    when the field to fill is `UF_HEAD` in Bitrix24.
  */
  it('names the units that have no head', () => {
    const named = headlessUnits(TREE, [unit('team-a', 'Charos(ROP)', 'emp-rop')])
    expect(named.map((u) => u.name)).toEqual([
      'NEWGEN',
      'Тошкент онлайн',
      'Sevinch(ROP)',
      'Baza(ROP)',
      'Operatsion',
    ])
  })

  /*
    A HEAD ROW WITH NOBODY BEHIND IT COUNTS AS HEADLESS.

    The unit names a `headId` the employee table cannot resolve, so no account
    can be anchored to it — which is the same practical answer as naming no
    head, and the administrator needs to read it in the same place.
  */
  it('counts a unit whose head does not resolve as headless', () => {
    expect(headlessUnits(TREE, [unit('team-a', 'Charos(ROP)', null)]).map((u) => u.id)).toContain(
      'team-a',
    )
  })
})
