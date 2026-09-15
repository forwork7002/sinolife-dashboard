import { describe, expect, it } from 'vitest'

import {
  RETENTION_GROUPS,
  RETENTION_GROUP_ORDER,
  UNMAPPED_RETENTION_GROUP,
  retentionGroupOf,
  retentionGroupSpec,
} from '@/lib/retentionGroups'

/**
 * The four groups have to PARTITION База — and to prove they still do.
 *
 * `/analytics/cohort` draws them as four bars and states a base under them,
 * which is a claim about the whole funnel. A stage that stops being named here
 * does not error and does not disappear: it falls to `OTHER` and gets its own
 * row. The failure this file exists for is the quieter one — a stage id in two
 * groups, which double-counts customers into two bars, or a group whose key is
 * missing from the draw order, which drops a bar off the card.
 *
 * The stage list is the live C10 funnel as read from the portal's own
 * reference data on 2026-09-15. When Bitrix24 grows a stage, this test goes
 * amber on the LAST case rather than failing the others, which is the right
 * order: the partition is still sound, there is simply something new to file.
 */

/** The C10 «База» funnel, exactly as `deal_stage` holds it. */
const BAZA_STAGES = [
  ['C10:NEW', 'База · Успешно раздача'],
  ['C10:UC_79XRT6', 'База · Новый база'],
  ['C10:UC_W94F10', 'База · Актив'],
  ['C10:FINAL_INVOICE', 'База · 1 кун'],
  ['C10:UC_FEENT1', 'База · 3 кун'],
  ['C10:UC_1TH09B', 'База · 10 кун'],
  ['C10:UC_8VIZ08', 'База · 20 кун'],
  ['C10:UC_4OTGKV', 'База · 30 кун'],
  ['C10:UC_S5YE1H', 'База · Недозвоны'],
  ['C10:PREPAYMENT_INVOIC', 'База · Активный клиент'],
  ['C10:UC_KYP1SE', 'База · Перерыв успешно'],
  ['C10:UC_SDQ5HF', 'База · Неактивные'],
  ['C10:UC_WWD9W7', 'База · Пропущенный'],
  ['C10:WON', 'База · Успешно'],
  ['C10:LOSE', 'База · Не активный клиент'],
] as const

describe('the retention groups partition База', () => {
  it('names no stage twice', () => {
    /*
      A stage in two groups puts the same customers into two bars, and the
      card's own caption already warns that the bars may overlap for a
      different and legitimate reason (one customer, two open deals) — so this
      kind of double count would hide inside an explanation of another one.
    */
    const all = RETENTION_GROUPS.flatMap((g) => g.stages)
    expect(new Set(all).size).toBe(all.length)
  })

  it('files every stage of the live funnel', () => {
    const unfiled = BAZA_STAGES.filter(([id]) => retentionGroupOf(id) === UNMAPPED_RETENTION_GROUP)
    expect(unfiled.map(([, name]) => name)).toEqual([])
  })

  it('puts the follow-up cadence in one group and nothing else in it', () => {
    // The card's copy promised «1 kun, 3 kun, 10 kun, 20 kun, 30 kun» over a
    // list of fifteen rows for months. These five ARE that promise now.
    const cadence = BAZA_STAGES.filter(([id]) => retentionGroupOf(id) === 'CADENCE')
    expect(cadence.map(([, name]) => name)).toEqual([
      'База · 1 кун',
      'База · 3 кун',
      'База · 10 кун',
      'База · 20 кун',
      'База · 30 кун',
    ])
  })

  it('sends an unknown stage to OTHER rather than into one of the four', () => {
    // The portal grows stages — «Ожидание / нд» appeared in C6 in September.
    expect(retentionGroupOf('C10:UC_SOMETHING_NEW')).toBe(UNMAPPED_RETENTION_GROUP)
    expect(retentionGroupOf(null)).toBe(UNMAPPED_RETENTION_GROUP)
    // …and it is still drawable, with a label saying what happened.
    expect(retentionGroupSpec(UNMAPPED_RETENTION_GROUP).label).toBe('Boshqa bosqichlar')
  })

  it('can draw every key it can produce', () => {
    /* A key the order does not carry sorts to the end silently; a key with no
       spec draws an unlabelled bar. Both are one edit away. */
    for (const group of RETENTION_GROUPS) {
      expect(RETENTION_GROUP_ORDER).toContain(group.key)
      expect(retentionGroupSpec(group.key).label).toBe(group.label)
      expect(retentionGroupSpec(group.key).colour).toMatch(/^--/)
    }
    expect(RETENTION_GROUP_ORDER).toContain(UNMAPPED_RETENTION_GROUP)
  })

  it('never paints a bar in the page accent', () => {
    /* `--series-7` is `/analytics/cohort`'s own accent. A mark that encodes a
       value must not wear page identity — the rule the stage ladder's
       sequential fill was corrected for before this replaced it. */
    for (const group of RETENTION_GROUPS) {
      expect(group.colour).not.toBe('--series-7')
    }
  })
})
