/**
 * «Oyliklar» — what each seller is owed over the dashboard's window (since
 * 2026-10-17: «Bugun · Kecha · Shu oy · Sana», as on Savdo dinamikasi — the
 * Haftalik / 15 kunlik / Oylik tabs went). The window's length picks the
 * client's table (`payrollSchemeOf`); see `domain/payroll/sellerPayroll`.
 *
 * ONE MEASUREMENT AND ONE RULE, kept apart. The measurement is FAKT 2 per
 * seller from the SAME query Savdo dinamikasi and the sellers board read
 * (`confirmationSellerRating`, the queue cohort: orders that ARRIVED in the
 * window and are delivered now), so a seller's figure here and their FAKT 2
 * there are one number. The client, 2026-10-17: «savdo dinamikasidagi to'g'ri
 * malumot ekan». From 2026-10-05 to then it was dated by the delivery day
 * (`deliveredSellerRows`, deleted with this change) and the two screens
 * disagreed for the same seller and month. What that costs, stated: a closed
 * month keeps growing while its late parcels land. The rule is
 * `domain/payroll/sellerPayroll`, which is the client's own table transcribed
 * and knows nothing about databases.
 *
 * WHY IT DOES NOT GO THROUGH `SellerBoardService`. That service is the
 * protected board's own path — window from an `AnalyticsContext`, its own
 * memo, its own ranking basis switch — and payroll asks a narrower question on
 * a different clock. Reading the repository directly costs one call and keeps
 * this screen from being a reason to edit a file «Sotuvchilar reytingi»
 * depends on.
 *
 * THE RANK IS DECIDED HERE, OVER THESE ROWS, and it is the board's own rule:
 * FAKT 2, then FAKT 1, then the employee id, with competition ranking. It is
 * mirrored rather than imported because the board's version is welded to its
 * DTO — and the screen says out loud which period the rank is over, because a
 * payroll fortnight's leader is not necessarily the month's.
 */

import { type DeltaDto, growth, toDeltaDto } from '@/server/domain/analytics/metrics'
import { mergeSellerTeamSlices } from '@/server/domain/analytics/sellerTeams'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { type Period, zonedDateKey } from '@/server/domain/period/period'
import {
  PAYROLL_BRANCHES,
  PAYROLL_BRANCH_LABEL,
  type PayrollBranch,
  payrollBranchOf,
} from '@/server/domain/payroll/payrollBranches'
import {
  FLAT_RATE_SELLERS,
  type PayrollInput,
  type PayrollSchemeValue,
  type PayrollTableValue,
  payrollSchemeOf,
  ropPayroll,
  sellerPayroll,
} from '@/server/domain/payroll/sellerPayroll'
import { isBaseTeam } from '@/server/domain/rnp/rnpSheet'
import type {
  ConfirmationSellerDayRow,
  ConfirmationSellerRatingRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import type { RegistrationRepository } from '@/server/repositories/registrationRepository'
import { LIVE_CACHE, keyPart, ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface PayrollSellerDto {
  /** Competition rank on FAKT 2 within this payroll period. 1 is the leader. */
  readonly rank: number
  readonly employeeId: string
  readonly fullName: string
  /** The ROP team, or null for a seller in no (ROP) department. */
  readonly rop: string | null
  /** The block the team is printed in (`payrollBranchOf`). */
  readonly branch: PayrollBranch
  /** Which pay the row is on: the standard tables, БАЗА's, or a flat rate of their own. */
  readonly table: PayrollTableValue
  /**
   * «Лид сони» — the leads handed to this person in the window's days, as
   * «ROP otchet» counts them (`RegistrationRepository.sellerLeads`). Null when
   * they could not be read: a column of zeros would read as nobody got a lead.
   */
  readonly leads: number | null
  /** «Транз-1» — FAKT 1 orders, the board's count. */
  readonly fakt1Orders: number
  /** «Конверсия» — Транз-1 ÷ Лид сони × 100, «ROP otchet»'s formula; null with no lead. */
  readonly conversion: number | null
  /** FAKT 2 — delivered money, and the only basis this screen pays on. */
  readonly fakt2: MoneyDto
  /** «Транз-2» — FAKT 2 orders, the screen's «Buyurtma soni». */
  readonly fakt2Orders: number
  /**
   * The rate this row was paid at, in per cent: 8 for a standard month or
   * half, 0 / 5 / 8 / 10 / 12 for a standard week, 8 / 10 / 12 / 15 on БАЗА's
   * tables, the person's own on a flat rate.
   */
  readonly percentRate: number
  /** `percentRate` of FAKT 2. */
  readonly percent: MoneyDto
  /** The tier's fixed part. Zero below the first floor, never null. */
  readonly fixed: MoneyDto
  /** percent + fixed. The soʻm the person is paid. */
  readonly total: MoneyDto
  /** The floor this row was paid at, so the screen can name the tier. */
  readonly tierFloor: MoneyDto | null
  /** The next floor up, null once the top tier is cleared. */
  readonly nextFloor: MoneyDto | null
  /** How much more FAKT 2 the next tier needs. Null with `nextFloor`. */
  readonly toNext: MoneyDto | null
  /**
   * The same person in the comparison window, paid by the same table. Null
   * when they delivered nothing then — new, or back — which the screen says
   * in words rather than as a percentage off zero.
   */
  readonly previous: { readonly fakt2: MoneyDto; readonly total: MoneyDto } | null
  readonly fakt2Delta: DeltaDto
  readonly totalDelta: DeltaDto
}

/**
 * One ROP team: its sellers' rows summed, now and in the comparison window.
 *
 * NOW is the sellers this payroll prints under that ROP — each person once,
 * under the team of their newest order (`mergeSellerTeamSlices`), so the cards
 * add up to the fund to the soʻm. THEN is the comparison window's sellers
 * under the label THEY wore then: a team's growth is what the team did, and a
 * seller who joined it this month did not make last month's figure smaller.
 */
export interface PayrollTeamDto {
  /** The ROP's team name, or null for sellers in no (ROP) department. */
  readonly rop: string | null
  readonly branch: PayrollBranch
  readonly sellers: number
  /** Σ the printed sellers' leads; null when the leads could not be read. */
  readonly leads: number | null
  readonly fakt1Orders: number
  readonly fakt2Orders: number
  /** Транз-1 ÷ Лид сони × 100 of the team's sums, over the rows handed a lead (`countsOf`) — never a mean of the rows. */
  readonly conversion: number | null
  readonly fakt2: MoneyDto
  readonly percent: MoneyDto
  readonly fixed: MoneyDto
  readonly total: MoneyDto
  /** Null when nobody was paid under this name in the comparison window. */
  readonly previous: {
    readonly sellers: number
    readonly fakt2: MoneyDto
    readonly total: MoneyDto
  } | null
  readonly fakt2Delta: DeltaDto
  readonly totalDelta: DeltaDto
  /**
   * The ROP's own pay off this team's FAKT 2 (`ropPayroll`): 2% on every
   * table, + 2 000 000 oklad on the month's. Null for «ROP yoʻq» and for a team with
   * nobody paid now. `head` is the unit's head in Bitrix24, null if unnamed.
   */
  readonly ropPay: {
    readonly head: string | null
    /**
     * The FAKT 2 the 2% is taken of: every delivery SOLD UNDER this label,
     * read off the raw slices — not `fakt2`, which follows each seller's
     * newest team. A seller who moved mid-month leaves the old ROP's share
     * with the old ROP (`mergeSellerTeamSlices`' own rule for teams).
     */
    readonly basis: MoneyDto
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    readonly total: MoneyDto
  } | null
}

/**
 * One block of the table — Toshkent, Navoiy, Baza, Zextra, Boshqa (the client,
 * 2026-10-20). Summed from its teams, which are summed from the printed rows,
 * so the blocks add up to the fund to the soʻm.
 */
export interface PayrollBranchDto {
  readonly branch: PayrollBranch
  readonly label: string
  /** Its teams' labels, in `teams`' order. */
  readonly teams: readonly (string | null)[]
  readonly sellers: number
  readonly leads: number | null
  readonly fakt1Orders: number
  readonly fakt2Orders: number
  readonly conversion: number | null
  readonly fakt2: MoneyDto
  readonly percent: MoneyDto
  readonly fixed: MoneyDto
  /** The sellers' pay. */
  readonly total: MoneyDto
  /** How many of its teams' ROPs are paid. */
  readonly rops: number
  /** Σ its teams' `ropPay`, apart from the sellers' pay. */
  readonly ropTotal: MoneyDto
}

export interface PayrollDto {
  /** Which of the client's tables was applied. */
  readonly scheme: PayrollSchemeValue
  /**
   * Whether the period is still running.
   *
   * «Shu oy» runs to the end of today, so a window that has not finished
   * reports what has been delivered so far. The screen has to
   * be able to say that out loud, or a mid-period total reads as a final one.
   */
  readonly open: boolean
  /** Every seller with money delivered in the period, best FAKT 2 first. */
  readonly sellers: readonly PayrollSellerDto[]
  readonly totals: {
    readonly sellers: number
    readonly leads: number | null
    readonly fakt1Orders: number
    readonly fakt2Orders: number
    readonly conversion: number | null
    readonly fakt2: MoneyDto
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    /** The payroll fund for the period — what the office pays out in soʻm. */
    readonly total: MoneyDto
  }
  /** Σ `teams[].ropPay` — the ROPs' pay, kept apart from the sellers' fund. */
  readonly ropTotals: {
    readonly rops: number
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    readonly total: MoneyDto
  }
  /** `totals.total` + `ropTotals.total`, summed here in minor units — everything the period pays out. */
  readonly fund: MoneyDto
  /** The people paid a flat rate of their own (`FLAT_RATE_SELLERS`), named, for the rule card. */
  readonly flatRates: readonly { readonly fullName: string; readonly percentRate: number }[]
  /** Per ROP, the biggest fund first and «ROP yoʻq» last. Σ = `totals`. */
  readonly teams: readonly PayrollTeamDto[]
  /** The blocks that have a team, in `PAYROLL_BRANCHES`' order. Σ = `totals`. */
  readonly branches: readonly PayrollBranchDto[]
  /** The comparison window's totals, by the same table. */
  readonly previous: {
    readonly sellers: number
    /**
     * Sellers who delivered money then and have no row now — the biggest
     * possible fall, which no row and no mover list can show, so it is counted.
     */
    readonly gone: number
    readonly fakt2: MoneyDto
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    readonly total: MoneyDto
  }
  readonly deltas: {
    readonly fakt2: DeltaDto
    readonly percent: DeltaDto
    readonly fixed: DeltaDto
    readonly total: DeltaDto
  }
}

/**
 * «Maosh jadvali»'s day columns (the client, 2026-10-23: «sotuvchilar oyligi
 * … huddi shunday jadval usulida»): FAKT 2 per Tashkent day of the window,
 * per seller and per team label, off the payroll's own cohort
 * (`confirmationSellerDays`). A seller's days add up to the FAKT 2 they are
 * paid on; a label's days to its ROP's 2% basis. Pay is not split by day — a
 * tier is reached over the period, not on a Tuesday — so only FAKT 2 is.
 */
export interface PayrollDaysDto {
  /** Every Tashkent day of the window, oldest first, `YYYY-MM-DD`. */
  readonly days: readonly string[]
  /** The Tashkent day it is now. */
  readonly today: string
  /** Per employee id: FAKT 2 soʻm per day, in `days`' order — every team slice of theirs together. */
  readonly sellers: Readonly<Record<string, readonly number[]>>
  /** Per team label as sold under ('' for none): FAKT 2 soʻm per day — the ROP's basis. */
  readonly rops: Readonly<Record<string, readonly number[]>>
}

/** The Tashkent days a window covers, oldest first: its first day to the day of its last instant. */
export function windowDays(period: Period): string[] {
  const first = zonedDateKey(period.start, period.timeZone)
  const last = zonedDateKey(new Date(period.end.getTime() - 1), period.timeZone)
  const out: string[] = []
  for (let d = new Date(`${first}T00:00:00Z`); out.length < 400; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10)
    if (key > last) break
    out.push(key)
  }
  return out
}

/** The day rows of one window — the rows memo's clock and key, a scan of its own. */
const daysCache = ttlCache<ConfirmationSellerDayRow[]>(120_000, LIVE_CACHE)

/**
 * Two minutes, the same as every other live memo here and the sync worker's tick.
 *
 * Keyed on the whole question — scheme, window and currency. There is no scope in
 * the key because there is no scope in the answer: the endpoint asks for
 * `analytics:read:all`, so a narrowed account is refused rather than served a
 * narrowed payroll. If this screen is ever opened to a ROP, the scope goes in
 * this key in the same commit or the memo goes.
 *
 * PLAIN, NOT STALE-WHILE-REVALIDATE (2026-10-06). The rows under it
 * (`rowsCache`) already hand out an expired answer while they refresh behind
 * the reader. A second stale layer here rebuilt its DTO behind the reader
 * FROM those stale rows, so every poll was served rows one poll older than
 * either layer alone — 240 s behind at the screen's 120 s poll, and up to
 * 2 × (ttl + stale) at worst, past the bound `ttlCache` promises. Expired,
 * this memo makes its reader wait for `build()`, which is arithmetic over
 * memoised rows: only a window nothing has read yet costs a scan.
 */
const payrollCache = ttlCache<PayrollDto>(120_000)

/**
 * ONE WINDOW'S FAKT 2 ROWS, memoised on the window alone — 2026-10-06.
 *
 * The memo above is keyed on the comparison window too, and while a period
 * ran, that window's end moved with the clock, so a poll of the running week
 * or month regularly met a key it had never seen and rebuilt. Until this
 * memo, that rebuild ran BOTH rows scans in front of the reader — the current period's included, although its
 * window had not moved. Memoised here on start|end with stale-while-revalidate,
 * the current period's rows are served on every poll and refreshed behind
 * the reader; only the comparison's scan is ever waited for. The window is the
 * whole question: the rows are the same FAKT 2 whichever table pays
 * them and in whatever currency, so neither is in the key. This is the ONE
 * stale-while-revalidate layer on the screen — see `payrollCache` for why the
 * DTO over it is not another.
 */
const rowsCache = ttlCache<ConfirmationSellerRatingRow[]>(120_000, LIVE_CACHE)

/** Who heads each ROP team. Changes with the three-hourly reference pass. */
const headsCache = ttlCache<Map<string, string>>(600_000)

/** Each team label's unit ancestors, for the blocks. The same clock as the heads. */
const ancestorsCache = ttlCache<Map<string, string[]>>(600_000)

/** `FLAT_RATE_SELLERS` resolved to our employees. */
const flatCache = ttlCache<Map<string, FlatRate>>(600_000)

interface FlatRate {
  readonly bp: bigint
  readonly fullName: string
}

/** One window's leads per person, on the rows' own clock. */
const leadsCache = ttlCache<Map<string, number>>(120_000, LIVE_CACHE)

/**
 * Test seam: every memo is module state, shared by every case in a worker —
 * the hazard `resetSellerBoardCache` describes.
 */
export function resetPayrollCache(): void {
  payrollCache.clear()
  rowsCache.clear()
  headsCache.clear()
  ancestorsCache.clear()
  flatCache.clear()
  leadsCache.clear()
  daysCache.clear()
}

/** The leads reader — «ROP otchet»'s, so «Лид сони» is one number on both screens. */
export type PayrollLeadsSource = Pick<RegistrationRepository, 'sellerLeads'>

export class PayrollService {
  constructor(
    private readonly insights: InsightsRepository,
    /** Null leaves «Лид сони» and «Конверсия» unread («—»), never zero. */
    private readonly leadsSource: PayrollLeadsSource | null = null,
    /**
     * Where a read the payroll survives without is reported (the container
     * hands the logger). Injected rather than imported: the logger reads `env`.
     */
    private readonly warn: (context: Record<string, unknown>, message: string) => void = () => {},
  ) {}

  /**
   * The payroll over the dashboard's window, paid by the table its length
   * names. `previous` is the comparison window — the dashboard's own
   * `previousEquivalent`, built by the route.
   */
  async payroll(period: Period, previous: Period, currency: string, now: Date): Promise<PayrollDto> {
    return this.cached(payrollSchemeOf(period), period, previous, currency, now)
  }

  /** FAKT 2 per day of the window, per seller and per team label — see `PayrollDaysDto`. */
  async days(period: Period, now: Date): Promise<PayrollDaysDto> {
    const days = windowDays(period)
    const at = new Map(days.map((d, i) => [d, i]))
    const rows = await daysCache.get(`${period.start.toISOString()}|${period.end.toISOString()}`, () =>
      this.insights.confirmationSellerDays({ ...period, restrictToEmployeeIds: null }),
    )
    const sellers = new Map<string, bigint[]>()
    const rops = new Map<string, bigint[]>()
    const add = (into: Map<string, bigint[]>, key: string, i: number, minor: bigint) => {
      let list = into.get(key)
      if (!list) {
        list = days.map(() => 0n)
        into.set(key, list)
      }
      list[i] = (list[i] ?? 0n) + minor
    }
    for (const row of rows) {
      const i = at.get(row.day)
      if (i === undefined) continue
      add(sellers, row.employeeId, i, row.deliveredMinor)
      add(rops, row.rop ?? '', i, row.deliveredMinor)
    }
    const soms = (map: Map<string, bigint[]>) =>
      Object.fromEntries([...map].map(([key, list]) => [key, list.map((minor) => Number(minor) / 100)]))
    return { days, today: zonedDateKey(now, period.timeZone), sellers: soms(sellers), rops: soms(rops) }
  }

  private cached(
    scheme: PayrollSchemeValue,
    period: Period,
    previous: Period,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    /*
      The window's start alone does not name the period — «Bugun» and «Shu
      oy» share it on the 1st — so the scheme and the end are in the key as
      well, and the comparison window with them.
    */
    const key = [
      scheme,
      period.start.toISOString(),
      period.end.toISOString(),
      previous.start.toISOString(),
      previous.end.toISOString(),
      keyPart(currency),
    ].join('|')
    return payrollCache.get(key, () => this.build(scheme, period, previous, currency, now))
  }

  /*
    COMPANY-WIDE, EXPLICITLY. `restrictToEmployeeIds: null` is the value the
    repository reads as "everybody", written here rather than left to a
    default so the one screen that states salaries says whose rows it asks
    for; and no filters, so no brand — the board's «Hammasi».

    FOLDED TO ONE ROW PER PERSON. The rating hands back a slice per seller
    and team since the team became the deal's own snapshot (2026-09-26),
    and pay is a person's: two slices would split one FAKT 2 across the
    tiers and rank one seller twice. See `mergeSellerTeamSlices`.
  */
  private slices(period: Period): Promise<ConfirmationSellerRatingRow[]> {
    return rowsCache.get(`${period.start.toISOString()}|${period.end.toISOString()}`, () =>
      this.insights.confirmationSellerRating({ ...period, restrictToEmployeeIds: null }),
    )
  }

  private async rows(period: Period): Promise<ConfirmationSellerRatingRow[]> {
    return mergeSellerTeamSlices(await this.slices(period))
  }

  /*
    A NAME, NEVER A REASON TO FAIL. The heads only label the ROP rows; a
    refused lookup prints the team label instead of taking the payroll down.
  */
  private heads(): Promise<Map<string, string>> {
    return headsCache.get('heads', () => this.insights.ropHeadNames()).catch(() => new Map())
  }

  /*
    A PLACE ON THE PAGE, NEVER A REASON TO FAIL. A refused tree prints every
    team under «Boshqa» — visible, and nobody's pay moves with it.
  */
  private ancestors(): Promise<Map<string, string[]>> {
    return ancestorsCache.get('ancestors', () => this.insights.ropAncestorNames()).catch((err: unknown) => {
      this.warn({ err }, 'payroll: unit tree unread; every team prints under «Boshqa»')
      return new Map()
    })
  }

  /*
    MONEY, SO A FAILURE IS THE PAYROLL'S. Swallowed, a refused lookup would
    pay the flat-rate seller by the standard table without a word — and so
    would a lookup that answers and finds NOBODY (the row re-created, not yet
    synced), which is why an unresolved id throws too.
  */
  private flatRates(): Promise<Map<string, FlatRate>> {
    return flatCache.get('flat', async () => {
      const found = await this.insights.employeesByExternalId(Object.keys(FLAT_RATE_SELLERS))
      const out = new Map<string, FlatRate>()
      for (const [externalId, bp] of Object.entries(FLAT_RATE_SELLERS)) {
        const employee = found.get(externalId)
        if (employee === undefined) throw new Error(`payroll: flat-rate seller ${externalId} has no employee row`)
        out.set(employee.id, { bp, fullName: employee.fullName })
      }
      return out
    })
  }

  /*
    THE WINDOW'S CALENDAR DAYS, as «ROP otchet» takes them: «Лид сони» is
    counted by «Лид таркатилган сана», a DATE, from the first day to the last
    (the end is exclusive, so the last day is the one before it). Informational
    — a refused read is «—» in the column, not the payroll down.
  */
  private leads(period: Period): Promise<Map<string, number> | null> {
    const source = this.leadsSource
    if (source === null) return Promise.resolve(null)
    const from = zonedDateKey(period.start, period.timeZone)
    const to = zonedDateKey(new Date(period.end.getTime() - 1), period.timeZone)
    return leadsCache
      .get(`${from}|${to}`, async () => {
        const out = new Map<string, number>()
        for (const row of await source.sellerLeads(from, to)) {
          if (row.employeeId !== null) out.set(row.employeeId, (out.get(row.employeeId) ?? 0) + row.leads)
        }
        return out
      })
      .catch((err: unknown) => {
        this.warn({ err, from, to }, 'payroll: leads unread; «Lid soni» prints «—»')
        return null
      })
  }

  private async build(
    scheme: PayrollSchemeValue,
    period: Period,
    previousPeriod: Period,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    /*
      Both windows at once, through the same query. An empty comparison
      window (a period that has not started) is not asked for at all.
    */
    const [slices, previousRows, heads, ancestors, flat, leads] = await Promise.all([
      this.slices(period),
      previousPeriod.end.getTime() > previousPeriod.start.getTime()
        ? this.rows(previousPeriod)
        : Promise.resolve([] as ConfirmationSellerRatingRow[]),
      this.heads(),
      this.ancestors(),
      this.flatRates(),
      this.leads(period),
    ])
    /*
      WHICH TABLE PAYS A ROW: a flat rate of the person's own first, then
      БАЗА's for the two БАЗА teams, else the standard one. By the row's team
      label — the team of their newest order once folded, so a seller is paid
      by the table of the block they are printed in.
    */
    const tableOf = (row: {
      readonly employeeId: string
      readonly rop: string | null
    }): { readonly table: PayrollTableValue } & Pick<PayrollInput, 'flatBp'> => {
      const own = flat.get(row.employeeId)
      if (own !== undefined) return { table: 'flat', flatBp: own.bp }
      return { table: isBaseTeam(row.rop) ? 'baza' : 'standard' }
    }
    /*
      PAID PEOPLE ONLY. The queue cohort also carries everyone whose orders
      are still queued or were refused — on the board, not on a payroll.
    */
    const rows = mergeSellerTeamSlices(slices).filter((row) => row.deliveredMinor > 0n)
    /* The ROPs' basis: what was sold under each label, slice by slice. */
    const ropBasis = new Map<string, bigint>()
    for (const slice of slices) {
      if (slice.rop !== null) ropBasis.set(slice.rop, (ropBasis.get(slice.rop) ?? 0n) + slice.deliveredMinor)
    }

    /*
      THE COMPARISON WINDOW IS PAID BY THE SAME TABLE. A half against a half,
      a week against a week — so «oʻtgan davr JAMI» is what the same person
      would have been paid then, not a figure from a different rule.
    */
    // Paid people only, as now: the cohort also carries the queued and refused.
    const previousPay = previousRows.filter((row) => row.deliveredMinor > 0n).map((row) => ({
      employeeId: row.employeeId,
      rop: row.rop,
      fakt2: row.deliveredMinor,
      pay: sellerPayroll({ basisMinor: row.deliveredMinor, scheme, ...tableOf(row) }),
    }))
    /*
      «HAD A PREVIOUS» MEANS DELIVERED MONEY THEN. The cohort carries sellers
      with nothing delivered (queued, refused), and an order booked at 0 soʻm
      makes a FAKT 2 of 0 too; counting that as a baseline would
      print «baza yoʻq · oldin 0» where the screen means «yangi», and rank
      them top of the risers with their whole FAKT 2.
    */
    const previousById = new Map(
      previousPay.filter((row) => row.fakt2 > 0n).map((row) => [row.employeeId, row]),
    )

    /*
      FAKT 2, THEN FAKT 1, THEN THE ID — the board's own order, so a seller's
      place here is their place on Savdo dinamikasi. The id is the last resort
      so two people level on both do not swap places between refreshes.
    */
    const ordered = [...rows].sort(
      (a, b) =>
        (b.deliveredMinor > a.deliveredMinor ? 1 : b.deliveredMinor < a.deliveredMinor ? -1 : 0) ||
        (b.confirmedMinor > a.confirmedMinor ? 1 : b.confirmedMinor < a.confirmedMinor ? -1 : 0) ||
        a.employeeId.localeCompare(b.employeeId),
    )

    /* Equal on BOTH figures, equal rank, and the next rank skips. */
    const rankOf = ordered.map((row, index) => {
      const above = index > 0 ? ordered[index - 1] : undefined
      return above &&
        above.deliveredMinor === row.deliveredMinor &&
        above.confirmedMinor === row.confirmedMinor
        ? -1
        : index + 1
    })
    for (let i = 1; i < rankOf.length; i++) {
      if (rankOf[i] === -1) rankOf[i] = rankOf[i - 1]!
    }

    const cash = (minor: bigint) => toMoneyDto(money(minor, currency))
    /*
      IN SOʻM, NOT TIYIN. The ratio is the same either way, but a «baza kichik»
      delta carries both sides to the screen, which prints them as they come —
      in minor units they read a hundred times too large.
    */
    const delta = (current: bigint, previous: bigint | null) =>
      toDeltaDto(growth(cash(current).amount, previous === null ? 0 : cash(previous).amount))

    const sellers = ordered.map<PayrollSellerDto>((row, index) => {
      const rank = rankOf[index]!
      const table = tableOf(row)
      const pay = sellerPayroll({ basisMinor: row.deliveredMinor, scheme, ...table })
      const before = previousById.get(row.employeeId)
      const leadCount = leads === null ? null : (leads.get(row.employeeId) ?? 0)

      return {
        rank,
        employeeId: row.employeeId,
        fullName: row.fullName,
        rop: row.rop,
        branch: payrollBranchOf(row.rop, ancestors),
        table: table.table,
        leads: leadCount,
        fakt1Orders: row.confirmedOrders,
        conversion: conversionOf(row.confirmedOrders, leadCount),
        fakt2: cash(row.deliveredMinor),
        fakt2Orders: row.deliveredOrders,
        percentRate: Number(pay.percentBp) / 100,
        percent: cash(pay.percentMinor),
        fixed: cash(pay.fixedMinor),
        total: cash(pay.totalMinor),
        tierFloor: pay.tierFloorMinor === null ? null : cash(pay.tierFloorMinor),
        nextFloor: pay.nextFloorMinor === null ? null : cash(pay.nextFloorMinor),
        toNext: pay.toNextMinor === null ? null : cash(pay.toNextMinor),
        previous: before
          ? { fakt2: cash(before.fakt2), total: cash(before.pay.totalMinor) }
          : null,
        fakt2Delta: delta(row.deliveredMinor, before?.fakt2 ?? null),
        totalDelta: delta(pay.totalMinor, before?.pay.totalMinor ?? null),
      }
    })

    /*
      THE FUND IS SUMMED FROM THE ROWS THE SCREEN PRINTS, in minor units, and
      never recomputed from the total FAKT 2: 8% of the sum is not the sum of
      each person's rounded 8%, and the tiers are per person by definition.
      A footer that disagreed with its own column by a few soʻm is exactly the
      kind of thing that costs an afternoon to explain.
    */
    const minor = (value: MoneyDto) => BigInt(value.amountMinor)
    const sum = (pick: (row: PayrollSellerDto) => MoneyDto) =>
      sellers.reduce((acc, row) => acc + minor(pick(row)), 0n)

    const then = {
      fakt2: previousPay.reduce((acc, row) => acc + row.fakt2, 0n),
      percent: previousPay.reduce((acc, row) => acc + row.pay.percentMinor, 0n),
      fixed: previousPay.reduce((acc, row) => acc + row.pay.fixedMinor, 0n),
      total: previousPay.reduce((acc, row) => acc + row.pay.totalMinor, 0n),
    }
    const current = {
      fakt2: sum((row) => row.fakt2),
      percent: sum((row) => row.percent),
      fixed: sum((row) => row.fixed),
      total: sum((row) => row.total),
    }
    const counts = countsOf(sellers, leads !== null)

    const printed = new Set(rows.map((row) => row.employeeId))
    const teams = teamsOf(sellers, previousPay, cash, delta, scheme, heads, ropBasis, ancestors, leads !== null)
    const paidRops = teams.flatMap((team) => (team.ropPay ? [team.ropPay] : []))

    return {
      scheme,
      open: period.end.getTime() > now.getTime(),
      sellers,
      totals: {
        sellers: sellers.length,
        ...counts,
        fakt2: cash(current.fakt2),
        percent: cash(current.percent),
        fixed: cash(current.fixed),
        total: cash(current.total),
      },
      teams,
      branches: branchesOf(teams, sellers, cash, leads !== null),
      ropTotals: {
        rops: paidRops.length,
        percent: cash(paidRops.reduce((acc, pay) => acc + minor(pay.percent), 0n)),
        fixed: cash(paidRops.reduce((acc, pay) => acc + minor(pay.fixed), 0n)),
        total: cash(paidRops.reduce((acc, pay) => acc + minor(pay.total), 0n)),
      },
      fund: cash(current.total + paidRops.reduce((acc, pay) => acc + minor(pay.total), 0n)),
      flatRates: [...flat.values()].map((rate) => ({ fullName: rate.fullName, percentRate: Number(rate.bp) / 100 })),
      previous: {
        sellers: previousPay.length,
        gone: [...previousById.keys()].filter((id) => !printed.has(id)).length,
        fakt2: cash(then.fakt2),
        percent: cash(then.percent),
        fixed: cash(then.fixed),
        total: cash(then.total),
      },
      deltas: {
        fakt2: delta(current.fakt2, then.fakt2),
        percent: delta(current.percent, then.percent),
        fixed: delta(current.fixed, then.fixed),
        total: delta(current.total, then.total),
      },
    }
  }
}

/**
 * The ROP cards, summed from the rows the screen prints — never re-read from
 * the database by team — so the cards add up to the fund exactly.
 */
function teamsOf(
  sellers: readonly PayrollSellerDto[],
  previousPay: readonly {
    readonly rop: string | null
    readonly fakt2: bigint
    readonly pay: { readonly totalMinor: bigint }
  }[],
  cash: (minor: bigint) => MoneyDto,
  delta: (current: bigint, previous: bigint | null) => DeltaDto,
  scheme: PayrollSchemeValue,
  heads: ReadonlyMap<string, string>,
  ropBasis: ReadonlyMap<string, bigint>,
  ancestors: ReadonlyMap<string, readonly string[]>,
  leadsRead: boolean,
): PayrollTeamDto[] {
  const minor = (value: MoneyDto) => BigInt(value.amountMinor)

  const now = new Map<string | null, { sellers: PayrollSellerDto[]; fakt2: bigint; percent: bigint; fixed: bigint; total: bigint }>()
  const empty = () => ({ sellers: [] as PayrollSellerDto[], fakt2: 0n, percent: 0n, fixed: 0n, total: 0n })
  for (const row of sellers) {
    const held = now.get(row.rop) ?? empty()
    now.set(row.rop, {
      sellers: [...held.sellers, row],
      fakt2: held.fakt2 + minor(row.fakt2),
      percent: held.percent + minor(row.percent),
      fixed: held.fixed + minor(row.fixed),
      total: held.total + minor(row.total),
    })
  }

  /* A team's baseline, like a seller's, is money delivered then. */
  const then = new Map<string | null, { sellers: number; fakt2: bigint; total: bigint }>()
  for (const row of previousPay) {
    if (row.fakt2 <= 0n) continue
    const held = then.get(row.rop) ?? { sellers: 0, fakt2: 0n, total: 0n }
    then.set(row.rop, {
      sellers: held.sellers + 1,
      fakt2: held.fakt2 + row.fakt2,
      total: held.total + row.pay.totalMinor,
    })
  }

  /*
    A TEAM PAID THEN AND EMPTY NOW STAYS, at zero. Dropped, its fall would be
    the one change the bars could not show, and Σ previous over the teams
    would stop being the previous fund. It has no sellers, so no card draws.
  */
  for (const rop of then.keys()) {
    if (!now.has(rop)) now.set(rop, empty())
  }
  /* A label only a moved seller sold under still pays its ROP — no card draws. */
  for (const [rop, basis] of ropBasis) {
    if (basis > 0n && !now.has(rop)) now.set(rop, empty())
  }

  return [...now.entries()]
    .map(([rop, team]): PayrollTeamDto => {
      const before = then.get(rop) ?? null
      const basis = rop === null ? 0n : (ropBasis.get(rop) ?? 0n)
      const pay = basis > 0n ? ropPayroll({ basisMinor: basis, scheme }) : null
      return {
        rop,
        branch: payrollBranchOf(rop, ancestors),
        sellers: team.sellers.length,
        ...countsOf(team.sellers, leadsRead),
        fakt2: cash(team.fakt2),
        percent: cash(team.percent),
        fixed: cash(team.fixed),
        total: cash(team.total),
        previous: before
          ? { sellers: before.sellers, fakt2: cash(before.fakt2), total: cash(before.total) }
          : null,
        fakt2Delta: delta(team.fakt2, before?.fakt2 ?? null),
        totalDelta: delta(team.total, before?.total ?? null),
        ropPay: pay && {
          head: (rop !== null && heads.get(rop)) || null,
          basis: cash(basis),
          percent: cash(pay.percentMinor),
          fixed: cash(pay.fixedMinor),
          total: cash(pay.totalMinor),
        },
      }
    })
    .sort(
      (a, b) =>
        Number(a.rop === null) - Number(b.rop === null) ||
        (minor(b.total) > minor(a.total) ? 1 : minor(b.total) < minor(a.total) ? -1 : 0) ||
        (a.rop ?? '').localeCompare(b.rop ?? '', 'ru'),
    )
}

/** «ROP otchet»'s «Конверсия»: Транз-1 ÷ Лид сони × 100, null with no lead to divide by. */
function conversionOf(fakt1Orders: number, leads: number | null): number | null {
  return leads !== null && leads > 0 ? (fakt1Orders / leads) * 100 : null
}

/**
 * The order and lead counts of a set of printed rows, and their conversion OF
 * THE SUMS — over the rows that were handed a lead. БАЗА is handed none (it
 * works the old customers by phone), and its orders over everybody's leads
 * would lift a block's or the company's «Konversiya» by orders no lead made.
 */
function countsOf(
  rows: readonly PayrollSellerDto[],
  leadsRead: boolean,
): Pick<PayrollTeamDto, 'leads' | 'fakt1Orders' | 'fakt2Orders' | 'conversion'> {
  const leads = leadsRead ? rows.reduce((acc, row) => acc + (row.leads ?? 0), 0) : null
  const ledOrders = rows.reduce((acc, row) => acc + ((row.leads ?? 0) > 0 ? row.fakt1Orders : 0), 0)
  return {
    leads,
    fakt1Orders: rows.reduce((acc, row) => acc + row.fakt1Orders, 0),
    fakt2Orders: rows.reduce((acc, row) => acc + row.fakt2Orders, 0),
    conversion: conversionOf(ledOrders, leads),
  }
}

/**
 * The blocks, summed from the teams — which are summed from the printed rows —
 * in `PAYROLL_BRANCHES`' order; a block with no team is not drawn.
 */
function branchesOf(
  teams: readonly PayrollTeamDto[],
  sellers: readonly PayrollSellerDto[],
  cash: (minor: bigint) => MoneyDto,
  leadsRead: boolean,
): PayrollBranchDto[] {
  const minor = (value: MoneyDto) => BigInt(value.amountMinor)
  return PAYROLL_BRANCHES.flatMap((branch) => {
    const own = teams.filter((team) => team.branch === branch)
    if (own.length === 0) return []
    const sum = (pick: (team: PayrollTeamDto) => MoneyDto) => cash(own.reduce((acc, team) => acc + minor(pick(team)), 0n))
    const paid = own.flatMap((team) => (team.ropPay ? [team.ropPay] : []))
    return [
      {
        branch,
        label: PAYROLL_BRANCH_LABEL[branch],
        teams: own.map((team) => team.rop),
        sellers: own.reduce((acc, team) => acc + team.sellers, 0),
        // A seller's block is their team's (`payrollBranchOf` on the same label), so these are its teams' rows.
        ...countsOf(sellers.filter((row) => row.branch === branch), leadsRead),
        fakt2: sum((team) => team.fakt2),
        percent: sum((team) => team.percent),
        fixed: sum((team) => team.fixed),
        total: sum((team) => team.total),
        rops: paid.length,
        ropTotal: cash(paid.reduce((acc, pay) => acc + minor(pay.total), 0n)),
      },
    ]
  })
}
