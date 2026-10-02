// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useState } from 'react'

import type { LeadSplitDto, RopReportDto } from '@/features/leads/leadSplitApi'

/**
 * The day's ROP cards on «Lidlar» (once «Registratsiya») — the administrator's daily split. Pins the form's promises:
 * a split saved in leads (basis points that are not whole tenths of a
 * percent) can be reopened and copied to the next day and saved again, leads
 * typed «Sonda» become shares summing to exactly 100 %, and plan and actual
 * are compared without the day's duplicates. And «ROP otchet» under it: one
 * group per team with its «Umumiy», deviation and conversion as the sheet
 * computes them, and the day plan typed in place.
 */

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


const { LeadSplitCard, LeadWeekCard, useLeadSplit } = await import('@/features/leads/LeadSplitCards')
const { RopReport } = await import('@/features/leads/RopReport')

/** The three cards as `LeadsPage` places them, on one shared day. */
function Cards() {
  const [day, setDay] = useState(TODAY)
  const { colors } = useLeadSplit(day)
  return (
    <>
      <LeadSplitCard day={day} onDay={setDay} />
      <LeadWeekCard day={day} />
      <RopReport day={day} onDay={setDay} colors={colors} />
    </>
  )
}

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const NINE = ['Sevinch', 'Gulzora', 'Saidaziz', 'Azizbek', 'Maftuna', 'Lola', 'Shohjaxon', 'Asliddin', 'Sadriddin']
/** 289 leads typed «Sonda» as 35 ×3, 46, 49, 29, 20 ×3 — what `apportion(10 000, …)` stores. */
const IN_LEADS = [1211, 1211, 1211, 1592, 1696, 1003, 692, 692, 692]

function fixture(over: Partial<LeadSplitDto> = {}): LeadSplitDto {
  const split = over.split === undefined ? null : over.split
  return {
    day: TODAY,
    total: 291,
    duplicates: 2,
    fresh: 289,
    unassigned: 0,
    rops: NINE.map((rop, i) => ({
      rop,
      shareBp: split ? IN_LEADS[i]! : null,
      planLeads: split ? [35, 35, 35, 46, 49, 29, 20, 20, 20][i]! : null,
      received: i === 0 ? 37 : [35, 35, 35, 46, 49, 29, 20, 20, 20][i]!,
      receivedFresh: [35, 35, 35, 46, 49, 29, 20, 20, 20][i]!,
      week: [0, 0, 0, 0, 0, 0, 0],
    })),
    week: { days: Array.from({ length: 7 }, (_, i) => `2026-09-${String(24 + i).padStart(2, '0')}`), unassigned: [0, 0, 0, 0, 0, 0, 0] },
    previous: null,
    canEdit: true,
    ...over,
    split,
  }
}

const money = (som: number) => ({ amountMinor: String(som * 100), currency: 'UZS', amount: som })
const cells = (leads: number, plan: number | null, fakt1: number, orders: number) => ({
  leads,
  plan: plan === null ? null : money(plan),
  fakt1: money(fakt1),
  deviation: plan === null ? null : money(fakt1 - plan),
  fakt1Orders: orders,
  conversionPercent: leads > 0 ? (orders / leads) * 100 : null,
  fakt2: money(0),
  fakt2Orders: 0,
})

function reportFixture(): RopReportDto {
  return {
    day: TODAY,
    month: TODAY.slice(0, 7),
    groups: [
      {
        rop: 'Asliddin',
        sellers: [
          { employeeId: 'e1', fullName: 'Asliddin Karimberdiyev', isHead: true, onRoster: true, ...cells(2, null, 4_050_000, 2) },
          { employeeId: 'e2', fullName: 'Sardor Davlatov', isHead: false, onRoster: true, ...cells(7, 5_000_000, 4_800_000, 2) },
        ],
        total: cells(9, 5_000_000, 8_850_000, 4),
      },
    ],
    total: cells(9, 5_000_000, 8_850_000, 4),
    canEdit: true,
  }
}

let data: LeadSplitDto
let report: RopReportDto
let posted: { day: string; rows: { rop: string; shareBp: number }[] }[] = []
let postedPlans: { month: string; sellers: { employeeId: string; dayPlan: number | null }[] }[] = []

beforeEach(() => {
  posted = []
  postedPlans = []
  report = reportFixture()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const isReport = String(url).includes('/registration/report')
      const isPlan = String(url).includes('/registration/plan')
      if (init?.method === 'POST') (isPlan ? postedPlans : posted).push(JSON.parse(String(init.body)))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: init?.method === 'POST' ? { saved: true } : isReport ? report : data,
          meta: { dataSource: 'DEMO', generatedAt: '2026-10-01T06:00:00.000Z' },
        }),
      }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function draw() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
      <Cards />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getAllByText('Sevinch').length).toBeGreaterThan(0))
}

const sum = (rows: { shareBp: number }[]) => rows.reduce((a, r) => a + r.shareBp, 0)

describe('RegistrationPage', () => {
  it('reopens a split saved in leads and saves it unchanged', async () => {
    data = fixture({ split: { updatedAt: '2026-10-01T04:00:00.000Z' } })
    await draw()
    fireEvent.click(screen.getByRole('button', { name: 'Taqsimotni oʻzgartirish' }))
    expect((screen.getByLabelText('Sevinch') as HTMLInputElement).value).toBe('12.11')
    const save = screen.getByRole('button', { name: 'Saqlash' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]!.rows.map((r) => r.shareBp)).toEqual(IN_LEADS)
  })

  it('copies the previous day\'s split into an unset day and saves it', async () => {
    data = fixture({ previous: { day: '2026-01-01', rows: NINE.map((rop, i) => ({ rop, shareBp: IN_LEADS[i]! })) } })
    await draw()
    expect(screen.getAllByText('Bu kunga taqsimot belgilanmagan').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Taqsimotni belgilash' }))
    fireEvent.click(screen.getByRole('button', { name: /taqsimotini olish$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(sum(posted[0]!.rows)).toBe(10_000)
  })

  it('turns leads typed «Sonda» into shares that sum to exactly 100 %', async () => {
    data = fixture()
    await draw()
    fireEvent.click(screen.getByRole('button', { name: 'Taqsimotni belgilash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sonda' }))
    const counts = [35, 35, 35, 46, 49, 29, 20, 20, 19]
    NINE.forEach((rop, i) => fireEvent.change(screen.getByLabelText(rop), { target: { value: String(counts[i]) } }))
    const save = screen.getByRole('button', { name: 'Saqlash' }) as HTMLButtonElement
    expect(save.disabled).toBe(true) // 288 of 289
    fireEvent.change(screen.getByLabelText('Sadriddin'), { target: { value: '20' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(sum(posted[0]!.rows)).toBe(10_000)
  })

  it('refuses a percent finer than a basis point', async () => {
    data = fixture()
    await draw()
    fireEvent.click(screen.getByRole('button', { name: 'Taqsimotni belgilash' }))
    fireEvent.change(screen.getByLabelText('Sevinch'), { target: { value: '12.345' } })
    expect(screen.getByText('Foiz koʻpi bilan ikki kasr bilan')).toBeTruthy()
  })

  it('draws «ROP otchet» group by group, with deviation and conversion as the sheet computes them', async () => {
    data = fixture()
    await draw()
    await waitFor(() => expect(screen.getByText('Asliddin guruhi')).toBeTruthy())
    expect(screen.getByText('Sardor Davlatov')).toBeTruthy()
    expect(within(screen.getByText('Asliddin Karimberdiyev').closest('th')!).getByText('ROP')).toBeTruthy()
    // 4 800 000 against a plan of 5 000 000; 2 orders of 7 leads.
    expect(screen.getByText(/−200[\s,.\u00a0]?000/)).toBeTruthy()
    expect(screen.getByText('29%')).toBeTruthy()
    // The sheet's «Лид руч» column is left out at the client's request.
    expect(screen.queryByText('Лид руч')).toBeNull()
  })

  it('saves only the day plans that changed, in whole soʻm, and an emptied one as null', async () => {
    data = fixture()
    await draw()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rejani kiritish' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Rejani kiritish' }))
    fireEvent.change(screen.getByLabelText('Asliddin Karimberdiyev — kunlik reja'), { target: { value: '3 000 000' } })
    fireEvent.change(screen.getByLabelText('Sardor Davlatov — kunlik reja'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
    await waitFor(() => expect(postedPlans).toHaveLength(1))
    expect(postedPlans[0]).toEqual({
      month: TODAY.slice(0, 7),
      sellers: [
        { employeeId: 'e1', dayPlan: 3_000_000 },
        { employeeId: 'e2', dayPlan: null },
      ],
    })
  })

  it('closes the plan form when the day changes', async () => {
    data = fixture()
    await draw()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rejani kiritish' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Rejani kiritish' }))
    expect(screen.getByLabelText('Sardor Davlatov — kunlik reja')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Oldingi kun' })[0]!)
    expect(screen.queryByLabelText('Sardor Davlatov — kunlik reja')).toBeNull()
  })
})
