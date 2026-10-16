import { describe, expect, it } from 'vitest'

import { FORM_BRAND_PATTERNS, FORM_RENAMED, UNNAMED_FORM_BRANDS, currentFormName, foldFormName, formNameBrand } from '@/server/domain/leads/leadSources'
import {
  ORIGIN_LEAD_DAYS,
  SPACE_CLASS_SQL,
  dealFormTitleSql,
  foldedFormNameSql,
  formAliasCteSql,
  formBrandOfTitleSql,
  originFormBrandSql,
  renamedFormNameSql,
} from '@/server/repositories/leadFormSql'

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
    const alias = formAliasCteSql('$1', '$2')
    // Every titled deal one form's, or 95 % when every form sharing the short name is one brand.
    expect(alias).toContain('WHERE fan.place = 1 AND (fan.deals = fan.named OR (fan.one_brand AND fan.deals * 20 >= fan.named * 19))')
    expect(alias).toContain('min(fg.brand) OVER (PARTITION BY fg.sd) = max(fg.brand) OVER (PARTITION BY fg.sd) AS one_brand')
    // Its old and new names one form; the title printed one under its name today.
    expect(alias).toContain(`GROUP BY fdn.sd, fdn.form`)
    expect(alias).toContain(`${renamedFormNameSql('fdf.folded')} AS form`)
    expect(alias).toContain('COALESCE(min(fdn.title) FILTER (WHERE fdn.folded = fdn.form), min(fdn.title)) AS title')
    // Each step fenced, so the fold runs once a row.
    expect(alias.match(/OFFSET 0/g)).toHaveLength(2)
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
    expect(formNameBrand('Kamron КОЛЛАГЕН тест')).toBe('Collagen')
    expect(formNameBrand('Аббос янги таргетолог Зехтра')).toBe('Zextra')
    expect(formNameBrand('Zekstra forma')).toBe('Zextra')
    expect(formNameBrand('Umar kolagen')).toBe('Collagen')
    expect(formNameBrand('Колаген тест')).toBe('Collagen')
    expect(formNameBrand('Kamron 7 etap filtr forma')).toBeNull()
    expect(formNameBrand(null)).toBeNull()
  })

  it('reads a form by its name today, and a form that names no brand by its sales (2026-10-16)', () => {
    // Form 198 wore «collagen» for a week; its leads and its sale were Zextra sure.
    expect(formNameBrand('Sobirjon-collagen I.S | Short form new 14.09')).toBe('Zextra')
    expect(formNameBrand('Sobirjon-collagen\u00a0 I.S | Short form new 14.09 \n')).toBe('Zextra')
    expect(currentFormName('Sinolife (UMAR) 777')).toBe('Umar-collagen Sinolife (UMAR) 777')
    expect(formNameBrand('Kamron 6 etap filt forma 05.07')).toBe('Zextra')
    expect(formNameBrand('Sobirjon')).toBe('Zextra')
    expect(formNameBrand('I.S | Short form | 01.08.2026')).toBe('Collagen')
    // Only the whole name: a form that merely contains one keeps its own words.
    expect(formNameBrand('Sobirjon-collagen I.S | Short form | 14.09.2026')).toBe('Collagen')
    for (const [old, now] of FORM_RENAMED) {
      expect(foldFormName(old)).toBe(old)
      expect(foldFormName(now)).toBe(now)
      // A name today is never renamed again: one step reaches it.
      expect(FORM_RENAMED.has(now)).toBe(false)
      expect(formNameBrand(now)).not.toBeNull()
    }
    for (const [name] of UNNAMED_FORM_BRANDS) expect(foldFormName(name)).toBe(name)
  })

  it('reads the same names in SQL, quoted, before the patterns', () => {
    expect(foldedFormNameSql('x')).toBe(`NULLIF(btrim(regexp_replace(x, '${SPACE_CLASS_SQL}+', ' ', 'g')), '')`)
    expect(renamedFormNameSql('f')).toBe(
      'CASE f ' + [...FORM_RENAMED].map(([old, now]) => `WHEN '${old}' THEN '${now}'`).join(' ') + ' ELSE f END',
    )
    const sql = formBrandOfTitleSql('t')
    expect(sql).toContain(`WHEN fbn.name IN ('Sobirjon') THEN 'Zextra'`)
    expect(sql).toContain(`WHEN fbn.name IN ('I.S | Short form | 01.08.2026', 'Umar Sinolife (UMAR) TEST-1', 'Sinolife (UMAR) TEST-2') THEN 'Collagen'`)
    expect(sql.indexOf('fbn.name IN')).toBeLessThan(sql.indexOf('fbn.name ~*'))
    // The title is spliced once and each step fenced — a sale's title expression is long.
    expect(sql.split('substring(t from').length).toBe(2)
    expect(sql.match(/OFFSET 0/g)).toHaveLength(3)
  })

  it('folds in SQL exactly the characters JS `\\s` folds', () => {
    // `[[:space:]]` under a C locale is the ASCII six; the rest is spelled out.
    const sqlClass = new RegExp(`^${SPACE_CLASS_SQL.replace('[:space:]', ' \\t\\n\\v\\f\\r')}$`)
    const differ: string[] = []
    for (let code = 0; code <= 0xffff; code++) {
      const ch = String.fromCharCode(code)
      if (/\s/.test(ch) !== sqlClass.test(ch)) differ.push(code.toString(16))
    }
    expect(differ).toEqual([])
  })

  it('spells every Cyrillic letter with both cases — `~*` folds only Latin under a C locale', () => {
    for (const [, pattern] of FORM_BRAND_PATTERNS) {
      for (const word of pattern.split('|')) {
        if (/[а-яё]/i.test(word)) expect(word).toMatch(/^(\[[А-ЯЁ][а-яё]\])+$/)
      }
      // Spliced into SQL literals: nothing that could close or escape one.
      expect(pattern).not.toMatch(/['\\]/)
    }
    expect(Number.isInteger(ORIGIN_LEAD_DAYS)).toBe(true)
    const sql = formBrandOfTitleSql('t')
    expect(sql).toContain(`(SELECT substring(t from 'CRM-форм[аы]${SPACE_CLASS_SQL}*[«"“]([^»"”]+)') AS name OFFSET 0) fbt`)
    expect(sql).toContain(`WHEN fbn.name ~* 'zextra|zekstra|`)
    expect(sql.indexOf(`'Zextra'`)).toBeLessThan(sql.indexOf(`'Collagen'`))
  })

  it('finds a sale\'s origin lead as Roistat does — same contact, ≤ 30 days before, WON first', () => {
    const sql = originFormBrandSql('d')
    expect(sql).toContain('ofb_l."customerId" = d."customerId"')
    expect(sql).toContain(`ofb_l."createdAtSource" > d."createdAtSource" - interval '30 days'`)
    expect(sql).toContain(`ORDER BY (ofb_l."status" = 'WON') DESC, ofb_l."createdAtSource" DESC, ofb_l."id" DESC`)
    // A lead found decides, form or not; only a sale with no lead reads its own title.
    expect(sql).toMatch(/WHEN ofb_lead\."id" IS NOT NULL THEN[\s\S]*WHEN d\."title" LIKE '%CRM-форм%' THEN d\."title"/)
  })
})
