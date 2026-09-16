// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SCREEN EXPLAINS ITSELF, IN PLACE.
 *
 * A separate explainer page was offered three ways and declined: «Faqat
 * ilova ichida — alohida sahifa kerak emas». So every fact a reader needs
 * lives on the block it describes, and this file pins the two things Task 9
 * actually had to add rather than re-asserting what Tasks 6-8 already put on
 * screen (ArrivalBars', ReturnAnswer's and MoneyAnswer's own `InfoTip`s are
 * covered by `cohortArrivals.test.tsx`, `cohortReturnAnswer.test.tsx` and
 * `cohortSimpleMode.test.tsx`):
 *
 *   1. the two honest customer totals — «yetkazilgan» here, «buyurtma
 *      berilgan» elsewhere — are named as two clocks, not left to look like
 *      a contradiction;
 *   2. no tip anywhere on the page answers with the generic «this is a
 *      cohort analysis» rather than the question the block it sits on
 *      actually answers.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/analytics/cohort',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ actions, children }: { actions?: unknown; children?: unknown }) => (
    <div>
      <div data-testid="page-actions">{actions as React.ReactNode}</div>
      <div>{children as React.ReactNode}</div>
    </div>
  ),
}))

// jsdom has no `matchMedia`; `AnimatedNumber` in the concentration tiles asks
// it whether the reader wants motion.
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const { CohortPage } = await import('@/features/cohort/CohortPage')

function cohortRow(
  cohort: string,
  size: number,
  cumulative: (number | null)[],
  revenueTotal: number,
) {
  const cumulativeCustomers = cumulative.map((v) =>
    v === null ? null : Math.round((v / 100) * size),
  )
  return {
    cohort,
    size,
    returned: cumulativeCustomers.at(-1) ?? 0,
    retention: cumulative,
    customers: cumulativeCustomers,
    cumulative,
    cumulativeCustomers,
    revenue: cumulative.map(() => ({ amount: 1_000_000, amountMinor: '100000000', currency: 'UZS' })),
    orders: cumulative.map(() => 1),
    revenueTotal: {
      amount: revenueTotal,
      amountMinor: String(revenueTotal * 100),
      currency: 'UZS',
    },
    revenuePerCustomer: { amount: 500_000, amountMinor: '50000000', currency: 'UZS' },
    ageMonths: cumulative.length - 1,
  }
}

const COHORTS = {
  rows: [
    cohortRow('2025-08-01', 24, [0, 21, 29, 38, 54, 63, 67], 12_000_000),
    cohortRow('2025-09-01', 17, [0, 18, 35, 35, 41, 41, 53], 7_500_000),
    cohortRow('2025-10-01', 15, [0, 13, 27, 33, 47, 47, 60], 4_250_000),
  ],
  groups: [],
  baseCustomers: 120,
  workedCustomers: 90,
  repeatRevenueShare: 65.2,
  repeatCustomers: 159,
  totalCustomers: 203,
  currentMonth: '2026-09-01',
  revenueTotalAll: { amount: 253_750_000, amountMinor: '25375000000', currency: 'UZS' },
  revenuePerCustomerAll: { amount: 1_250_000, amountMinor: '125000000', currency: 'UZS' },
}

const CONCENTRATION = {
  pareto: {
    top10SharePercent: 22.4,
    top5SharePercent: 14.1,
    nullCustomerSharePercent: 3.2,
    customersFor80Percent: 42,
    totalCustomers: 203,
  },
  repeat: {
    medianDaysBetweenFirstAndSecond: 31.5,
    p90Days: 92.1,
    pairsMeasured: 410,
    repurchaseWithin90Percent: 38.4,
    cohortSize: 180,
    repeatRevenueSharePercent: 61.0,
    bitrixFlagSharePercent: 54.3,
  },
}

const META = { dataSource: 'DEMO', generatedAt: '2026-09-15T06:00:00.000Z' }

/*
  «Mijozlar oqimi», the band at the top of «Batafsil».

  A STUB THAT ANSWERED `{}` WOULD NOT BE A LIGHTER FIXTURE, IT WOULD BE A LIE
  ABOUT THE CONTRACT: `apiGet<CustomerFlowDto>` promises these fields and the
  page reads them the way every other block on it reads its own payload —
  unguarded past the response itself. An empty object is truthy, so the band
  rendered and threw on `states.rows`, taking the whole page with it.
*/
const FLOW = {
  summary: {
    newCustomers: 180,
    returningCustomers: 64,
    activeCustomers: 244,
    newCustomersWon: 138,
    firstRevenue: { amount: 42_000_000, amountMinor: '4200000000', currency: 'UZS' },
    repeatRevenue: { amount: 18_000_000, amountMinor: '1800000000', currency: 'UZS' },
    repeatRevenueSharePercent: 30.0,
  },
  series: [
    { bucket: '2026-08-01', newCustomers: 90, returningCustomers: 30 },
    { bucket: '2026-08-02', newCustomers: 90, returningCustomers: 34 },
  ],
  sources: [
    {
      key: 'instagram',
      label: 'Instagram',
      newCustomers: 120,
      sharePercent: 66.7,
      repeatPercent: 21.4,
      maturedCustomers: 900,
    },
    {
      key: 'telefon',
      label: 'Telefon',
      newCustomers: 60,
      sharePercent: 33.3,
      repeatPercent: 12.1,
      maturedCustomers: 410,
    },
  ],
  states: {
    customers: 500,
    rows: [
      { key: 'ACTIVE', label: 'Faol', colour: '--series-3', customers: 300 },
      { key: 'AT_RISK', label: 'Xavf ostida', colour: '--series-5', customers: 120 },
      { key: 'LOST', label: 'Yoʻqotilgan', colour: '--series-8', customers: 80 },
    ],
  },
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const data = url.includes('/insights/cohorts')
      ? COHORTS
      : url.includes('/insights/concentration')
        ? CONCENTRATION
        : url.includes('/insights/customers')
          ? FLOW
          : {}
    return {
      ok: true,
      status: 200,
      json: async () => ({ data, meta: META }),
    } as unknown as Response
  })
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } },
  })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/analytics/cohort')
  vi.stubGlobal('fetch', mockFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openPage() {
  const view = render(
    <QueryClientProvider client={client()}>
      <CohortPage />
    </QueryClientProvider>,
  )
  // The manager's view resolves first — both queries have landed.
  await screen.findByText(/Qancha yangi mijoz keladi\?/)
  return view
}

describe('the two customer totals', () => {
  /*
    FIX ROUND 1: this used to be framed as "two clocks" — it is not. A deal
    becomes WON the instant it reaches Успешно, so «yetkazilgan» and
    «yopilgan (WON)» name the same event. What differs elsewhere is the
    POPULATION: an order-arrival board counts orders in a bounded window,
    these two tiles count distinct customers over all history. The tests
    below assert that reframing, not the old (wrong) one.
  */
  it('names «yetkazilgan» and the order-arrival clock as the same instant, not as a contradiction', async () => {
    await openPage()

    // «Batafsil» is where the tile row — and the hint beneath it — lives.
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    const hint = screen.getByTestId('cohort-total-hint').textContent ?? ''
    expect(hint).toMatch(/yetkazilgan/i)
    // The floor's own established phrase for the order-arrival window — the
    // same words `LogisticsPage`'s `DailySection` already contrasts
    // «yetkazilgan sana» against («Kun — buyurtma tasdiqlash navbatiga
    // TUSHGAN sana, yetkazilgan sana emas.») — reused here rather than a
    // phrase invented for this sentence alone.
    expect(hint).toMatch(/tasdiqlash navbatiga tushgan/i)
  })

  it('names the population difference — customers vs. orders — not a clock difference', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    const hint = screen.getByTestId('cohort-total-hint').textContent ?? ''
    // The word "soati" (clock/hour) is only used to DENY it is the
    // difference — "soati emas" — so this checks for the denial rather than
    // a bare presence, which the old, wrong sentence would also have passed.
    expect(hint).toMatch(/soati emas/i)
    expect(hint).toMatch(/mijozlarni emas/i)
    expect(hint).toMatch(/buyurtmalarni sanaydi/i)
  })

  it('does not sweep in «Faol bazada», a today-snapshot on a different question', async () => {
    /*
      «Faol bazada» is a distinct-customers-with-an-open-deal count, dated by
      right now — not by a first purchase, and not over all history. An
      earlier draft of this sentence said «Bu sahifadagi mijozlar soni»,
      which reads as every tile on the page, this one included.
    */
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    const hint = screen.getByTestId('cohort-total-hint').textContent ?? ''
    expect(hint).toMatch(/Jami mijozlar/)
    expect(hint).toMatch(/Qaytgan mijozlar/)
    expect(hint).not.toMatch(/Faol bazada/i)
  })

  it('carries the statement on the element the testid marks, not scattered text', async () => {
    /*
      A regression this guards against: satisfying the assertions above
      because the WORDS happen to appear somewhere on the page (one in the
      «Jami mijozlar» tile's own hint, one nowhere at all) rather than in the
      one sentence built to reconcile them.
    */
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    const el = screen.getByTestId('cohort-total-hint')
    expect(el.tagName.toLowerCase()).toBe('p')
    expect((el.textContent ?? '').length).toBeGreaterThan(20)
  })
})

describe('every tip names its own question', () => {
  /*
    THE MANAGER'S VIEW, ONLY. «Batafsil» carries exactly one `InfoTip` today
    (`RepeatShareCard`'s «Nega ikkita raqam», which does not label itself
    «Izoh» and so is out of this query's reach on purpose — the matrix and
    «База» explain themselves through always-visible `ChartCard` hint text
    instead, see the describe block below). Switching to «Batafsil» before
    this assertion would make `getAllByRole` match nothing there and throw
    on an empty result — a jsdom bug in its own error-formatting path
    (`role-helpers.js`'s `prettyRoles`, which `cloneNode`s every candidate
    button to build the debug dump) turns that empty match into an unrelated
    `TypeError` rather than a clean assertion failure. Asserting on an empty
    set would also be vacuous, so this stays where the brief's own draft put
    it: the view that actually carries the tips.
  */
  it('never answers with «kogorta tahlili» or «retention»', async () => {
    await openPage()

    const tips = screen.getAllByRole('button', { name: /izoh/i })
    expect(tips.length).toBeGreaterThan(0)
    for (const tip of tips) {
      expect(tip.getAttribute('aria-label')).not.toMatch(/kogorta tahlili|retention/i)
    }
  })
})

describe('the matrix and «База» already name their own clock', () => {
  /*
    AUDIT, PINNED. Both cards state their clock as always-visible `hint`
    text on `ChartCard` (never gated behind a hover) rather than through a
    second `InfoTip` — the matrix's own comment (`CohortPage.tsx`, beside the
    `ChartCard` call) says its card hint stopped repeating the mechanics
    once the grid grew its own legend and worked example, and adding a tip
    back on top of that legend would be exactly the redundancy that comment
    describes removing. This test is what stops a future edit from deleting
    that visible text on the assumption that an `InfoTip` must replace it.
  */
  it('states the matrix is grouped by first purchase, with its denominator', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    expect(screen.getByText(/kogortadagi jami mijozlar/i)).toBeDefined()
  })

  it('states «База» is a snapshot, not a historical curve', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    /*
      ONE BLOCK OWNS THIS SENTENCE. «Mijozlar oqimi» at the top also reports a
      today-snapshot (who has gone quiet), and its tile hint deliberately does
      NOT say «bugungi holat» — two blocks wearing one phrase over two
      populations is an invitation to compare numbers that were never
      comparable. `getByText` is what enforces that: it throws on a second match.
    */
    expect(screen.getByText(/bugungi holat/i)).toBeDefined()
  })

  /*
    TWO CLOCKS ON ONE SCREEN, AND EACH NAMES ITSELF.

    «Mijozlar oqimi» counts a customer from the day they ORDERED
    (`createdAtSource`); everything under «Kogorta tahlili» counts them from
    the day their first order was DELIVERED (`closedAt` on a WON deal). The
    two totals therefore differ on purpose — and unlabelled they read as one
    of them being broken, which is the first conclusion a reader reaches and
    the one nothing else on the page would correct.

    Asserted as two DIFFERENT sentences present at once rather than as two
    regexes that might both match one heading: the failure this guards is
    exactly that one clock's words get copied onto the other block.
  */
  it('names the order clock on the band and the delivered clock on the matrix', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    expect(screen.getByText(/Buyurtma berilgan sana boʻyicha/i)).toBeDefined()
    expect(screen.getByText(/Yetkazilgan sana boʻyicha/i)).toBeDefined()
  })

  /*
    AND THE BAND DOES NOT ADD A THIRD «TAKRORIY TUSHUM ULUSHI».

    The label is already on this screen twice — over the whole history, and
    over the last ninety days on the concentration band — and two was only
    acceptable because each names its own SPAN. A third reading «soʻnggi 90
    kun» would put two ninety-day repeat shares, on two different clocks, under
    one name. The band carries the soʼm instead, which collides with nothing.
  */
  it('keeps the repeat-share label to the two blocks that already own it', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Batafsil' }))

    expect(screen.getAllByText(/Takroriy tushum ulushi/i)).toHaveLength(2)
    expect(screen.getByText(/Takroriy xarid tushumi/i)).toBeDefined()
  })
})
