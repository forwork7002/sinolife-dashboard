/**
 * Who a TEAM-scoped account is allowed to read.
 *
 * ONE QUESTION, ONE STATEMENT: given the employee a login is linked to, which
 * employees' rows may that login see? Everything else in the authorisation
 * path is pure and unit tested; this is the one part that has to ask the
 * database, so it is isolated here and answers nothing else.
 *
 * THE RULE, AND WHY EACH HALF OF IT IS THERE
 *
 *   ANCHOR — the units this person is attached to. Two sources, unioned:
 *     their own `employee."departmentId"`, and every department whose
 *     `headId` is them. The second is not redundant. «Навоий» names a head
 *     whose own units are «Kompaniya(ROP)» and «Тошкент онлайн» — the portal
 *     draws that card with no head row because his record does not sit in the
 *     unit he runs. Anchoring on membership alone would hand that man his own
 *     branch and not the one he heads.
 *
 *   SUBTREE — every department beneath the anchors, to any depth. A ROP
 *     anchors on one team and sees one team; the head of NEWGEN anchors on the
 *     root of a branch and sees the nine teams under it. That is what the org
 *     chart already draws, and a scope that stopped at the first level would
 *     mean a department head could not read the departments they are
 *     accountable for. `UNION` rather than `UNION ALL` so a parentId cycle —
 *     which the schema does not forbid — terminates instead of hanging.
 *
 *   MEMBERS — everyone whose PRIMARY `departmentId` falls in that subtree.
 *
 * PRIMARY MEMBERSHIP, NOT `department_member`, AND THAT IS THE LOAD-BEARING
 * CHOICE. Bitrix24's `UF_DEPARTMENT` is an array and nine of this portal's
 * active people sit in two units, so `department_member` lists them twice on
 * purpose — it exists for the org chart, which counts a person in every unit
 * that names them. This is a MONEY question, not a headcount one: every
 * analytic on this dashboard credits a person to exactly one unit, and reading
 * memberships here would put one operator's orders on two ROPs' boards, each
 * of them reading it as their own team's work. Narrower than the org chart is
 * the correct direction to be wrong in: a borrowed operator's rows staying
 * with the unit that is credited for them is a gap, and the other reading is a
 * leak.
 *
 * INACTIVE PEOPLE ARE INCLUDED. Their deals did not stop being the team's when
 * they left, and a board that dropped them would show a month with a hole in
 * it that no filter on screen explains.
 */

import type { PrismaClient } from '@/generated/prisma/client'

export class ScopeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Every employee id in this person's unit and everything under it.
   *
   * Includes the person themself whenever their own department is anchored;
   * `rowScopeFor` adds them unconditionally afterwards, so a person filed
   * nowhere still reads their own rows rather than none.
   *
   * Returns a possibly EMPTY array. Emptiness is meaningful here — it says the
   * tree knows nothing about this person — and the caller is the one that
   * turns it into a non-empty, fail-closed scope. A repository that invented a
   * sentinel would be deciding policy.
   */
  async teamEmployeeIds(employeeId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `
      WITH RECURSIVE anchor AS (
        SELECT e."departmentId" AS id
          FROM "employee" e
         WHERE e."id" = $1
           AND e."departmentId" IS NOT NULL
        UNION
        SELECT d."id"
          FROM "department" d
         WHERE d."headId" = $1
      ),
      subtree AS (
        SELECT id FROM anchor
        UNION
        SELECT child."id"
          FROM "department" child
          JOIN subtree s ON child."parentId" = s.id
      )
      SELECT e."id" AS id
        FROM "employee" e
       WHERE e."departmentId" IN (SELECT id FROM subtree)
      `,
      employeeId,
    )

    return rows.map((r) => r.id)
  }
}
