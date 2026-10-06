import { describe, expect, it } from 'vitest'

import { dealFormTitleSql, formAliasCteSql } from '@/server/repositories/leadFormSql'

/*
  The one SQL home of a lead's CRM form — «Roistat», «Lidlar» and «RNP
  jadvali» read it alike, so a repeat lead cannot be a form lead on one
  screen and brandless on another.
*/
describe('leadFormSql', () => {
  const sql = dealFormTitleSql('d', 's', 'fa')

  it('reads the title first, then the description in its three spellings', () => {
    const at = (needle: string) => sql.indexOf(needle)
    expect(at(`WHEN d."title" LIKE '%CRM-форм%' THEN d."title"`)).toBeGreaterThan(-1)
    expect(at(`WHEN d."metadata"->'utm'->>'SOURCE_DESCRIPTION' LIKE '%CRM-форм%'`)).toBeGreaterThan(at('WHEN d."title"'))
    expect(at(`'CRM-формы «AI targetolog · '`)).toBeGreaterThan(at(`LIKE '%CRM-форм%' THEN d."metadata"`))
    expect(at(`WHEN s."externalId" = 'REPEAT_SALE' THEN fa.title`)).toBeGreaterThan(at('AI targetolog'))
  })

  it('lends a short name to a «Ген лид» deal only, and only a name that is one form', () => {
    expect(sql).not.toMatch(/ELSE fa\.title/)
    expect(formAliasCteSql('$1', '$2')).toMatch(/HAVING count\(DISTINCT btrim\(translate\(/)
    expect(formAliasCteSql('$1', '$2')).toContain(`fd."createdAtSource" >= $1 AND fd."createdAtSource" < $2`)
  })
})
