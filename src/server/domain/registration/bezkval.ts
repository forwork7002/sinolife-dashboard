/**
 * «БЕЗКВАЛ» BY THE CLIENT'S WRITTEN SPEC (2026-10-22, `bezkval-lid-spec.md`):
 * how many leads came in a day, how many distinct CLIENTS they were, which
 * ROP each client went to, and which clients are new.
 *
 * A LEAD is a deal born in Регистрация (#0) or Первичный отдел (#12) — its
 * `crm.stagehistory` TYPE_ID 1 row, `crm_deal_birth` — or standing in one of
 * them now. The second arm is the user's (2026-10-22, against the spec's
 * letter): an «ИИ обработка» deal the portal moves into Регистрация once the
 * AI has a number is a lead (21.10: 102 such deals, 51 handed to a ROP); it
 * also keeps every deal on the portal's own «Воронка = Регистрация» screen in,
 * and covers a deal whose birth the feed has not read yet. Every stage counts,
 * «Дубликат (лид)» included — a duplicate falls out as the same client.
 *
 * ITS DAY is the Tashkent day of its creation — or, for a deal Lead Guard
 * brought in late («Как поступил лид» names Lead Guard and «Лид тушган сана»
 * is set), of that arrival (21.10: 373 such deals, most of them the evening
 * before). The repository reads both and hands the day over.
 *
 * A CLIENT is a phone number, the last nine digits: every number the deal's
 * contact holds, joined by union-find, so a contact with two numbers ties both
 * (21.10: 252 contacts held two or more), and so does one contact named by
 * two deals. A contact with no usable number falls back to the deal's own
 * «Телефон ракам», then to the contact itself (`c:`), then to the deal
 * (`d:`). A number of nine equal digits is nobody's.
 * One client a day is ONE безквал lead, however many deals it opened.
 *
 * ITS ROP is the first ROP the client's deals of the day were handed to, in
 * time order — «ROP KVAL LID», else «РОП (Первичка)» — the user's reading of
 * the spec's «birinchi berilgan ROP» (2026-10-22): a first deal still with the
 * desk does not hide a later one a ROP holds (21.10: 14 clients). None:
 * «Tarqatilmagan». A client whose deals name two ROPs is counted once, under
 * the first, and in `multiRop`.
 *
 * NEW OR REPEAT (one day only — `BezkvalHistory`, read per number): new in 30
 * days when no lead of the 30 days before the day carries the number; new
 * outright when no deal of any pipeline but HR ever did.
 *
 * Pure: rows in, counts out.
 */

/** One lead deal, as `RegistrationRepository.bezkvalLeadsSql` reads it. */
export interface BezkvalLeadRow {
  readonly dealId: string
  /** The portal's deal id; null on a deal that did not come from the portal. */
  readonly externalId: string | null
  /** The lead's Tashkent day, `YYYY-MM-DD` — Lead Guard's arrival when it applies. */
  readonly day: string
  /** The lead's instant (the same choice as `day`). */
  readonly at: Date
  /** Its Tashkent hour, 0–23. */
  readonly hour: number
  /** Dated by «Лид тушган сана» because Lead Guard brought it late. */
  readonly leadGuard: boolean
  /** CATEGORY_ID it was born in; null when no birth row is held. */
  readonly bornCategory: number | null
  /** The pipeline it stands in now, as the portal numbers it. */
  readonly pipeline: string | null
  /** The contact's portal id. */
  readonly contactId: string | null
  /** Every number of the contact, as typed — `dealKeys` takes their last nine digits. */
  readonly phones: readonly string[]
  /** The deal's own «Телефон ракам», raw. */
  readonly dealPhone: string | null
  /** «ROP KVAL LID»: the team the person heads, else their name. */
  readonly rop: string | null
  /** «РОП (Первичка)», read the same way. */
  readonly ropPrimary: string | null
  /** Detail reads only. */
  readonly source?: string | null
  readonly stage?: string | null
  readonly pipelineName?: string | null
}

/** What a client was keyed by — the spec's 4.3 order. */
export type BezkvalKeyKind = 'phone' | 'dealPhone' | 'contact' | 'deal'

export interface BezkvalClient {
  readonly day: string
  /** The client's key: `p:<nine digits>` (the smallest of its numbers), `c:<contact>` or `d:<deal>`. */
  readonly key: string
  readonly kind: BezkvalKeyKind
  /** Every number the client's deals carried that day. */
  readonly phones: readonly string[]
  /** The contacts the client's deals named. */
  readonly contactIds: readonly string[]
  /** Its deals that day, the first first. */
  readonly deals: readonly BezkvalLeadRow[]
  /** The first ROP its deals were handed to; null: «Tarqatilmagan». */
  readonly rop: string | null
  /** Its deals named two or more ROPs. */
  readonly multiRop: boolean
}

/** The last nine digits of a typed number, or null when it is not one. */
export function phoneNine(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 9) return null
  const nine = digits.slice(-9)
  return /^(\d)\1{8}$/.test(nine) ? null : nine
}

/** «ROP KVAL LID», else «РОП (Первичка)». */
export function dealRop(row: Pick<BezkvalLeadRow, 'rop' | 'ropPrimary'>): string | null {
  return row.rop ?? row.ropPrimary ?? null
}

/** The keys one deal ties together, and what they are. */
export function dealKeys(row: BezkvalLeadRow): { kind: BezkvalKeyKind; keys: string[] } {
  const phones = [...new Set(row.phones.map(phoneNine).filter((p): p is string => p !== null))].sort()
  if (phones.length > 0) return { kind: 'phone', keys: phones.map((p) => `p:${p}`) }
  const own = phoneNine(row.dealPhone)
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
 */
export function bezkvalClients(rows: readonly BezkvalLeadRow[]): BezkvalClient[] {
  const byDay = new Map<string, BezkvalLeadRow[]>()
  for (const r of rows) {
    const list = byDay.get(r.day)
    if (list) list.push(r)
    else byDay.set(r.day, [r])
  }

  const out: BezkvalClient[] = []
  for (const [day, deals] of [...byDay].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
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
      const rops = [...new Set(sorted.map((g) => dealRop(g.row)).filter((r): r is string => r !== null))]
      const firstRop = sorted.map((g) => dealRop(g.row)).find((r): r is string => r !== null) ?? null
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
        rop: firstRop,
        multiRop: rops.length > 1,
      })
    }
  }
  return out
}

/**
 * «Безквал» per day × ROP — the month grid's, «Guruhlar»'s and /rnp's rows:
 * `leads` the clients, `deals` the lead deals they opened («Jami lid»).
 */
export function bezkvalDayRows(clients: readonly BezkvalClient[]): { day: string; rop: string | null; leads: number; deals: number }[] {
  const counts = new Map<string, { day: string; rop: string | null; leads: number; deals: number }>()
  for (const c of clients) {
    const id = `${c.day}\u0000${c.rop ?? ''}`
    const hit = counts.get(id)
    if (hit) {
      hit.leads++
      hit.deals += c.deals.length
    } else counts.set(id, { day: c.day, rop: c.rop, leads: 1, deals: c.deals.length })
  }
  return [...counts.values()]
}

/** What the history read found for one key (`p:<nine>` or `c:<contact>`) before the day. */
export interface BezkvalHistoryRow {
  readonly key: string
  /** The latest lead of the 30 days before the day, if any. */
  readonly lastLeadAt: Date | null
  /** The latest deal of any pipeline but HR before the day, if any. */
  readonly lastDeal: { readonly externalId: string | null; readonly at: Date; readonly pipeline: string | null } | null
}

export interface BezkvalNovelty {
  /** No lead in the 30 days before. */
  readonly new30: boolean
  /** No deal ever before (HR aside). */
  readonly newEver: boolean
  /** The latest earlier deal, for the drill-down's proof. */
  readonly previous: BezkvalHistoryRow['lastDeal']
}

/** The history keys a client is looked up by: its numbers, else its contacts. */
export function historyKeys(client: Pick<BezkvalClient, 'phones' | 'contactIds'>): string[] {
  return client.phones.length > 0 ? client.phones.map((p) => `p:${p}`) : client.contactIds.map((c) => `c:${c}`)
}

/** A client is repeat when ANY of its keys was seen before. */
export function novelty(client: Pick<BezkvalClient, 'phones' | 'contactIds'>, history: ReadonlyMap<string, BezkvalHistoryRow>): BezkvalNovelty {
  let lead = false
  let previous: BezkvalHistoryRow['lastDeal'] = null
  for (const key of historyKeys(client)) {
    const h = history.get(key)
    if (!h) continue
    if (h.lastLeadAt) lead = true
    if (h.lastDeal && (!previous || h.lastDeal.at > previous.at)) previous = h.lastDeal
  }
  // A lead is a deal of a pipeline that is not HR, so a lead in 30 days is a deal ever.
  return { new30: !lead, newEver: !lead && previous === null, previous }
}

/** The number as a person may see it in a list: +998 90 ***-45-67. */
export function maskPhone(nine: string): string {
  if (!/^\d{9}$/.test(nine)) return nine
  return `+998 ${nine.slice(0, 2)} ***-${nine.slice(5, 7)}-${nine.slice(7, 9)}`
}

/** The spec's invariants for one day; the empty list when they hold. */
export function bezkvalInvariantProblems(day: {
  total: number
  bezkval: number
  new30: number
  newEver: number
  unassigned: number
  rops: readonly { readonly bezkval: number }[]
}): string[] {
  const problems: string[] = []
  const ropSum = day.rops.reduce((n, r) => n + r.bezkval, 0)
  if (ropSum + day.unassigned !== day.bezkval) problems.push(`ROPʼlar ${ropSum} + tarqatilmagan ${day.unassigned} ≠ bezkval ${day.bezkval}`)
  if (!(day.newEver <= day.new30 && day.new30 <= day.bezkval && day.bezkval <= day.total)) {
    problems.push(`butunlay yangi ${day.newEver} ≤ 30 kunda yangi ${day.new30} ≤ bezkval ${day.bezkval} ≤ jami ${day.total} buzildi`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// One day, opened up — «Bezkval lidlar» on «Lidlar» (the spec's 5).
// ---------------------------------------------------------------------------

export interface BezkvalRopLineDto {
  /** Null: «Tarqatilmagan». */
  readonly rop: string | null
  readonly bezkval: number
  readonly new30: number
  readonly newEver: number
  /** `bezkval` − `new30`. */
  readonly repeat30: number
  /** Of the day's безквал, 0–100. */
  readonly sharePct: number
}

export interface BezkvalDayDto {
  readonly day: string
  /** When the sync worker last computed the day (ISO); null: not yet — every count is then zero. */
  readonly computedAt: string | null
  /** «Jami lid» — the lead deals. */
  readonly total: number
  /** The distinct clients. */
  readonly bezkval: number
  readonly new30: number
  readonly newEver: number
  readonly repeat30: number
  readonly unassigned: number
  /** Clients whose deals named two or more ROPs — counted once, under the first. */
  readonly multiRop: number
  /** Lead deals dated by Lead Guard's «Лид тушган сана». */
  readonly leadGuard: number
  /** Lead deals counted because they stand in Регистрация / Первичный отдел though born elsewhere… */
  readonly movedIn: number
  /** …or with no birth row at all. */
  readonly noBirth: number
  /** Clients by what keyed them: a contact's number, the deal's number, the contact, the deal. */
  readonly keyKinds: Readonly<Record<BezkvalKeyKind, number>>
  readonly rops: readonly BezkvalRopLineDto[]
  /** By the client's first deal's source. */
  readonly sources: readonly { readonly source: string | null; readonly bezkval: number; readonly new30: number }[]
  /** Clients by the Tashkent hour of their first deal, 0–23. */
  readonly hours: readonly number[]
  /** The 30 days to `day`: lead deals against clients. */
  readonly trend: readonly { readonly day: string; readonly total: number; readonly bezkval: number }[]
  /** The spec's invariants that do not hold; empty when they all do. */
  readonly problems: readonly string[]
}

export interface BezkvalClientDealDto {
  /** The portal's deal id. */
  readonly id: string | null
  readonly pipeline: string | null
  readonly stage: string | null
  readonly source: string | null
  readonly rop: string | null
  /** The lead's instant, ISO. */
  readonly at: string
  readonly leadGuard: boolean
  /** CATEGORY_ID it was born in; null when no birth row was held. */
  readonly born: number | null
}

export interface BezkvalClientDto {
  /** The number, masked; null when the client has none. */
  readonly phone: string | null
  readonly kind: BezkvalKeyKind
  readonly rop: string | null
  readonly source: string | null
  readonly hour: number
  readonly new30: boolean
  readonly newEver: boolean
  readonly multiRop: boolean
  /** The latest deal before the day, for proof of a repeat. */
  readonly previous: { readonly id: string | null; readonly at: string; readonly pipeline: string | null } | null
  readonly deals: readonly BezkvalClientDealDto[]
}

export interface BezkvalClientsDto {
  readonly day: string
  readonly clients: readonly BezkvalClientDto[]
}

const LEAD_CATEGORIES: ReadonlySet<number> = new Set([0, 12])

/** One day's clients, each with what came before it. */
export function bezkvalClientList(
  day: string,
  clients: readonly BezkvalClient[],
  history: ReadonlyMap<string, BezkvalHistoryRow>,
): BezkvalClientDto[] {
  return bezkvalClientRows(day, clients, history).map((r) => r.client)
}

/** `bezkvalClientList` with each client's key — the stored row's id; the key holds a whole number, so it never goes out on the wire. */
export function bezkvalClientRows(
  day: string,
  clients: readonly BezkvalClient[],
  history: ReadonlyMap<string, BezkvalHistoryRow>,
): { key: string; client: BezkvalClientDto }[] {
  return clients
    .filter((c) => c.day === day)
    .map((c) => {
      const n = novelty(c, history)
      const first = c.deals[0]!
      return { key: c.key, client: {
        phone: c.phones.length > 0 ? maskPhone(c.phones[0]!) : null,
        kind: c.kind,
        rop: c.rop,
        source: first.source ?? null,
        hour: first.hour,
        new30: n.new30,
        newEver: n.newEver,
        multiRop: c.multiRop,
        previous: n.previous ? { id: n.previous.externalId, at: n.previous.at.toISOString(), pipeline: n.previous.pipeline } : null,
        deals: c.deals.map((d) => ({
          id: d.externalId,
          pipeline: d.pipelineName ?? d.pipeline,
          stage: d.stage ?? null,
          source: d.source ?? null,
          rop: dealRop(d),
          at: d.at.toISOString(),
          leadGuard: d.leadGuard,
          born: d.bornCategory,
        })),
      } }
    })
    .sort((a, b) => (a.client.deals[0]!.at < b.client.deals[0]!.at ? -1 : a.client.deals[0]!.at > b.client.deals[0]!.at ? 1 : 0))
}

/** Lead deals and clients per day — the trend under the day card. */
export function bezkvalDayTotals(rows: readonly { day: string; leads: number; deals: number }[]): Map<string, { total: number; bezkval: number }> {
  const out = new Map<string, { total: number; bezkval: number }>()
  for (const r of rows) {
    const hit = out.get(r.day) ?? { total: 0, bezkval: 0 }
    hit.total += r.deals
    hit.bezkval += r.leads
    out.set(r.day, hit)
  }
  return out
}

/** The day card from the day's client list (`bezkvalClientList`, as stored) and the trend's days. */
export function buildBezkvalDay(input: {
  day: string
  clients: readonly BezkvalClientDto[]
  /** When the worker computed the day; null: not yet. */
  computedAt: string | null
  trendDays: readonly string[]
  totals: ReadonlyMap<string, { total: number; bezkval: number }>
  /** The team order of the month grid. */
  order: (rops: readonly string[]) => string[]
}): BezkvalDayDto {
  const { clients } = input
  const total = clients.reduce((n, c) => n + c.deals.length, 0)
  const bezkval = clients.length
  const new30 = clients.filter((c) => c.new30).length
  const newEver = clients.filter((c) => c.newEver).length

  const byRop = new Map<string | null, { bezkval: number; new30: number; newEver: number }>()
  const bySource = new Map<string | null, { bezkval: number; new30: number }>()
  const hours = Array.from({ length: 24 }, () => 0)
  const keyKinds: Record<BezkvalKeyKind, number> = { phone: 0, dealPhone: 0, contact: 0, deal: 0 }
  for (const c of clients) {
    const r = byRop.get(c.rop) ?? { bezkval: 0, new30: 0, newEver: 0 }
    r.bezkval++
    if (c.new30) r.new30++
    if (c.newEver) r.newEver++
    byRop.set(c.rop, r)
    const s = bySource.get(c.source) ?? { bezkval: 0, new30: 0 }
    s.bezkval++
    if (c.new30) s.new30++
    bySource.set(c.source, s)
    if (c.hour >= 0 && c.hour < 24) hours[c.hour]!++
    keyKinds[c.kind]++
  }
  const pct = (n: number) => (bezkval > 0 ? (n / bezkval) * 100 : 0)
  const line = (rop: string | null): BezkvalRopLineDto => {
    const r = byRop.get(rop) ?? { bezkval: 0, new30: 0, newEver: 0 }
    return { rop, ...r, repeat30: r.bezkval - r.new30, sharePct: pct(r.bezkval) }
  }
  const named = input.order([...byRop.keys()].filter((r): r is string => r !== null)).filter((r) => byRop.has(r))
  const rops = [...named.map(line), line(null)]
  const unassigned = byRop.get(null)?.bezkval ?? 0

  const deals = clients.flatMap((c) => c.deals)
  const movedIn = deals.filter((d) => d.born !== null && !LEAD_CATEGORIES.has(d.born)).length
  const noBirth = deals.filter((d) => d.born === null).length

  const dto: Omit<BezkvalDayDto, 'problems'> = {
    day: input.day,
    computedAt: input.computedAt,
    total,
    bezkval,
    new30,
    newEver,
    repeat30: bezkval - new30,
    unassigned,
    multiRop: clients.filter((c) => c.multiRop).length,
    leadGuard: clients.reduce((n, c) => n + c.deals.filter((d) => d.leadGuard).length, 0),
    movedIn,
    noBirth,
    keyKinds,
    rops,
    sources: [...bySource]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.bezkval - a.bezkval || (a.source ?? '').localeCompare(b.source ?? '', 'ru')),
    hours,
    trend: input.trendDays.map((day) => ({ day, ...(input.totals.get(day) ?? { total: 0, bezkval: 0 }) })),
  }
  const problems = bezkvalInvariantProblems({ ...dto, rops: rops.filter((r) => r.rop !== null) })
  // Every deal in exactly one client: the list is built from groups, so a deal twice would be a bug upstream.
  const ids = clients.flatMap((c) => c.deals.map((d) => d.id)).filter((id): id is string => id !== null)
  if (new Set(ids).size !== ids.length) problems.push('bitta bitim ikki mijozda')
  return { ...dto, problems }
}
