// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeadSplitDto } from '@/features/registration/registrationApi'

/**
 * «Registratsiya» — the administrator's daily split. Pins the form's promises:
 * a split saved in leads (basis points that are not whole tenths of a
 * percent) can be reopened and copied to the next day and saved again, leads
 * typed «Sonda» become shares summing to exactly 100 %, and plan and actual
 * are compared without the day's duplicates.
 */

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ toolbar, children }: { toolbar?: unknown; children?: unknown }) => (
    <div>
      <div data-testid="page-toolbar">{toolbar as React.ReactNode}</div>
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


const { RegistrationPage } = await import('@/features/registration/RegistrationPage')

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

let data: LeadSplitDto
let posted: { day: string; rows: { rop: string; shareBp: number }[] }[] = []

beforeEach(() => {
  posted = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)))
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: init?.method === 'POST' ? { saved: true } : data, meta: { dataSource: 'DEMO', generatedAt: '2026-10-01T06:00:00.000Z' } }),
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
      <RegistrationPage />
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

  it('compares the plan with the leads less the day\'s duplicates', async () => {
    data = fixture({ split: { updatedAt: '2026-10-01T04:00:00.000Z' } })
    await draw()
    expect(screen.getByText('2 dubl')).toBeTruthy()
    // Sevinch got 37, two of them repeats: 35 against a plan of 35 is on target, not «+2».
    expect(screen.queryByText('+2')).toBeNull()
  })
})
