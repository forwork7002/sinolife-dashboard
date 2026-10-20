import { describe, expect, it } from 'vitest'

import { payrollBranchOf } from '@/server/domain/payroll/payrollBranches'

/**
 * The portal's tree on 2026-10-20 (department.get, read-only MCP): «Коллаген
 * отдел продаж» → «Навоий» (Saidaziz, Maftuna, Sevinch, Gulzora, Lola, Baza,
 * Kompaniya) and «Тошкент» (Mubina, Hayot, Marjona, Shohjaxon, Azizbek);
 * «Зехтра отдел продаж» → «Malika(ROP)» → Afruzaxon, Sadriddin, Asliddin.
 */
const COLLAGEN = 'Коллаген отдел продаж'
const ZEXTRA = 'Зехтра отдел продаж'
const ANCESTORS = new Map<string, string[]>([
  ['Saidaziz', ['Навоий', COLLAGEN, 'NEWGEN ']],
  ['Baza', ['Навоий', COLLAGEN, 'NEWGEN ']],
  ['Kompaniya', ['Навоий', COLLAGEN, 'NEWGEN ']],
  ['Marjona', ['Тошкент', COLLAGEN, 'NEWGEN ']],
  ['Hayot', ['Тошкент', COLLAGEN, 'NEWGEN ']],
  ['Malika', [ZEXTRA, 'NEWGEN ']],
  ['Asliddin', ['Malika(ROP)', ZEXTRA, 'NEWGEN ']],
  ['Sadriddin', ['Malika(ROP)', ZEXTRA, 'NEWGEN ']],
])

describe('payrollBranchOf', () => {
  it('files a team under the nearest unit that names a branch', () => {
    expect(payrollBranchOf('Saidaziz', ANCESTORS)).toBe('navoiy')
    expect(payrollBranchOf('Kompaniya', ANCESTORS)).toBe('navoiy')
    expect(payrollBranchOf('Marjona', ANCESTORS)).toBe('toshkent')
    expect(payrollBranchOf('Hayot', ANCESTORS)).toBe('toshkent')
    expect(payrollBranchOf('Asliddin', ANCESTORS)).toBe('zextra')
  })

  it('puts both БАЗА teams in Baza, whatever unit the portal files them under', () => {
    // «Baza(ROP)» sits under «Навоий», «Malika(ROP)» under «Зехтра отдел продаж».
    expect(payrollBranchOf('Baza', ANCESTORS)).toBe('baza')
    expect(payrollBranchOf('Malika', ANCESTORS)).toBe('baza')
    // Her deals' old label, folded by `TEAM_ALIASES`.
    expect(payrollBranchOf('Charos', ANCESTORS)).toBe('baza')
  })

  it('reads an old label through its alias', () => {
    // «Sevinchxon» is today's Sadriddin (`TEAM_ALIASES`).
    expect(payrollBranchOf('Sevinchxon', ANCESTORS)).toBe('zextra')
  })

  it('prints what it cannot place under «Boshqa», never drops it', () => {
    expect(payrollBranchOf(null, ANCESTORS)).toBe('other')
    expect(payrollBranchOf('Husniddin', ANCESTORS)).toBe('other')
    expect(payrollBranchOf('Saidaziz', new Map())).toBe('other')
  })
})
