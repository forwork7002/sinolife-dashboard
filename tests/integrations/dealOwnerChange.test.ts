import { describe, expect, it } from 'vitest'

import { ownerChangesOf } from '@/server/integrations/crm/sync/handlers'

/*
  «Безквал» (2026-10-06): the portal returns no «Ответственный» history over
  REST, so the deals pass records each owner change it sees.
*/
describe('ownerChangesOf', () => {
  const employees = new Map([
    ['10', 'doniyor'],
    ['7010', 'azizbek'],
    ['7034', 'mohigul'],
  ])
  const before = [
    { id: 'd1', externalId: '1', employeeId: 'doniyor' },
    { id: 'd2', externalId: '2', employeeId: 'azizbek' },
    { id: 'd3', externalId: '3', employeeId: 'azizbek' },
  ]
  const at = new Date('2026-10-06T10:00:00Z')
  const now = new Date('2026-10-06T10:05:00Z')

  it('records a stored deal whose owner now resolves to someone else, at the portal\'s DATE_MODIFY', () => {
    const changes = ownerChangesOf(before, [{ externalId: '1', employeeExternalId: '7010', updatedAtSource: at }], employees, now)
    expect(changes).toEqual([{ dealId: 'd1', fromEmployeeId: 'doniyor', toEmployeeId: 'azizbek', changedAt: at }])
  })

  it('records nothing for an unchanged owner, a new deal or an owner it cannot resolve', () => {
    const changes = ownerChangesOf(
      before,
      [
        { externalId: '2', employeeExternalId: '7010', updatedAtSource: at },
        { externalId: '9', employeeExternalId: '7034', updatedAtSource: at },
        { externalId: '3', employeeExternalId: '999', updatedAtSource: at },
      ],
      employees,
      now,
    )
    expect(changes).toEqual([])
  })

  it('falls back to the read time when the portal sends no DATE_MODIFY', () => {
    const [change] = ownerChangesOf(before, [{ externalId: '3', employeeExternalId: '7034' }], employees, now)
    expect(change).toMatchObject({ dealId: 'd3', fromEmployeeId: 'azizbek', toEmployeeId: 'mohigul', changedAt: now })
  })
})
