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
const { resolvePeriod } = await import('@/server/domain/period/period')

/**
 * THE ORG CHART IS THE ONE COMPANY-WIDE SCREEN A SALESPERSON MAY OPEN.
 *
 * Every other company-wide reading on this dashboard refuses an OWN-scoped
 * account at the permission gate, because there is no honest answer to give
 * one: the company's figures would leak and a blank page would lie. This screen
 * takes the third option — it serves the STRUCTURE, which is not confidential
 * and is the whole reason the floor was to be given the page, and withholds the
 * money. The route decides with `can(principal, 'analytics:read:all')`; these
 * pin what the service does with the answer.
 *
 * A leak here is silent: the numbers simply appear, on a screen whose audience
 * is by design the widest in the product.
 */

const PERIOD = resolvePeriod('this_month', { timeZone: 'Asia/Tashkent' })

/** Two units, one nested, both with money — the smallest tree that rolls up. */
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
    workingHeadcount: 1,
    memberCount: 3,
    memberNames: ['Rahbar'],
    subordinateCount: 2,
    headManagesCount: 4,
    childCount: 1,
    sortOrder: 100,
    deals: 4,
    revenueMinor: 1_000_00n,
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
    workingHeadcount: 2,
    memberCount: 2,
    memberNames: ['A', 'B'],
    subordinateCount: 2,
    headManagesCount: 2,
    childCount: 0,
    sortOrder: 100,
    deals: 6,
    revenueMinor: 500_00n,
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
    deals: 4,
    revenueMinor: 1_000_00n,
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

describe('the org chart money gate', () => {
  it('sends every money field as null when the reader may not see money', async () => {
    const tree = await service().structure(PERIOD, 'UZS', {}, { withMoney: false })

    for (const node of flatten(tree) as { revenue: unknown; deals: unknown }[]) {
      expect(node.revenue).toBeNull()
      // Null, never 0 — a zero is a measurement and would be a false one here.
      expect(node.deals).toBeNull()
    }
  })

  it('still sends the whole structure to that reader', async () => {
    const tree = await service().structure(PERIOD, 'UZS', {}, { withMoney: false })
    const flat = flatten(tree) as { name: string; subordinateCount: number }[]

    expect(flat.map((n) => n.name)).toEqual(['NEWGEN', 'Sevinch(ROP)'])
    // The counts are the point of the screen and are not confidential.
    expect(flat.map((n) => n.subordinateCount)).toEqual([2, 2])
  })

  it('withholds the roster money too, and keeps the roster', async () => {
    const rows = await service().departmentRoster('child', PERIOD, 'UZS', { withMoney: false })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.revenue).toBeNull()
    expect(rows[0]!.deals).toBeNull()
    expect(rows[0]!.fullName).toBe('Rahbar')
  })

  /**
   * THE ROLLUP MUST NOT TRAVEL THROUGH THE DTO.
   *
   * It used to read `acc.deals + kid.deals` off each child DTO, which stopped
   * working the moment money became withholdable: the children's fields are
   * null for a gated reader, and summing nulls up the tree turns an
   * authorisation rule into a wrong number for the reader who IS allowed to
   * see it. 4 + 6 deals and 1 500 minor units, whatever the gate says.
   */
  it('rolls the children up from the repository integers, not from the DTO', async () => {
    const withMoney = await service().structure(PERIOD, 'UZS', {}, { withMoney: true })
    const root = withMoney[0]!

    expect(root.deals).toBe(10)
    expect(root.revenue?.amountMinor).toBe('150000')
    expect(root.children[0]!.deals).toBe(6)
  })

  it('badges only the units the reader actually sits in', async () => {
    const tree = await service().structure(PERIOD, 'UZS', {}, { viewerEmployeeId: 'e9' })
    const flat = flatten(tree) as { id: string; isViewerDepartment: boolean }[]
    expect(flat.filter((n) => n.isViewerDepartment).map((n) => n.id)).toEqual(['child'])
  })

  it('badges nothing when the account is not linked to an employee', async () => {
    const tree = await service().structure(PERIOD, 'UZS', {}, { viewerEmployeeId: null })
    const flat = flatten(tree) as { isViewerDepartment: boolean }[]
    expect(flat.some((n) => n.isViewerDepartment)).toBe(false)
  })
})
