/**
 * Deterministic demo CRM provider.
 *
 * Implements the same `CrmProvider` interface the Bitrix24 provider will, so
 * demo data travels the identical path real data will:
 *
 *     DemoCrmProvider -> SyncEngine -> database -> analytics -> API -> dashboard
 *
 * Nothing downstream can tell the difference, which is the whole point: when
 * the real credentials arrive, only the provider changes.
 *
 * DETERMINISM
 * The full dataset is generated once, lazily, from (seed, referenceDate) and
 * cached on the instance. The same inputs always produce the same employees,
 * deals and revenue — on any machine, in any process. Nothing here reads the
 * clock on its own; `referenceDate` is injected and truncated to a whole day,
 * so a dataset stays identical for the whole day it was generated in.
 *
 * Once seeded into PostgreSQL the data is simply stored, so the dashboard is
 * stable regardless. Regeneration only happens on an explicit re-seed.
 */

import {
  type CrmProvider,
  type FetchOptions,
  type Page,
  type ProviderCapabilities,
  type ProviderHealth,
  type RawCustomer,
  type RawDeal,
  type RawDealItem,
  type RawDepartment,
  type RawEmployee,
  type RawPayment,
  type RawProduct,
  type RawProductCategory,
  type RawSalesSource,
  type RawStage,
} from '@/server/integrations/crm/CrmProvider'
import type {
  DealStatusValue,
  ExternalSourceValue,
  PaymentMethodValue,
  StageCategoryValue,
} from '@/server/domain/types'
import { statusForStageCategory } from '@/server/domain/types'

import {
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  DEPARTMENTS,
  GIVEN_NAMES_FEMALE,
  GIVEN_NAMES_MALE,
  POSITIONS,
  PRODUCTS,
  PRODUCT_CATEGORIES,
  REGIONS,
  SALES_SOURCES,
  STAGES,
  SURNAMES,
  feminineSurname,
} from './catalogue'
import { Rng } from './rng'

const DAY_MS = 86_400_000

export interface DemoProviderOptions {
  readonly seed: number
  /** Datasets end here. Truncated to a whole UTC day for stability. */
  readonly referenceDate: Date
  /** How much history to generate. */
  readonly historyDays?: number
  readonly employeeCount?: number
  readonly customerCount?: number
  readonly dealCount?: number
  readonly currency?: string
  readonly defaultPageSize?: number
}

interface DemoDataset {
  readonly departments: RawDepartment[]
  readonly employees: RawEmployee[]
  readonly productCategories: RawProductCategory[]
  readonly products: RawProduct[]
  readonly stages: RawStage[]
  readonly sources: RawSalesSource[]
  readonly customers: RawCustomer[]
  readonly deals: RawDeal[]
  readonly dealItems: RawDealItem[]
  readonly payments: RawPayment[]
}

export class DemoCrmProvider implements CrmProvider {
  readonly source: ExternalSourceValue = 'DEMO'

  /**
   * The demo provider is a TEST FIXTURE, not a data source.
   *
   * Production runs on Bitrix24 and nothing else. What survives here is the
   * generator the sync-engine and analytics tests run against, so those tests
   * keep working without a portal or a network.
   *
   * It supplies payments, which the Bitrix24 provider deliberately does not.
   * That asymmetry is the point: it exercises the capability mechanism in the
   * test suite rather than on the day of a cutover.
   *
   * The entities added for the superdashboard modules — pipelines, stage
   * history, calls, stores, stock — are declared FALSE. Generating plausible
   * delivery timings would let a test pass against data no portal produced.
   */
  readonly capabilities: ProviderCapabilities = Object.freeze({
    DEPARTMENTS: true,
    EMPLOYEES: true,
    PRODUCT_CATEGORIES: true,
    PRODUCTS: true,
    PIPELINES: false,
    STAGES: true,
    SOURCES: true,
    CUSTOMERS: true,
    DEALS: true,
    DEAL_ITEMS: true,
    PAYMENTS: true,
    STAGE_HISTORY: false,
    CALLS: false,
    STORES: false,
    STOCK: false,
  })

  private readonly options: Required<DemoProviderOptions>
  private cache: DemoDataset | null = null

  constructor(options: DemoProviderOptions) {
    const referenceDate = new Date(
      Math.floor(options.referenceDate.getTime() / DAY_MS) * DAY_MS,
    )

    if (Number.isNaN(referenceDate.getTime())) {
      throw new TypeError('DemoCrmProvider: referenceDate is not a valid date')
    }

    this.options = {
      seed: options.seed,
      referenceDate,
      historyDays: options.historyDays ?? 540, // ~18 months, enough for YoY trends
      employeeCount: options.employeeCount ?? 14,
      customerCount: options.customerCount ?? 220,
      dealCount: options.dealCount ?? 1_600,
      currency: options.currency ?? 'UZS',
      defaultPageSize: options.defaultPageSize ?? 500,
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const data = this.dataset()
    return {
      ok: true,
      detail:
        `Demo provider ready (seed ${this.options.seed}): ` +
        `${data.employees.length} employees, ${data.deals.length} deals.`,
    }
  }

  // -------------------------------------------------------------------------
  // Fetch methods
  // -------------------------------------------------------------------------

  async fetchDepartments(o?: FetchOptions) { return this.page(this.dataset().departments, o) }
  async fetchEmployees(o?: FetchOptions) { return this.page(this.dataset().employees, o) }
  async fetchProductCategories(o?: FetchOptions) { return this.page(this.dataset().productCategories, o) }
  async fetchProducts(o?: FetchOptions) { return this.page(this.dataset().products, o) }
  async fetchStages(o?: FetchOptions) { return this.page(this.dataset().stages, o) }
  async fetchSources(o?: FetchOptions) { return this.page(this.dataset().sources, o) }
  async fetchCustomers(o?: FetchOptions) { return this.page(this.dataset().customers, o) }
  async fetchDeals(o?: FetchOptions) { return this.page(this.dataset().deals, o) }
  async fetchDealItems(o?: FetchOptions) { return this.page(this.dataset().dealItems, o) }
  async fetchPayments(o?: FetchOptions) { return this.page(this.dataset().payments, o) }

  // Declared unsupported above, so the sync engine never calls these. They
  // exist to satisfy the interface, and returning an empty page is honest:
  // this provider genuinely has no delivery timings or call recordings.
  async fetchPipelines(_o?: FetchOptions) { return this.page([], _o) }
  async fetchStageHistory(_o?: FetchOptions) { return this.page([], _o) }
  async fetchCalls(_o?: FetchOptions) { return this.page([], _o) }
  async fetchStores(_o?: FetchOptions) { return this.page([], _o) }
  async fetchStockLevels(_o?: FetchOptions) { return this.page([], _o) }

  /**
   * Slice a collection into a page.
   *
   * Honours `updatedSince` by filtering client-side. Bitrix24 will filter
   * server-side instead, but the contract the sync engine sees is identical.
   */
  private page<T extends { readonly updatedAtSource?: Date }>(
    all: readonly T[],
    options: FetchOptions = {},
  ): Page<T> {
    const filtered = options.updatedSince
      ? all.filter(
          (item) =>
            item.updatedAtSource !== undefined &&
            item.updatedAtSource.getTime() >= options.updatedSince!.getTime(),
        )
      : all

    const pageSize = Math.max(1, options.pageSize ?? this.options.defaultPageSize)
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0

    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError(`DemoCrmProvider: malformed cursor "${options.cursor}"`)
    }

    const items = filtered.slice(offset, offset + pageSize)
    const nextOffset = offset + items.length

    return nextOffset < filtered.length
      ? { items, nextCursor: String(nextOffset) }
      : { items }
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  /** Generate once, then reuse. Repeated calls return the identical objects. */
  private dataset(): DemoDataset {
    if (this.cache) return this.cache
    this.cache = this.generate()
    return this.cache
  }

  private generate(): DemoDataset {
    const { seed, referenceDate, historyDays, currency } = this.options
    const rng = new Rng(seed)

    const endMs = referenceDate.getTime()
    const startMs = endMs - historyDays * DAY_MS

    const departments: RawDepartment[] = DEPARTMENTS.map((d) => ({
      externalId: d.externalId,
      name: d.name,
      isActive: true,
      updatedAtSource: referenceDate,
    }))

    const productCategories: RawProductCategory[] = PRODUCT_CATEGORIES.map((c) => ({
      externalId: c.externalId,
      name: c.name,
      isActive: true,
      updatedAtSource: referenceDate,
    }))

    const products: RawProduct[] = PRODUCTS.map((p) => ({
      externalId: p.externalId,
      name: p.name,
      sku: p.externalId.toUpperCase(),
      categoryExternalId: p.categoryExternalId,
      priceMinor: p.basePriceMinor,
      currency,
      isActive: true,
      updatedAtSource: referenceDate,
    }))

    const stages: RawStage[] = STAGES.map((s) => ({
      externalId: s.externalId,
      name: s.name,
      category: s.category as StageCategoryValue,
      sortOrder: s.sortOrder,
      isActive: true,
      updatedAtSource: referenceDate,
    }))

    const sources: RawSalesSource[] = SALES_SOURCES.map((s) => ({
      externalId: s.externalId,
      name: s.name,
      isActive: true,
      updatedAtSource: referenceDate,
    }))

    const employees = this.generateEmployees(rng, startMs)
    const customers = this.generateCustomers(rng)

    const { deals, dealItems, payments } = this.generateDeals(
      rng,
      employees,
      customers,
      startMs,
      endMs,
    )

    return {
      departments,
      employees,
      productCategories,
      products,
      stages,
      sources,
      customers,
      deals,
      dealItems,
      payments,
    }
  }

  private generateEmployees(rng: Rng, startMs: number): RawEmployee[] {
    const { employeeCount, referenceDate } = this.options
    const employees: RawEmployee[] = []

    for (let i = 0; i < employeeCount; i++) {
      const isFemale = rng.bool(0.45)
      const given = isFemale ? rng.pick(GIVEN_NAMES_FEMALE) : rng.pick(GIVEN_NAMES_MALE)
      const baseSurname = rng.pick(SURNAMES)
      const surname = isFemale ? feminineSurname(baseSurname) : baseSurname

      // A couple of former employees keep historical data honest: their deals
      // still count toward past periods even though they are inactive now.
      const isActive = i >= employeeCount - 2 ? rng.bool(0.3) : true

      employees.push({
        externalId: `emp-${String(i + 1).padStart(3, '0')}`,
        fullName: `${given} ${surname}`,
        email: `${transliterate(given)}.${transliterate(baseSurname)}@sinolife.uz`.toLowerCase(),
        phone: `+998 ${rng.int(90, 99)} ${rng.int(100, 999)}-${rng.int(10, 99)}-${rng.int(10, 99)}`,
        position: rng.pick(POSITIONS),
        departmentExternalId: rng.pick(DEPARTMENTS).externalId,
        isActive,
        hiredAt: new Date(startMs - rng.int(0, 900) * DAY_MS),
        updatedAtSource: referenceDate,
      })
    }

    return employees
  }

  private generateCustomers(rng: Rng): RawCustomer[] {
    const { customerCount, referenceDate } = this.options
    const customers: RawCustomer[] = []

    for (let i = 0; i < customerCount; i++) {
      const isCompany = rng.bool(0.35)

      let name: string
      if (isCompany) {
        name = `${rng.pick(COMPANY_PREFIXES)} ${rng.pick(COMPANY_SUFFIXES)}`
      } else {
        const isFemale = rng.bool(0.5)
        const given = isFemale ? rng.pick(GIVEN_NAMES_FEMALE) : rng.pick(GIVEN_NAMES_MALE)
        const baseSurname = rng.pick(SURNAMES)
        name = `${given} ${isFemale ? feminineSurname(baseSurname) : baseSurname}`
      }

      customers.push({
        externalId: `cus-${String(i + 1).padStart(4, '0')}`,
        name,
        isCompany,
        phone: `+998 ${rng.int(90, 99)} ${rng.int(100, 999)}-${rng.int(10, 99)}-${rng.int(10, 99)}`,
        region: rng.pick(REGIONS),
        updatedAtSource: referenceDate,
      })
    }

    return customers
  }

  /**
   * Generate deals with their line items and payments.
   *
   * Shape of the simulated business, chosen so the dashboard exercises real
   * analytics rather than flat noise:
   *   - performance varies per employee (a strength multiplier), so the
   *     leaderboard has a genuine spread instead of a dead heat;
   *   - revenue trends mildly upward with a seasonal wobble, so period-over-
   *     period comparison shows plausible movement;
   *   - older deals are mostly resolved, recent ones mostly still open, which
   *     is what a real pipeline looks like at any given moment.
   */
  private generateDeals(
    rng: Rng,
    employees: readonly RawEmployee[],
    customers: readonly RawCustomer[],
    startMs: number,
    endMs: number,
  ): Pick<DemoDataset, 'deals' | 'dealItems' | 'payments'> {
    const { dealCount, currency, referenceDate, historyDays } = this.options

    const deals: RawDeal[] = []
    const dealItems: RawDealItem[] = []
    const payments: RawPayment[] = []

    // Per-employee strength: a few stars, a long tail. Fixed by the seed.
    const strength = new Map<string, number>()
    for (const employee of employees) {
      strength.set(employee.externalId, rng.float(0.55, 1.7))
    }

    const employeeWeights = employees.map(
      (e) => [e, (strength.get(e.externalId) ?? 1) * (e.isActive ? 1 : 0.25)] as const,
    )

    const sourceWeights = SALES_SOURCES.map((s) => [s.externalId, s.weight] as const)

    const wonStage = STAGES.find((s) => s.category === 'WON')!
    const lostStage = STAGES.find((s) => s.category === 'LOST')!
    const openStages = STAGES.filter(
      (s) => s.category === 'NEW' || s.category === 'IN_PROGRESS',
    )

    let itemSeq = 0
    let paymentSeq = 0

    for (let i = 0; i < dealCount; i++) {
      const externalId = `deal-${String(i + 1).padStart(5, '0')}`

      // Position in history, skewed slightly toward recent activity.
      const progress = Math.pow(rng.next(), 0.85)
      const createdMs = startMs + Math.floor(progress * (endMs - startMs))
      const createdAtSource = new Date(createdMs)

      const ageDays = (endMs - createdMs) / DAY_MS

      const employee = rng.weighted(employeeWeights)
      const employeeStrength = strength.get(employee.externalId) ?? 1

      // Older deals have had time to resolve; recent ones are still in flight.
      const resolvedProbability = Math.min(0.95, ageDays / 45)
      const isResolvedDeal = rng.bool(resolvedProbability)

      let stageExternalId: string
      let status: DealStatusValue
      let closedAt: Date | undefined

      if (isResolvedDeal) {
        // Win rate tracks the rep's strength, centred near 55%.
        const winProbability = Math.min(0.82, Math.max(0.22, 0.34 * employeeStrength))
        const won = rng.bool(winProbability)
        stageExternalId = won ? wonStage.externalId : lostStage.externalId
        status = won ? 'WON' : 'LOST'

        const cycleDays = rng.normalInt(14, 9, 1, 90)
        const closedMs = Math.min(endMs - 1, createdMs + cycleDays * DAY_MS)
        closedAt = new Date(closedMs)
      } else {
        const stage = rng.weighted(
          openStages.map((s) => [s, s.category === 'NEW' ? 3 : 2] as const),
        )
        stageExternalId = stage.externalId
        status = statusForStageCategory(stage.category as StageCategoryValue)
      }

      // Mild upward trend plus a seasonal wobble, so trends are not flat noise.
      const trend = 1 + 0.22 * (1 - ageDays / historyDays)
      const seasonal = 1 + 0.12 * Math.sin((createdMs / DAY_MS) * ((2 * Math.PI) / 365))

      const customer = rng.pick(customers)

      // Build line items first; the deal amount is their sum, so the two can
      // never disagree — a mismatch would make product analytics contradict
      // revenue analytics.
      const lineCount = rng.weighted([
        [1, 45],
        [2, 30],
        [3, 15],
        [4, 10],
      ] as const)

      const chosenProducts = rng.shuffle(PRODUCTS).slice(0, lineCount)
      let amountMinor = 0n

      for (const product of chosenProducts) {
        // Weighted toward small orders with a real bulk tail — a distributor
        // pipeline where most deals are modest and a few are large. A uniform
        // spread would flatten the leaderboard and hide the outliers the
        // dashboard exists to surface.
        const quantity = rng.weighted([
          [2, 22],
          [5, 24],
          [10, 20],
          [20, 15],
          [40, 11],
          [80, 6],
          [150, 2],
        ] as const)

        // Discount or uplift within a believable band, applied in integer math.
        const adjustmentBp = BigInt(rng.int(9_200, 11_500)) // 92% .. 115%
        const unitPriceMinor =
          (product.basePriceMinor *
            adjustmentBp *
            BigInt(Math.round(trend * seasonal * 1000))) /
          (10_000n * 1000n)

        const totalMinor = unitPriceMinor * BigInt(quantity)
        amountMinor += totalMinor

        dealItems.push({
          externalId: `item-${String(++itemSeq).padStart(6, '0')}`,
          dealExternalId: externalId,
          productExternalId: product.externalId,
          quantity,
          unitPriceMinor,
          totalMinor,
          updatedAtSource: referenceDate,
        })
      }

      deals.push({
        externalId,
        title: `${customer.name} — ${chosenProducts[0]!.name}`,
        amountMinor,
        currency,
        stageExternalId,
        status,
        employeeExternalId: employee.externalId,
        customerExternalId: customer.externalId,
        sourceExternalId: rng.weighted(sourceWeights),
        // The demo provider models a single sales pipeline, so every deal it
        // generates is revenue. The flag still has to be set explicitly —
        // defaulting it would defeat the guard it exists to be.
        countsAsRevenue: true,
        createdAtSource,
        closedAt,
        updatedAtSource: closedAt ?? createdAtSource,
      })

      // Payments exist only for won deals, in three states. A ledger where
      // every won deal has at least one payment makes the "unpaid" figure
      // permanently zero, so the finance page would carry a stat that can
      // never say anything. Real receivables include invoices nobody has paid.
      if (status === 'WON' && closedAt) {
        const settlement = rng.weighted([
          ['full', 62],
          ['partial', 26],
          ['none', 12],
        ] as const)

        if (settlement === 'none') continue

        const fullyPaid = settlement === 'full'
        const instalments = fullyPaid ? rng.weighted([[1, 70], [2, 30]] as const) : 1

        const paidTotal = fullyPaid
          ? amountMinor
          : (amountMinor * BigInt(rng.int(20, 80))) / 100n

        let remaining = paidTotal
        for (let n = 0; n < instalments; n++) {
          const isLast = n === instalments - 1
          const chunk = isLast ? remaining : remaining / BigInt(instalments - n)
          remaining -= chunk

          if (chunk <= 0n) continue

          payments.push({
            externalId: `pay-${String(++paymentSeq).padStart(6, '0')}`,
            dealExternalId: externalId,
            amountMinor: chunk,
            currency,
            paidAt: new Date(
              Math.min(endMs - 1, closedAt.getTime() + n * rng.int(1, 21) * DAY_MS),
            ),
            method: rng.weighted([
              ['BANK_TRANSFER', 45],
              ['CARD', 30],
              ['CASH', 22],
              ['OTHER', 3],
            ] as const) as PaymentMethodValue,
            updatedAtSource: referenceDate,
          })
        }
      }
    }

    // Chronological order makes incremental-sync behaviour easy to reason about.
    deals.sort((a, b) => a.createdAtSource.getTime() - b.createdAtSource.getTime())

    return { deals, dealItems, payments }
  }
}

/** Crude Latin-ASCII fold, enough to build a plausible email local-part. */
function transliterate(value: string): string {
  return value
    .replace(/[gʻGʻ]/g, 'g')
    .replace(/[oʻOʻ]/g, 'o')
    .replace(/ʻ/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
}
