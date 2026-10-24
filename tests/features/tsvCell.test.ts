import { describe, expect, it } from 'vitest'

import { tsvCell } from '@/features/shared/tsv'

/**
 * The one rule every «Nusxa olish (Excel)» button pastes through
 * (`src/features/shared/tsv.ts`, 2026-10-24): a name from the CRM stays a
 * name in the spreadsheet, and stays in its own column.
 */
describe('tsvCell', () => {
  it('marks a cell a spreadsheet would run as a formula as text', () => {
    expect(tsvCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(tsvCell('+998 90 123')).toBe(`'+998 90 123`)
    expect(tsvCell('-1 Collagen')).toBe(`'-1 Collagen`)
    expect(tsvCell('@seller')).toBe(`'@seller`)
  })

  it('keeps a tab or a line break from shifting the columns after it', () => {
    expect(tsvCell('Toshkent\tonlayn')).toBe('Toshkent onlayn')
    expect(tsvCell('bir\r\nikki\n\nuch')).toBe('bir ikki uch')
    // Flattened first, then checked: the break becomes a leading space, which
    // a spreadsheet does not read as a formula.
    expect(tsvCell('\n=1+1')).toBe(' =1+1')
  })

  it('leaves an ordinary name alone', () => {
    expect(tsvCell('Azizbek(ROP)')).toBe('Azizbek(ROP)')
    expect(tsvCell('')).toBe('')
  })
})
