/**
 * Roistat vs Bitrix24 — the cross-check.
 *
 *     npm run roistat:verify              the standard report
 *     npm run roistat:verify -- --full    every key, not just the top rows
 *     npm run roistat:verify -- --top 25  how many rows per section (default 12)
 *
 * READ-ONLY. Every statement runs inside one `SET TRANSACTION READ ONLY`
 * transaction, so a mistake in this file cannot write to the database even if
 * someone adds an UPDATE to it by accident. Postgres refuses it.
 *
 * WHAT THIS IS FOR
 * Two systems measure overlapping things. Bitrix24 holds the deals; the
 * Roistat blob holds the client's own sheet of leads, spend and collected
 * money. The requirement is not that they agree — they cannot, and the reasons
 * are listed at the bottom of the report — but that we can say by HOW MUCH
 * they disagree, on which keys, and why. A dashboard that quietly picks one of
 * the two is the failure this script exists to prevent.
 *
 * THE COMPARISON BASIS, WHICH IS THE WHOLE DIFFICULTY
 * Roistat attributes money to the LEAD's date ("Выручка привязана к дате
 * лида", printed in the footer of their own page). Bitrix24 books a won deal
 * on its CLOSE date. Comparing Roistat against won-by-close-date would show a
 * divergence that is pure definition, so the primary comparison here uses
 * Bitrix deals bucketed by `createdAtSource` — the closest thing the portal has
 * to a lead date — and the close-date total is printed beside it so the size of
 * the definitional gap is visible rather than assumed.
 *
 * KEY MATCHING
 * The Roistat keys were typed into a spreadsheet by hand; the Bitrix24 names
 * come from the portal. Three rules are tried in order, and the report says
 * which one matched each pair and lists every key that matched nothing on
 * EITHER side:
 *   1. exact  — after trimming, collapsing whitespace, casefolding and
 *               normalising the five apostrophe characters that Uzbek names
 *               get typed with (ʻ ʼ ' ` ´) onto one.
 *   2. tokens — the same normalisation, then the words sorted. This is what
 *               matches "Latofat Dostonova 213" to "Dostonova 213 Latofat";
 *               the portal and the sheet order surname and given name
 *               differently and neither is wrong.
 *   3. code   — the standalone 2–4 digit employee number both sides carry
 *               inside seller names. Only used when exactly one key on each
 *               side holds that number, so an ambiguous code matches nothing.
 * Nothing fuzzier than that. Edit distance would start inventing matches, and
 * an invented match is worse than an honest "unmatched" line.
 */

import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'

/** Asia/Tashkent, like every other bucketed figure in the application. */
const TZ = 'Asia/Tashkent'

const SNAPSHOT_ID = 'roistat'

const args = process.argv.slice(2)
const FULL = args.includes('--full')
const topFlag = args.indexOf('--top')
const TOP = topFlag >= 0 ? Math.max(1, Number(args[topFlag + 1]) || 12) : 12

/**
 * The strings the source sheet uses for "no value". They are not keys, they
 * are the sheet's own em dash, and they line up with a NULL on the Bitrix side.
 */
const UNSET = new Set(['— не указано —', '— не передан —', '', '-', '—'])
const UNATTRIBUTED = '(koʻrsatilmagan)'

// ---------------------------------------------------------------------------
// Formatting — em dash for unknown, never zero. House rule.
// ---------------------------------------------------------------------------

const DASH = '—'
const RULE = (n = 132) => '  ' + '─'.repeat(n)

function head(title: string): void {
  console.log('')
  console.log('  ' + '━'.repeat(132))
  console.log(`  ${title}`)
  console.log('  ' + '━'.repeat(132))
}

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

/** UZS minor units as whole soʻm. */
function uzs(minor: bigint): string {
  return group(minor / 100n)
}

function signedUzs(minor: bigint): string {
  return (minor > 0n ? '+' : '') + uzs(minor)
}

function signedInt(value: number): string {
  return (value > 0 ? '+' : '') + group(value)
}

/**
 * Relative difference of `b` against `a`, in percent.
 *
 * Null — rendered as an em dash — when `a` is zero. There is no percentage
 * difference from nothing, and printing 0% or ∞ there would be a claim we
 * cannot support.
 */
function pct(a: bigint | number, b: bigint | number): string {
  const from = Number(a)
  const to = Number(b)
  if (from === 0) return DASH
  const value = ((to - from) / Math.abs(from)) * 100
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function trunc(value: string, width: number): string {
  return value.length <= width ? value.padEnd(width) : value.slice(0, width - 1) + '…'
}

// ---------------------------------------------------------------------------
// Key normalisation and matching
// ---------------------------------------------------------------------------

/** ʻ U+02BB · ʼ U+02BC · ‘ U+2018 · ’ U+2019 · ` U+0060 · ´ U+00B4 · ' U+0027 */
const APOSTROPHES = /[ʻʼ‘’`´']/g

function normalise(value: string): string {
  return value.replace(APOSTROPHES, "'").replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Words sorted, so surname-first and given-name-first collapse together. */
function tokenSignature(value: string): string {
  return normalise(value).split(' ').filter(Boolean).sort().join(' ')
}

/** The standalone 2–4 digit employee number, when there is exactly one. */
function employeeCode(value: string): string | null {
  const codes = normalise(value)
    .split(' ')
    .filter((t) => /^\d{2,4}$/.test(t))
  return codes.length === 1 ? codes[0] : null
}

type MatchRule = 'exact' | 'tokens' | 'code'

interface Matched {
  left: string
  right: string
  rule: MatchRule
}

interface MatchResult {
  matched: Matched[]
  unmatchedLeft: string[]
  unmatchedRight: string[]
}

/** Index a side by a derived signature, keeping only unambiguous entries. */
function index(keys: string[], of: (key: string) => string | null): Map<string, string> {
  const buckets = new Map<string, string[]>()
  for (const key of keys) {
    const signature = of(key)
    if (signature === null || signature === '') continue
    const bucket = buckets.get(signature)
    if (bucket) bucket.push(key)
    else buckets.set(signature, [key])
  }
  const unique = new Map<string, string>()
  for (const [signature, bucket] of buckets) {
    // Two keys sharing a signature is not a match, it is an ambiguity. Leaving
    // it out reports both as unmatched, which is the truth.
    if (bucket.length === 1) unique.set(signature, bucket[0])
  }
  return unique
}

function matchKeys(left: string[], right: string[]): MatchResult {
  const rules: ReadonlyArray<readonly [MatchRule, (key: string) => string | null]> = [
    ['exact', normalise],
    ['tokens', tokenSignature],
    ['code', employeeCode],
  ]

  const matched: Matched[] = []
  const takenRight = new Set<string>()
  let pending = [...left]

  for (const [rule, of] of rules) {
    const available = right.filter((key) => !takenRight.has(key))
    const rightIndex = index(available, of)
    const leftIndex = index(pending, of)
    const next: string[] = []

    for (const key of pending) {
      const signature = of(key)
      // The left side must be unambiguous too: two sheet rows normalising to
      // one name cannot both claim the same portal record.
      if (signature === null || leftIndex.get(signature) !== key) {
        next.push(key)
        continue
      }
      const hit = rightIndex.get(signature)
      if (hit === undefined) {
        next.push(key)
        continue
      }
      matched.push({ left: key, right: hit, rule })
      takenRight.add(hit)
    }

    pending = next
  }

  return {
    matched,
    unmatchedLeft: pending,
    unmatchedRight: right.filter((key) => !takenRight.has(key)),
  }
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** What both sides report for one key, in the same units. */
interface Facts {
  orders: number
  sold: number
  /** UZS minor units. */
  revenue: bigint
}

const ZERO: Facts = { orders: 0, sold: 0, revenue: 0n }

interface RawFacts {
  key: string
  orders: number
  sold: number
  revenue: string
}

function collect(rows: RawFacts[]): Map<string, Facts> {
  const out = new Map<string, Facts>()
  for (const row of rows) {
    // Fold the "not stated" spellings together on both sides so the buckets
    // line up instead of appearing as two unmatched keys.
    const key = UNSET.has(row.key.trim()) ? UNATTRIBUTED : row.key
    const current = out.get(key) ?? { orders: 0, sold: 0, revenue: 0n }
    out.set(key, {
      orders: current.orders + row.orders,
      sold: current.sold + row.sold,
      revenue: current.revenue + BigInt(row.revenue),
    })
  }
  return out
}

function total(facts: Iterable<Facts>): Facts {
  let orders = 0
  let sold = 0
  let revenue = 0n
  for (const f of facts) {
    orders += f.orders
    sold += f.sold
    revenue += f.revenue
  }
  return { orders, sold, revenue }
}

// ---------------------------------------------------------------------------
// Queries
//
// `countsAsRevenue` is named in every one of them. The portal records the same
// order twice — Доставка, then База — and a comparison that forgot this would
// report Bitrix24 as roughly double Roistat and look like a Roistat problem.
// ---------------------------------------------------------------------------

type Reader = Omit<PrismaClient, '$connect' | '$disconnect' | '$transaction' | '$on' | '$extends'>

/** Deals bucketed by the day they were CREATED — the lead-date basis. */
const BITRIX_CREATED_BASIS = `
    d."countsAsRevenue"
    AND (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`

function roistatFacts(
  tx: Reader,
  dimension: string,
  from: string,
  to: string,
): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT "key"                    AS "key",
           sum("orders")::int       AS "orders",
           sum("sold")::int         AS "sold",
           sum("soldMinor")::text   AS "revenue"
    FROM "marketing_daily"
    WHERE "dimension" = $1::"MarketingDimension" AND "date" BETWEEN $2::date AND $3::date
    GROUP BY 1
    `,
    dimension,
    from,
    to,
  )
}

/** Roistat's DAYS dimension keyed by its own date string. */
function roistatByDay(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT "date"::text             AS "key",
           sum("orders")::int       AS "orders",
           sum("sold")::int         AS "sold",
           sum("soldMinor")::text   AS "revenue"
    FROM "marketing_daily"
    WHERE "dimension" = 'DAYS' AND "date" BETWEEN $1::date AND $2::date
    GROUP BY 1
    `,
    from,
    to,
  )
}

function bitrixByDay(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date::text AS "key",
           count(*)::int                                                       AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int                     AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
    `,
    TZ,
    from,
    to,
  )
}

/** The same window on Bitrix24's own basis: won deals on their close date. */
function bitrixByCloseDate(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT (d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date::text AS "key",
           0::int                                                        AS "orders",
           count(*)::int                                                 AS "sold",
           coalesce(sum(d."amountMinor"), 0)::text                       AS "revenue"
    FROM "deal" d
    WHERE d."countsAsRevenue" AND d."status" = 'WON' AND d."closedAt" IS NOT NULL
      AND (d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
    GROUP BY 1
    `,
    TZ,
    from,
    to,
  )
}

function bitrixByRegion(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT coalesce(d."region", '')                                      AS "key",
           count(*)::int                                                 AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int               AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
    `,
    TZ,
    from,
    to,
  )
}

/**
 * Products come from the line items, not from the deal.
 *
 * `count(DISTINCT d."id")` rather than `count(*)`: a deal carrying two lines of
 * the same product is one order, and counting rows would inflate exactly the
 * dimension the client checks most often. Revenue is the LINE total, so a
 * two-product deal contributes to two products and the column still sums to the
 * deal.
 */
function bitrixByProduct(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT p."name"                                                      AS "key",
           count(DISTINCT d."id")::int                                   AS "orders",
           count(DISTINCT d."id") FILTER (WHERE d."status" = 'WON')::int AS "sold",
           coalesce(sum(i."totalMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal_item" i
    JOIN "deal" d    ON d."id" = i."dealId"
    JOIN "product" p ON p."id" = i."productId"
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
    `,
    TZ,
    from,
    to,
  )
}

/** ROP = the department the deal's assigned employee belongs to. */
function bitrixByRop(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT coalesce(dep."name", '')                                      AS "key",
           count(*)::int                                                 AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int               AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    JOIN "employee" e        ON e."id" = d."employeeId"
    LEFT JOIN "department" dep ON dep."id" = e."departmentId"
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
    `,
    TZ,
    from,
    to,
  )
}

function bitrixBySeller(tx: Reader, from: string, to: string): Promise<RawFacts[]> {
  return tx.$queryRawUnsafe<RawFacts[]>(
    `
    SELECT e."fullName"                                                  AS "key",
           count(*)::int                                                 AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int               AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    JOIN "employee" e ON e."id" = d."employeeId"
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
    `,
    TZ,
    from,
    to,
  )
}

/** What the Roistat table actually covers, per dimension. */
function roistatCoverage(tx: Reader): Promise<{ dimension: string; from: string; to: string }[]> {
  return tx.$queryRawUnsafe(`
    SELECT "dimension"::text AS "dimension", min("date")::text AS "from", max("date")::text AS "to"
    FROM "marketing_daily" GROUP BY 1 ORDER BY 1
  `)
}

/**
 * The days the DAYS dimension actually says something about.
 *
 * The blob pads its day series out to its own `today` with all-zero rows —
 * 2026-08-12…08-27 carry no leads, no spend, no orders, nothing. Comparing
 * those against real Bitrix24 days would score the padding as a Roistat
 * shortfall of several hundred orders, which is a reporting artefact, not a
 * divergence. So the day window ends at the last day with any activity.
 */
function roistatActiveDays(tx: Reader): Promise<{ from: string | null; to: string | null }[]> {
  return tx.$queryRawUnsafe(`
    SELECT min("date")::text AS "from", max("date")::text AS "to"
    FROM "marketing_daily"
    WHERE "dimension" = 'DAYS'
      AND ("leads" > 0 OR "orders" > 0 OR "sold" > 0
           OR "soldMinor" > 0 OR "orderedMinor" > 0 OR "spendMicroUsd" > 0)
  `)
}

function bitrixCoverage(tx: Reader): Promise<{ from: string; to: string }[]> {
  return tx.$queryRawUnsafe(
    `
    SELECT min((d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date)::text AS "from",
           max((d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date)::text AS "to"
    FROM "deal" d WHERE d."countsAsRevenue"
    `,
    TZ,
  )
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER =
  '  ' +
  'kalit'.padEnd(30) +
  'R.buyurtma'.padStart(11) +
  'B.buyurtma'.padStart(11) +
  'Δ%'.padStart(8) +
  'R.sotuv'.padStart(9) +
  'B.sotuv'.padStart(9) +
  'Δ%'.padStart(8) +
  'R.tushum'.padStart(17) +
  'B.tushum'.padStart(17) +
  'Δ tushum'.padStart(17) +
  'Δ%'.padStart(8)

function line(label: string, r: Facts, b: Facts): string {
  return (
    '  ' +
    trunc(label, 30) +
    group(r.orders).padStart(11) +
    group(b.orders).padStart(11) +
    pct(r.orders, b.orders).padStart(8) +
    group(r.sold).padStart(9) +
    group(b.sold).padStart(9) +
    pct(r.sold, b.sold).padStart(8) +
    uzs(r.revenue).padStart(17) +
    uzs(b.revenue).padStart(17) +
    signedUzs(b.revenue - r.revenue).padStart(17) +
    pct(r.revenue, b.revenue).padStart(8)
  )
}

interface SectionOptions {
  title: string
  window: { from: string; to: string }
  note: string
  roistat: Map<string, Facts>
  bitrix: Map<string, Facts>
}

function section({ title, window, note, roistat, bitrix }: SectionOptions): void {
  head(title)
  console.log(`  Oyna: ${window.from} … ${window.to}`)
  console.log(`  ${note}`)
  console.log('')

  const match = matchKeys([...roistat.keys()], [...bitrix.keys()])
  const rows = match.matched
    .map((m) => ({
      label: m.left + (m.rule === 'exact' ? '' : m.rule === 'tokens' ? ' ~' : ' #'),
      r: roistat.get(m.left) ?? ZERO,
      b: bitrix.get(m.right) ?? ZERO,
    }))
    .sort((a, b) => Number(b.r.revenue - a.r.revenue) || b.r.sold - a.r.sold)

  console.log(HEADER)
  console.log(RULE())
  for (const row of FULL ? rows : rows.slice(0, TOP)) console.log(line(row.label, row.r, row.b))
  if (!FULL && rows.length > TOP) {
    console.log(`  … yana ${rows.length - TOP} ta mos kelgan kalit (--full bilan koʻrsatiladi)`)
  }
  console.log(RULE())
  console.log(
    line(
      `JAMI · mos kelgan ${rows.length} kalit`,
      total(rows.map((row) => row.r)),
      total(rows.map((row) => row.b)),
    ),
  )

  // Unmatched keys carry real money, so they are printed with it. An unmatched
  // key holding nothing is a naming curiosity; one holding 300 million soʻm is
  // the reason the totals disagree.
  const showUnmatched = (label: string, keys: string[], source: Map<string, Facts>) => {
    if (keys.length === 0) {
      console.log(`  ${label}: yoʻq — hammasi mos keldi.`)
      return
    }
    const withFacts = keys
      .map((key) => ({ key, facts: source.get(key) ?? ZERO }))
      .sort((a, b) => Number(b.facts.revenue - a.facts.revenue))
    const carried = total(withFacts.map((x) => x.facts))
    console.log(
      `  ${label}: ${keys.length} ta · ${group(carried.sold)} sotuv · ${uzs(carried.revenue)} soʻm`,
    )
    for (const item of FULL ? withFacts : withFacts.slice(0, TOP)) {
      console.log(
        `      ${trunc(item.key, 44)} ${group(item.facts.sold).padStart(7)} sotuv ${uzs(item.facts.revenue).padStart(17)} soʻm`,
      )
    }
    if (!FULL && withFacts.length > TOP) {
      console.log(`      … yana ${withFacts.length - TOP} ta`)
    }
  }

  console.log('')
  showUnmatched('Mos kelmadi · Roistat tomonida', match.unmatchedLeft, roistat)
  showUnmatched('Mos kelmadi · Bitrix24 tomonida', match.unmatchedRight, bitrix)

  const rules = match.matched.reduce<Record<string, number>>((acc, m) => {
    acc[m.rule] = (acc[m.rule] ?? 0) + 1
    return acc
  }, {})
  console.log(
    `  Moslashtirish: exact ${rules.exact ?? 0} · tokens ${rules.tokens ?? 0} (~) · code ${rules.code ?? 0} (#)`,
  )
}

/** The overlap of two closed date ranges, or null when they do not overlap. */
function overlap(
  a: { from: string; to: string },
  b: { from: string; to: string },
): { from: string; to: string } | null {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from <= to ? { from, to } : null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('DATABASE_URL .env da yoʻq.')

  const pool = new Pool(poolConfig(DATABASE_URL, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    await prisma.$transaction(
      async (tx) => {
        // The guarantee in the header, enforced by Postgres rather than by
        // careful reading. Any write below this line fails with 25006.
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')

        const snapshot = await tx.marketingSnapshot.findUnique({ where: { id: SNAPSHOT_ID } })
        if (!snapshot) {
          throw new Error(
            'Roistat snapshot topilmadi — avval `npm run roistat:import` ni ishga tushiring.',
          )
        }

        const coverage = await roistatCoverage(tx)
        const byDimension = new Map(coverage.map((c) => [c.dimension, c]))
        const [bitrix] = await bitrixCoverage(tx)
        const [active] = await roistatActiveDays(tx)

        head('ROISTAT ↔ BITRIX24 — SOLISHTIRISH')
        console.log(`  Roistat manbasi : ${snapshot.sourceUrl}`)
        console.log(
          `  Blob yangilandi : ${snapshot.updatedLabel}  ·  import ${snapshot.importedAt.toISOString()}`,
        )
        console.log(
          `  Kurs            : ${(Number(snapshot.usdRateMicro) / 1e6).toFixed(2)} soʻm/$ · ${snapshot.rateDate.toISOString().slice(0, 10)}`,
        )
        console.log(
          `  Roistat qamrovi : ${snapshot.minDate.toISOString().slice(0, 10)} … ${snapshot.maxDate.toISOString().slice(0, 10)}` +
            `  (kunlar qatorlari ${byDimension.get('DAYS')?.to} gacha, lekin ${active.to} dan keyin nol bilan toʻldirilgan)`,
        )
        console.log(`  Bitrix24 qamrovi: ${bitrix.from} … ${bitrix.to}  (countsAsRevenue = true)`)
        console.log(
          `  Toʻlmagan davr  : ${snapshot.freshFrom.toISOString().slice(0, 10)} dan keyingi kunlar hali yopilmagan — past ROAS normal.`,
        )

        // ---- 1. By day ------------------------------------------------------
        const days =
          active.from && active.to ? { dimension: 'DAYS', from: active.from, to: active.to } : null
        if (days) {
          const w = overlap(days, bitrix)
          if (!w) throw new Error('Roistat va Bitrix24 davrlari kesishmaydi.')

          const roistatDays = collect(await roistatByDay(tx, w.from, w.to))
          const bitrixDays = collect(await bitrixByDay(tx, w.from, w.to))
          const closedDays = collect(await bitrixByCloseDate(tx, w.from, w.to))

          const r = total(roistatDays.values())
          const b = total(bitrixDays.values())
          const c = total(closedDays.values())

          head('1 · KUNLAR — JAMI')
          console.log(`  Oyna: ${w.from} … ${w.to}  (Roistat faol kunlari; keyingi kunlar nol bilan toʻldirilgan)`)
          console.log('')
          console.log(
            '  ' +
              'koʻrsatkich'.padEnd(30) +
              'Roistat'.padStart(18) +
              'Bitrix24 (yaratilgan)'.padStart(24) +
              'Δ'.padStart(18) +
              'Δ%'.padStart(9),
          )
          console.log(RULE(101))
          console.log(
            '  ' +
              'Buyurtmalar (dona)'.padEnd(30) +
              group(r.orders).padStart(18) +
              group(b.orders).padStart(24) +
              signedInt(b.orders - r.orders).padStart(18) +
              pct(r.orders, b.orders).padStart(9),
          )
          console.log(
            '  ' +
              'Sotuvlar (dona)'.padEnd(30) +
              group(r.sold).padStart(18) +
              group(b.sold).padStart(24) +
              signedInt(b.sold - r.sold).padStart(18) +
              pct(r.sold, b.sold).padStart(9),
          )
          console.log(
            '  ' +
              'Tushum (soʻm)'.padEnd(30) +
              uzs(r.revenue).padStart(18) +
              uzs(b.revenue).padStart(24) +
              signedUzs(b.revenue - r.revenue).padStart(18) +
              pct(r.revenue, b.revenue).padStart(9),
          )
          console.log(RULE(101))
          console.log(
            '  Bitrix24, oʻz asosida (bitim YOPILGAN sana boʻyicha): ' +
              `${group(c.sold)} sotuv · ${uzs(c.revenue)} soʻm` +
              `  → yopilish/yaratilish farqi ${signedUzs(c.revenue - b.revenue)} soʻm (${pct(b.revenue, c.revenue)})`,
          )
          console.log(
            '  Roistat pulni LID sanasiga bogʻlaydi, shuning uchun asosiy solishtirish "yaratilgan" ustuni boʻyicha.',
          )

          // Per-day detail, sorted by the day itself.
          head('1b · KUNLAR — KUNMA-KUN')
          console.log(HEADER)
          console.log(RULE())
          const keys = [...new Set([...roistatDays.keys(), ...bitrixDays.keys()])].sort()
          const shown = FULL ? keys : keys.slice(-TOP)
          if (!FULL && keys.length > TOP) {
            console.log(`  … oldingi ${keys.length - TOP} kun yashirilgan (--full bilan koʻrsatiladi)`)
          }
          for (const key of shown) {
            const fresh = key >= snapshot.freshFrom.toISOString().slice(0, 10)
            console.log(
              line(key + (fresh ? ' ⧗' : ''), roistatDays.get(key) ?? ZERO, bitrixDays.get(key) ?? ZERO),
            )
          }
          console.log(RULE())
          console.log('  ⧗ = hali yopilmagan kun (freshFrom dan keyin).')
        }

        // ---- 2..5. The keyed dimensions -------------------------------------
        const dimensions: ReadonlyArray<{
          dimension: string
          title: string
          note: string
          read: (tx: Reader, from: string, to: string) => Promise<RawFacts[]>
        }> = [
          {
            dimension: 'REGION',
            title: '2 · REGION',
            note: 'Bitrix24: deal.region · Roistat: region kaliti. Ikkalasi ham qoʻlda toʻldiriladi.',
            read: bitrixByRegion,
          },
          {
            dimension: 'PRODUCT',
            title: '3 · MAHSULOT',
            note:
              'Bitrix24: deal_item → product.name (buyurtma = alohida bitim, tushum = satr summasi) · ' +
              'Roistat: bitta bitim bitta mahsulotga yoziladi.',
            read: bitrixByProduct,
          },
          {
            dimension: 'ROP',
            title: '4 · ROP',
            note: 'Bitrix24: bitim egasining boʻlimi · Roistat: rop kaliti (boʻlim nomi bilan bir xil yoziladi).',
            read: bitrixByRop,
          },
          {
            dimension: 'SELLER',
            title: '5 · SOTUVCHI',
            note: 'Bitrix24: employee.fullName · Roistat: sotuvchi ismi. Ism tartibi va raqam joyi har xil.',
            read: bitrixBySeller,
          },
        ]

        for (const spec of dimensions) {
          const cover = byDimension.get(spec.dimension)
          if (!cover) {
            console.log(`\n  ${spec.title}: Roistat tomonida maʼlumot yoʻq — solishtirilmadi.`)
            continue
          }
          const w = overlap(cover, bitrix)
          if (!w) {
            console.log(`\n  ${spec.title}: davrlar kesishmadi — solishtirilmadi.`)
            continue
          }
          section({
            title: spec.title,
            window: w,
            note: spec.note,
            roistat: collect(await roistatFacts(tx, spec.dimension, w.from, w.to)),
            bitrix: collect(await spec.read(tx, w.from, w.to)),
          })
        }

        // ---- The reasons ----------------------------------------------------
        head('FARQNING QONUNIY SABABLARI — raqamni "toʻgʻrilash" mumkin emas')
        for (const reason of [
          '1. Tushum taʼrifi boshqa. Roistat fact2 = yigʻilgan pul, LID sanasiga bogʻlangan ' +
            '("Выручка привязана к дате лида" — ularning oʻz sahifasi izohi). Bitrix24 esa ' +
            'yutilgan bitimni YOPILGAN sanasiga yozadi. Yuqoridagi ikkala ustun shu farqni koʻrsatadi.',
          '2. Voronkalar boshqa. Bu yerda faqat countsAsRevenue = true (Доставка + Ecommerce). ' +
            'База voronkasi oʻsha pulning nusxasi — hisobga kirmaydi, aks holda Bitrix24 ikki barobar koʻrinardi.',
          '3. Roistat faqat PULLIK trafikni qamraydi. Portalga boshqa yoʻldan kelgan bitimlar ' +
            'Bitrix24 da bor, Roistat da yoʻq — bu yerda "Roistat tomonida mos kelmadi" emas, ' +
            'balki umuman yoʻq qatorlar.',
          '4. Kalitlar qoʻlda yoziladi. Google Sheets dagi ism/region imlosi portal nomiga aynan ' +
            'teng emas; yuqoridagi "mos kelmadi" roʻyxatlari aynan shu — moslashtirilmagan, koʻrsatilgan.',
          '5. Davrlar teng emas. Roistat oʻlchovlarining oxirgi sanasi har xil (kunlar ' +
            `${byDimension.get('DAYS')?.to}, sheet oʻlchovlari ${byDimension.get('REGION')?.to}), ` +
            'va oxirgi 7 kun hali yopilmagan — oʻsha kunlarda Roistat past koʻrinadi.',
          '6. Mahsulot boʻyicha asos boshqa. Bitrix24 da bitta bitimda bir nechta mahsulot boʻlishi ' +
            'mumkin (tushum satrlarga boʻlinadi), Roistat da bitim bitta mahsulotga yoziladi.',
        ]) {
          console.log(`  ${reason}`)
          console.log('')
        }
        console.log('  Bu skript hech narsani oʻzgartirmaydi (SET TRANSACTION READ ONLY).')
        console.log('')
      },
      { maxWait: 15_000, timeout: 300_000 },
    )
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n  ✗ SOLISHTIRISH TOʻXTADI\n\n      ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
