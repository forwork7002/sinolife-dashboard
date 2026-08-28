/**
 * Roistat (marketing) import — the published dashboard → Postgres.
 *
 *     npm run roistat:import                 fetch the live page and import
 *     npm run roistat:import -- --dry-run    fetch, validate, report, write nothing
 *     npm run roistat:import -- --file p.html   read a saved copy instead of the network
 *     npm run roistat:import -- --force      import despite the shrink guard
 *
 * WHY THIS SCRIPT EXISTS AT ALL
 * The marketing numbers are not in Bitrix24. A live probe of the portal found
 * no Roistat fields, sources, apps or smart processes: the client's ad spend,
 * leads and buyout rates live in their own Google Sheets (working + archive)
 * plus Meta Ads, and the only machine-readable form of them is a `var D = {…}`
 * literal inside a 5.5 MB static page on GitHub Pages. There is no API to call
 * and no webhook to subscribe to. So we copy the blob, verbatim, and keep it in
 * its own two tables that touch nothing Bitrix24 owns.
 *
 * HOW THE BLOB IS FOUND
 * By brace matching, not by regular expression. The page is one 5.5 MB line
 * with the data literal followed by ~14 KB of application code; a greedy `.*`
 * would swallow the code, a lazy one would stop at the first `}` inside the
 * first row. The scanner below walks forward from the opening brace counting
 * depth and skipping over string literals (so a `}` inside a campaign name
 * cannot end the object early), which is O(n) over the page and exact.
 *
 * WHAT MAKES IT SAFE TO RE-RUN
 * Three things, in order of how much damage they prevent:
 *   1. A blob that parses but is empty, or missing a dimension, or carrying a
 *      non-positive rate, is REFUSED before the transaction opens. Silently
 *      importing nothing would empty the module and look like a quiet day.
 *   2. A blob carrying a small fraction of what is already stored is refused
 *      too, unless --force. A truncated publish is far likelier than the
 *      client deleting nine tenths of their history.
 *   3. Writes happen in ONE transaction, and per dimension they replace only
 *      the date range that dimension actually covers. The dimensions do not
 *      share a range — camp/adset/creative/days run to the blob's `today`,
 *      the sheet-fed ones stop days earlier — so a global delete would throw
 *      away days that only the longer dimensions hold.
 *
 * The report ends with a content digest per dimension, computed in Postgres
 * over the stored rows. Running the script twice must print the same digests
 * and a diff of zeroes: that is the idempotency claim, checked rather than
 * asserted.
 */

import 'dotenv/config'

import { readFile } from 'node:fs/promises'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { z } from 'zod'

import { PrismaClient } from '../src/generated/prisma/client'
import type { MarketingDimension } from '../src/generated/prisma/enums'
import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

// ---------------------------------------------------------------------------
// Configuration
//
// A constant with an environment override, read here rather than added to
// src/server/config/env.ts: that module is the contract for what the SERVER
// needs to boot, and the dashboard boots perfectly well without ever knowing
// this URL. Only the importer needs it.
// ---------------------------------------------------------------------------

const DEFAULT_SOURCE_URL = 'https://rustamov0277-cmd.github.io/roistat/'
const SOURCE_URL = process.env.ROISTAT_SOURCE_URL?.trim() || DEFAULT_SOURCE_URL

/** One published dashboard, one snapshot row. */
const SNAPSHOT_ID = 'roistat'

/**
 * Floor for "this blob is not degenerate". The real one carries ~24 500 rows
 * across twelve dimensions; anything under a few hundred is a publish that
 * went wrong, not a quiet month.
 */
const MIN_TOTAL_ROWS = 500

/**
 * Refuse a blob holding less than this share of what is already stored.
 * A half-written publish is the failure mode this catches — and --force is
 * the escape hatch for the day the client really does prune their sheet.
 */
const SHRINK_GUARD = 0.5

/** Rows per INSERT. 21 columns × 1000 stays well under Postgres' 65 535 parameters. */
const CHUNK = 1000

/** HTTP read budget. The page is 5.5 MB over a CDN; ten seconds is typical. */
const FETCH_TIMEOUT_MS = 120_000

/**
 * The source's own tab ids, in the order the dashboard shows them, mapped onto
 * our enum. Lowercase the enum value and you have the id back — the mapping is
 * case-only by design, so the module's `?dimension=camp` needs no lookup table.
 */
const DIMENSIONS: ReadonlyArray<readonly [string, MarketingDimension]> = [
  ['camp', 'CAMP'],
  ['adset', 'ADSET'],
  ['creative', 'CREATIVE'],
  ['targetolog', 'TARGETOLOG'],
  ['form', 'FORM'],
  ['source', 'SOURCE'],
  ['product', 'PRODUCT'],
  ['region', 'REGION'],
  ['rop', 'ROP'],
  ['seller', 'SELLER'],
  ['registrator', 'REGISTRATOR'],
  ['days', 'DAYS'],
]

// ---------------------------------------------------------------------------
// Blob extraction
// ---------------------------------------------------------------------------

/**
 * Slice the `var D = {…}` object literal out of the page.
 *
 * Walks forward from the opening brace tracking nesting depth, with a string
 * state machine so braces and escaped quotes inside campaign names ("EX - TOF
 * - Collagen - IF (ABO)") cannot terminate the scan. Returns the exact JSON
 * text; the caller parses it.
 */
function extractBlob(html: string): string {
  const opener = /var\s+D\s*=\s*\{/.exec(html)
  if (!opener) {
    throw new Error(
      'No `var D = {` found in the page. Either the publish failed or the ' +
        'dashboard was rewritten — check the source URL in a browser before ' +
        'changing this script.',
    )
  }

  const start = opener.index + opener[0].length - 1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < html.length; i += 1) {
    const c = html[i]

    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }

    if (c === '"') inString = true
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return html.slice(start, i + 1)
    }
  }

  throw new Error(
    'The `var D = {` object never closes — the page is truncated. ' +
      `Read ${html.length} characters and never came back to depth 0.`,
  )
}

// ---------------------------------------------------------------------------
// Validation
//
// Strict about identity (dates, keys), forgiving about absent counters — which
// is exactly what the source page itself does: its aggregator reads every
// metric as `row[field] || 0`. Anything else is a hard failure, because a
// malformed blob that imports as zeroes is worse than one that does not import.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const RU_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/

const isoDate = z.string().regex(ISO_DATE, 'expected an ISO YYYY-MM-DD date')

/** A non-negative finite count. Absent means zero, like the source's own reader. */
const counter = z
  .number()
  .finite()
  .nonnegative()
  .optional()
  .default(0)

const rowSchema = z.object({
  d: isoDate,
  k: z.string().min(1, 'a dimension value may not be empty'),
  p: z.string().optional().default(''),
  leads: counter,
  clean: counter,
  kval: counter,
  spend: counter,
  orders: counter,
  fact1: counter,
  fact2: counter,
  sold: counter,
  newc: counter,
  dsum: counter,
  dcnt: counter,
  mrev: counter,
  impr: counter,
  reach: counter,
  clicks: counter,
  mleads: counter,
})

const blobSchema = z.object({
  dims: z.record(z.string(), z.array(rowSchema)),
  tabs: z.array(z.object({ id: z.string(), label: z.string(), parent: z.string().nullable() })),
  rate: z.number().positive('the USD rate must be greater than zero'),
  rateDate: z.string().regex(RU_DATE, 'expected DD.MM.YYYY'),
  updated: z.string().min(1),
  today: isoDate,
  minDate: isoDate,
  maxDate: isoDate,
  dailyFrom: isoDate,
  freshFrom: isoDate,
})

type Blob = z.infer<typeof blobSchema>
type Row = z.infer<typeof rowSchema>

/**
 * The checks zod cannot express: cross-field consistency and non-degeneracy.
 * Every one of these has a failure it prevents named in its message, because
 * the person reading it at 2am will not have this file open.
 */
function assertUsable(blob: Blob): void {
  const problems: string[] = []

  if (blob.minDate > blob.maxDate) {
    problems.push(`minDate ${blob.minDate} is after maxDate ${blob.maxDate}`)
  }

  let total = 0
  for (const [id] of DIMENSIONS) {
    const rows = blob.dims[id]
    if (!rows) {
      problems.push(`dimension "${id}" is missing from D.dims`)
      continue
    }
    if (rows.length === 0) {
      problems.push(`dimension "${id}" is present but empty`)
      continue
    }
    total += rows.length
  }

  if (total < MIN_TOTAL_ROWS) {
    problems.push(
      `only ${total} rows across all dimensions — the published dashboard ` +
        `normally carries tens of thousands, so this looks like a truncated publish`,
    )
  }

  const unknown = Object.keys(blob.dims).filter(
    (id) => !DIMENSIONS.some(([known]) => known === id),
  )
  if (unknown.length > 0) {
    // Not fatal: a new dimension is new data, not broken data. But it is
    // dropped on the floor until someone adds it to the enum, so it must be
    // impossible to miss.
    console.warn(
      `\n  ! Manbada notanish oʻlchov(lar): ${unknown.join(', ')} — import qilinmaydi.` +
        `\n    Qoʻshish uchun: prisma/schema.prisma → MarketingDimension + DIMENSIONS.\n`,
    )
  }

  if (problems.length > 0) {
    throw new Error(
      'The blob parsed but is not usable:\n' + problems.map((p) => `      - ${p}`).join('\n'),
    )
  }
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * A bare calendar day as a UTC-midnight Date, which is what a `@db.Date`
 * column wants. Constructed from the parts rather than parsed from the string
 * so the machine's own timezone can never shift the day.
 */
function day(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function ruDay(value: string): Date {
  const m = RU_DATE.exec(value)
  if (!m) throw new Error(`Not a DD.MM.YYYY date: ${value}`)
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
}

/**
 * Money and large counters into integers, with the rounding stated once.
 *
 * `scale` is where the unit lives: 1e6 for USD micro, 100 for UZS minor, 1 for
 * counts. Math.round rather than a cast because the source is JSON floats —
 * 80.36 × 1e6 is 80359999.99999999 in IEEE 754, and truncating it would lose a
 * cent per row and several dollars per import.
 */
function scaled(value: number, scale: number): bigint {
  return BigInt(Math.round(value * scale))
}

function toRecord(dimension: MarketingDimension, row: Row) {
  return {
    dimension,
    date: day(row.d),
    key: row.k,
    parent: row.p,
    leads: Math.round(row.leads),
    clean: Math.round(row.clean),
    kval: Math.round(row.kval),
    orders: Math.round(row.orders),
    sold: Math.round(row.sold),
    newCustomers: Math.round(row.newc),
    // USD → micro dollars; UZS → minor soʻm. Never the other way round.
    spendMicroUsd: scaled(row.spend, 1_000_000),
    orderedMinor: scaled(row.fact1, 100),
    soldMinor: scaled(row.fact2, 100),
    metaRevenueMinor: scaled(row.mrev, 100),
    dealDaysSum: Math.round(row.dsum),
    dealCount: Math.round(row.dcnt),
    impressions: scaled(row.impr, 1),
    reach: scaled(row.reach, 1),
    clicks: scaled(row.clicks, 1),
    metaLeads: Math.round(row.mleads),
  }
}

// ---------------------------------------------------------------------------
// State snapshots — what the diff and the idempotency proof are built from
// ---------------------------------------------------------------------------

interface DimensionState {
  dimension: string
  rows: number
  minDate: string | null
  maxDate: string | null
  leads: string
  sold: string
  spend: string
  revenue: string
  digest: string
}

/**
 * Per-dimension totals plus an md5 over the stored rows.
 *
 * The digest is the honest form of "running it twice changes nothing": row ids
 * are cuids and are regenerated on every replace, so comparing ids would report
 * a change that is not one. Comparing the CONTENT — every column of every row,
 * ordered — reports the thing we actually promise.
 */
async function readState(prisma: PrismaClient): Promise<DimensionState[]> {
  return prisma.$queryRawUnsafe<DimensionState[]>(`
    SELECT
      "dimension"::text                     AS "dimension",
      count(*)::int                         AS "rows",
      min("date")::text                     AS "minDate",
      max("date")::text                     AS "maxDate",
      sum("leads")::text                    AS "leads",
      sum("sold")::text                     AS "sold",
      sum("spendMicroUsd")::text            AS "spend",
      sum("soldMinor")::text                AS "revenue",
      md5(string_agg(
        concat_ws('|', "date"::text, "key", "parent",
          "leads", "clean", "kval", "orders", "sold", "newCustomers",
          "spendMicroUsd", "orderedMinor", "soldMinor", "metaRevenueMinor",
          "dealDaysSum", "dealCount", "impressions", "reach", "clicks", "metaLeads"),
        E'\\n' ORDER BY "date", "key", "parent"))  AS "digest"
    FROM "marketing_daily"
    GROUP BY 1
    ORDER BY 1
  `)
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const RULE = '  ' + '─'.repeat(96)

function head(title: string): void {
  console.log('')
  console.log('  ' + '━'.repeat(96))
  console.log(`  ${title}`)
  console.log('  ' + '━'.repeat(96))
}

/** Thin-space grouping, the way every number on the dashboard is printed. */
function group(value: bigint | number): string {
  const negative = value < 0
  const digits = (negative ? -value : value).toString()
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ' '
    out += digits[i]
  }
  return (negative ? '-' : '') + out
}

/** USD micro units as dollars with cents. */
function usd(micro: bigint): string {
  const negative = micro < 0n
  const abs = negative ? -micro : micro
  const whole = abs / 1_000_000n
  const cents = (abs % 1_000_000n) / 10_000n
  return `${negative ? '-' : ''}${group(whole)}.${cents.toString().padStart(2, '0')}`
}

/** UZS minor units as whole soʻm — tiyin never appear on a marketing screen. */
function uzs(minor: bigint): string {
  return group(minor / 100n)
}

function signed(value: bigint, format: (v: bigint) => string): string {
  if (value === 0n) return '·'
  return (value > 0n ? '+' : '') + (value < 0n ? '-' + format(-value) : format(value))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const FORCE = args.has('--force')
const fileFlag = process.argv.indexOf('--file')
const FROM_FILE = fileFlag >= 0 ? process.argv[fileFlag + 1] : undefined

async function loadPage(): Promise<{ text: string; origin: string }> {
  if (FROM_FILE) {
    return { text: await readFile(FROM_FILE, 'utf8'), origin: `file://${FROM_FILE}` }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(SOURCE_URL, {
      signal: controller.signal,
      // The page is regenerated by the client's script; a CDN copy from this
      // morning would import as "fresh" while carrying yesterday's spend.
      headers: { 'cache-control': 'no-cache' },
    })
    if (!response.ok) {
      throw new Error(`${SOURCE_URL} answered ${response.status} ${response.statusText}`)
    }
    return { text: await response.text(), origin: SOURCE_URL }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const started = Date.now()

  head(`ROISTAT IMPORT${DRY_RUN ? ' — DRY RUN (hech narsa yozilmaydi)' : ''}`)
  console.log(`  Manba     : ${FROM_FILE ?? SOURCE_URL}`)

  const { text, origin } = await loadPage()
  const json = extractBlob(text)
  console.log(`  Sahifa    : ${group(text.length)} belgi · blob ${group(json.length)} belgi`)

  const parsed = blobSchema.safeParse(JSON.parse(json))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 12)
      .map((i) => `      - ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(
      `The blob failed validation (${parsed.error.issues.length} issue(s)):\n` + issues.join('\n'),
    )
  }
  const blob = parsed.data
  assertUsable(blob)

  console.log(`  Yangilangan: ${blob.updated}  (manbaning oʻz vaqti, mintaqasiz)`)
  console.log(
    `  Kurs      : ${blob.rate.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} soʻm/$ · ${blob.rateDate}`,
  )
  console.log(
    `  Davr      : ${blob.minDate} … ${blob.maxDate}` +
      `  ·  today ${blob.today}  ·  dailyFrom ${blob.dailyFrom}  ·  freshFrom ${blob.freshFrom}`,
  )

  // ---- Shape the rows before touching the database -------------------------
  const batches = DIMENSIONS.map(([id, dimension]) => {
    const rows = blob.dims[id] ?? []
    const dates = rows.map((r) => r.d)
    return {
      id,
      dimension,
      from: dates.reduce((a, b) => (a < b ? a : b)),
      to: dates.reduce((a, b) => (a > b ? a : b)),
      records: rows.map((r) => toRecord(dimension, r)),
    }
  })
  const totalRows = batches.reduce((sum, b) => sum + b.records.length, 0)

  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('DATABASE_URL .env da yoʻq.')

  const pool = new Pool(poolConfig(DATABASE_URL, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const before = await readState(prisma)
    const storedRows = before.reduce((sum, s) => sum + s.rows, 0)

    if (storedRows > 0 && totalRows < storedRows * SHRINK_GUARD && !FORCE) {
      throw new Error(
        `The blob carries ${group(totalRows)} rows but the database already holds ` +
          `${group(storedRows)}. That is a ${Math.round((1 - totalRows / storedRows) * 100)}% drop, ` +
          `which is far more likely to be a truncated publish than a real change.\n` +
          `      Re-run with --force if the source really did shrink.`,
      )
    }

    // ---- Coverage table ----------------------------------------------------
    head('OʻLCHOVLAR')
    console.log(
      '  ' +
        'dimension'.padEnd(13) +
        'rows'.padStart(7) +
        'keys'.padStart(7) +
        '  ' +
        'date range'.padEnd(24) +
        'leads'.padStart(8) +
        'sold'.padStart(8) +
        'spend $'.padStart(13) +
        'tushum soʻm'.padStart(18),
    )
    console.log(RULE)
    for (const batch of batches) {
      // Distinct VALUES, not distinct (value, parent) pairs: the same adset
      // can sit under two campaigns in the sheet, and the tab lists it once.
      const keys = new Set(batch.records.map((r) => r.key)).size
      let leads = 0
      let sold = 0
      let spend = 0n
      let revenue = 0n
      for (const r of batch.records) {
        leads += r.leads
        sold += r.sold
        spend += r.spendMicroUsd
        revenue += r.soldMinor
      }
      console.log(
        '  ' +
          batch.id.padEnd(13) +
          group(batch.records.length).padStart(7) +
          group(keys).padStart(7) +
          '  ' +
          `${batch.from} … ${batch.to}`.padEnd(24) +
          group(leads).padStart(8) +
          group(sold).padStart(8) +
          usd(spend).padStart(13) +
          uzs(revenue).padStart(18),
      )
    }
    console.log(RULE)
    console.log(`  ${group(totalRows)} qator jami.`)
    console.log(
      '  Eslatma: oʻlchovlar bir xil faktlarning parallel kesimlari — ularni qoʻshib boʻlmaydi.\n' +
        '           product/region/rop da lid va xarajat yoʻq (manbada ham), registrator da sotuv yoʻq.',
    )

    if (DRY_RUN) {
      head('DRY RUN — hech narsa yozilmadi')
      return
    }

    // ---- The one transaction ------------------------------------------------
    await prisma.$transaction(
      async (tx) => {
        for (const batch of batches) {
          // Only this dimension's own covered range. A global delete would
          // drop the days that camp/adset/creative/days hold beyond the
          // sheet-fed dimensions' last day.
          await tx.marketingDaily.deleteMany({
            where: { dimension: batch.dimension, date: { gte: day(batch.from), lte: day(batch.to) } },
          })
          for (let i = 0; i < batch.records.length; i += CHUNK) {
            await tx.marketingDaily.createMany({ data: batch.records.slice(i, i + CHUNK) })
          }
        }

        const snapshot = {
          sourceUrl: origin,
          usdRateMicro: scaled(blob.rate, 1_000_000),
          rateDate: ruDay(blob.rateDate),
          updatedLabel: blob.updated,
          today: day(blob.today),
          minDate: day(blob.minDate),
          maxDate: day(blob.maxDate),
          dailyFrom: day(blob.dailyFrom),
          freshFrom: day(blob.freshFrom),
          importedAt: new Date(),
          rowCount: totalRows,
        }
        await tx.marketingSnapshot.upsert({
          where: { id: SNAPSHOT_ID },
          create: { id: SNAPSHOT_ID, ...snapshot },
          update: snapshot,
        })
      },
      { maxWait: 15_000, timeout: 300_000 },
    )

    // ---- Previous vs new ----------------------------------------------------
    const after = await readState(prisma)
    const byDimension = new Map(before.map((s) => [s.dimension, s]))

    head('OLDINGI HOLAT BILAN FARQ')
    console.log(
      '  ' +
        'dimension'.padEnd(13) +
        'rows'.padStart(8) +
        'Δ rows'.padStart(9) +
        'Δ leads'.padStart(10) +
        'Δ sold'.padStart(9) +
        'Δ spend $'.padStart(14) +
        'Δ tushum soʻm'.padStart(18) +
        '  digest',
    )
    console.log(RULE)

    let changed = 0
    for (const state of after) {
      const prev = byDimension.get(state.dimension)
      const dRows = state.rows - (prev?.rows ?? 0)
      const dLeads = BigInt(state.leads ?? 0) - BigInt(prev?.leads ?? 0)
      const dSold = BigInt(state.sold ?? 0) - BigInt(prev?.sold ?? 0)
      const dSpend = BigInt(state.spend ?? 0) - BigInt(prev?.spend ?? 0)
      const dRevenue = BigInt(state.revenue ?? 0) - BigInt(prev?.revenue ?? 0)
      const same = prev !== undefined && prev.digest === state.digest
      if (!same) changed += 1

      console.log(
        '  ' +
          state.dimension.toLowerCase().padEnd(13) +
          group(state.rows).padStart(8) +
          (dRows === 0 ? '·' : (dRows > 0 ? '+' : '') + group(dRows)).padStart(9) +
          signed(dLeads, group).padStart(10) +
          signed(dSold, group).padStart(9) +
          signed(dSpend, usd).padStart(14) +
          signed(dRevenue, uzs).padStart(18) +
          `  ${state.digest.slice(0, 8)} ${same ? '=' : '≠'}`,
      )
    }
    console.log(RULE)

    if (changed === 0) {
      console.log('  ✓ Hech narsa oʻzgarmadi — import idempotent (barcha digest bir xil).')
    } else {
      console.log(
        `  ${changed} ta oʻlchov oʻzgardi` +
          (before.length === 0 ? ' (birinchi import).' : ' — manbada yangi maʼlumot bor.'),
      )
    }

    const snapshot = await prisma.marketingSnapshot.findUniqueOrThrow({ where: { id: SNAPSHOT_ID } })
    head('SNAPSHOT')
    console.log(`  id           : ${snapshot.id}`)
    console.log(`  sourceUrl    : ${snapshot.sourceUrl}`)
    console.log(
      `  usdRateMicro : ${group(snapshot.usdRateMicro)}  (= ${(Number(snapshot.usdRateMicro) / 1e6).toFixed(2)} soʻm/$)`,
    )
    console.log(`  rateDate     : ${snapshot.rateDate.toISOString().slice(0, 10)}`)
    console.log(`  updatedLabel : ${snapshot.updatedLabel}`)
    console.log(
      `  today/min/max: ${snapshot.today.toISOString().slice(0, 10)} / ` +
        `${snapshot.minDate.toISOString().slice(0, 10)} / ${snapshot.maxDate.toISOString().slice(0, 10)}`,
    )
    console.log(
      `  dailyFrom    : ${snapshot.dailyFrom.toISOString().slice(0, 10)}` +
        `   freshFrom: ${snapshot.freshFrom.toISOString().slice(0, 10)}`,
    )
    console.log(`  rowCount     : ${group(snapshot.rowCount)}`)
    console.log(`  importedAt   : ${snapshot.importedAt.toISOString()}`)

    console.log(`\n  Tugadi — ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(`\n  ✗ IMPORT TOʻXTADI\n\n      ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
