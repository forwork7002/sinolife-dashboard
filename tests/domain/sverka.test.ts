import { describe, expect, it } from 'vitest'

import {
  type BitrixSide,
  type MoyskladSide,
  MOYSKLAD_DATA_FLOOR,
  bitrixPhase,
  compareDeal,
  moyskladPhase,
  normaliseName,
  orphanLine,
  phasesAgree,
  productDiff,
  productRecheckRows,
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

/*
  The three checks the 2026-10-17 audit found nothing reading, each from an
  order MoySklad held on 01–19.10.
*/
describe('compareDeal — MoySklad against itself, and a deal taken back', () => {
  const delivered = { delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' } as const

  it('flags a deal back in Первичный отдел whose order MoySklad still has on its way (deal 1135804)', () => {
    const back = bitrix({ fakt1: false, logisticsRole: 'CANCELLED_EARLY', stageExternalId: 'C12:UC_1OM8B2', stageName: 'Тасдикланмаган' })
    expect(compareDeal(back, [moysklad({ stateName: 'В пути', shippedMinor: 0n })]).issues).toEqual(['NOT_FAKT1', 'PULLED_BACK'])
    expect(compareDeal(back, [moysklad({ stateName: 'Новый', shippedMinor: 0n })]).issues).toContain('PULLED_BACK')
    // Back in Тасдиклаш is the same: not confirmed on the portal, moving in the warehouse.
    expect(compareDeal(bitrix({ stageExternalId: 'C4:NEW', logisticsRole: null }), [moysklad()]).issues).toContain('PULLED_BACK')
  })

  it('does not flag a taken-back deal whose order came back — that is its ordinary end', () => {
    const back = bitrix({ fakt1: false, logisticsRole: 'CANCELLED_EARLY', stageExternalId: 'C12:UC_2HKFV9' })
    expect(compareDeal(back, [moysklad({ stateName: 'Возврат получен', shippedMinor: 0n })]).issues).not.toContain('PULLED_BACK')
  })

  it('flags «Касса» short of its sum and «Успешно» paid in full (bx10075, bx09926)', () => {
    const kassaUnpaid = compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 0n })])
    const kassaShort = compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 155_000_000n })])
    const successPaid = compareDeal(bitrix(delivered), [moysklad({ stateName: 'Успешно', payedMinor: 160_000_000n })])
    expect(kassaUnpaid.issues).toEqual(['PAYMENT'])
    expect(kassaShort.issues).toEqual(['PAYMENT'])
    expect(successPaid.issues).toEqual(['PAYMENT'])
  })

  it('leaves the usual pair alone: «Касса» paid, «Успешно» waiting or paid in part', () => {
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 160_000_000n })]).issues).toEqual([])
    // A kopeck short is paid.
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 159_999_999n })]).issues).toEqual([])
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Успешно' })]).issues).toEqual([])
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Успешно', payedMinor: 60_000_000n })]).issues).toEqual([])
  })

  it('reads MoySklad\'s own sum, so a SUM gap is not also a payment one', () => {
    const line = compareDeal(bitrix({ ...delivered, amountMinor: 180_000_000n }), [
      moysklad({ stateName: 'Касса', payedMinor: 160_000_000n }),
    ])
    expect(line.issues).toEqual(['SUM'])
  })

  it('flags a delivered order its shipments do not cover (bx10020: «Касса», shipped 0)', () => {
    const line = compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 160_000_000n, shippedMinor: 0n })])
    expect(line.issues).toEqual(['NOT_SHIPPED'])
    expect(
      compareDeal(bitrix(delivered), [moysklad({ stateName: 'Успешно', shippedMinor: 100_000_000n })]).issues,
    ).toEqual(['NOT_SHIPPED'])
  })

  it('does not ask an order on its way for a shipment it has not made yet', () => {
    expect(compareDeal(bitrix(), [moysklad({ stateName: 'В пути', shippedMinor: 0n })]).issues).toEqual([])
  })

  it('draws each line at the whole soʻm, as SUM does', () => {
    // «Касса» one soʻm short is short; 99 tiyin short is paid.
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 159_999_900n })]).issues).toEqual(['PAYMENT'])
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Касса', payedMinor: 159_999_901n })]).issues).toEqual([])
    // Shipped 99 tiyin short is shipped; one soʻm short is not.
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Успешно', shippedMinor: 159_999_901n })]).issues).toEqual([])
    expect(compareDeal(bitrix(delivered), [moysklad({ stateName: 'Успешно', shippedMinor: 159_999_900n })]).issues).toEqual([
      'NOT_SHIPPED',
    ])
  })

  it('does not call a zero-sum «Успешно» paid in full', () => {
    const free = compareDeal(bitrix({ ...delivered, amountMinor: 0n }), [moysklad({ stateName: 'Успешно', sumMinor: 0n, shippedMinor: 0n })])
    expect(free.issues).toEqual([])
  })

  it('sums the payment over the deal\'s orders, as the cash desk does — a re-made order is paid on the older one', () => {
    const line = compareDeal(bitrix(delivered), [
      moysklad({ stateName: 'Касса', payedMinor: 0n }),
      moysklad({ orderId: 'older', stateName: 'Отказ', payedMinor: 160_000_000n }),
    ])
    expect(line.issues).toEqual(['DUPLICATE'])
  })

  it('reads «Ожидание / нд» as on its way for a taken-back deal', () => {
    const back = bitrix({ fakt1: false, logisticsRole: 'CANCELLED_EARLY', stageExternalId: 'C12:UC_1OM8B2' })
    expect(compareDeal(back, [moysklad({ stateName: 'Ожидание / нд', shippedMinor: 0n })]).issues).toContain('PULLED_BACK')
  })
})

/*
  MoySklad holds no order dated before 2026-06-15: a «Yil» window used to turn
  every January–June FAKT 1 order into «MoySkladʼda yoʻq».
*/
describe('compareDeal — before MoySklad held any order', () => {
  const may = new Date('2026-05-10T07:00:00Z')
  const delivered = { logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON', delivered: true }

  it('the floor is 2026-06-15 00:00 in Tashkent', () => {
    expect(MOYSKLAD_DATA_FLOOR.toISOString()).toBe('2026-06-14T19:00:00.000Z')
  })

  it('does not call an order older than MoySklad missing — it is compared with nothing', () => {
    const line = compareDeal(bitrix({ ...delivered, queuedAt: may }), [])
    expect(line.issues).toEqual([])
    expect(line.beforeFloor).toBe(true)
  })

  it('still calls an order from the floor on missing, the floor itself included', () => {
    const line = compareDeal(bitrix({ ...delivered, queuedAt: MOYSKLAD_DATA_FLOOR }), [])
    expect(line.issues).toEqual(['MISSING_IN_MS'])
    expect(line.beforeFloor).toBe(false)
  })

  it('compares an old order that does have a MoySklad order, as any other', () => {
    const line = compareDeal(bitrix({ queuedAt: may }), [moysklad({ sumMinor: 180_000_000n })])
    expect(line.issues).toEqual(['SUM'])
    expect(line.beforeFloor).toBe(false)
  })

  it('keeps an old order still being packed pending — its MoySklad order is made when it leaves', () => {
    const line = compareDeal(bitrix({ queuedAt: may, logisticsRole: 'PREPARING', stageExternalId: 'C6:NEW' }), [])
    expect(line.beforeFloor).toBe(false)
    expect(sverkaTotals([line]).pending.orders).toBe(1)
  })

  /*
    Only a FAKT 1 or FAKT 2 deal is one MoySklad should hold. A refusal never
    gets an order, before the floor or after it, and counted as «before» it
    the page told the reader it was in the FAKT figures — the probe that found
    it: one refused and one delivered May deal read 2 there against FAKT 1's 1.
  */
  it('leaves an old order refused at confirmation as it is — not before anything, not in any FAKT figure', () => {
    // C4:LOSE is where the refusal is picked; C12:UC_1OM8B2 is where it comes to rest.
    for (const stageExternalId of ['C4:LOSE', 'C12:UC_1OM8B2']) {
      const refused = compareDeal(
        bitrix({ externalId: 'refused', queuedAt: may, fakt1: false, delivered: false, logisticsRole: 'CANCELLED_EARLY', stageExternalId }),
        [],
      )
      expect(refused.issues).toEqual([])
      expect(refused.beforeFloor).toBe(false)

      const totals = sverkaTotals([refused, compareDeal(bitrix({ ...delivered, queuedAt: may }), [])])
      expect(totals.beforeFloor).toEqual(totals.fakt1.beforeFloor)
      expect(totals.beforeFloor.orders).toBe(1)
    }
  })

  it('still sets aside an old delivered order outside FAKT 1 — FAKT 2 counts it', () => {
    const line = compareDeal(bitrix({ ...delivered, fakt1: false, queuedAt: may }), [])
    expect(line.beforeFloor).toBe(true)
    const totals = sverkaTotals([line])
    expect(totals.fakt2.beforeFloor.orders).toBe(1)
    expect(totals.fakt1.beforeFloor.orders).toBe(0)
    expect(totals.beforeFloor.orders).toBe(1)
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

describe('productRecheckRows', () => {
  /*
    1052240 on 2026-10-15: the portal and MoySklad both held one Collagen;
    the stored rows still had the Omega gift the portal dropped on 2026-10-06.
  */
  const collagen = { code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity: 1, totalMinor: 80_000_000n }
  const omega = { code: OMEGA, name: 'Omega Sinolife 500', quantity: 1, totalMinor: 0n }
  const row = (dealId: string, moment: string, bitrixItems: typeof collagen[], moyskladItems: typeof collagen[]) => ({
    dealId,
    moment: new Date(moment),
    bitrix: bitrixItems,
    moysklad: moyskladItems,
  })

  it('names the deals «Mahsulot farqi» would flag, newest order first', () => {
    const rows = [
      row('1050902', '2026-10-01T09:00:00Z', [{ ...collagen, quantity: 2 }, omega, omega], [{ ...collagen, quantity: 2 }, omega]),
      row('1052240', '2026-10-01T12:00:00Z', [collagen, omega], [collagen]),
      row('1060000', '2026-10-02T12:00:00Z', [collagen], [collagen]),
    ]
    const ids = (limit: number) => productRecheckRows(rows, limit).map((r) => r.dealId)
    expect(ids(10)).toEqual(['1052240', '1050902'])
    expect(ids(1)).toEqual(['1052240'])
  })

  it('skips a deal with no stored rows, as compareDeal does', () => {
    expect(productRecheckRows([row('1', '2026-10-01T09:00:00Z', [], [collagen])], 10)).toEqual([])
    expect(compareDeal(bitrix({ items: [] }), [moysklad({ items: [collagen] })]).issues).not.toContain('PRODUCTS')
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
        moysklad({ stateName: 'Касса', payedMinor: 160_000_000n }),
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

  it('counts FAKT 2 into the cash desk by MoySklad\'s booked payment, not by the «Касса» status', () => {
    const delivered = { delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' } as const
    const totals = sverkaTotals([
      // «Касса» with no payment booked is NOT in the cash desk.
      compareDeal(bitrix({ externalId: '1', ...delivered }), [moysklad({ stateName: 'Касса' })]),
      // «Успешно» paid in full is.
      compareDeal(bitrix({ externalId: '2', ...delivered }), [moysklad({ stateName: 'Успешно', payedMinor: 160_000_000n })]),
      // Paid in part: the part is received, the rest is left.
      compareDeal(bitrix({ externalId: '3', ...delivered }), [moysklad({ stateName: 'Успешно', payedMinor: 60_000_000n })]),
      // MoySklad's own sum is paid in full and the gap is a kopeck one: not money missing.
      compareDeal(bitrix({ externalId: '4', ...delivered, amountMinor: 160_000_050n }), [
        moysklad({ stateName: 'Успешно', payedMinor: 160_000_000n }),
      ]),
      // Delivered with no MoySklad order: due, nothing received.
      compareDeal(bitrix({ externalId: '5', ...delivered }), []),
      // On its way: no part of the cash desk's figure, whatever was prepaid.
      compareDeal(bitrix({ externalId: '6' }), [moysklad({ payedMinor: 50_000_000n })]),
    ])
    const k = totals.kassa
    expect(k.due).toEqual({ orders: 5, amountMinor: 800_000_050n })
    expect(k.received).toEqual({ orders: 3, amountMinor: 380_000_050n })
    expect(k.left).toEqual({ orders: 3, amountMinor: 420_000_000n })
    expect(k.received.amountMinor + k.left.amountMinor).toBe(k.due.amountMinor)
    expect(k.due.amountMinor).toBe(totals.fakt2.bitrix.amountMinor)
    expect(k.partial).toBe(1)
    expect(k.noOrder).toBe(1)
    expect(k.byState).toEqual([
      { state: 'Успешно', due: { orders: 3, amountMinor: 480_000_050n }, paidOrders: 3 },
      { state: 'Касса', due: { orders: 1, amountMinor: 160_000_000n }, paidOrders: 0 },
      { state: null, due: { orders: 1, amountMinor: 160_000_000n }, paidOrders: 0 },
    ])
  })

  it('keeps a real SUM gap left even when MoySklad\'s own smaller sum is paid in full', () => {
    const delivered = { delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' } as const
    const k = sverkaTotals([
      compareDeal(bitrix({ externalId: '1', ...delivered }), [
        moysklad({ stateName: 'Успешно', sumMinor: 100_000_000n, payedMinor: 100_000_000n }),
      ]),
    ]).kassa
    expect(k.received).toEqual({ orders: 1, amountMinor: 100_000_000n })
    expect(k.left).toEqual({ orders: 1, amountMinor: 60_000_000n })
  })

  it('counts a payment booked on the deal\'s older order, and an order with no status apart from no order', () => {
    const delivered = { delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' } as const
    const older = moysklad({ orderId: 'old', orderName: 'bx10043-old', moment: new Date('2026-10-04T10:00:00Z'), payedMinor: 160_000_000n })
    const k = sverkaTotals([
      compareDeal(bitrix({ externalId: '1', ...delivered }), [moysklad({ stateName: null }), older]),
    ]).kassa
    expect(k.received).toEqual({ orders: 1, amountMinor: 160_000_000n })
    expect(k.left.orders).toBe(0)
    expect(k.byState).toEqual([{ state: 'holatsiz', due: { orders: 1, amountMinor: 160_000_000n }, paidOrders: 1 }])
  })

  it('never counts more than is due on an overpaid deal', () => {
    const delivered = { delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' } as const
    const k = sverkaTotals([
      compareDeal(bitrix({ externalId: '1', ...delivered }), [moysklad({ stateName: 'Успешно', payedMinor: 200_000_000n })]),
    ]).kassa
    expect(k.received).toEqual({ orders: 1, amountMinor: 160_000_000n })
    expect(k.left).toEqual({ orders: 0, amountMinor: 0n })
  })

  it('ignores orphan lines — they have no Bitrix24 side', () => {
    expect(sverkaTotals([orphanLine(null, 'NO_DEAL', [moysklad()])]).fakt1.moysklad.orders).toBe(0)
  })

  it('keeps an order older than MoySklad in Bitrix24\'s figures and names its share of each', () => {
    const may = new Date('2026-05-10T07:00:00Z')
    const lines = [
      compareDeal(bitrix(), [moysklad()]),
      compareDeal(bitrix({ externalId: 'old-delivered', queuedAt: may, delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' }), []),
      compareDeal(bitrix({ externalId: 'old-refused', queuedAt: may, logisticsRole: 'REFUSED', stageExternalId: 'C6:LOSE' }), []),
    ]
    const totals = sverkaTotals(lines)
    // FAKT 1 is still the whole cohort's — Savdo dinamikasi's to the soʻm.
    expect(totals.fakt1.bitrix).toEqual({ orders: 3, amountMinor: 480_000_000n })
    expect(totals.fakt1.beforeFloor).toEqual({ orders: 2, amountMinor: 320_000_000n })
    expect(totals.fakt2.bitrix.orders).toBe(1)
    expect(totals.fakt2.beforeFloor.orders).toBe(1)
    // MoySklad could not hold it, so the cash desk is not owed it either.
    expect(totals.kassa.due.orders).toBe(0)
    expect(totals.returned.beforeFloor.orders).toBe(1)
    expect(totals.transit.beforeFloor.orders).toBe(0)
    expect(totals.beforeFloor).toEqual({ orders: 2, amountMinor: 320_000_000n })
    expect(totals.clean).toBe(1)
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

  it('sets no order older than MoySklad against MoySklad, by product or by team', () => {
    const old = compareDeal(bitrix({ externalId: 'old', queuedAt: new Date('2026-05-10T07:00:00Z') }), [])
    const lines = [compareDeal(bitrix(), [moysklad()]), old]
    expect(old.beforeFloor).toBe(true)
    expect(productRows(lines).find((r) => r.code === COLLAGEN)).toMatchObject({ bitrixQuantity: 2, moyskladQuantity: 2 })
    expect(teamRows(lines, '(ROP yoʻq)').map((r) => [r.team, r.bitrix.orders, r.moysklad.orders])).toEqual([['Shohjaxon', 1, 1]])
  })

  it('over FAKT 2 reads Bitrix24\'s delivered deals and the orders MoySklad calls Успешно / Касса, each on its own side', () => {
    const won = { delivered: true, logisticsRole: 'DELIVERED', stageExternalId: 'C6:WON' } as const
    const collagen = (quantity: number) => [{ code: COLLAGEN, name: 'Collagen Marine Sinolife', quantity, totalMinor: BigInt(quantity) * 80_000_000n }]
    const lines = [
      // Delivered on both systems.
      compareDeal(bitrix({ ...won, items: collagen(2) }), [moysklad({ stateName: 'Касса', items: collagen(2) })]),
      // Delivered in Bitrix24, still on the way in MoySklad: Bitrix24's pieces only.
      compareDeal(bitrix({ ...won, externalId: '9', items: collagen(3) }), [moysklad({ orderName: 'bx9', items: collagen(3) })]),
      // MoySklad has it delivered, Bitrix24 does not yet: MoySklad's pieces only.
      compareDeal(bitrix({ externalId: '10', items: collagen(5) }), [moysklad({ orderName: 'bx10', stateName: 'Успешно', items: collagen(5) })]),
    ]
    const of = (rows: ReturnType<typeof productRows>) => rows.find((r) => r.code === COLLAGEN)
    expect(of(productRows(lines, 'FAKT2'))).toMatchObject({ bitrixQuantity: 5, bitrixMinor: 400_000_000n, moyskladQuantity: 7, moyskladMinor: 560_000_000n })
    // FAKT 1, the default, is every one of them on both sides.
    expect(of(productRows(lines))).toMatchObject({ bitrixQuantity: 10, moyskladQuantity: 10 })

    // Delivered with a queue outcome outside FAKT 1: FAKT 2 only — FAKT 2 is every delivered cohort deal, as `sverkaTotals` counts it.
    const unconfirmed = compareDeal(bitrix({ ...won, fakt1: false, externalId: '11', items: collagen(4) }), [
      moysklad({ orderName: 'bx11', stateName: 'Успешно', items: collagen(4) }),
    ])
    expect(of(productRows([unconfirmed], 'FAKT2'))).toMatchObject({ bitrixQuantity: 4, moyskladQuantity: 4 })
    expect(productRows([unconfirmed])).toEqual([])

    // Queued before MoySklad held orders: on neither side.
    const old = compareDeal(bitrix({ ...won, externalId: 'old', queuedAt: new Date('2026-05-10T07:00:00Z'), items: collagen(6) }), [])
    expect(old.beforeFloor).toBe(true)
    expect(productRows([old], 'FAKT2')).toEqual([])
  })
})
