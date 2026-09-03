import { describe, expect, it } from 'vitest'

import { historyLeftAtSql } from '@/server/integrations/crm/sync/handlers'

/**
 * THE MOST EXPENSIVE STATEMENT ON THE DATABASE, BY A FACTOR OF FOUR.
 *
 * Closing each stage transition with the start of the next one used to run a
 * window function over all 222 600 history rows, every minute, to update about
 * two dozen of them: 21.6% of all execution time on production, 7 472 calls at
 * a mean of 1 745 ms and a worst case of 67 seconds, for a lifetime total of
 * 178 379 changed rows. It ran on the same single vCPU that answers every page
 * the dashboard serves, which is most of what "the dashboard is slow" was.
 *
 * `leftAt` on a row is decided by the next row OF THE SAME DEAL, so a deal
 * whose history did not change cannot have a new answer. Scoping to the deals
 * the run wrote is therefore exact, not approximate.
 */
describe('closing stage transitions', () => {
  const scoped = historyLeftAtSql(true)
  const whole = historyLeftAtSql(false)

  it('restricts the window to the deals the run touched', () => {
    expect(scoped).toContain('WHERE "dealId" = ANY($1::text[])')
    // The partition has to stay per deal, or a restricted window would take
    // its neighbour from another order entirely.
    expect(scoped).toContain('PARTITION BY "dealId" ORDER BY "enteredAt", "id"')
  })

  it('keeps the whole-table form for a full import, which touches everything', () => {
    expect(whole).not.toContain('dealId" = ANY')
    expect(whole).not.toContain('$1')
  })

  it('changes only which rows are considered, never how leftAt is decided', () => {
    /*
      The two forms must differ by the WHERE clause and nothing else. A
      difference in the window, the join or the guard would make a tick's
      answer disagree with a full import's for the same order — the kind of
      fault that shows up months later as a duration nobody can reproduce.
    */
    const strip = (sql: string) =>
      sql.replace('WHERE "dealId" = ANY($1::text[])', '').replace(/\s+/g, ' ').trim()
    expect(strip(scoped)).toBe(strip(whole))
  })

  it('still writes only the rows whose value actually moves', () => {
    // Without this guard the statement rewrites every row it looks at, which
    // on a 222 600-row table is a full rewrite once a minute.
    for (const sql of [scoped, whole]) {
      expect(sql).toContain('h."leftAt" IS DISTINCT FROM next."enteredAt"')
    }
  })
})
