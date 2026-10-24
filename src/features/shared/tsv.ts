/**
 * A text cell a spreadsheet will take as TEXT. Names come from Bitrix24 and
 * MoySklad, and a name that opens with = + - @ is run as a formula by Excel and
 * Sheets on paste; a tab or a line break inside one shifts every column after
 * it. A leading apostrophe is the spreadsheets' own «this is text» mark.
 *
 * ONE COPY FOR EVERY «Nusxa olish (Excel)» (2026-10-24). Sverka and the payroll
 * page each carried this function word for word, and a fix made to one would
 * not have reached the other's clipboard.
 */
export function tsvCell(value: string): string {
  const flat = value.replace(/[\t\r\n]+/g, ' ')
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat
}
