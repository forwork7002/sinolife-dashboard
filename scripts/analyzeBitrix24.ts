/**
 * Bitrix24 structure analysis — answers two specific questions.
 *
 *     npm run bitrix:analyze
 *
 * READ-ONLY. Every call reads metadata or a small sample. Nothing is written.
 *
 * QUESTION 1 — Are Регистрация → Тасдиклаш → Доставка one deal moving through
 * pipelines, or separate deals per stage? This decides whether revenue would be
 * counted once or three times.
 *
 * QUESTION 2 — Is there a payment AMOUNT anywhere, or is payment only ever a
 * stage? This decides whether the finance page can exist at all.
 *
 * Both are answered from the portal's own data rather than by asking, because
 * a wrong answer here silently corrupts every revenue figure.
 */

import 'dotenv/config'

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { redact } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL
if (!WEBHOOK) {
  console.error('\nBITRIX24_WEBHOOK_URL is not set in .env.\n')
  process.exit(1)
}
const BASE = WEBHOOK.replace(/\/+$/, '') + '/'

const DELAY_MS = 600
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call<T>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<{ ok: boolean; result?: T; total?: number; error?: string }> {
  await sleep(DELAY_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${BASE}${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
    const payload = (await response.json()) as {
      result?: T
      total?: number
      error?: string
      error_description?: string
    }
    if (payload.error) {
      return { ok: false, error: `${payload.error}${payload.error_description ? ` — ${payload.error_description}` : ''}` }
    }
    return { ok: true, result: payload.result, total: payload.total }
  } catch (error) {
    return { ok: false, error: redact(error) }
  } finally {
    clearTimeout(timer)
  }
}

const head = (t: string) => {
  console.log('')
  console.log('  ' + '━'.repeat(74))
  console.log(`  ${t}`)
  console.log('  ' + '━'.repeat(74))
}

/** The three pipelines the business confirmed are sales. */
const SALES_PIPELINES = [12, 4, 14] as const
const PIPELINE_NAMES: Record<number, string> = {
  0: 'Регистрация',
  4: 'Тасдиклаш',
  6: 'Доставка',
  8: 'HR',
  10: 'База',
  12: 'Первичный отдел',
  14: 'Ecommerce',
  18: 'Бахолаш ва таклифлар',
  20: 'ИИ обработка',
}

interface DealRow {
  ID: string
  TITLE?: string
  CATEGORY_ID?: string
  STAGE_ID?: string
  STAGE_SEMANTIC_ID?: string
  OPPORTUNITY?: string
  CURRENCY_ID?: string
  CONTACT_ID?: string
  DATE_CREATE?: string
  CLOSEDATE?: string
  CLOSED?: string
  ASSIGNED_BY_ID?: string
  ORIGIN_ID?: string
  ORIGINATOR_ID?: string
}

const out: Record<string, unknown> = {}

async function main() {
  console.log('\n  Bitrix24 tuzilmasini tahlil qilyapmiz…')
  console.log(`  Portal: ${new URL(BASE).host}  (faqat o‘qish)`)

  // =========================================================================
  head('A. VORONKALAR BO‘YICHA HAJM')
  // =========================================================================
  const perPipeline: { id: number; name: string; total: number; withMoney: number }[] = []

  for (const id of Object.keys(PIPELINE_NAMES).map(Number).sort((a, b) => a - b)) {
    const all = await call<DealRow[]>('crm.deal.list', {
      filter: { CATEGORY_ID: id },
      select: ['ID'],
      start: 0,
    })
    // How many carry a non-zero amount? A pipeline where nothing has a value
    // is not where revenue lives.
    const money = await call<DealRow[]>('crm.deal.list', {
      filter: { CATEGORY_ID: id, '>OPPORTUNITY': 0 },
      select: ['ID'],
      start: 0,
    })

    const row = {
      id,
      name: PIPELINE_NAMES[id] ?? String(id),
      total: all.total ?? 0,
      withMoney: money.total ?? 0,
    }
    perPipeline.push(row)

    const flag = (SALES_PIPELINES as readonly number[]).includes(id) ? ' ← savdo' : ''
    console.log(
      `  #${String(id).padEnd(3)} ${row.name.padEnd(24)} ${String(row.total).padStart(8)} ta` +
        `   summasi bor: ${String(row.withMoney).padStart(7)}${flag}`,
    )
  }
  out.perPipeline = perPipeline

  const salesTotal = perPipeline
    .filter((p) => (SALES_PIPELINES as readonly number[]).includes(p.id))
    .reduce((s, p) => s + p.total, 0)
  console.log(`\n  Savdo voronkalarida jami: ${salesTotal.toLocaleString('en-US')} ta bitim`)

  // =========================================================================
  head('B. SAVOL 1 — bitta bitim ko‘chadimi yoki alohida bitimlarmi?')
  // =========================================================================
  console.log('  Test: Доставка voronkasidan bir nechta bitim olamiz va')
  console.log('  ularning mijozida boshqa voronkalarda ham bitim bormi tekshiramiz.\n')

  const deliverySample = await call<DealRow[]>('crm.deal.list', {
    filter: { CATEGORY_ID: 6, '!CONTACT_ID': '' },
    select: ['ID', 'TITLE', 'CONTACT_ID', 'DATE_CREATE', 'OPPORTUNITY', 'STAGE_ID'],
    order: { ID: 'DESC' },
    start: 0,
  })

  const contacts = [
    ...new Set((deliverySample.result ?? []).map((d) => d.CONTACT_ID).filter(Boolean)),
  ].slice(0, 8) as string[]

  if (contacts.length === 0) {
    console.log('  Доставка voronkasida kontaktli bitim topilmadi.')
  } else {
    let multiPipeline = 0
    const detail: unknown[] = []

    for (const contactId of contacts) {
      const deals = await call<DealRow[]>('crm.deal.list', {
        filter: { CONTACT_ID: contactId },
        select: ['ID', 'CATEGORY_ID', 'TITLE', 'DATE_CREATE', 'OPPORTUNITY', 'STAGE_SEMANTIC_ID'],
        order: { ID: 'ASC' },
        start: 0,
      })

      const rows = deals.result ?? []
      const cats = [...new Set(rows.map((d) => Number(d.CATEGORY_ID ?? 0)))]
      if (cats.length > 1) multiPipeline++

      console.log(`  Mijoz #${contactId} — ${rows.length} ta bitim, voronkalar: ${cats.join(', ')}`)
      for (const d of rows.slice(0, 6)) {
        const cat = PIPELINE_NAMES[Number(d.CATEGORY_ID ?? 0)] ?? d.CATEGORY_ID
        console.log(
          `     #${String(d.ID).padEnd(8)} ${String(cat).padEnd(20)}` +
            ` ${String(d.OPPORTUNITY ?? 0).padStart(12)}` +
            `  ${String(d.DATE_CREATE ?? '').slice(0, 10)}  ${d.STAGE_SEMANTIC_ID ?? ''}`,
        )
      }
      if (rows.length > 6) console.log(`     … +${rows.length - 6} ta`)
      detail.push({ contactId, deals: rows })
    }

    out.contactOverlap = detail

    console.log('')
    console.log(`  ${multiPipeline}/${contacts.length} mijozda bir nechta voronkada bitim bor.`)
    if (multiPipeline >= contacts.length * 0.6) {
      console.log('  ⇒ ALOHIDA BITIMLAR. Bitta savdo bir nechta yozuv sifatida takrorlanadi.')
      console.log('    Hammasini import qilsak, tushum bir necha barobar oshib ketadi.')
    } else if (multiPipeline === 0) {
      console.log('  ⇒ BITTA BITIM ko‘chadi. Har bir savdo — bitta yozuv.')
    } else {
      console.log('  ⇒ Aralash. Qo‘lda tekshirish kerak.')
    }
  }

  // =========================================================================
  head('C. SAVOL 2 — to‘lov summasi maydoni bormi?')
  // =========================================================================

  // 1) Numeric custom fields are the only place an amount could hide.
  const discoveryPath = resolve(process.cwd(), 'bitrix24-discovery.json')
  let numericFields: string[] = []
  try {
    const disc = JSON.parse(readFileSync(discoveryPath, 'utf8')) as {
      dealFields?: Record<string, { type?: string; title?: string }>
    }
    const fields = disc.dealFields ?? {}
    numericFields = Object.entries(fields)
      .filter(([, f]) => ['double', 'money', 'integer'].includes(f.type ?? ''))
      .map(([k, f]) => `${k} (${f.type})${f.title && f.title !== k ? ` — ${f.title}` : ''}`)

    console.log('  Bitimdagi raqamli maydonlar (summa shu yerda bo‘lishi mumkin):\n')
    for (const f of numericFields) console.log(`    ${f}`)
    if (numericFields.length === 0) console.log('    (yo‘q)')
  } catch {
    console.log('  bitrix24-discovery.json topilmadi — avval npm run bitrix:discover')
  }
  out.numericDealFields = numericFields

  // 2) Smart processes: the status list mentioned SMART_INVOICE_STAGE_2, so
  //    invoices may exist as a separate entity with its own amounts.
  console.log('\n  Smart-jarayonlar (hisob-faktura shu yerda bo‘lishi mumkin):\n')
  const types = await call<{ types?: { entityTypeId: number; title: string; name?: string }[] }>(
    'crm.type.list',
  )
  const typeList = (types.result as { types?: { entityTypeId: number; title: string }[] })?.types ?? []
  if (typeList.length === 0) {
    console.log('    (crm.type.list bo‘sh yoki mavjud emas)')
  } else {
    for (const t of typeList) console.log(`    entityTypeId ${String(t.entityTypeId).padEnd(5)} ${t.title}`)
  }
  out.smartTypes = typeList

  // 3) Old-style invoices.
  const invoices = await call<unknown[]>('crm.invoice.list', { select: ['ID'], start: 0 })
  console.log(
    `\n  Eski uslubdagi hisob-fakturalar (crm.invoice): ` +
      (invoices.ok ? `${invoices.total ?? 0} ta` : `mavjud emas (${invoices.error})`),
  )
  out.invoiceCount = invoices.ok ? invoices.total : null

  // =========================================================================
  head('D. NAMUNA BITIM — savdo voronkasidan')
  // =========================================================================
  const sample = await call<DealRow[]>('crm.deal.list', {
    filter: { CATEGORY_ID: 14, '>OPPORTUNITY': 0 },
    select: [
      'ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
      'OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID', 'CONTACT_ID',
      'DATE_CREATE', 'CLOSEDATE', 'CLOSED', 'SOURCE_ID',
    ],
    order: { ID: 'DESC' },
    start: 0,
  })

  const deal = sample.result?.[0]
  if (deal) {
    for (const [k, v] of Object.entries(deal)) {
      if (v === null || v === '' || v === undefined) continue
      console.log(`    ${k.padEnd(22)} ${String(v).slice(0, 44)}`)
    }
    out.sampleDeal = deal

    // Product rows decide whether product analytics can work at all.
    const rows = await call<{ PRODUCT_ID: string; PRODUCT_NAME?: string; QUANTITY?: string; PRICE?: string }[]>(
      'crm.deal.productrows.get',
      { id: deal.ID },
    )
    console.log(`\n  Mahsulot qatorlari: ${rows.ok ? (rows.result?.length ?? 0) : `✗ ${rows.error}`}`)
    for (const r of (rows.result ?? []).slice(0, 5)) {
      console.log(`    ${String(r.PRODUCT_NAME ?? r.PRODUCT_ID).slice(0, 40).padEnd(42)} x${r.QUANTITY}  ${r.PRICE}`)
    }
    out.sampleProductRows = rows.result
  } else {
    console.log(`  Topilmadi: ${sample.error ?? 'bo‘sh'}`)
  }

  // =========================================================================
  head('E. SEMANTIKA — yutuq/yo‘qotish avtomatik aniqlanadimi?')
  // =========================================================================
  for (const id of SALES_PIPELINES) {
    const counts: Record<string, number> = {}
    for (const sem of ['P', 'S', 'F'] as const) {
      const r = await call('crm.deal.list', {
        filter: { CATEGORY_ID: id, STAGE_SEMANTIC_ID: sem },
        select: ['ID'],
        start: 0,
      })
      counts[sem] = r.total ?? 0
    }
    console.log(
      `  #${String(id).padEnd(3)} ${(PIPELINE_NAMES[id] ?? '').padEnd(20)}` +
        ` jarayonda ${String(counts.P).padStart(7)}` +
        `   yutuq ${String(counts.S).padStart(7)}` +
        `   yo‘qotish ${String(counts.F).padStart(7)}`,
    )
    out[`semantic_${id}`] = counts
  }
  console.log('\n  Agar bu raqamlar mantiqli bo‘lsa — STAGE_SEMANTIC_ID ishonchli,')
  console.log('  100+ bosqichni qo‘lda moslash shart emas.')

  const file = resolve(process.cwd(), 'bitrix24-analysis.json')
  writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
  console.log(`\n  To‘liq natija: ${file}\n`)
}

main().catch((e) => {
  console.error('\n  Xato:', redact(e), '\n')
  process.exit(1)
})
