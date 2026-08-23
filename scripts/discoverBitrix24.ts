/**
 * Bitrix24 portal discovery.
 *
 *     npm run bitrix:discover
 *
 * READ-ONLY. Every call below fetches metadata or a single sample row; nothing
 * is created, updated or deleted. Safe to run against a live portal.
 *
 * WHY THIS EXISTS
 * A Bitrix24 portal is heavily customised — its pipelines, stage IDs and custom
 * fields are specific to one business. `mapping.ts` is deliberately empty
 * rather than pre-filled with plausible guesses, because a wrong-but-plausible
 * mapping imports silently and produces a dashboard that looks authoritative
 * and is wrong. This script replaces the guessing with facts.
 *
 * The webhook token is never printed. Every URL and error message goes through
 * `redact()` before it reaches the console or the report file.
 */

import 'dotenv/config'

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { redact } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL

if (!WEBHOOK) {
  console.error(
    '\nBITRIX24_WEBHOOK_URL is not set in .env.\n' +
      'Paste the inbound webhook URL there first — see docs/BITRIX24.md.\n',
  )
  process.exit(1)
}

const BASE = WEBHOOK.replace(/\/+$/, '') + '/'

/**
 * Bitrix24 throttles at roughly 2 requests/second per portal, and exceeding it
 * can block the portal for its real users. One call every 600 ms keeps us
 * comfortably under without making discovery slow.
 */
const DELAY_MS = 600
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface CallResult<T> {
  ok: boolean
  result?: T
  total?: number
  error?: string
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<CallResult<T>> {
  await sleep(DELAY_MS)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)

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
      return {
        ok: false,
        error: `${payload.error}${payload.error_description ? ` — ${payload.error_description}` : ''}`,
      }
    }

    return { ok: true, result: payload.result, total: payload.total }
  } catch (error) {
    return { ok: false, error: redact(error) }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------

const line = (char = '─') => console.log('  ' + char.repeat(74))
const head = (title: string) => {
  console.log('')
  line('━')
  console.log(`  ${title}`)
  line('━')
}

/** Everything gathered, written to a file so the mapping work has a reference. */
const report: Record<string, unknown> = {}

interface FieldDef {
  type?: string
  title?: string
  listLabel?: string
  formLabel?: string
  isRequired?: boolean
  isReadOnly?: boolean
  isMultiple?: boolean
  items?: { ID: string; VALUE: string }[]
}

function describeFields(fields: Record<string, FieldDef>, filter?: (k: string) => boolean) {
  const keys = Object.keys(fields).filter((k) => (filter ? filter(k) : true)).sort()

  for (const key of keys) {
    const f = fields[key]!
    const label = f.title || f.listLabel || f.formLabel || ''
    const flags = [
      f.type,
      f.isRequired ? 'required' : '',
      f.isMultiple ? 'multiple' : '',
      f.isReadOnly ? 'readonly' : '',
    ]
      .filter(Boolean)
      .join(', ')

    console.log(`    ${key.padEnd(34)} ${String(flags).padEnd(28)} ${label}`)

    // Enumerations matter most: these become our stage/source mappings.
    if (f.items?.length) {
      for (const item of f.items.slice(0, 12)) {
        console.log(`      └ ${String(item.ID).padEnd(28)} ${item.VALUE}`)
      }
      if (f.items.length > 12) console.log(`      └ … +${f.items.length - 12} ta`)
    }
  }
}

async function main() {
  console.log('\n  Bitrix24 portalini o‘qiyapmiz…')
  console.log(`  Portal: ${new URL(BASE).host}`)
  console.log('  (faqat o‘qish — hech narsa o‘zgartirilmaydi)')

  // -- 1. Connection -------------------------------------------------------
  head('1. ULANISH')
  const profile = await call<{ ID: string; NAME?: string; LAST_NAME?: string; ADMIN?: boolean }>('profile')

  if (!profile.ok) {
    console.error(`\n  ✗ Ulanib bo‘lmadi: ${profile.error}\n`)
    console.error('  Tekshiring: webhook URL to‘g‘rimi, ruxsatlar saqlanganmi.\n')
    process.exit(1)
  }

  const me = profile.result!
  console.log(`  ✓ Ulandi — user #${me.ID} ${me.NAME ?? ''} ${me.LAST_NAME ?? ''}`.trimEnd())
  console.log(`    Administrator: ${me.ADMIN ? 'ha' : 'yo‘q'}`)
  report.profile = me

  // -- 2. Scope check ------------------------------------------------------
  head('2. RUXSATLAR')
  const scope = await call<string[]>('scope')
  if (scope.ok && scope.result) {
    const have = scope.result
    report.scope = have
    for (const needed of ['crm', 'user', 'department']) {
      console.log(`  ${have.includes(needed) ? '✓' : '✗'} ${needed}`)
    }
    const extra = have.filter((s) => !['crm', 'user', 'department'].includes(s))
    if (extra.length) console.log(`  ℹ qo‘shimcha: ${extra.join(', ')}`)
  } else {
    console.log(`  ? aniqlab bo‘lmadi: ${scope.error}`)
  }

  // -- 3. Pipelines --------------------------------------------------------
  head('3. VORONKALAR (pipeline)')
  const categories = await call<{ id: number; name: string; isDefault?: string }[]>(
    'crm.category.list',
    { entityTypeId: 2 },
  )

  let pipelines: { id: number; name: string }[] = []

  if (categories.ok) {
    // Newer portals wrap the list in { categories: [...] }.
    const raw = categories.result as unknown as
      | { categories?: { id: number; name: string }[] }
      | { id: number; name: string }[]
    pipelines = Array.isArray(raw) ? raw : (raw?.categories ?? [])
  }

  if (pipelines.length === 0) {
    const legacy = await call<{ ID: string; NAME: string }[]>('crm.dealcategory.list')
    if (legacy.ok && legacy.result) {
      pipelines = legacy.result.map((c) => ({ id: Number(c.ID), name: c.NAME }))
    }
  }

  if (pipelines.length === 0) {
    console.log('  Bitta standart voronka (alohida pipeline sozlanmagan)')
  } else {
    for (const p of pipelines) console.log(`  #${String(p.id).padEnd(4)} ${p.name}`)
    console.log(`\n  Jami: ${pipelines.length} ta voronka`)
    if (pipelines.length > 1) {
      console.log('  ⚠ Bir nechta voronka bor — panelda birlashtiramizmi yoki ajratamizmi?')
    }
  }
  report.pipelines = pipelines

  // -- 4. Stages -----------------------------------------------------------
  head('4. BOSQICHLAR — eng muhim qism')
  console.log('  Qaysi bosqich "yutuq" ekanini SIZ tasdiqlashingiz kerak.')
  console.log('  Butun tushum, konversiya va KPI shunga bog‘liq.\n')

  const stages = await call<{ STATUS_ID: string; NAME: string; ENTITY_ID: string; SORT: string }[]>(
    'crm.status.list',
    { order: { SORT: 'ASC' }, filter: {} },
  )

  if (stages.ok && stages.result) {
    const byEntity = new Map<string, typeof stages.result>()
    for (const s of stages.result) {
      const list = byEntity.get(s.ENTITY_ID) ?? []
      list.push(s)
      byEntity.set(s.ENTITY_ID, list)
    }

    // DEAL_STAGE* are the pipeline stages; SOURCE is the lead source list.
    const interesting = [...byEntity.keys()]
      .filter((k) => k.startsWith('DEAL_STAGE') || k === 'SOURCE' || k === 'STATUS')
      .sort()

    for (const entity of interesting) {
      console.log(`  ${entity}`)
      for (const s of byEntity.get(entity)!) {
        console.log(`    ${s.STATUS_ID.padEnd(28)} ${s.NAME}`)
      }
      console.log('')
    }

    const others = [...byEntity.keys()].filter((k) => !interesting.includes(k))
    if (others.length) console.log(`  (boshqa ro‘yxatlar: ${others.join(', ')})`)

    report.statuses = Object.fromEntries(byEntity)
  } else {
    console.log(`  ✗ ${stages.error}`)
  }

  // -- 5. Deal fields ------------------------------------------------------
  head('5. BITIM MAYDONLARI')
  const dealFields = await call<Record<string, FieldDef>>('crm.deal.fields')

  if (dealFields.ok && dealFields.result) {
    const all = dealFields.result
    report.dealFields = all

    console.log('  Standart maydonlar:\n')
    describeFields(all, (k) => !k.startsWith('UF_'))

    const custom = Object.keys(all).filter((k) => k.startsWith('UF_'))
    if (custom.length) {
      console.log(`\n  Maxsus maydonlar (UF_*) — ${custom.length} ta:\n`)
      describeFields(all, (k) => k.startsWith('UF_'))
      console.log('\n  ⚠ To‘lov/qarz shu maxsus maydonlarda yuritilishi mumkin.')
    } else {
      console.log('\n  Maxsus maydon yo‘q.')
    }
  } else {
    console.log(`  ✗ ${dealFields.error}`)
  }

  // -- 6. Volume -----------------------------------------------------------
  head('6. HAJM')
  for (const [label, method] of [
    ['Bitimlar', 'crm.deal.list'],
    ['Kompaniyalar', 'crm.company.list'],
    ['Kontaktlar', 'crm.contact.list'],
    ['Mahsulotlar', 'crm.product.list'],
  ] as const) {
    const res = await call(method, { select: ['ID'], start: 0 })
    console.log(
      `  ${label.padEnd(16)} ${res.ok ? (res.total ?? '?') : `✗ ${res.error}`}`,
    )
    report[`count_${method}`] = res.ok ? res.total : null
  }

  // -- 7. Sample deal ------------------------------------------------------
  head('7. NAMUNA BITIM (bitta yozuv)')
  const sample = await call<Record<string, unknown>[]>('crm.deal.list', {
    select: ['*', 'UF_*'],
    order: { ID: 'DESC' },
    start: 0,
  })

  if (sample.ok && sample.result?.length) {
    const deal = sample.result[0]!
    report.sampleDeal = deal

    // Values are truncated: this is real customer data on a real portal.
    for (const [key, value] of Object.entries(deal)) {
      if (value === null || value === '' || value === undefined) continue
      const shown = String(value).slice(0, 46)
      console.log(`    ${key.padEnd(34)} ${shown}`)
    }

    // -- 8. Product rows ---------------------------------------------------
    head('8. MAHSULOT QATORLARI')
    const rows = await call<unknown[]>('crm.deal.productrows.get', { id: deal.ID })
    if (rows.ok) {
      const n = rows.result?.length ?? 0
      console.log(`  Namuna bitimda ${n} ta mahsulot qatori`)
      if (n === 0) {
        console.log('  ⚠ Bo‘sh. Agar mahsulotlar izchil to‘ldirilmasa,')
        console.log('    mahsulot tahlili chala bo‘ladi — buni oldindan bilgan ma‘qul.')
      } else {
        console.log(`  ${JSON.stringify(rows.result?.[0]).slice(0, 160)}`)
      }
      report.sampleProductRows = rows.result
    } else {
      console.log(`  ✗ ${rows.error}`)
    }
  } else {
    console.log(`  Bitim topilmadi yoki xato: ${sample.error ?? 'bo‘sh'}`)
  }

  // -- 9. Users and departments -------------------------------------------
  head('9. XODIMLAR VA BO‘LIMLAR')
  const users = await call<{ ID: string; NAME?: string; LAST_NAME?: string; ACTIVE?: boolean }[]>(
    'user.get',
    { ACTIVE: true },
  )
  if (users.ok) {
    console.log(`  Faol xodimlar: ${users.total ?? users.result?.length ?? 0}`)
    for (const u of (users.result ?? []).slice(0, 5)) {
      console.log(`    #${String(u.ID).padEnd(6)} ${u.NAME ?? ''} ${u.LAST_NAME ?? ''}`.trimEnd())
    }
    if ((users.result?.length ?? 0) > 5) console.log('    …')
    report.userCount = users.total
  } else {
    console.log(`  ✗ user.get: ${users.error}`)
  }

  const departments = await call<{ ID: string; NAME: string; PARENT?: string }[]>('department.get')
  if (departments.ok) {
    console.log(`\n  Bo‘limlar: ${departments.total ?? departments.result?.length ?? 0}`)
    for (const d of (departments.result ?? []).slice(0, 10)) {
      console.log(`    #${String(d.ID).padEnd(6)} ${d.NAME}${d.PARENT ? `  (ota: ${d.PARENT})` : ''}`)
    }
    report.departments = departments.result
  } else {
    console.log(`  ✗ department.get: ${departments.error}`)
  }

  // -- Save ----------------------------------------------------------------
  const out = resolve(process.cwd(), 'bitrix24-discovery.json')
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')

  head('TUGADI')
  console.log(`  To‘liq natija: ${out}`)
  console.log('  (bu fayl .gitignore da — mijoz ma‘lumoti bor)\n')
  console.log('  Keyingi qadam: yuqoridagi bosqichlar ro‘yxatiga qarab,')
  console.log('  qaysi bosqich YUTUQ va qaysi biri YO‘QOTISH ekanini ayting.\n')
}

main().catch((error) => {
  console.error('\n  Xato:', redact(error), '\n')
  process.exit(1)
})
