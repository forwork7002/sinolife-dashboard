import { describe, expect, it } from 'vitest'

/*
  Same preamble as the other server-side tests: `env` refuses to load without a
  complete configuration, deliberately, so a misconfigured deployment fails at
  boot rather than at midnight.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsService } = await import('@/server/services/insightsService')

/**
 * THE ORG CHART IS THE ONE COMPANY-WIDE SCREEN A SALESPERSON MAY OPEN.
 *
 * Every other company-wide reading on this dashboard refuses an OWN-scoped
 * account at the permission gate, because there is no honest answer to give
 * one: the company's figures would leak and a blank page would lie. This screen
 * has no figures to leak — money on this dashboard is stated on Boshqaruv
 * markazi and nowhere else — so it is served whole, to everybody holding the
 * section, which is what the client asked the page to be wired to the floor for.
 *
 * This file replaces `structureMoneyGate.test.ts`, which pinned the withholding
 * that gate used to do. What it kept are the two things that survive: the
 * headcounts roll up from the repository's own integers, and the «SIZ» badge
 * lands only where the reader actually sits.
 */

/** Two units, one nested — the smallest tree that rolls up. */
const NODES = [
  {
    id: 'root',
    name: 'NEWGEN',
    parentId: null,
    headId: 'e1',
    headName: 'Rahbar',
    headPosition: null,
    headIsMember: true,
    headcount: 3,
    activeHeadcount: 3,
    memberCount: 3,
    memberNames: ['Rahbar'],
    subordinateCount: 2,
    headManagesCount: 4,
    childCount: 1,
    sortOrder: 100,
  },
  {
    id: 'child',
    name: 'Sevinch(ROP)',
    parentId: 'root',
    headId: null,
    headName: null,
    headPosition: null,
    headIsMember: false,
    headcount: 2,
    activeHeadcount: 2,
    memberCount: 2,
    memberNames: ['A', 'B'],
    subordinateCount: 2,
    headManagesCount: 2,
    childCount: 0,
    sortOrder: 100,
  },
]

const ROSTER = [
  {
    id: 'e1',
    fullName: 'Rahbar',
    position: null,
    isActive: true,
    isPrimary: true,
    isHead: true,
  },
]

function service() {
  return new InsightsService({
    structure: async () => NODES,
    departmentRoster: async () => ROSTER,
    departmentsOfEmployee: async () => ['child'],
  } as never)
}

function flatten(nodes: readonly { children: readonly unknown[] }[]): unknown[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children as never)])
}

describe('the org chart', () => {
  /**
   * NEITHER CALL TAKES A PERIOD, AND THAT IS THE POINT.
   *
   * TypeScript already refuses the old four-argument form, but the argument is
   * about meaning rather than arity: who reports to whom is a fact about today,
   * `/structure` carries no window control, and a dated question here would key
   * one unchanging answer under a dozen windows. If somebody re-adds a `Period`
   * parameter, this file stops compiling before the screen starts lying.
   */
  it('answers with no reporting window at all', async () => {
    const tree = await service().structure()
    const roster = await service().departmentRoster('child')

    expect(tree).toHaveLength(1)
    expect(roster).toHaveLength(1)
  })

  it('serves the whole structure to every reader', async () => {
    const flat = (await service().structure()) as unknown as {
      name: string
      subordinateCount: number
    }[]
    const all = flatten(await service().structure()) as {
      name: string
      subordinateCount: number
    }[]

    expect(flat).toHaveLength(1)
    expect(all.map((n) => n.name)).toEqual(['NEWGEN', 'Sevinch(ROP)'])
    // The counts are the point of the screen and are not confidential.
    expect(all.map((n) => n.subordinateCount)).toEqual([2, 2])
  })

  /**
   * THE ROLLUP MUST NOT TRAVEL THROUGH THE DTO.
   *
   * `headcount` and `activeHeadcount` are the unit plus everything beneath it,
   * summed from the repository's own integers. Read back off each child DTO
   * instead, the sum would be of whatever the DTO happened to print — which is
   * how the withheld-money version of this used to add up nulls. 3 + 2 people,
   * and the child still states its own 2.
   */
  it('rolls the children up from the repository integers, not from the DTO', async () => {
    const tree = await service().structure()
    const root = tree[0]!

    expect(root.headcount).toBe(5)
    expect(root.activeHeadcount).toBe(5)
    // «Oʻzida» stays the unit's own, or a branch would claim its children's
    // people as directly attached to it.
    expect(root.ownHeadcount).toBe(3)
    expect(root.children[0]!.headcount).toBe(2)
  })

  it('badges only the units the reader actually sits in', async () => {
    const tree = await service().structure({}, { viewerEmployeeId: 'e9' })
    const flat = flatten(tree) as { id: string; isViewerDepartment: boolean }[]
    expect(flat.filter((n) => n.isViewerDepartment).map((n) => n.id)).toEqual(['child'])
  })

  it('badges nothing when the account is not linked to an employee', async () => {
    const tree = await service().structure({}, { viewerEmployeeId: null })
    const flat = flatten(tree) as { isViewerDepartment: boolean }[]
    expect(flat.some((n) => n.isViewerDepartment)).toBe(false)
  })
})
