import { describe, expect, it } from 'vitest'

import { isCopiedOperatorSnapshot, isSalesTeamName } from '@/server/domain/employees/operatorSnapshot'

/**
 * A repeat deal arrives with the older deal's seller snapshot copied in.
 * The cases are production deals, read off the portal on 2026-10-19.
 */
describe('a copied seller snapshot', () => {
  it('is caught when the seller opened and holds the order herself (deal 1150184)', () => {
    // Snapshot «Davlatbek Sirojov 115 / Sevinch(ROP)» from the 27.08 deal;
    // opened and owned by Ziyoda Ashirova 170, Baza(ROP).
    expect(
      isCopiedOperatorSnapshot({
        snapshotEmployeeId: 'davlatbek',
        ownerEmployeeId: 'ziyoda',
        creatorEmployeeId: 'ziyoda',
        ownerOnSalesTeam: true,
      }),
    ).toBe(true)
  })

  it('is believed when back office owns the row (the 556-order reason the snapshot exists)', () => {
    expect(
      isCopiedOperatorSnapshot({
        snapshotEmployeeId: 'seller',
        ownerEmployeeId: 'operations',
        creatorEmployeeId: 'operations',
        ownerOnSalesTeam: false,
      }),
    ).toBe(false)
  })

  it('is believed when a registrar opened it and a Baza operator took it over later (16.07 hand-over)', () => {
    expect(
      isCopiedOperatorSnapshot({
        snapshotEmployeeId: 'davlatbek',
        ownerEmployeeId: 'farrux',
        creatorEmployeeId: 'registrar',
        ownerOnSalesTeam: true,
      }),
    ).toBe(false)
  })

  it('is believed when it names the owner, or names nobody we know', () => {
    const base = { ownerEmployeeId: 'ziyoda', creatorEmployeeId: 'ziyoda', ownerOnSalesTeam: true }
    expect(isCopiedOperatorSnapshot({ ...base, snapshotEmployeeId: 'ziyoda' })).toBe(false)
    expect(isCopiedOperatorSnapshot({ ...base, snapshotEmployeeId: null })).toBe(false)
  })

  it('is believed when the creator is unknown', () => {
    expect(
      isCopiedOperatorSnapshot({
        snapshotEmployeeId: 'davlatbek',
        ownerEmployeeId: 'ziyoda',
        creatorEmployeeId: null,
        ownerOnSalesTeam: true,
      }),
    ).toBe(false)
  })
})

describe('a sales team', () => {
  it('is a unit whose name carries (ROP), in any case', () => {
    expect(isSalesTeamName('Baza(ROP)')).toBe(true)
    expect(isSalesTeamName('Charos(rop)')).toBe(true)
    expect(isSalesTeamName('Логистика')).toBe(false)
    expect(isSalesTeamName('Регистрация')).toBe(false)
    expect(isSalesTeamName(null)).toBe(false)
  })
})
