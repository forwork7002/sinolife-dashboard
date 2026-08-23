/**
 * Strict duplication test — is База (#10) a copy of Доставка (#6)?
 *
 *     npm run bitrix:verify-dup
 *
 * READ-ONLY.
 *
 * WHY THIS EXISTS
 * The first pass reported "100% of amounts match" and concluded the pipelines
 * were copies. That test was too weak to support the conclusion: this business
 * sells a handful of fixed packages, so a pipeline with ~15 distinct price
 * points will match another one almost perfectly by chance alone. A 100% hit
 * rate is itself a warning sign, not proof.
 *
 * Three stricter checks:
 *   1. How many DISTINCT amounts exist? Few → amount matching proves nothing.
 *   2. ONE-TO-ONE pairing inside a date window — each Доставка deal may be
 *      claimed by at most one База deal, so coincidences cannot be reused.
 *   3. Distribution comparison — copies have identical averages. Different
 *      averages mean different transactions.
 */

import 'dotenv/config'

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { redact } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL
if (!WEBHOOK) {
  console.error('\nBITRIX24_WEBHOOK_URL is not set.\n')
  process.exit(1)
}
const BASE = WEBHOOK.replace(/\/+$/, '') + '/'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call<T>(method: string, params: Record<string, unknown> = {}) {
  await sleep(550)
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 30_000)
  try {
    const res = await fetch(`${BASE}${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: c.signal,
    })
    const p = (await res.json()) as { result?: T; total?: number; error?: string }
    if (p.error) return { ok: false as const, error: p.error }
    return { ok: true as const, result: p.result, total: p.total }
  } catch (e) {
    return { ok: false as const, error: redact(e) }
  } finally {
    clearTimeout(t)
  }
}

interface Deal {
  ID: string
  CONTACT_ID?: string
  OPPORTUNITY?: string
  DATE_CREATE?: string
  STAGE_SEMANTIC_ID?: string
  ASSIGNED_BY_ID?: string
}

async function fetchAll(filter: Record<string, unknown>, cap: number): Promise<Deal[]> {
  const rows: Deal[] = []
  let start = 0
  for (let i = 0; i < 40; i++) {
    const r = await call<Deal[]>('crm.deal.list', {
      filter,
      select: ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'STAGE_SEMANTIC_ID', 'ASSIGNED_BY_ID'],
      order: { ID: 'DESC' },
      start,
    })
    if (!r.ok || !r.result?.length) break
    rows.push(...r.result)
    if (rows.length >= cap || r.result.length < 50) break
    start += 50
  }
  return rows.slice(0, cap)
}

const head = (t: string) => {
  console.log('')
  console.log('  ' + '━'.repeat(76))
  console.log(`  ${t}`)
  console.log('  ' + '━'.repeat(76))
}

const amt = (d: Deal) => Math.round(Number(d.OPPORTUNITY ?? 0))
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function stats(values: number[]) {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, min: 0, max: 0 }
  const s = [...values].sort((a, b) => a - b)
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    median: s[Math.floor(s.length / 2)]!,
    min: s[0]!,
    max: s[s.length - 1]!,
  }
}

const out: Record<string, unknown> = {}

async function main() {
  console.log('\n  Qat‘iy nusxa testi…')
  console.log(`  Portal: ${new URL(BASE).host}  (faqat o‘qish)\n`)

  console.log('  Namuna yuklanmoqda (bir necha daqiqa)…')
  const delivery = await fetchAll({ CATEGORY_ID: 6, '>OPPORTUNITY': 0 }, 800)
  const baza = await fetchAll({ CATEGORY_ID: 10, '>OPPORTUNITY': 0 }, 800)
  console.log(`  Доставка: ${delivery.length} ta · База: ${baza.length} ta`)

  // =========================================================================
  head('1. NARX NUQTALARI — summa mosligi umuman dalil boʻla oladimi?')
  // =========================================================================
  const dAmounts = new Set(delivery.map(amt))
  const bAmounts = new Set(baza.map(amt))

  console.log(`  Доставка da turli summalar: ${dAmounts.size} ta (${delivery.length} bitimda)`)
  console.log(`  База da turli summalar    : ${bAmounts.size} ta (${baza.length} bitimda)`)

  const topD = [...delivery.reduce((m, d) => m.set(amt(d), (m.get(amt(d)) ?? 0) + 1), new Map<number, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  console.log('\n  Доставка da eng koʻp uchraydigan summalar:')
  for (const [value, count] of topD) {
    console.log(`    ${fmt(value).padStart(12)}  ${count} ta  (${((count / delivery.length) * 100).toFixed(1)}%)`)
  }

  const concentration = topD.reduce((s, [, c]) => s + c, 0) / delivery.length
  console.log(`\n  Eng koʻp 8 ta summa barcha bitimlarning ${(concentration * 100).toFixed(0)}% ini qoplaydi.`)
  if (concentration > 0.5) {
    console.log('  ⇒ Narxlar juda takrorlanuvchi. "Summa mos keldi" — TASODIF boʻlishi mumkin.')
    console.log('    Birinchi testning 100% natijasi shuning uchun ishonchsiz edi.')
  }
  out.pricePoints = { delivery: dAmounts.size, baza: bAmounts.size, concentration }

  // =========================================================================
  head('2. BIR-BIRGA JUFTLASH — har bir Доставка bitimi faqat bir marta')
  // =========================================================================
  console.log('  Shart: bir xil mijoz + bir xil summa + 14 kun ichida.')
  console.log('  Har bir Доставка bitimi eng koʻpi bilan bitta juftga ega boʻladi,')
  console.log('  shuning uchun tasodifiy mosliklar qayta ishlatilmaydi.\n')

  const byContact = new Map<string, Deal[]>()
  for (const d of delivery) {
    if (!d.CONTACT_ID) continue
    const l = byContact.get(d.CONTACT_ID) ?? []
    l.push(d)
    byContact.set(d.CONTACT_ID, l)
  }

  const claimed = new Set<string>()
  let paired = 0
  let sameContactNoPair = 0
  let noContactMatch = 0
  const gaps: number[] = []

  for (const b of baza) {
    if (!b.CONTACT_ID) continue
    const peers = byContact.get(b.CONTACT_ID)
    if (!peers) {
      noContactMatch++
      continue
    }

    const bTime = new Date(b.DATE_CREATE!).getTime()
    const match = peers.find((p) => {
      if (claimed.has(p.ID)) return false
      if (amt(p) !== amt(b)) return false
      const gap = Math.abs(new Date(p.DATE_CREATE!).getTime() - bTime) / 86_400_000
      return gap <= 14
    })

    if (match) {
      claimed.add(match.ID)
      paired++
      gaps.push(Math.abs(new Date(match.DATE_CREATE!).getTime() - bTime) / 86_400_000)
    } else {
      sameContactNoPair++
    }
  }

  const withContact = baza.filter((b) => b.CONTACT_ID).length
  const pct = (n: number) => `${((n / withContact) * 100).toFixed(0)}%`

  console.log(`  База bitimlari (kontaktli)        : ${withContact}`)
  console.log(`  qat‘iy juftlik topildi            : ${paired} (${pct(paired)})`)
  console.log(`  mijozi bor, lekin juftligi yoʻq   : ${sameContactNoPair} (${pct(sameContactNoPair)})`)
  console.log(`  mijozining Доставка bitimi yoʻq   : ${noContactMatch} (${pct(noContactMatch)})`)
  if (gaps.length) {
    const g = stats(gaps)
    console.log(`  juftliklar orasidagi farq         : median ${g.median.toFixed(1)} kun, max ${g.max.toFixed(0)} kun`)
  }
  out.strictPairing = { withContact, paired, sameContactNoPair, noContactMatch }

  // =========================================================================
  head('3. TAQSIMOT — nusxa boʻlsa, oʻrtachalar teng boʻlishi kerak')
  // =========================================================================
  const dS = stats(delivery.map(amt))
  const bS = stats(baza.map(amt))

  console.log('                    Доставка          База')
  console.log('  ' + '─'.repeat(46))
  console.log(`  bitimlar     ${String(dS.n).padStart(12)} ${String(bS.n).padStart(13)}`)
  console.log(`  oʻrtacha     ${fmt(dS.mean).padStart(12)} ${fmt(bS.mean).padStart(13)}`)
  console.log(`  mediana      ${fmt(dS.median).padStart(12)} ${fmt(bS.median).padStart(13)}`)
  console.log(`  eng kichik   ${fmt(dS.min).padStart(12)} ${fmt(bS.min).padStart(13)}`)
  console.log(`  eng katta    ${fmt(dS.max).padStart(12)} ${fmt(bS.max).padStart(13)}`)

  const ratio = bS.mean / (dS.mean || 1)
  console.log(`\n  База / Доставка oʻrtacha nisbati: ${ratio.toFixed(2)}×`)
  out.distribution = { delivery: dS, baza: bS, ratio }

  // =========================================================================
  head('XULOSA')
  // =========================================================================
  const pairRate = paired / withContact

  if (pairRate >= 0.7 && Math.abs(ratio - 1) < 0.15) {
    console.log('  NUSXA. База — Доставка ning takrori. Faqat bittasini import qiling.')
  } else if (pairRate < 0.3) {
    console.log('  NUSXA EMAS. База mustaqil bitimlarni saqlaydi.')
    console.log(`  Qat‘iy juftlik atigi ${pct(paired)} — birinchi testdagi 100% tasodif edi.`)
    console.log(`  Oʻrtacha summalar ham farq qiladi (${ratio.toFixed(2)}×).`)
    console.log('\n  ⇒ Ehtimol: База — takroriy/yirik buyurtmalar voronkasi.')
    console.log('    Lekin buni biznes tasdiqlashi kerak.')
  } else {
    console.log(`  ARALASH — ${pct(paired)} juftlik topildi.`)
    console.log('  Bir qismi takror, bir qismi mustaqil. Qoʻlda tekshirish kerak.')
  }

  const file = resolve(process.cwd(), 'bitrix24-duplication.json')
  writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
  console.log(`\n  Toʻliq natija: ${file}\n`)
}

main().catch((e) => {
  console.error('\n  Xato:', redact(e), '\n')
  process.exit(1)
})
