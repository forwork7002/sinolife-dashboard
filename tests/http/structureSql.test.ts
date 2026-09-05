import { describe, expect, it } from 'vitest'

/*
  Same preamble as the other SQL-shape tests: the repository reads `env` at
  module scope for APP_TIMEZONE and `env` refuses to load without a complete
  configuration, deliberately, so a misconfigured deployment fails at boot
  rather than at midnight. A test about SQL shape has no database and no
  secrets, so it supplies the four required names first and imports afterwards.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The org chart reproduces a screen the client already reads every day.
 *
 * Its figures are checked against `obey.bitrix24.kz/hr/structure/` by the
 * people whose floors they describe, so "close enough" is a support ticket.
 * Measured against the live portal on 2026-09-05, all twenty units agree:
 * NEWGEN 21 subordinates, Операцион 5, Регистрация 14, Sevinch(ROP) 13,
 * Тошкент онлайн 1, Kompaniya(ROP) 0.
 *
 * Two of those twenty are only right because of the two rules below, and both
 * rules are invisible in the output — a regression in either prints a
 * plausible number, not an error.
 */
const SQL = (InsightsRepository as unknown as { structureSql: () => string }).structureSql()

/*
  Negative assertions run against the SQL with its prose stripped. The builder
  carries a hundred lines of comment explaining why each figure is what it is,
  and those comments name the very columns the `not.toContain` checks forbid.
*/
const bare = SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

describe('structure SQL', () => {
  it('builds one statement with every CTE the tree needs', () => {
    const chain = [...SQL.matchAll(/(\w+) AS(?: MATERIALIZED)? \(/g)].map((m) => m[1])
    expect(chain).toEqual(['active', 'walk', 'members', 'subtree', 'kids', 'people', 'sales'])
  })

  it('binds both window parameters', () => {
    expect(SQL).toContain('$1')
    expect(SQL).toContain('$2')
  })

  /**
   * MEMBERSHIP, NOT THE PRIMARY UNIT.
   *
   * `employee."departmentId"` is the ONE unit a person's money is credited to.
   * Bitrix24's `UF_DEPARTMENT` is an array and its own org chart counts a
   * person once in every entry, so the card's «N xodim» has to read the join
   * table. Nine of the portal's 208 active people have two units; reading the
   * primary instead left five of the twenty cards short by one or two —
   * Тошкент онлайн 0 against 1, Asliddin(ROP) 8 against 10, Azizbek(ROP) 14
   * against 16, Saidaziz(ROP) 14 against 15, Sevinchxon(ROP) 8 against 10.
   */
  it('counts card members off department_member, not off the primary unit', () => {
    const membersCte = bare.slice(bare.indexOf('members AS ('), bare.indexOf('subtree AS ('))
    expect(membersCte).toContain('"department_member"')
    expect(membersCte).toContain('m."departmentId" AS dep_id')
    // …while the analytics CTE beside it still keys off the primary unit, or
    // a two-unit person's revenue would be counted into both branches.
    const peopleCte = bare.slice(bare.indexOf('people AS ('), bare.indexOf('sales AS ('))
    expect(peopleCte).toContain('e."departmentId"')
    expect(peopleCte).not.toContain('department_member')
  })

  /**
   * THE HEAD IS NOT ONE OF THEIR OWN SUBORDINATES.
   *
   * The portal prints «Подчинённые: 13 сотрудников» over a unit of fourteen
   * people, thirteen of whom report to the fourteenth. Dropping the
   * subtraction adds one to every single card on the screen.
   */
  it('takes the head out of the subordinate count, but only when they were counted in', () => {
    expect(bare).toContain('subordinate_count')

    /*
      The subtraction and the total must come from ONE pass under ONE filter.

      They did not: the total counted active members while the subtraction
      fired on membership alone, so a unit whose head Bitrix24 had deactivated
      printed one subordinate fewer than the portal and fewer than its own
      roster panel — five active people over «4 xodim».
    */
    const membersCte = bare.slice(bare.indexOf('members AS ('), bare.indexOf('subtree AS ('))
    expect(membersCte).toContain('AS head_counted')
    expect(membersCte).toMatch(/count\(\*\) FILTER \(WHERE e\."isActive" AND m\."employeeId" = d\."headId"\)/)
    expect(membersCte).toMatch(/count\(\*\) FILTER \(WHERE e\."isActive"\)/)

    const clause = bare.slice(
      bare.indexOf('AS subordinate_count') - 300,
      bare.indexOf('AS subordinate_count'),
    )
    expect(clause).toContain('m.head_counted')
    // GREATEST, so a unit whose only member IS the head reads 0 and never -1.
    expect(clause).toContain('GREATEST')
  })

  /**
   * A HEAD WHO DOES NOT SIT IN THE UNIT IS NOT SHOWN AS ITS HEAD.
   *
   * «Навоий» names UF_HEAD = Мурод Содиков, whose own two units are
   * «Kompaniya(ROP)» and «Тошкент онлайн». The portal draws that card with no
   * head row at all rather than seating him somewhere his own record does not.
   */
  it('reports whether the head is actually a member', () => {
    expect(bare).toContain('AS head_is_member')
    const clause = bare.slice(bare.indexOf('AS head_is_member') - 400, bare.indexOf('AS head_is_member'))
    expect(clause).toContain('EXISTS')
    expect(clause).toContain('hm."employeeId" = dep."headId"')
  })

  /**
   * THE SUBTREE PILL COUNTS PEOPLE, NOT MEMBERSHIPS.
   *
   * Somebody in both «Регистрация» and «Azizbek(ROP)» is ONE person under
   * NEWGEN. Without DISTINCT the root's pill counts them twice, and the number
   * beside the owner's name — 206 over this roster — quietly inflates.
   */
  it('counts the subtree distinctly and leaves out that unit\'s own head', () => {
    const subtree = bare.slice(bare.indexOf('subtree AS ('), bare.indexOf('kids AS ('))
    expect(subtree).toContain('count(DISTINCT m."employeeId")')
    expect(subtree).toContain('r."headId"')
  })

  /**
   * THE RECURSION HAS A CYCLE GUARD.
   *
   * `department."parentId"` is a nullable self-reference filled from a portal
   * over the wire. Nothing in the schema forbids a loop, and a loop in a
   * recursive CTE is not a wrong number — it is a statement that never returns
   * and a page that never loads, on the single vCPU that answers every other
   * screen too.
   */
  it('bounds the recursive walk', () => {
    expect(SQL).toContain('WITH RECURSIVE')
    expect(bare).toMatch(/w\.depth < \d+/)
  })

  /**
   * SIBLINGS SIT IN THE PORTAL'S ORDER, NOT ALPHABETICALLY.
   *
   * The row under «Тошкент онлайн» reads Asliddin, Azizbek, Saidaziz, Marjona,
   * Sevinchxon, NEW, Saida, Hayot, Charos — sort values 100 to 1900, which is
   * the order somebody arranged by hand in Bitrix24 and the order the floor
   * reads left to right. Alphabetical would reshuffle nine cards.
   */
  it('orders siblings by the portal\'s own sort value first', () => {
    expect(bare).toMatch(/ORDER BY dep\."sortOrder", dep\."name"/)
  })

  /**
   * The money half is unchanged and must stay that way.
   *
   * These two conditions are the leading columns of
   * deal_countsAsRevenue_status_closedAt_idx. Left in an aggregate FILTER they
   * are unbound at scan time: Postgres walked the whole index and heap-fetched
   * 28 449 rows to keep 3 890, and the query went from 992 ms to 3 527 ms.
   */
  it('keeps the revenue predicate in the WHERE, not in a FILTER', () => {
    const sales = bare.slice(bare.indexOf('sales AS ('))
    expect(sales).toMatch(/WHERE d\."countsAsRevenue" AND d\."status" = 'WON'/)
    expect(sales).not.toMatch(/FILTER \(WHERE d\."countsAsRevenue"/)
  })
})
