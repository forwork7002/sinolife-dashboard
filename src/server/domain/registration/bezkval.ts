/**
 * «БЕЗКВАЛ» BY THE CLIENT'S WRITTEN SPEC, v2 (2026-10-26,
 * `bezkval-lid-spec (1).md`, checked by its author against the portal itself):
 * how many deals came INTO Регистрация in a day, how many distinct CLIENTS
 * they were, which are new and which repeat, and which ROP each went to.
 * v1 (2026-10-22) counted Первичный отдел too and dated Lead Guard deals by
 * «Лид тушган сана»; both were wrong (the spec's facts 1 and 4).
 *
 * A KIRIM is a deal that entered Регистрация (#0) that day: CREATED there (its
 * `crm.stagehistory` TYPE_ID 1 row, `crm_deal_birth`), or MOVED there from «ИИ
 * обработка» (#20) — a TYPE_ID 5 row into #0 whose previous row was in #20
 * (`crm_deal_move`). A deal back from Первичный отдел (12 → 0) is not one: its
 * client came in earlier. Every stage counts, «Дубликат (лид)» included — a
 * duplicate falls out as the same client.
 *
 * ITS DAY is the Tashkent day of that history row — DATE_CREATE for a created
 * deal. «Лид тушган сана» is never read: on the portal's own form leads it
 * stands exactly two hours before DATE_CREATE (Tashkent time written as
 * Moscow's — the spec's fact 4).
 *
 * A CLIENT is a phone number, normalised as the spec's 4.4 (`phoneKey`): a
 * local number is its nine digits, a foreign one all of its digits (+7 and
 * +992 numbers are other people than the local nine they end in). Every
 * number the deal's contact holds is joined by union-find, so a contact with
 * two numbers ties both, and so does one contact named by two deals. A
 * contact with no usable number falls back to the deal's own «Телефон
 * ракам», then to the contact itself (`c:`), then to the deal (`d:`). A
 * number of one repeated digit is nobody's. One client a day is ONE безквал
 * lead, however many deals it opened; its FIRST deal (the earliest kirim) is
 * its main one.
 *
 * ITS ROP is the main deal's (the spec's 5.5, in order): the team the «ROP
 * KVAL LID» person stands for (heads, else sits in), else «РОП (Первичка)»
 * read the same way, else «Ответственный» when they sit in a ROP team; the
 * repository resolves each person once. No ROP: «Taqsimlanmagan» when the
 * owner is the desk (portal users 10 and 1 — form deals are created in
 * user 10's name), else «Регистрация boʻlimida». The ROP list is the org
 * chart's «(ROP)» units — ~15, not the six the fields usually name.
 *
 * NEW OR REPEAT (the spec's 5.4): every contact holding any of the client's
 * numbers, and every deal of theirs created before the day began in any
 * pipeline but HR (#8). None: «Yangi». The latest within the 30 days before:
 * «Takror 30 kun». Otherwise «Takror eski». So Yangi + T30 + T eski = Bezkval.
 *
 * KVAL is counted beside it, never in it: deals CREATED in Первичный отдел
 * that day, by client (the spec's fact 1 — 336 of 337 had a Регистрация deal
 * first).
 *
 * Pure: rows in, counts out.
 */

/** How a deal entered Регистрация: created there, or moved in from «ИИ обработка». */
export type BezkvalEntry = 'created' | 'ai'

/** Where a client went: a ROP team, the Регистрация desk's own people, or nobody yet. */
export type BezkvalBucket = 'rop' | 'registration' | 'unassigned'

/** «Yangi», «Takror 30 kun», «Takror eski». */
export type BezkvalStatus = 'new' | 't30' | 'old'

/** The source a Lead Guard deal is shown under — the portal stamps every one REPEAT_SALE (the spec's fact 6). */
export const LEAD_GUARD_SOURCE = 'Ген лид (Lead Guard)'

/** The days before the day a repeat counts as recent. */
export const BEZKVAL_RECENT_DAYS = 30

/** One kirim deal, as `RegistrationRepository.bezkvalLeadsSql` reads it. */
export interface BezkvalLeadRow {
  readonly dealId: string
  /** The portal's deal id; null on a deal that did not come from the portal. */
  readonly externalId: string | null
  /** The kirim's Tashkent day, `YYYY-MM-DD`. */
  readonly day: string
  /** The kirim's instant: the history row's. */
  readonly at: Date
  /** Its Tashkent hour, 0–23. */
  readonly hour: number
  readonly entry: BezkvalEntry
  /** «Как поступил лид» names Lead Guard. */
  readonly leadGuard: boolean
  /** The contact's portal id. */
  readonly contactId: string | null
  /** Every number of the contact, as typed — `dealKeys` normalises them. */
  readonly phones: readonly string[]
  /** The deal's own «Телефон ракам», raw. */
  readonly dealPhone: string | null
  /** The ROP team «ROP KVAL LID» stands for (the person heads it, else sits in it); null: none. */
  readonly ropKval: string | null
  /** «РОП (Первичка)», read the same way. */
  readonly ropPrimary: string | null
  /** The ROP team «Ответственный» sits in or heads; null: none. */
  readonly ownerRop: string | null
  /** «Ответственный» is the desk — portal user 10 or 1. */
  readonly ownerDesk: boolean
  /** Detail reads only: the source's name, the stage, the pipeline it stands in now. */
  readonly source?: string | null
  readonly stage?: string | null
  readonly pipelineName?: string | null
}

/** What a client was keyed by — the spec's 4.4 order. */
export type BezkvalKeyKind = 'phone' | 'dealPhone' | 'contact' | 'deal'

export interface BezkvalClient {
  readonly day: string
  /** The client's key: `p:<number key>` (the smallest of its numbers), `c:<contact>` or `d:<deal>`. */
  readonly key: string
  readonly kind: BezkvalKeyKind
  /** Every number key the client's deals carried that day (`phoneKey`). */
  readonly phones: readonly string[]
  /** The contacts the client's deals named. */
  readonly contactIds: readonly string[]
  /** Its kirim deals that day, the main (earliest) first. */
  readonly deals: readonly BezkvalLeadRow[]
  /** The main deal's ROP team; null with `bucket` 'registration' or 'unassigned'. */
  readonly rop: string | null
  readonly bucket: BezkvalBucket
  /** Its deals named two or more ROP teams — counted once, by the main deal. */
  readonly multiRop: boolean
}

/**
 * A typed number as the spec's 4.4 keys it, or null when it is none: twelve
 * digits starting 998 → the last nine; nine digits → themselves (local, no
 * code); ten or more not starting 998 → `x` and every digit (foreign);
 * anything else is not a number. One digit repeated is a placeholder.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  let key: string | null = null
  if (digits.length === 12 && digits.startsWith('998')) key = digits.slice(3)
  else if (digits.length === 9) key = digits
  else if (digits.length >= 10 && !digits.startsWith('998')) key = `x${digits}`
  if (key === null || /^x?(\d)\1+$/.test(key)) return null
  return key
}

/** The last nine digits of a number key — what the phone index (`phone_nines`) holds, to find its candidates by. */
export function phoneTail(key: string): string {
  return key.replace(/^x/, '').slice(-9)
}

/** The spec's 5.5 for one deal: «ROP KVAL LID», «РОП (Первичка)», the owner's team — else the desk or Регистрация. */
export function dealRop(row: Pick<BezkvalLeadRow, 'ropKval' | 'ropPrimary' | 'ownerRop' | 'ownerDesk'>): { rop: string | null; bucket: BezkvalBucket } {
  const rop = row.ropKval ?? row.ropPrimary ?? row.ownerRop
  if (rop !== null) return { rop, bucket: 'rop' }
  return { rop: null, bucket: row.ownerDesk ? 'unassigned' : 'registration' }
}

/** The keys one deal ties together, and what they are. */
export function dealKeys(row: Pick<BezkvalLeadRow, 'dealId' | 'contactId' | 'phones' | 'dealPhone'>): { kind: BezkvalKeyKind; keys: string[] } {
  const phones = [...new Set(row.phones.map(phoneKey).filter((p): p is string => p !== null))].sort()
  if (phones.length > 0) return { kind: 'phone', keys: phones.map((p) => `p:${p}`) }
  const own = phoneKey(row.dealPhone)
  if (own !== null) return { kind: 'dealPhone', keys: [`p:${own}`] }
  if (row.contactId) return { kind: 'contact', keys: [`c:${row.contactId}`] }
  return { kind: 'deal', keys: [`d:${row.dealId}`] }
}

const byTime = (a: BezkvalLeadRow, b: BezkvalLeadRow) =>
  a.at.getTime() - b.at.getTime() || compareIds(a.externalId ?? a.dealId, b.externalId ?? b.dealId)

/** Portal ids are numbers; compare them as numbers, anything else as text. */
function compareIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The day's clients: the deals of each day joined wherever they share a key.
 * Days never mix — a number back the next day is a client of that day too.
 * A deal listed twice in a day (in, out and in again) is kept once, at its
 * first entry.
 */
export function bezkvalClients(rows: readonly BezkvalLeadRow[]): BezkvalClient[] {
  const byDay = new Map<string, Map<string, BezkvalLeadRow>>()
  for (const r of rows) {
    const day = byDay.get(r.day) ?? new Map<string, BezkvalLeadRow>()
    const held = day.get(r.dealId)
    if (!held || byTime(r, held) < 0) day.set(r.dealId, r)
    byDay.set(r.day, day)
  }

  const out: BezkvalClient[] = []
  for (const [day, held] of [...byDay].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const deals = [...held.values()]
    const parent = new Map<string, string>()
    const find = (x: string): string => {
      let root = x
      while (parent.get(root) !== root) root = parent.get(root)!
      // Path compression: every key on the way points at the root.
      let at = x
      while (parent.get(at) !== root) {
        const next = parent.get(at)!
        parent.set(at, root)
        at = next
      }
      return root
    }
    const add = (x: string) => {
      if (!parent.has(x)) parent.set(x, x)
    }
    const union = (a: string, b: string) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
    }

    // A deal's contact ties it too: one contact is one person, whatever it was keyed by.
    const keyed = deals.map((row) => {
      const own = dealKeys(row)
      const ties = row.contactId && !own.keys.includes(`c:${row.contactId}`) ? [...own.keys, `c:${row.contactId}`] : own.keys
      return { row, ...own, ties }
    })
    for (const k of keyed) {
      for (const key of k.ties) add(key)
      for (const key of k.ties.slice(1)) union(k.ties[0]!, key)
    }

    const groups = new Map<string, typeof keyed>()
    for (const k of keyed) {
      const root = find(k.keys[0]!)
      const list = groups.get(root)
      if (list) list.push(k)
      else groups.set(root, [k])
    }

    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => byTime(a.row, b.row))
      const phones = [...new Set(group.flatMap((g) => g.keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2))))].sort()
      const contactIds = [...new Set(group.map((g) => g.row.contactId).filter((c): c is string => !!c))].sort()
      const rops = new Set(sorted.map((g) => dealRop(g.row).rop).filter((r): r is string => r !== null))
      const main = dealRop(sorted[0]!.row)
      // The strongest key any of its deals had: one deal with a number makes it a number.
      const kinds = new Set(group.map((g) => g.kind))
      const kind: BezkvalKeyKind = kinds.has('phone') ? 'phone' : kinds.has('dealPhone') ? 'dealPhone' : kinds.has('contact') ? 'contact' : 'deal'
      const key = phones.length > 0 ? `p:${phones[0]}` : [...new Set(group.flatMap((g) => g.keys))].sort()[0]!
      out.push({
        day,
        key,
        kind,
        phones,
        contactIds,
        deals: sorted.map((g) => g.row),
        rop: main.rop,
        bucket: main.bucket,
        multiRop: rops.size > 1,
      })
    }
  }
  return out
}

/**
 * One contact the history read found — by one of the day's numbers or by its
 * id — with its latest deal created before the day in a pipeline that is not
 * HR (`RegistrationRepository.bezkvalHistorySql`). A contact with no such
 * deal is not returned.
 */
export interface BezkvalHistoryRow {
  readonly contactId: string | null
  /** Every number it holds, as typed. */
  readonly phones: readonly string[]
  readonly lastDeal: { readonly externalId: string | null; readonly at: Date; readonly pipeline: string | null }
}

type PriorDeal = BezkvalHistoryRow['lastDeal']

/**
 * The history keyed as the day's clients are — `p:<number key>` and
 * `c:<contact>` — each with the latest earlier deal behind it. The read found
 * its contacts by the last nine digits; this keeps only the exact numbers, so
 * a +7 number never stands for the local nine it ends in.
 */
export function historyIndex(rows: readonly BezkvalHistoryRow[]): Map<string, PriorDeal> {
  const out = new Map<string, PriorDeal>()
  const put = (key: string, deal: PriorDeal) => {
    const held = out.get(key)
    if (!held || deal.at > held.at) out.set(key, deal)
  }
  for (const r of rows) {
    for (const p of r.phones) {
      const key = phoneKey(p)
      if (key !== null) put(`p:${key}`, r.lastDeal)
    }
    if (r.contactId) put(`c:${r.contactId}`, r.lastDeal)
  }
  return out
}

/** The keys a client is looked up by: its numbers and its contacts. */
export function historyKeys(client: Pick<BezkvalClient, 'phones' | 'contactIds'>): string[] {
  return [...client.phones.map((p) => `p:${p}`), ...client.contactIds.map((c) => `c:${c}`)]
}

/**
 * New or repeat, and the earlier deal that makes it one: the latest deal
 * behind ANY of the client's keys. `dayStart` is the instant the day began.
 */
export function novelty(
  client: Pick<BezkvalClient, 'phones' | 'contactIds'>,
  history: ReadonlyMap<string, PriorDeal>,
  dayStart: Date,
): { status: BezkvalStatus; previous: PriorDeal | null } {
  let previous: PriorDeal | null = null
  for (const key of historyKeys(client)) {
    const deal = history.get(key)
    if (deal && deal.at < dayStart && (!previous || deal.at > previous.at)) previous = deal
  }
  if (previous === null) return { status: 'new', previous }
  const recent = new Date(dayStart.getTime() - BEZKVAL_RECENT_DAYS * 86_400_000)
  return { status: previous.at >= recent ? 't30' : 'old', previous }
}

/**
 * A number as a person may see it in a list — the last four digits only
 * (the spec's 6.4): +998 •• •••-45-67, or a foreign one +•••45-67.
 */
export function maskPhone(key: string): string {
  if (/^\d{9}$/.test(key)) return `+998 •• •••-${key.slice(5, 7)}-${key.slice(7, 9)}`
  const foreign = /^x(\d{10,})$/.exec(key)
  if (foreign) return `+•••${foreign[1]!.slice(-4, -2)}-${foreign[1]!.slice(-2)}`
  return key
}

/** A client's main source: a Lead Guard deal is «Ген лид (Lead Guard)», whatever SOURCE_ID says. */
export function clientSource(deal: Pick<BezkvalLeadRow, 'leadGuard' | 'source'>): string | null {
  return deal.leadGuard ? LEAD_GUARD_SOURCE : (deal.source ?? null)
}

/** The kirim's kind on the card: an «ИИ» move, else a Lead Guard deal, else one created in Регистрация. */
export type BezkvalEntryKind = 'created' | 'ai' | 'leadGuard'

export function entryKind(deal: { readonly entry: BezkvalEntry; readonly leadGuard: boolean }): BezkvalEntryKind {
  return deal.entry === 'ai' ? 'ai' : deal.leadGuard ? 'leadGuard' : 'created'
}

/** The spec's automatic checks (its 7) for one day; the empty list when they hold. */
export function bezkvalInvariantProblems(day: {
  kirim: number
  bezkval: number
  fresh: number
  repeat30: number
  repeatOld: number
  /** Every line of the ROP table: the teams, «Регистрация boʻlimida», «Taqsimlanmagan». */
  lines: readonly { readonly bezkval: number }[]
  /** Every kirim deal id, as the clients list them. */
  dealIds: readonly string[]
}): string[] {
  const problems: string[] = []
  const lineSum = day.lines.reduce((n, r) => n + r.bezkval, 0)
  if (lineSum !== day.bezkval) problems.push(`ROPʼlar + Регистрация + taqsimlanmagan = ${lineSum} ≠ bezkval ${day.bezkval}`)
  if (day.fresh + day.repeat30 + day.repeatOld !== day.bezkval) {
    problems.push(`yangi ${day.fresh} + takror 30 ${day.repeat30} + takror eski ${day.repeatOld} ≠ bezkval ${day.bezkval}`)
  }
  if (day.bezkval > day.kirim) problems.push(`bezkval ${day.bezkval} > kirim ${day.kirim}`)
  if (new Set(day.dealIds).size !== day.dealIds.length) problems.push('bitta bitim ikki mijozda')
  return problems
}

// ---------------------------------------------------------------------------
// One day, opened up — «Bezkval lidlar» on «Lidlar» (the spec's 6).
// ---------------------------------------------------------------------------

export interface BezkvalCountsDto {
  readonly bezkval: number
  readonly fresh: number
  readonly repeat30: number
  readonly repeatOld: number
}

export interface BezkvalRopLineDto extends BezkvalCountsDto {
  /** The team; null on the «Регистрация boʻlimida» and «Taqsimlanmagan» lines. */
  readonly rop: string | null
  readonly bucket: BezkvalBucket
  /** Who heads the team now — the name the client's sheet uses; null when the org chart names nobody. */
  readonly head: string | null
  /** Of the day's безквал, 0–100. */
  readonly sharePct: number
}

export interface BezkvalDayDto extends BezkvalCountsDto {
  readonly day: string
  /** When the sync worker last computed the day (ISO); null: not yet — every count is then zero. */
  readonly computedAt: string | null
  /** «Kirim (sdelka)» — deals that entered Регистрация. */
  readonly kirim: number
  readonly unassigned: number
  readonly registration: number
  /** Первичный отдел's births — beside безквал, never in it. */
  readonly kval: { readonly deals: number; readonly clients: number }
  /** Kirim by how it came: deals, and clients by their main deal. */
  readonly entries: Readonly<Record<BezkvalEntryKind, { readonly deals: number; readonly clients: number }>>
  /** Clients whose deals named two or more ROP teams — counted once, by the main deal. */
  readonly multiRop: number
  /** Clients by what keyed them: a contact's number, the deal's number, the contact, the deal. */
  readonly keyKinds: Readonly<Record<BezkvalKeyKind, number>>
  /** The teams, then «Регистрация boʻlimida», then «Taqsimlanmagan». */
  readonly rops: readonly BezkvalRopLineDto[]
  /** By the client's main source. */
  readonly sources: readonly ({ readonly source: string | null } & BezkvalCountsDto)[]
  /** Clients by the Tashkent hour of their main deal, 0–23. */
  readonly hours: readonly number[]
  /** The 30 days to `day`: kirim deals against clients. */
  readonly trend: readonly { readonly day: string; readonly kirim: number; readonly bezkval: number }[]
  /** The spec's checks that do not hold; empty when they all do. */
  readonly problems: readonly string[]
}

export interface BezkvalClientDealDto {
  /** The portal's deal id. */
  readonly id: string | null
  /** The pipeline it stands in NOW. */
  readonly pipeline: string | null
  readonly stage: string | null
  readonly source: string | null
  readonly rop: string | null
  /** The kirim's instant, ISO. */
  readonly at: string
  readonly entry: BezkvalEntry
  readonly leadGuard: boolean
}

export interface BezkvalClientDto {
  /** The number, masked to its last four digits; null when the client has none. */
  readonly phone: string | null
  readonly kind: BezkvalKeyKind
  readonly rop: string | null
  readonly bucket: BezkvalBucket
  /** The main deal's (`clientSource`). */
  readonly source: string | null
  readonly hour: number
  /** Null on a kval client — new or repeat is not asked of them. */
  readonly status: BezkvalStatus | null
  readonly multiRop: boolean
  /** The latest deal before the day, for proof of a repeat. */
  readonly previous: { readonly id: string | null; readonly at: string; readonly pipeline: string | null } | null
  readonly deals: readonly BezkvalClientDealDto[]
}

export interface BezkvalClientsDto {
  readonly day: string
  readonly clients: readonly BezkvalClientDto[]
  /** Первичный отдел's clients that day. */
  readonly kval: readonly BezkvalClientDto[]
}

/** One counted day: its безквал clients and its kval clients, each with its stored key. */
export interface BezkvalCountedDay {
  readonly clients: readonly { key: string; client: BezkvalClientDto }[]
  readonly kval: readonly { key: string; client: BezkvalClientDto }[]
}

/**
 * One day's clients as stored, each with its key — the stored row's id; the
 * key holds a whole number, so it never goes out on the wire. `history`
 * null: a kval day, asked nothing about what came before.
 */
export function bezkvalClientRows(
  day: string,
  clients: readonly BezkvalClient[],
  history: { readonly index: ReadonlyMap<string, PriorDeal>; readonly dayStart: Date } | null,
): { key: string; client: BezkvalClientDto }[] {
  return clients
    .filter((c) => c.day === day)
    .map((c) => {
      const n = history === null ? null : novelty(c, history.index, history.dayStart)
      const main = c.deals[0]!
      return {
        key: c.key,
        client: {
          phone: c.phones.length > 0 ? maskPhone(c.phones[0]!) : null,
          kind: c.kind,
          rop: c.rop,
          bucket: c.bucket,
          source: clientSource(main),
          hour: main.hour,
          status: n?.status ?? null,
          multiRop: c.multiRop,
          previous: n?.previous ? { id: n.previous.externalId, at: n.previous.at.toISOString(), pipeline: n.previous.pipeline } : null,
          deals: c.deals.map((d) => ({
            id: d.externalId,
            pipeline: d.pipelineName ?? null,
            stage: d.stage ?? null,
            source: clientSource(d),
            rop: dealRop(d).rop,
            at: d.at.toISOString(),
            entry: d.entry,
            leadGuard: d.leadGuard,
          })),
        },
      }
    })
    .sort((a, b) => (a.client.deals[0]!.at < b.client.deals[0]!.at ? -1 : a.client.deals[0]!.at > b.client.deals[0]!.at ? 1 : 0))
}

/** Kirim deals and clients per day — the trend under the day card. */
export function bezkvalDayTotals(rows: readonly { day: string; leads: number; deals: number }[]): Map<string, { kirim: number; bezkval: number }> {
  const out = new Map<string, { kirim: number; bezkval: number }>()
  for (const r of rows) {
    const hit = out.get(r.day) ?? { kirim: 0, bezkval: 0 }
    hit.kirim += r.deals
    hit.bezkval += r.leads
    out.set(r.day, hit)
  }
  return out
}

type Counts = { bezkval: number; fresh: number; repeat30: number; repeatOld: number }

const emptyCounts = (): Counts => ({ bezkval: 0, fresh: 0, repeat30: 0, repeatOld: 0 })

function tally(into: Counts, status: BezkvalStatus | null) {
  into.bezkval++
  if (status === 'new') into.fresh++
  else if (status === 't30') into.repeat30++
  else if (status === 'old') into.repeatOld++
}

/** The day card from the day's client lists (as stored) and the trend's days. */
export function buildBezkvalDay(input: {
  day: string
  clients: readonly BezkvalClientDto[]
  kval: readonly BezkvalClientDto[]
  /** When the worker computed the day; null: not yet. */
  computedAt: string | null
  trendDays: readonly string[]
  totals: ReadonlyMap<string, { kirim: number; bezkval: number }>
  /** The team order of the month grid. */
  order: (rops: readonly string[]) => string[]
  /** Each team's head now. */
  heads: ReadonlyMap<string, string>
}): BezkvalDayDto {
  const { clients } = input
  const all = emptyCounts()
  const byRop = new Map<string, Counts>()
  const registration = emptyCounts()
  const unassigned = emptyCounts()
  const bySource = new Map<string | null, Counts>()
  const hours = Array.from({ length: 24 }, () => 0)
  const keyKinds: Record<BezkvalKeyKind, number> = { phone: 0, dealPhone: 0, contact: 0, deal: 0 }
  const entries: Record<BezkvalEntryKind, { deals: number; clients: number }> = {
    created: { deals: 0, clients: 0 },
    ai: { deals: 0, clients: 0 },
    leadGuard: { deals: 0, clients: 0 },
  }
  let kirim = 0
  for (const c of clients) {
    tally(all, c.status)
    if (c.bucket === 'rop' && c.rop !== null) {
      const r = byRop.get(c.rop) ?? emptyCounts()
      tally(r, c.status)
      byRop.set(c.rop, r)
    } else {
      tally(c.bucket === 'registration' ? registration : unassigned, c.status)
    }
    const s = bySource.get(c.source) ?? emptyCounts()
    tally(s, c.status)
    bySource.set(c.source, s)
    if (c.hour >= 0 && c.hour < 24) hours[c.hour]!++
    keyKinds[c.kind]++
    kirim += c.deals.length
    for (const d of c.deals) entries[entryKind(d)].deals++
    if (c.deals[0]) entries[entryKind(c.deals[0])].clients++
  }
  const pct = (n: number) => (all.bezkval > 0 ? (n / all.bezkval) * 100 : 0)
  const named = input.order([...byRop.keys()]).filter((r) => byRop.has(r))
  const rops: BezkvalRopLineDto[] = [
    ...named.map((rop) => {
      const r = byRop.get(rop)!
      return { rop, bucket: 'rop' as const, head: input.heads.get(rop) ?? null, ...r, sharePct: pct(r.bezkval) }
    }),
    { rop: null, bucket: 'registration', head: null, ...registration, sharePct: pct(registration.bezkval) },
    { rop: null, bucket: 'unassigned', head: null, ...unassigned, sharePct: pct(unassigned.bezkval) },
  ]

  const dto: Omit<BezkvalDayDto, 'problems'> = {
    day: input.day,
    computedAt: input.computedAt,
    kirim,
    ...all,
    unassigned: unassigned.bezkval,
    registration: registration.bezkval,
    kval: { deals: input.kval.reduce((n, c) => n + c.deals.length, 0), clients: input.kval.length },
    entries,
    multiRop: clients.filter((c) => c.multiRop).length,
    keyKinds,
    rops,
    sources: [...bySource]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.bezkval - a.bezkval || (a.source ?? '').localeCompare(b.source ?? '', 'ru')),
    hours,
    trend: input.trendDays.map((day) => ({ day, ...(input.totals.get(day) ?? { kirim: 0, bezkval: 0 }) })),
  }
  const problems = bezkvalInvariantProblems({
    ...dto,
    lines: rops,
    dealIds: clients.flatMap((c) => c.deals.map((d) => d.id)).filter((id): id is string => id !== null),
  })
  return { ...dto, problems }
}
