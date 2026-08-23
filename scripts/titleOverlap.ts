/**
 * Decisive test: do База (#10) and Доставка (#6) carry the SAME order code?
 *
 *     npm run bitrix:titles
 *
 * READ-ONLY.
 *
 * Deal titles look like `bx05267` — a per-order code, not a description. If
 * the same code appears in both pipelines, they are the same order recorded
 * twice, and importing both would double revenue.
 *
 * This is a far stronger key than the amount: with 84% of deals sitting on
 * eight price points, amount matching proves almost nothing, whereas an order
 * code collides only if it is genuinely the same order.
 */

import 'dotenv/config'

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
  TITLE?: string
  OPPORTUNITY?: string
  CATEGORY_ID?: string
  DATE_CREATE?: string
  STAGE_SEMANTIC_ID?: string
}

async function page(filter: Record<string, unknown>, cap: number): Promise<Deal[]> {
  const rows: Deal[] = []
  let start = 0
  for (let i = 0; i < 30; i++) {
    const r = await call<Deal[]>('crm.deal.list', {
      filter,
      select: ['ID', 'TITLE', 'OPPORTUNITY', 'CATEGORY_ID', 'DATE_CREATE', 'STAGE_SEMANTIC_ID'],
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

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const amt = (d: Deal) => Math.round(Number(d.OPPORTUNITY ?? 0))

async function main() {
  console.log('\n  Buyurtma kodi (TITLE) bo‘yicha test…\n')

  const baza = await page({ CATEGORY_ID: 10, '>OPPORTUNITY': 0 }, 300)
  const titles = [...new Set(baza.map((d) => (d.TITLE ?? '').trim()).filter(Boolean))]
  console.log(`  База: ${baza.length} ta bitim, ${titles.length} ta noyob kod`)

  // Do these codes look like order identifiers, or free-text names?
  const codeLike = titles.filter((t) => /^bx\d+$/i.test(t)).length
  console.log(`  "bx#####" ko‘rinishidagi kodlar: ${codeLike}/${titles.length}`)

  // Look each code up in Доставка — an exact-value filter, not a guess.
  console.log('\n  Shu kodlarni Доставка da qidiryapmiz…')
  const found: Deal[] = []
  const CHUNK = 45
  for (let i = 0; i < titles.length; i += CHUNK) {
    found.push(...(await page({ CATEGORY_ID: 6, TITLE: titles.slice(i, i + CHUNK) }, 900)))
  }

  const deliveryByTitle = new Map<string, Deal[]>()
  for (const d of found) {
    const key = (d.TITLE ?? '').trim()
    const l = deliveryByTitle.get(key) ?? []
    l.push(d)
    deliveryByTitle.set(key, l)
  }

  let matched = 0
  let matchedSameAmount = 0
  const gaps: number[] = []
  const examples: string[] = []

  for (const b of baza) {
    const key = (b.TITLE ?? '').trim()
    const peers = deliveryByTitle.get(key)
    if (!peers?.length) continue
    matched++

    const twin = peers.find((p) => amt(p) === amt(b))
    if (twin) {
      matchedSameAmount++
      const gap =
        (new Date(b.DATE_CREATE!).getTime() - new Date(twin.DATE_CREATE!).getTime()) / 86_400_000
      gaps.push(gap)
      if (examples.length < 6) {
        examples.push(
          `    ${key.padEnd(12)} ${fmt(amt(b)).padStart(11)}   ` +
            `Доставка #${twin.ID} ${twin.DATE_CREATE?.slice(0, 10)}  →  ` +
            `База #${b.ID} ${b.DATE_CREATE?.slice(0, 10)}   (+${gap.toFixed(0)} kun)`,
        )
      }
    }
  }

  const pct = (n: number) => `${((n / baza.length) * 100).toFixed(0)}%`

  console.log('\n  ' + '━'.repeat(74))
  console.log('  NATIJA')
  console.log('  ' + '━'.repeat(74))
  console.log(`  База bitimlari                          : ${baza.length}`)
  console.log(`  kodi Доставка da ham bor                : ${matched} (${pct(matched)})`)
  console.log(`  kodi VA summasi bir xil                 : ${matchedSameAmount} (${pct(matchedSameAmount)})`)

  if (gaps.length) {
    const s = [...gaps].sort((a, b) => a - b)
    const median = s[Math.floor(s.length / 2)]!
    const positive = s.filter((g) => g > 0).length
    console.log(`  vaqt farqi (median)                     : ${median.toFixed(0)} kun`)
    console.log(`  База keyinroq yaratilgan                : ${positive}/${s.length}`)
  }

  if (examples.length) {
    console.log('\n  Namunalar:')
    for (const e of examples) console.log(e)
  }

  console.log('')
  if (matchedSameAmount / baza.length >= 0.7) {
    console.log('  ⇒ NUSXA TASDIQLANDI. Bir xil buyurtma ikki voronkada.')
    console.log('    Ikkalasini import qilsak, tushum IKKI BAROBAR koʻrinadi.')
    console.log('    Faqat bittasini revenue manbai qilib olish kerak.')
  } else if (matched / baza.length < 0.2) {
    console.log('  ⇒ Kodlar mos kelmadi — mustaqil buyurtmalar.')
  } else {
    console.log(`  ⇒ Qisman (${pct(matchedSameAmount)}). Biznes tomondan aniqlash kerak.`)
  }
  console.log('')
}

main().catch((e) => {
  console.error('\n  Xato:', redact(e), '\n')
  process.exit(1)
})
