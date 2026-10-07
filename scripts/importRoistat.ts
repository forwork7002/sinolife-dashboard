/**
 * Roistat (marketing) import — the published dashboard's USD rate → Postgres.
 *
 * SINCE 2026-10-07 IT WRITES ONE ROW: `marketing_snapshot`, whose UZS/USD rate
 * «Target tahlili» reads for ROAS. The ~24 500 `marketing_daily` rows it used
 * to replace every hour had no reader left, and the hourly delete + insert in
 * one long transaction was load on the one-core database for nothing — see
 * `roistatSnapshot.ts`. The table and its rows are kept, frozen as of the last
 * import that wrote them. The blob is still fetched and validated in full, so
 * a degenerate publish cannot hand /target a rate.
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
 * and no webhook to subscribe to. So we read the blob and keep what is still
 * used of it in its own table, which touches nothing Bitrix24 owns.
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
 *   1. A blob that parses but is empty, or missing a dimension, or carrying a
 *      non-positive rate, is REFUSED before anything is written.
 *   2. A blob carrying a small fraction of the rows the last import's blob
 *      carried is refused too, unless --force (`SHRINK_GUARD`). A truncated
 *      publish is far likelier than the client deleting nine tenths of their
 *      history.
 *   3. The write is one upsert of one row, so running it twice leaves the
 *      same row.
 */

import 'dotenv/config'

import { readFile } from 'node:fs/promises'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { z } from 'zod'

import { PrismaClient } from '../src/generated/prisma/client'
import type { MarketingDimension } from '../src/generated/prisma/enums'
import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'
import { SNAPSHOT_ID, saveSnapshot } from './roistatSnapshot'

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

/**
 * Floor for "this blob is not degenerate". The real one carries ~24 500 rows
 * across twelve dimensions; anything under a few hundred is a publish that
 * went wrong, not a quiet month.
 */
const MIN_TOTAL_ROWS = 500

/** HTTP read budget. The page is 5.5 MB over a CDN; ten seconds is typical. */
const FETCH_TIMEOUT_MS = 120_000

/**
 * The source's own tab ids, in the order the dashboard shows them, mapped onto
 * our enum. Every one must be present and non-empty (`assertUsable`) — that is
 * the evidence the publish is whole, and the rate with it.
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
// Reporting
// ---------------------------------------------------------------------------

const RULE = '  ' + '─'.repeat(40)

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

  // ---- What the blob carries, per dimension (nothing of it is stored) -------
  const counts = DIMENSIONS.map(([id]) => ({ id, rows: blob.dims[id]?.length ?? 0 }))
  const totalRows = counts.reduce((sum, c) => sum + c.rows, 0)

  head('OʻLCHOVLAR (faqat tekshiruv uchun — marketing_daily ga yozilmaydi)')
  for (const c of counts) console.log('  ' + c.id.padEnd(13) + group(c.rows).padStart(8))
  console.log(RULE)
  console.log(`  ${group(totalRows)} qator jami.`)

  if (DRY_RUN) {
    head('DRY RUN — hech narsa yozilmadi')
    return
  }

  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('DATABASE_URL .env da yoʻq.')

  /*
    ONE connection. The sync worker spawns this as a child process, so its pool
    is invisible to the worker's own budget and draws on the managed cluster's
    connection ceiling alongside the web service; two statements need one.
  */
  const pool = new Pool(poolConfig(DATABASE_URL, { caCert: caCertFromEnv(), max: 1 }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const snapshot = await saveSnapshot(prisma, blob, origin, totalRows, {
      force: FORCE,
      now: new Date(),
    })

    head('SNAPSHOT')
    console.log(`  id           : ${SNAPSHOT_ID}`)
    console.log(`  sourceUrl    : ${snapshot.sourceUrl}`)
    console.log(
      `  usdRateMicro : ${group(snapshot.usdRateMicro)}  (= ${(Number(snapshot.usdRateMicro) / 1e6).toFixed(2)} soʻm/$)`,
    )
    console.log(`  rateDate     : ${snapshot.rateDate.toISOString().slice(0, 10)}`)
    console.log(`  updatedLabel : ${snapshot.updatedLabel}`)
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
