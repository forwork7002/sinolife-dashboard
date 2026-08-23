/**
 * Definitive duplication test — База (#10) vs Доставка (#6).
 *
 *     npm run bitrix:final-dup
 *
 * READ-ONLY.
 *
 * TWO EARLIER ATTEMPTS WERE WRONG, IN OPPOSITE DIRECTIONS
 *
 *   Attempt 1 matched on contact + amount and reported 100% — but 84% of all
 *   deals sit on just 8 price points, so amount matching is close to
 *   worthless. It over-reported duplication.
 *
 *   Attempt 2 intersected two independent 800-deal samples. Доставка has
 *   16 283 deals, so a 5% sample barely overlaps anything by construction.
 *   Its "84% have no counterpart" was a sampling artifact. It under-reported
 *   duplication.
 *
 * This test fixes both flaws:
 *   - Contacts come FROM the База sample, and their Доставка deals are then
 *     fetched by explicit id — a complete lookup, not an intersection.
 *   - Pairing is one-to-one, so a single Доставка deal cannot satisfy several
 *     База deals by coincidence.
 *   - The date window is swept, so the shape of the gap distribution is
 *     visible rather than assumed. A workflow copy produces a tight cluster;
 *     genuine repeat purchases spread out.
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
  TITLE?: string
}

const SELECT = ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'STAGE_SEMANTIC_ID', 'TITLE']

async function page(filter: Record<string, unknown>, cap: number): Promise<Deal[]> {
  const rows: Deal[] = []
  let start = 0
  for (let i = 0; i < 40; i++) {
    const r = await call<Deal[]>('crm.deal.list', { filter, select: SELECT, order: { ID: 'DESC' }, start })
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

async function main() {
  console.log('\n  Yakuniy nusxa testi…')
  console.log(`  Portal: ${new URL(BASE).host}  (faqat o‘qish)\n`)

  // 1. Sample from База.
  const bazaSample = await page({ CATEGORY_ID: 10, '>OPPORTUNITY': 0, '!CONTACT_ID': '' }, 250)
  const contactIds = [...new Set(bazaSample.map((d) => d.CONTACT_ID!))]
  console.log(`  База namunasi: ${bazaSample.length} ta bitim, ${contactIds.length} ta mijoz`)

  // 2. COMPLETE lookup of those contacts' Доставка deals — the fix for attempt 2.
  console.log('  Shu mijozlarning BARCHA Доставка bitimlari yuklanmoqda…')
  const deliveryForContacts: Deal[] = []
  const CHUNK = 40
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const chunk = contactIds.slice(i, i + CHUNK)
    deliveryForContacts.push(...(await page({ CATEGORY_ID: 6, CONTACT_ID: chunk }, 900)))
  }
  console.log(`  Topildi: ${deliveryForContacts.length} ta Доставка bitimi\n`)

  const byContact = new Map<string, Deal[]>()
  for (const d of deliveryForContacts) {
    const l = byContact.get(d.CONTACT_ID!) ?? []
    l.push(d)
    byContact.set(d.CONTACT_ID!, l)
  }

  // =========================================================================
  head('1. MIJOZ DARAJASIDA')
  // =========================================================================
  const contactsWithDelivery = contactIds.filter((c) => byContact.has(c)).length
  console.log(`  База mijozlarining Доставка da ham bitimi bor: ` +
    `${contactsWithDelivery}/${contactIds.length} ` +
    `(${((contactsWithDelivery / contactIds.length) * 100).toFixed(0)}%)`)

  // =========================================================================
  head('2. QAT‘IY JUFTLASH — sana oynasi bo‘yicha')
  // =========================================================================
  console.log('  Bir xil mijoz + bir xil summa + bir marta ishlatiladigan juftlik.\n')
  console.log('  oyna        juftlik      ulush')
  console.log('  ' + '─'.repeat(38))

  const windows = [1, 3, 7, 14, 30, 90, 365, 100000]
  const results: Record<string, number> = {}
  let gapsAtMax: number[] = []

  for (const win of windows) {
    const claimed = new Set<string>()
    let paired = 0
    const gaps: number[] = []

    for (const b of bazaSample) {
      const peers = byContact.get(b.CONTACT_ID!) ?? []
      const bTime = new Date(b.DATE_CREATE!).getTime()

      // Prefer the closest unclaimed candidate, so a tight pair is not lost
      // to a distant one that happened to be scanned first.
      const candidates = peers
        .filter((p) => !claimed.has(p.ID) && amt(p) === amt(b))
        .map((p) => ({ p, gap: Math.abs(new Date(p.DATE_CREATE!).getTime() - bTime) / 86_400_000 }))
        .filter((c) => c.gap <= win)
        .sort((a, z) => a.gap - z.gap)

      if (candidates.length) {
        claimed.add(candidates[0]!.p.ID)
        paired++
        gaps.push(candidates[0]!.gap)
      }
    }

    const share = paired / bazaSample.length
    results[`w${win}`] = paired
    console.log(
      `  ${(win === 100000 ? 'cheksiz' : `${win} kun`).padEnd(10)} ${String(paired).padStart(7)}` +
        `   ${(share * 100).toFixed(0).padStart(5)}%`,
    )
    if (win === 100000) gapsAtMax = gaps
  }

  // =========================================================================
  head('3. VAQT FARQI TAQSIMOTI')
  // =========================================================================
  if (gapsAtMax.length) {
    const s = [...gapsAtMax].sort((a, b) => a - b)
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!
    console.log(`  juftliklar: ${s.length}`)
    console.log(`  median   : ${q(0.5).toFixed(0)} kun`)
    console.log(`  25%      : ${q(0.25).toFixed(0)} kun`)
    console.log(`  75%      : ${q(0.75).toFixed(0)} kun`)
    console.log(`  max      : ${s[s.length - 1]!.toFixed(0)} kun`)
    const within7 = s.filter((g) => g <= 7).length / s.length
    console.log(`\n  7 kun ichida: ${(within7 * 100).toFixed(0)}%`)
    console.log(
      within7 > 0.6
        ? '  ⇒ Zich klaster — ish jarayonining nusxasiga oʻxshaydi.'
        : '  ⇒ Tarqoq — takroriy xaridlarga oʻxshaydi, avtomatik nusxa emas.',
    )
  }

  // =========================================================================
  head('4. TITLE NAMUNALARI')
  // =========================================================================
  console.log('  База:')
  for (const d of bazaSample.slice(0, 6)) {
    console.log(`    ${String(d.TITLE ?? '').slice(0, 52).padEnd(54)} ${fmt(amt(d)).padStart(11)}`)
  }
  console.log('\n  Доставка:')
  for (const d of deliveryForContacts.slice(0, 6)) {
    console.log(`    ${String(d.TITLE ?? '').slice(0, 52).padEnd(54)} ${fmt(amt(d)).padStart(11)}`)
  }

  const file = resolve(process.cwd(), 'bitrix24-final-dup.json')
  writeFileSync(file, JSON.stringify({ contactsWithDelivery, contactIds: contactIds.length, results }, null, 2), 'utf8')
  console.log(`\n  Toʻliq natija: ${file}\n`)
}

main().catch((e) => {
  console.error('\n  Xato:', redact(e), '\n')
  process.exit(1)
})
