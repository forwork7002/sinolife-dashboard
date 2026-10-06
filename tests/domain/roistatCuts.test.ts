import { describe, expect, it } from 'vitest'

import {
  type BitrixCutRow,
  type SpendDay,
  ROISTAT_FORM_NO_OWNER,
  ROISTAT_NO_FORM,
  ROISTAT_NO_PRODUCT,
  ROISTAT_NO_TARGETOLOG,
  ROISTAT_NOT_FORM,
  ROISTAT_NOT_STATED,
  bitrixCut,
  bitrixTotal,
  columnsOf,
  daysBetween,
  mergeCuts,
  narrowBitrix,
  productOfLine,
  spendCut,
  spendTotal,
} from '@/server/domain/roistat/roistatCuts'
import type { TargetProduct } from '@/server/domain/types'

/*
  RNP's `leadBrand` lives in a service, which loads `env`; the cut only needs
  a brand reader handed in, so a two-line one stands in for it here.
*/
function leadBrand(_sourceId: string | null, formTitle: string | null): TargetProduct | null {
  if (!formTitle) return null
  return /zextra/i.test(formTitle) ? 'Zextra' : 'Collagen'
}

/** And the portal's source vocabulary, as `leadChannel` reads it: two of its sources stand in. */
const labelers = {
  brandOf: leadBrand,
  channelOf: (sourceId: string | null) => (sourceId === 'UC_1X1J24' ? 'page' : sourceId === 'UC_KPZA32' ? 'outbound' : 'other') as 'page' | 'outbound' | 'other',
}

function row(set: BitrixCutRow['set'], fields: Partial<BitrixCutRow>): BitrixCutRow {
  return {
    set,
    day: null,
    sourceId: null,
    sourceName: null,
    formTitle: null,
    targetolog: null,
    productLine: null,
    region: null,
    rop: null,
    seller: null,
    registrar: null,
    leads: 0,
    clean: 0,
    kval: 0,
    orders: 0,
    orderedMinor: 0n,
    sold: 0,
    soldMinor: 0n,
    newCustomers: 0,
    dealDaysSum: 0,
    dealCount: 0,
    ...fields,
  }
}

function spend(fields: Partial<SpendDay>): SpendDay {
  return {
    date: '2026-09-01',
    targetolog: 'Umar',
    product: 'Collagen',
    form: true,
    spendMicroUsd: 0n,
    impressions: 0,
    clicks: 0,
    metaLeads: 0,
    ...fields,
  }
}

describe('columnsOf', () => {
  it('gives the Meta cuts no Bitrix columns — no lead can be tied to an ad', () => {
    for (const dim of ['camp', 'adset', 'ad'] as const) {
      expect(columnsOf(dim)).toEqual({ meta: true, leads: false, spend: true, sales: false })
    }
  })

  it('places spend only where an owner is a fact: day, targetolog, product', () => {
    const withSpend = (['targetolog', 'form', 'source', 'product', 'region', 'rop', 'seller', 'registrator', 'days'] as const).filter(
      (dim) => columnsOf(dim).spend,
    )
    expect(withSpend).toEqual(['targetolog', 'product', 'days'])
  })

  it('draws «Дни» as the reference does — Расход, leads and sales, no Meta group', () => {
    expect(columnsOf('days')).toEqual({ meta: false, leads: true, spend: true, sales: true })
  })
})

describe('bitrixCut', () => {
  it('reads the targetolog from the form name first, then the field, then the channel', () => {
    const rows = [
      row('form', { formTitle: 'Заполнение CRM-формы "Umar-collagen Collagen (UMAR)"', targetolog: 'Kimdir', leads: 3 }),
      row('form', { formTitle: null, targetolog: 'Kamron', leads: 2 }),
      row('form', { formTitle: null, targetolog: null, sourceId: 'UC_KPZA32', leads: 5 }),
      // A DM page's lead sits with the DM money.
      row('form', { formTitle: null, targetolog: null, sourceId: 'UC_1X1J24', leads: 4 }),
      // Not the targetolog's set: ignored.
      row('source', { sourceName: 'sinolifeuz', leads: 100 }),
    ]
    const cut = bitrixCut('targetolog', rows, labelers)
    expect(cut.get('Umar')?.leads).toBe(3)
    expect(cut.get('Kamron')?.leads).toBe(2)
    expect(cut.get(ROISTAT_NO_TARGETOLOG)?.leads).toBe(5)
    expect(cut.get(ROISTAT_NOT_FORM)?.leads).toBe(4)
    expect(cut.size).toBe(4)
  })

  it('puts the AI targetolog\'s leads and its spend on one row', () => {
    const rows = [
      // The deal field's «AI», on a lead with no form…
      row('form', { formTitle: null, targetolog: 'AI', leads: 2 }),
      // …and the form rebuilt from its SOURCE_DESCRIPTION (roistatRepository.formTitleJoinSql).
      row('form', { formTitle: 'CRM-формы «AI targetolog · Sinolife AI forma 26.09.2026 17:44»', leads: 3 }),
    ]
    const merged = mergeCuts(
      bitrixCut('targetolog', rows, labelers),
      spendCut('targetolog', [spend({ targetolog: 'AI targetolog', spendMicroUsd: 45_740_000n })]),
    )
    expect(merged.get('AI targetolog')).toMatchObject({ leads: 5, spendMicroUsd: 45_740_000n })
    expect(merged.size).toBe(1)
  })

  it('names a repeat lead\'s form from «Заполнена CRM-форма», as an ordinary one', () => {
    const rows = [
      row('form', { formTitle: 'Заполнение CRM-формы «Timur-collagen\u00a0Sinolife - TM - 01 / 10»', leads: 2 }),
      row('form', { formTitle: 'Qayta zayavka (forma akt #4806000) Заполнена CRM-форма "Timur-collagen\u00a0Sinolife - TM - 01 / 10"', leads: 1 }),
    ]
    expect(bitrixCut('form', rows, labelers).get('Timur-collagen Sinolife - TM - 01 / 10')?.leads).toBe(3)
    expect(bitrixCut('targetolog', rows, labelers).get('Timur')?.leads).toBe(3)
  })

  it('keeps a form lead whose form and deal name nobody apart from the no-form leads', () => {
    const rows = [row('form', { formTitle: 'Заполнение CRM-формы "Sinolifecollgen marine"', sourceId: 'REPEAT_SALE', leads: 2 })]
    expect(bitrixCut('targetolog', rows, labelers).get(ROISTAT_FORM_NO_OWNER)?.leads).toBe(2)
  })

  it('files a lead with no form under the channel it came through', () => {
    const rows = [
      row('form', { sourceId: 'UC_KPZA32', leads: 6 }),
      row('form', { sourceId: 'UC_1X1J24', leads: 4 }),
      row('form', { sourceId: null, leads: 1 }),
    ]
    const cut = bitrixCut('form', rows, labelers)
    expect(cut.get(ROISTAT_NO_FORM.outbound)?.leads).toBe(6)
    expect(cut.get(ROISTAT_NO_FORM.page)?.leads).toBe(4)
    expect(cut.get(ROISTAT_NO_FORM.other)?.leads).toBe(1)
  })

  it('names a form by its title and folds two titles of one form together', () => {
    const rows = [
      row('form', { formTitle: 'Заполнение CRM-формы "Sinolife (UMAR) 777"', targetolog: 'a', leads: 1 }),
      row('form', { formTitle: 'Заполнение CRM-формы "Sinolife (UMAR) 777"', targetolog: 'b', leads: 2 }),
    ]
    expect(bitrixCut('form', rows, labelers).get('Sinolife (UMAR) 777')?.leads).toBe(3)
  })

  it('files a sale by what it was paid for (its product_line), a lead by its source or form', () => {
    const zextraForm = 'Заполнение CRM-формы "Kamron-zextra Zextra 6 etapli filtr forma 05.07"'
    const rows = [
      row('product', { formTitle: zextraForm, leads: 4 }),
      // A sale from a Zextra lead that was paid for Collagen is Collagen's.
      row('product', { formTitle: zextraForm, productLine: 'Collagen', sold: 1, soldMinor: 100n }),
      // «Boshqa» (another product) is final — the lead's brand does not overrule it.
      row('product', { formTitle: zextraForm, productLine: ROISTAT_NO_PRODUCT, sold: 1, soldMinor: 50n }),
      row('product', { productLine: 'Zextra', sold: 1, soldMinor: 30n }),
    ]
    const cut = bitrixCut('product', rows, labelers)
    expect(cut.get('Zextra')?.leads).toBe(4)
    expect(cut.get('Zextra')?.soldMinor).toBe(30n)
    expect(cut.get('Collagen')?.soldMinor).toBe(100n)
    expect(cut.get(ROISTAT_NO_PRODUCT)?.soldMinor).toBe(50n)
  })

  it('drops the leads from a sales-only cut instead of piling them into «Region kiritilmagan»', () => {
    const rows = [
      row('region', { region: null, leads: 50, clean: 45, kval: 20 }),
      row('region', { region: 'Ташкент г.', orders: 3, orderedMinor: 300n, sold: 2, soldMinor: 200n }),
      row('region', { region: null, orders: 1, orderedMinor: 100n }),
    ]
    const cut = bitrixCut('region', rows, labelers)
    expect(cut.get('Ташкент г.')?.sold).toBe(2)
    expect(cut.get(ROISTAT_NOT_STATED.region!)).toMatchObject({ leads: 0, orders: 1 })
    expect(cut.size).toBe(2)
  })

  it('keeps every lead and sale on the day cut, so its total is the tiles’ total', () => {
    const rows = [
      row('total', { leads: 7, sold: 2, soldMinor: 500n }),
      row('day', { day: '2026-09-01', leads: 4, sold: 1, soldMinor: 200n }),
      row('day', { day: '2026-09-02', leads: 3, sold: 1, soldMinor: 300n }),
    ]
    const cut = bitrixCut('days', rows, labelers)
    const total = bitrixTotal(rows)
    expect([...cut.values()].reduce((n, c) => n + c.leads, 0)).toBe(total.leads)
    expect([...cut.values()].reduce((n, c) => n + c.soldMinor, 0n)).toBe(total.soldMinor)
  })

  it('refuses a scan without its grand total rather than answer zero', () => {
    expect(() => bitrixTotal([row('day', { day: '2026-09-01' })])).toThrow(/grand-total/)
  })
})

describe('spendCut', () => {
  const days = [
    spend({ date: '2026-09-01', targetolog: 'Umar', product: 'Collagen', spendMicroUsd: 10_000_000n }),
    spend({ date: '2026-09-01', targetolog: 'Элдор', product: 'Zextra', spendMicroUsd: 5_000_000n }),
    spend({ date: '2026-09-01', targetolog: 'Umar', product: 'Collagen', form: false, spendMicroUsd: 2_000_000n }),
    // Not ad budget: an unmapped account, a hiring campaign (adBudgetProduct → null).
    spend({ date: '2026-09-02', targetolog: 'Newgen', product: null, spendMicroUsd: 1_000_000n }),
    spend({ date: '2026-09-02', targetolog: 'Элдор', product: null, spendMicroUsd: 99_000_000n }),
  ]

  it('counts the ad budget only — RNP and «Lidlar» price the same money', () => {
    expect(spendTotal(days).spendMicroUsd).toBe(17_000_000n)
    expect(spendCut('days', days).get('2026-09-02')).toBeUndefined()
    expect([...spendCut('product', days).keys()].sort()).toEqual(['Collagen', 'Zextra'])
  })

  it('gives a targetolog his form money only; DM and the rest get a row of their own', () => {
    const cut = spendCut('targetolog', days)
    expect(cut.get('Umar')?.spendMicroUsd).toBe(10_000_000n)
    expect(cut.get(ROISTAT_NOT_FORM)?.spendMicroUsd).toBe(2_000_000n)
    // …and the cut still adds up to the tile.
    expect([...cut.values()].reduce((n, c) => n + c.spendMicroUsd, 0n)).toBe(spendTotal(days).spendMicroUsd)
  })

  it('places no money on a cut that cannot carry it', () => {
    expect(spendCut('source', days).size).toBe(0)
    expect(spendCut('seller', days).size).toBe(0)
  })

  it('meets the leads on one targetolog key', () => {
    const merged = mergeCuts(
      bitrixCut('targetolog', [row('form', { formTitle: 'Заполнение CRM-формы "Eldor-collagen Sinolife Collagen - 30.04"', leads: 9 })], labelers),
      spendCut('targetolog', days),
    )
    expect(merged.get('Элдор')).toMatchObject({ leads: 9, spendMicroUsd: 5_000_000n })
  })
})

describe('helpers', () => {
  it('reads a product line', () => {
    expect(productOfLine('Zextra Sinolife')).toBe('Zextra')
    expect(productOfLine('Коллаген')).toBe('Collagen')
    expect(productOfLine(null)).toBeNull()
  })

  it('lists every day of a window, inclusive', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })
})

describe('narrowBitrix', () => {
  it('keeps the accepted rows and folds the split grand total back into one', () => {
    const rows = [
      row('total', { leads: 3, sold: 1, soldMinor: 100n }),
      row('total', { leads: 5, sold: 2, soldMinor: 700n, formTitle: 'x' }),
      row('total', { leads: 2, dealDaysSum: 4, dealCount: 1 }),
      row('day', { day: '2026-10-01', leads: 3 }),
      row('day', { day: '2026-10-01', leads: 5, formTitle: 'x' }),
    ]
    const kept = narrowBitrix(rows, (r) => r.formTitle === null)
    expect(kept.filter((r) => r.set === 'total')).toHaveLength(1)
    expect(bitrixTotal(kept)).toMatchObject({ leads: 5, sold: 1, soldMinor: 100n, dealDaysSum: 4, dealCount: 1 })
    expect(kept.filter((r) => r.set === 'day').map((r) => r.leads)).toEqual([3])
  })

  it('answers a zero total when nothing is kept, so the tiles still render', () => {
    const kept = narrowBitrix([row('total', { leads: 9 })], () => false)
    expect(bitrixTotal(kept)).toMatchObject({ leads: 0, sold: 0, soldMinor: 0n })
  })
})
