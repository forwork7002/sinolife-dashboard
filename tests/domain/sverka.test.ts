import { describe, expect, it } from 'vitest'

import {
  type BitrixSide,
  type MoyskladSide,
  bitrixPhase,
  compareDeal,
  moyskladPhase,
  normaliseName,
  orphanLine,
  phasesAgree,
  productDiff,
  productRows,
  regionKey,
  regionVerdict,
  ropKey,
  ropVerdict,
  sameProducts,
  sverkaTotals,
  teamRows,
} from '@/server/domain/sverka/sverka'

/*
  The fixtures are deals read off the live systems on 2026-10-06 (MoySklad
  orders of 01–05.10 against their Bitrix24 deals), so each case below is a
  difference — or a non-difference — that really occurs.
*/

const COLLAGEN = 'LEcGiRfph3h6SUjE5yxxF3' // Collagen Marine Sinolife — Bitrix24 674's XML_ID
const OMEGA = '-n3II3IBjoS45bviltfkN0' // Omega Sinolife 500 — 714's

const bitrix = (over: Partial<BitrixSide> = {}): BitrixSide => ({
  externalId: '1071642',
  amountMinor: 160_000_000n,
  fakt1: true,
  delivered: false,
  logisticsRole: 'CARRIER', // CARAVAN
  stageExternalId: 'C6:PREPAYMENT_INVOICE',
  stageName: 'CARAVAN',
  seller: 'Zarnigor Mirzayeva230',
  rop: 'Shohjaxon',
  ropSource: 'Shohjaxon',
  region: 'Хорезм',
  queuedAt: new Date('2026-10-05T13:00:00Z'),
  // The portal sells the offers: «Sinolife collagen marine kakao», «Sinolife omega kapsula 60».
  items: [
    { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 2, totalMinor: 160_000_000n },
    { code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, totalMinor: 0n },
  ],
  ...over,
})

const moysklad = (over: Partial<MoyskladSide> = {}): MoyskladSide => ({
  orderId: '667b33a6-c0d6-11f1-0a80-065d00a9c1dd',
  orderName: 'bx10043',
  moment: new Date('2026-10-05T16:04:00Z'),
  stateName: 'В пути',
  sumMinor: 160_000_000n,
  seller: 'Zarnigor Mirzayeva230',
  project: 'Shohjaxon(ROP)',
  region: 'Хорезм',
  logistics: 'CARAVAN',
  payedMinor: 0n,
  shippedMinor: 160_000_000n,
  items: [
    { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 2, totalMinor: 160_000_000n },
    { code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, totalMinor: 0n },
  ],
  ...over,
})

describe('phases', () => {
  it('folds MoySklad statuses into four places', () => {
    expect(moyskladPhase('В пути')).toBe('TRANSIT')
    expect(moyskladPhase('Ожидание / нд')).toBe('TRANSIT')
    expect(moyskladPhase('Успешно')).toBe('DELIVERED')
    expect(moyskladPhase('Касса')).toBe('DELIVERED')
    expect(moyskladPhase('Возврат получен')).toBe('RETURNED')
    expect(moyskladPhase('Отказ')).toBe('RETURNED')
    expect(moyskladPhase('Новый')).toBe('PRE_WAREHOUSE')
    expect(moyskladPhase(null)).toBe('OUTSIDE')
  })

  it('reads a hub, a carrier and the chasing stages as «В пути»', () => {
    for (const role of ['IN_TRANSIT', 'REGIONAL_HUB', 'CARRIER', 'CHASING']) expect(bitrixPhase(role, 'C6:X')).toBe('TRANSIT')
    expect(bitrixPhase('DELIVERED', 'C6:WON')).toBe('DELIVERED')
    expect(bitrixPhase('DELIVERED', 'C14:WON')).toBe('DELIVERED')
    expect(bitrixPhase('SETTLED', 'C6:UC_YUKVF1')).toBe('DELIVERED')
    expect(bitrixPhase('REFUSED', 'C6:LOSE')).toBe('RETURNED')
    expect(bitrixPhase('CANCELLED_EARLY', 'C6:UC_3U7025')).toBe('RETURNED')
    expect(bitrixPhase('PREPARING', 'C6:NEW')).toBe('PRE_WAREHOUSE')
    expect(bitrixPhase(null, 'C6:X')).toBe('OUTSIDE')
  })

  it('reads a role only inside the delivery funnels — Тасдиклаш and База are OUTSIDE', () => {
    // DELIVERY_STAGE_ROLES gives C4's missed-call stage CHASING and C12's refusal CANCELLED_EARLY.
    expect(bitrixPhase('CHASING', 'C4:FINAL_INVOICE')).toBe('OUTSIDE')
    expect(bitrixPhase('CANCELLED_EARLY', 'C12:UC_1OM8B2')).toBe('OUTSIDE')
    expect(bitrixPhase(null, 'C10:NEW')).toBe('OUTSIDE')
    expect(bitrixPhase('CARRIER', null)).toBe('OUTSIDE')
  })

  it('treats «not packed yet» and «on the way» as agreeing', () => {
    expect(phasesAgree('PRE_WAREHOUSE', 'TRANSIT')).toBe(true)
    expect(phasesAgree('TRANSIT', 'DELIVERED')).toBe(false)
    expect(phasesAgree('DELIVERED', 'DELIVERED')).toBe(true)
  })
})

describe('compareDeal', () => {
  it('finds nothing on an order both systems hold alike (deal 1071642)', () => {
    expect(compareDeal(bitrix(), [moysklad()]).issues).toEqual([])
  })

  it('ignores the kopeck MoySklad adds to a discounted line (deal 1053056)', () => {
    const line = compareDeal(bitrix({ amountMinor: 260_000_000n }), [moysklad({ sumMinor: 260_000_001n })])
    expect(line.issues).not.toContain('SUM')
  })

  it('flags a real sum difference (deal 1071484: 1 600 000 against 1 800 000)', () => {
    const line = compareDeal(bitrix({ amountMinor: 160_000_000n }), [moysklad({ sumMinor: 180_000_000n })])
    expect(line.issues).toContain('SUM')
  })

  it('ignores a trailing space on the seller (24 of 357 orders) but not another person (deal 1055922)', () => {
    expect(compareDeal(bitrix({ seller: '160 Mohlaroy Erkinovna ' }), [moysklad({ seller: '160 Mohlaroy Erkinovna' })]).issues).toEqual([])
    expect(
      compareDeal(bitrix({ seller: 'Kamilla Xushmurodova 225 (stajor)' }), [moysklad({ seller: 'Marjona Shahtiyarovna 197' })]).issues,
    ).toEqual(['SELLER'])
  })

  it('flags an order shipped in MoySklad whose deal Bitrix24 refused (deal 1063504, Первичный отдел)', () => {
    const line = compareDeal(bitrix({ fakt1: false, logisticsRole: 'CANCELLED_EARLY', stageExternalId: 'C12:UC_1OM8B2', stageName: 'Тасдикланмаган' }), [moysklad()])
    expect(line.issues).toContain('NOT_FAKT1')
    expect(line.issues).not.toContain('STATUS')
  })

  it('calls a FAKT 1 order past the warehouse with no MoySklad order missing', () => {
    expect(compareDeal(bitrix(), []).issues).toEqual(['MISSING_IN_MS'])
  })

  it('does NOT call an order still being packed missing — it is pending', () => {
    expect(compareDeal(bitrix({ logisticsRole: 'PREPARING' }), []).issues).toEqual([])
    expect(compareDeal(bitrix({ logisticsRole: 'WAREHOUSE' }), []).issues).toEqual([])
  })

  it('flags a status the two systems disagree on', () => {
    const line = compareDeal(bitrix({ logisticsRole: 'DELIVERED', delivered: true }), [moysklad({ stateName: 'В пути' })])
    expect(line.issues).toEqual(['STATUS'])
  })

  it('does not compare the status of a confirmed order that moved on to База', () => {
    const base = bitrix({ logisticsRole: null, stageExternalId: 'C10:NEW', stageName: 'База' })
    expect(compareDeal(base, [moysklad({ stateName: 'Успешно' })]).issues).toEqual([])
  })

  it('compares products by code, so the offer «kakao» matches its product', () => {
    const fewer = moysklad({ items: [{ code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 1, totalMinor: 80_000_000n }] })
    expect(compareDeal(bitrix(), [fewer]).issues).toContain('PRODUCTS')
  })

  it('skips the product check when the deal has no product rows synced', () => {
    expect(compareDeal(bitrix({ items: [] }), [moysklad()]).issues).toEqual([])
  })

  it('flags two MoySklad orders for one deal, comparing the newest', () => {
    const line = compareDeal(bitrix(), [moysklad(), moysklad({ orderId: 'older', sumMinor: 1n })])
    expect(line.issues).toEqual(['DUPLICATE'])
    expect(line.moysklad?.orderId).toBe('667b33a6-c0d6-11f1-0a80-065d00a9c1dd')
  })
})

describe('regionKey / ropKey', () => {
  it('reads the portal\'s fourteen regions and their other spellings as one', () => {
    expect(regionKey('Ташкент г.')).toBe('TASHKENT_CITY')
    expect(regionKey('Ташкент')).toBe('TASHKENT_ANY')
    expect(regionKey('Тошкент ш.')).toBe('TASHKENT_CITY')
    expect(regionKey('Ташкент область')).toBe('TASHKENT_REGION')
    expect(regionKey('Тошкент вилояти')).toBe('TASHKENT_REGION')
    expect(regionKey('Қашқадарё')).toBe('KASHKADARYA')
    expect(regionKey('Кашкадарья')).toBe('KASHKADARYA')
    expect(regionKey('Самарқанд')).toBe('SAMARKAND')
    expect(regionKey('Samarqand viloyati')).toBe('SAMARKAND')
    expect(regionKey("Farg'ona")).toBe('FERGANA')
    expect(regionKey('Нукус')).toBe('KARAKALPAKSTAN')
  })

  it('knows nothing it cannot name — an unknown spelling is null, never a difference', () => {
    expect(regionKey('Москва')).toBeNull()
    expect(regionKey('')).toBeNull()
    expect(regionKey(null)).toBeNull()
  })

  it('reads a ROP project, and only a ROP project', () => {
    expect(ropKey('Shohjaxon(ROP)')).toBe('shohjahon')
    expect(ropKey('Sevinch (rop)')).toBe('sevinch')
    expect(ropKey('Collagen Marine')).toBeNull()
  })
})

describe('compareDeal — region and team', () => {
  it('flags two different regions', () => {
    expect(compareDeal(bitrix({ region: 'Хорезм' }), [moysklad({ region: 'Бухара' })]).issues).toEqual(['REGION'])
  })

  it('takes two spellings of one region as the same', () => {
    expect(compareDeal(bitrix({ region: 'Ташкент г.' }), [moysklad({ region: 'Тошкент ш.' })]).issues).toEqual([])
  })

  it('reads bare «Ташкент» as either Tashkent, and as no other region', () => {
    expect(compareDeal(bitrix({ region: 'Ташкент г.' }), [moysklad({ region: 'Ташкент' })]).issues).toEqual([])
    expect(compareDeal(bitrix({ region: 'Ташкент область' }), [moysklad({ region: 'Ташкент' })]).issues).toEqual([])
    expect(compareDeal(bitrix({ region: 'Ташкент г.' }), [moysklad({ region: 'Ташкент область' })]).issues).toEqual(['REGION'])
    expect(compareDeal(bitrix({ region: 'Хорезм' }), [moysklad({ region: 'Ташкент' })]).issues).toEqual(['REGION'])
  })

  it('says «not compared», never «same», for a region it cannot name', () => {
    expect(regionVerdict('Хорезмская обл.', 'Самаркандская обл.')).toBeNull()
    expect(regionVerdict('Хорезм', 'Склад 3')).toBeNull()
    expect(regionVerdict('Хорезм', 'Xorazm')).toBe('same')
  })

  it('does not flag a region either side leaves empty or spells in a way nobody knows', () => {
    expect(compareDeal(bitrix({ region: null }), [moysklad()]).issues).toEqual([])
    expect(compareDeal(bitrix(), [moysklad({ region: 'Склад 3' })]).issues).toEqual([])
  })

  it('flags a MoySklad project naming another ROP team', () => {
    expect(compareDeal(bitrix(), [moysklad({ project: 'Sevinch(ROP)' })]).issues).toEqual(['ROP'])
  })

  it('folds the two systems\' spellings of one team', () => {
    expect(ropVerdict('Shohjaxon', 'Shoxjaxon(ROP)')).toBe('same')
    expect(ropVerdict('Shohjaxon', 'Collagen')).toBeNull()
  })

  it('does not compare a project that names no team', () => {
    expect(compareDeal(bitrix(), [moysklad({ project: 'Collagen' })]).issues).toEqual([])
    expect(compareDeal(bitrix({ ropSource: null }), [moysklad({ project: 'Sevinch(ROP)' })]).issues).toEqual([])
  })

  it('keeps the other orders of a duplicate', () => {
    const line = compareDeal(bitrix(), [moysklad(), moysklad({ orderId: 'older' })])
    expect(line.others.map((o) => o.orderId)).toEqual(['older'])
  })
})

describe('productDiff', () => {
  it('names the product and both counts (deal 1071484: an extra Sedana in MoySklad)', () => {
    const sedana = { code: 'sedana', name: 'Sedana Sinolife', quantity: 1, totalMinor: 20_000_000n }
    const diff = productDiff(bitrix().items, [...moysklad().items, sedana])
    expect(diff).toEqual([{ key: 'code:sedana', code: 'sedana', name: 'Sedana Sinolife', bitrixQuantity: 0, moyskladQuantity: 1 }])
  })

  it('is empty when the baskets agree', () => {
    expect(productDiff(bitrix().items, moysklad().items)).toEqual([])
  })
})

describe('sameProducts / normaliseName', () => {
  it('tells two different products apart even when the baskets have as many lines', () => {
    const collagen = { code: COLLAGEN, name: 'Collagen', quantity: 2, totalMinor: 0n }
    const zextra = { code: 'wSM3W0pTh9TL4bG0R77Oe2', name: 'Zextra sure', quantity: 2, totalMinor: 0n }
    expect(sameProducts([collagen], [zextra])).toBe(false)
    expect(compareDeal(bitrix({ items: [collagen] }), [moysklad({ items: [zextra] })]).issues).toContain('PRODUCTS')
  })

  it('ignores a zero line, so it cannot flag a basket with nothing to show for it', () => {
    const one = { code: OMEGA, name: 'x', quantity: 1, totalMinor: 0n }
    expect(sameProducts([one, { ...one, code: 'gift', quantity: 0 }], [one])).toBe(true)
  })

  it('adds up repeated codes before comparing', () => {
    const one = { code: OMEGA, name: 'x', quantity: 1, totalMinor: 0n }
    expect(sameProducts([one, one], [{ ...one, quantity: 2 }])).toBe(true)
  })

  it('keys a product without a code by its name', () => {
    expect(sameProducts([{ code: null, name: 'Gel ', quantity: 1, totalMinor: 0n }], [{ code: null, name: 'gel', quantity: 1, totalMinor: 0n }])).toBe(
      true,
    )
  })

  it('folds space and case', () => {
    expect(normaliseName('  Davlat  ')).toBe(normaliseName('davlat'))
  })
})

describe('orphanLine', () => {
  it('names a deal Bitrix24 does not have, and one that skipped the queue', () => {
    expect(orphanLine(null, 'NO_DEAL', [moysklad()]).issues).toEqual(['NO_DEAL'])
    expect(orphanLine('8996', 'NOT_QUEUED', [moysklad()]).issues).toEqual(['NOT_QUEUED'])
    expect(orphanLine('8996', 'OTHER_WINDOW', [moysklad()]).issues).toEqual([])
  })
})

describe('sverkaTotals', () => {
  it('sets FAKT 1 against the same deals in MoySklad and FAKT 2 against «Успешно» / «Касса»', () => {
    const lines = [
      compareDeal(bitrix(), [moysklad()]),
      compareDeal(bitrix({ externalId: '2', delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' }), [
        moysklad({ stateName: 'Касса' }),
      ]),
      compareDeal(bitrix({ externalId: '3', logisticsRole: 'PREPARING', stageExternalId: 'C6:NEW' }), []),
      compareDeal(bitrix({ externalId: '4', fakt1: false, logisticsRole: 'CANCELLED_EARLY', stageExternalId: 'C12:UC_1OM8B2' }), [
        moysklad(),
      ]),
    ]
    const totals = sverkaTotals(lines)
    expect(totals.fakt1.bitrix).toEqual({ orders: 3, amountMinor: 480_000_000n })
    expect(totals.fakt1.moysklad).toEqual({ orders: 2, amountMinor: 320_000_000n })
    expect(totals.fakt2.bitrix.orders).toBe(1)
    expect(totals.fakt2.moysklad.orders).toBe(1)
    expect(totals.pending.orders).toBe(1)
    expect(totals.clean).toBe(2)
    expect(totals.transit.bitrix.orders).toBe(1)
    expect(totals.transit.moysklad.orders).toBe(1)
  })

  it('ignores orphan lines — they have no Bitrix24 side', () => {
    expect(sverkaTotals([orphanLine(null, 'NO_DEAL', [moysklad()])]).fakt1.moysklad.orders).toBe(0)
  })
})

describe('productRows / teamRows', () => {
  it('sums pieces per code over FAKT 1 deals, named by MoySklad', () => {
    const rows = productRows([compareDeal(bitrix(), [moysklad()]), compareDeal(bitrix({ externalId: '9' }), [])])
    const collagen = rows.find((r) => r.code === COLLAGEN)
    expect(collagen).toMatchObject({ bitrixQuantity: 4, moyskladQuantity: 2, name: 'Collagen Marine Sinolife' })
  })

  it('totals FAKT 1 per team and counts the deals with a difference', () => {
    const rows = teamRows([compareDeal(bitrix(), [moysklad()]), compareDeal(bitrix({ externalId: '9', rop: null }), [])], '(ROP yoʻq)')
    expect(rows.map((r) => [r.team, r.bitrix.orders, r.moysklad.orders, r.issues])).toEqual([
      ['Shohjaxon', 1, 1, 0],
      ['(ROP yoʻq)', 1, 0, 1],
    ])
  })
})
