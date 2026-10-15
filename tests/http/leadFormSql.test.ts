import { describe, expect, it } from 'vitest'

import { FORM_BRAND_PATTERNS, formNameBrand } from '@/server/domain/leads/leadSources'
import { dealFormTitleSql, formAliasCteSql, formBrandOfTitleSql, originFormBrandSql } from '@/server/repositories/leadFormSql'

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
    expect(formAliasCteSql('$1', '$2')).toContain(`ad."createdAtSource" >= $1 AND ad."createdAtSource" < $2`)
  })
})

/*
  The client's rule of 2026-10-15: the CRM form's NAME says the brand, for a
  lead and for the sale its lead became — one pattern list for JS and SQL.
*/
describe('the form\'s brand', () => {
  it('reads «zextra» first, then the collagen in Latin or Cyrillic, and nothing else', () => {
    expect(formNameBrand('Umar-collagen Collagen (UMAR)')).toBe('Collagen')
    expect(formNameBrand('Sobirjon-zextra I.S | Long form new 14.09')).toBe('Zextra')
    expect(formNameBrand('Kamron Коллаген тест')).toBe('Collagen')
    expect(formNameBrand('Kamron 6 etap filt forma 05.07')).toBeNull()
    expect(formNameBrand(null)).toBeNull()
  })

  it('spells Cyrillic with both cases — `~*` folds only Latin under a C locale', () => {
    for (const [, pattern] of FORM_BRAND_PATTERNS) {
      for (const word of pattern.split('|')) if (/[а-яё]/i.test(word)) expect(word).toMatch(/^\[[А-ЯЁ][а-яё]\]/)
    }
    const sql = formBrandOfTitleSql('t')
    expect(sql).toContain(`WHEN substring(t from 'CRM-форм[аы][[:space:]]*[«"“]([^»"”]+)') ~* 'zextra' THEN 'Zextra'`)
    expect(sql.indexOf(`'Zextra'`)).toBeLessThan(sql.indexOf(`'Collagen'`))
  })

  it('finds a sale\'s origin lead as Roistat does — same contact, ≤ 30 days before, WON first', () => {
    const sql = originFormBrandSql('d')
    expect(sql).toContain('l."customerId" = d."customerId"')
    expect(sql).toContain(`l."createdAtSource" > d."createdAtSource" - interval '30 days'`)
    expect(sql).toContain(`ORDER BY (l."status" = 'WON') DESC, l."createdAtSource" DESC`)
    // A lead found decides, form or not; only a sale with no lead reads its own title.
    expect(sql).toMatch(/WHEN ol\."id" IS NOT NULL THEN[\s\S]*WHEN d\."title" LIKE '%CRM-форм%' THEN d\."title"/)
  })
})
