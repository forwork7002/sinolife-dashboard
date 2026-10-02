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
 * typed «Sonda» become shares summing to exactly 100 %. And «ROP otchet» under it: one
 * group per team with its «Umumiy», deviation and conversion as the sheet
 * computes them (plan 500 000 per lead, ✅ / 🔴), and the call columns.
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

/** The three cards on one shared day, as `LeadsPage` shares it across its tabs. */
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
    fresh: 289,
    unassigned: 0,
    rops: NINE.map((rop, i) => ({
      rop,
      shareBp: split ? IN_LEADS[i]! : null,
      planLeads: split ? [35, 35, 35, 46, 49, 29, 20, 20, 20][i]! : null,
      received: i === 0 ? 37 : [35, 35, 35, 46, 49, 29, 20, 20, 20][i]!,
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
const cells = (leads: number, fakt1: number, orders: number, connectedCalls: number | null = 0, talkSec: number | null = 0) => ({
  leads,
  plan: money(leads * 500_000),
  fakt1: money(fakt1),
  deviation: money(leads * 500_000 - fakt1),
  fakt1Orders: orders,
  conversionPercent: leads > 0 ? (orders / leads) * 100 : null,
  fakt2: money(0),
  fakt2Orders: 0,
  connectedCalls,
  talkSec,
})

function reportFixture(): RopReportDto {
  return {
    day: TODAY,
    groups: [
      {
        rop: 'Asliddin',
        sellers: [
          { employeeId: 'e1', fullName: 'Asliddin Karimberdiyev', isHead: true, onRoster: true, ...cells(2, 4_050_000, 2, 14, 3_725) },
          { employeeId: 'e2', fullName: 'Sardor Davlatov', isHead: false, onRoster: true, ...cells(12, 4_800_000, 2, 0, 0) },
        ],
        total: cells(14, 8_850_000, 4, 14, 3_725),
      },
    ],
    total: cells(14, 8_850_000, 4, 14, 3_725),
  }
}

let data: LeadSplitDto
let report: RopReportDto
let posted: { day: string; rows: { rop: string; shareBp: number }[] }[] = []

beforeEach(() => {
  posted = []
  report = reportFixture()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const isReport = String(url).includes('/registration/report')
      if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)))
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

describe('LeadSplitCards', () => {
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

  it('draws «ROP otchet» group by group: plan 500 000 per lead, ✅ / 🔴 deviation, conversion and calls', async () => {
    data = fixture()
    await draw()
    await waitFor(() => expect(screen.getByText('Asliddin guruhi')).toBeTruthy())
    expect(within(screen.getByText('Asliddin Karimberdiyev').closest('th')!).getByText('ROP')).toBeTruthy()
    const row = (name: string) => screen.getByText(name).closest('tr')!
    // Sardor: 12 leads → plan 6 000 000, fact 4 800 000 → 1 200 000 short, red.
    const sardor = row('Sardor Davlatov')
    expect(within(sardor).getByText(/6[\s,.\u00a0]?000[\s,.\u00a0]?000/)).toBeTruthy()
    expect(within(sardor).getByText('🔴')).toBeTruthy()
    expect(within(sardor).getByText(/^1[\s,.\u00a0]?200[\s,.\u00a0]?000$/)).toBeTruthy()
    expect(within(sardor).getByText('17%')).toBeTruthy()
    // The head: 2 leads → plan 1 000 000, fact 4 050 000 → ahead, green, below zero.
    const head = row('Asliddin Karimberdiyev')
    expect(within(head).getByText('✅')).toBeTruthy()
    expect(within(head).getByText(/−3[\s,.\u00a0]?050[\s,.\u00a0]?000/)).toBeTruthy()
    expect(within(head).getByText('14')).toBeTruthy()
    expect(within(head).getByText('1 soat 2 daq')).toBeTruthy()
    expect(screen.getByText('Дозвон')).toBeTruthy()
    expect(screen.getByText('Длительность')).toBeTruthy()
    // The plan is computed, not typed; the sheet's «Лид руч» column is left out at the client's request.
    expect(screen.queryByRole('button', { name: 'Rejani kiritish' })).toBeNull()
    expect(screen.queryByText('Лид руч')).toBeNull()
  })
})
