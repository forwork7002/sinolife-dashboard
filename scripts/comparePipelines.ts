/**
 * Pipeline relationship analysis — Доставка (#6) vs База (#10) vs Ecommerce (#14).
 *
 *     npm run bitrix:compare
 *
 * READ-ONLY.
 *
 * The question is which of these pipelines hold the SAME money. Importing two
 * pipelines that mirror each other would double reported revenue, and the
 * error would be invisible — every figure would simply be twice what it should
 * be, consistently, with nothing obviously broken.
 *
 * Four independent signals, because no single one is conclusive:
 *   1. Timeline — do they run in parallel, or did one replace the other?
 *   2. Contact overlap — do the same customers appear in both?
 *   3. Amount matching — for overlapping customers, are the sums identical?
 *   4. Ownership — same team working both, or different teams?
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

const DELAY_MS = 550
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; result?: T; total?: number; error?: string }> {
  await sleep(DELAY_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${BASE}${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
    const p = (await res.json()) as { result?: T; total?: number; error?: string; error_description?: string }
    if (p.error) return { ok: false, error: `${p.error} ${p.error_description ?? ''}`.trim() }
    return { ok: true, result: p.result, total: p.total }
  } catch (e) {
    return { ok: false, error: redact(e) }
  } finally {
    clearTimeout(timer)
  }
}

const head = (t: string) => {
  console.log('')
  console.log('  ' + '━'.repeat(76))
  console.log(`  ${t}`)
  console.log('  ' + '━'.repeat(76))
}

interface Deal {
  ID: string
  CATEGORY_ID?: string
  CONTACT_ID?: string
  OPPORTUNITY?: string
  DATE_CREATE?: string
  CLOSEDATE?: string
  STAGE_ID?: string
  STAGE_SEMANTIC_ID?: string
  ASSIGNED_BY_ID?: string
  TITLE?: string
  SOURCE_ID?: string
}

const PIPES = { 6: 'Доставка', 10: 'База', 14: 'Ecommerce' } as const
const out: Record<string, unknown> = {}

/** Fetch every page of a deal query, up to a cap. */
async function fetchAll(filter: Record<string, unknown>, select: string[], cap = 500): Promise<Deal[]> {
  const rows: Deal[] = []
  let start = 0
  for (let page = 0; page < 20; page++) {
    const res = await call<Deal[]>('crm.deal.list', { filter, select, order: { ID: 'DESC' }, start })
    if (!res.ok || !res.result?.length) break
    rows.push(...res.result)
    if (rows.length >= cap) break
    if (res.result.length < 50) break
    start += 50
  }
  return rows.slice(0, cap)
}

const money = (v?: string) => Math.round(Number(v ?? 0))
const fmt = (n: number) => n.toLocaleString('en-US')

async function main() {
  console.log('\n  Voronkalar bog‘lanishini tahlil qilyapmiz…')
  console.log(`  Portal: ${new URL(BASE).host}  (faqat o‘qish)`)

  // =========================================================================
  head('1. VAQT BO‘YICHA — parallel ishlaydimi yoki biri ikkinchisini almashtirganmi?')
  // =========================================================================
  const months: string[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push(d.toISOString().slice(0, 7))
  }

  console.log('  oy        Доставка      База   Ecommerce')
  console.log('  ' + '─'.repeat(46))

  const timeline: Record<string, Record<number, number>> = {}

  for (const m of months) {
    const from = `${m}-01T00:00:00+05:00`
    const [y, mo] = m.split('-').map(Number)
    const next = new Date(Date.UTC(y!, mo!, 1)).toISOString().slice(0, 10)
    const to = `${next}T00:00:00+05:00`

    const row: Record<number, number> = {}
    for (const id of [6, 10, 14] as const) {
      const r = await call('crm.deal.list', {
        filter: { CATEGORY_ID: id, '>=DATE_CREATE': from, '<DATE_CREATE': to },
        select: ['ID'],
        start: 0,
      })
      row[id] = r.total ?? 0
    }
    timeline[m] = row
    console.log(
      `  ${m}  ${String(row[6]).padStart(9)} ${String(row[10]).padStart(9)} ${String(row[14]).padStart(11)}`,
    )
  }
  out.timeline = timeline

  // =========================================================================
  head('2. MIJOZLAR KESISHUVI — База va Ecommerce mijozlari Доставка da bormi?')
  // =========================================================================

  /**
   * Take a sample from the candidate pipeline, then look up ALL deals for those
   * same contacts in one query using an array filter. One round trip instead of
   * one per contact.
   */
  async function overlap(candidateId: 10 | 14) {
    const sample = await fetchAll(
      { CATEGORY_ID: candidateId, '!CONTACT_ID': '' },
      ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'STAGE_SEMANTIC_ID', 'ASSIGNED_BY_ID'],
      150,
    )

    if (sample.length === 0) {
      console.log(`\n  #${candidateId} ${PIPES[candidateId]}: kontaktli bitim topilmadi`)
      return null
    }

    const contactIds = [...new Set(sample.map((d) => d.CONTACT_ID).filter(Boolean))] as string[]

    // All Доставка deals belonging to the same contacts.
    const delivery = await fetchAll(
      { CATEGORY_ID: 6, CONTACT_ID: contactIds },
      ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'STAGE_SEMANTIC_ID', 'ASSIGNED_BY_ID'],
      600,
    )

    const deliveryByContact = new Map<string, Deal[]>()
    for (const d of delivery) {
      const list = deliveryByContact.get(d.CONTACT_ID!) ?? []
      list.push(d)
      deliveryByContact.set(d.CONTACT_ID!, list)
    }

    let withDelivery = 0
    let exactAmountMatch = 0
    let sameDayMatch = 0
    const examples: string[] = []

    for (const d of sample) {
      const peers = deliveryByContact.get(d.CONTACT_ID!) ?? []
      if (peers.length === 0) continue
      withDelivery++

      const amount = money(d.OPPORTUNITY)
      const twin = peers.find((p) => money(p.OPPORTUNITY) === amount && amount > 0)
      if (twin) {
        exactAmountMatch++
        const gapDays = Math.abs(
          (new Date(d.DATE_CREATE!).getTime() - new Date(twin.DATE_CREATE!).getTime()) / 86_400_000,
        )
        if (gapDays <= 2) sameDayMatch++
        if (examples.length < 5) {
          examples.push(
            `    #${d.ID} (${PIPES[candidateId]}) ${fmt(amount).padStart(11)} ` +
              `${d.DATE_CREATE?.slice(0, 10)}  ⇄  #${twin.ID} (Доставка) ${twin.DATE_CREATE?.slice(0, 10)}` +
              `  farq ${gapDays.toFixed(0)} kun`,
          )
        }
      }
    }

    const pct = (n: number) => `${((n / sample.length) * 100).toFixed(0)}%`

    console.log(`\n  #${candidateId} ${PIPES[candidateId]} — namuna ${sample.length} ta bitim`)
    console.log(`    mijozida Доставка bitimi ham bor : ${withDelivery} (${pct(withDelivery)})`)
    console.log(`    summasi AYNAN mos keladi         : ${exactAmountMatch} (${pct(exactAmountMatch)})`)
    console.log(`    ustiga 2 kun ichida yaratilgan   : ${sameDayMatch} (${pct(sameDayMatch)})`)
    if (examples.length) {
      console.log('\n    Namunalar:')
      for (const e of examples) console.log(e)
    }

    const verdict =
      exactAmountMatch / sample.length >= 0.5
        ? 'NUSXA — bir xil pul ikki joyda. Faqat bittasini import qilish kerak.'
        : withDelivery / sample.length >= 0.5
          ? 'Mijozlar bir xil, lekin summalar boshqa — alohida savdolar boʻlishi mumkin.'
          : 'MUSTAQIL — Доставка bilan takrorlanmaydi.'

    console.log(`\n    ⇒ ${verdict}`)

    return { sampleSize: sample.length, withDelivery, exactAmountMatch, sameDayMatch, verdict }
  }

  out.overlapBaza = await overlap(10)
  out.overlapEcom = await overlap(14)

  // =========================================================================
  head('3. KIM ISHLAYDI — bir jamoami yoki alohida jamoalarmi?')
  // =========================================================================
  const owners: Record<number, Set<string>> = { 6: new Set(), 10: new Set(), 14: new Set() }

  for (const id of [6, 10, 14] as const) {
    const rows = await fetchAll({ CATEGORY_ID: id }, ['ID', 'ASSIGNED_BY_ID'], 300)
    for (const r of rows) if (r.ASSIGNED_BY_ID) owners[id].add(r.ASSIGNED_BY_ID)
    console.log(`  #${String(id).padEnd(3)} ${PIPES[id].padEnd(12)} ${owners[id].size} ta xodim (namuna ${rows.length} bitim)`)
  }

  const shared6and10 = [...owners[6]].filter((u) => owners[10].has(u))
  const shared6and14 = [...owners[6]].filter((u) => owners[14].has(u))
  console.log(`\n  Доставка ∩ База      : ${shared6and10.length} ta umumiy xodim`)
  console.log(`  Доставка ∩ Ecommerce : ${shared6and14.length} ta umumiy xodim`)
  out.owners = {
    delivery: [...owners[6]],
    baza: [...owners[10]],
    ecom: [...owners[14]],
    shared6and10,
    shared6and14,
  }

  // =========================================================================
  head('4. YAKUNLANISH — har bir voronkada pul qachon tan olinadi?')
  // =========================================================================
  for (const id of [6, 10, 14] as const) {
    const won = await fetchAll(
      { CATEGORY_ID: id, STAGE_SEMANTIC_ID: 'S' },
      ['ID', 'STAGE_ID', 'OPPORTUNITY', 'CLOSEDATE'],
      300,
    )
    const byStage = new Map<string, { n: number; sum: number }>()
    for (const d of won) {
      const e = byStage.get(d.STAGE_ID ?? '?') ?? { n: 0, sum: 0 }
      e.n++
      e.sum += money(d.OPPORTUNITY)
      byStage.set(d.STAGE_ID ?? '?', e)
    }

    console.log(`\n  #${id} ${PIPES[id]} — yutuq bosqichlari (namuna ${won.length} ta):`)
    if (byStage.size === 0) console.log('    yutuq bitim yoʻq')
    for (const [stage, e] of byStage) {
      console.log(`    ${stage.padEnd(26)} ${String(e.n).padStart(5)} ta   ${fmt(e.sum).padStart(15)} soʻm`)
    }
    const withClose = won.filter((d) => d.CLOSEDATE).length
    if (won.length) {
      console.log(`    yopilish sanasi toʻldirilgan: ${withClose}/${won.length}`)
    }
  }

  const file = resolve(process.cwd(), 'bitrix24-pipelines.json')
  writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
  console.log(`\n  Toʻliq natija: ${file}\n`)
}

main().catch((e) => {
  console.error('\n  Xato:', redact(e), '\n')
  process.exit(1)
})
