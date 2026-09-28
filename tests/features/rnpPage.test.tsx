// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RnpOverviewDto, RnpRowDto } from '@/features/rnp/rnpApi'

/**
 * «RNP jadvali» — what the sheet prints and what the team filter leaves.
 *
 * Three promises nothing else checks: a day with no figure prints a dash and
 * never a zero, a rate prints as a percent, and picking a team leaves that
 * team's blocks and nothing else.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/rnp',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ actions, toolbar, children }: { actions?: unknown; toolbar?: unknown; children?: unknown }) => (
    <div>
      <div data-testid="page-actions">{actions as React.ReactNode}</div>
      <div data-testid="page-toolbar">{toolbar as React.ReactNode}</div>
      <div>{children as React.ReactNode}</div>
    </div>
  ),
}))

const { RnpPage } = await import('@/features/rnp/RnpPage')

function row(over: Partial<RnpRowDto> & Pick<RnpRowDto, 'key' | 'label'>): RnpRowDto {
  return {
    unit: 'count',
    additive: true,
    better: 'up',
    plan: null,
    dayPlan: null,
    fact: null,
    forecast: null,
    index: null,
    days: [null, null, null],
    planKey: null,
    share: null,
    tone: 'plain',
    hint: null,
    reliableFrom: null,
    ...over,
  }
}

const FIXTURE: RnpOverviewDto = {
  month: '2026-09',
  days: ['2026-09-01', '2026-09-02', '2026-09-03'],
  today: '2026-09-02',
  elapsedDays: 1,
  teams: [
    { rop: 'Sevinch', head: 'Sevinch Aliyeva', isBase: false },
    { rop: 'Charos', head: 'Malika Rahmonova', isBase: true },
  ],
  blocks: [
    {
      id: 'registration',
      kind: 'registration',
      title: 'Регистрация',
      subtitle: null,
      team: null,
      rows: [row({ key: 'reg:leads', label: 'Лидлар', fact: 12, days: [12, null, null] })],
    },
    {
      id: 'team:Sevinch',
      kind: 'team',
      title: 'Sevinch РОП',
      subtitle: 'Sevinch Aliyeva',
      team: 'Sevinch',
      rows: [
        row({
          key: 'team:Sevinch:conv1',
          label: 'Конверсия % от квал лид',
          unit: 'percent',
          additive: false,
          plan: 30,
          fact: 85.3,
          index: 284.3,
          days: [85.3, null, null],
        }),
      ],
    },
    {
      id: 'team:Charos',
      kind: 'team',
      title: 'Charos РОП — БАЗА',
      subtitle: 'Malika Rahmonova',
      team: 'Charos',
      rows: [row({ key: 'team:Charos:reach', label: 'Дозвон', fact: 40, days: [40, null, null] })],
    },
  ],
  settings: { usdRate: null, leadValues: [] },
  canEditPlans: false,
}

let fixture: RnpOverviewDto = FIXTURE
let posted: unknown[] = []

beforeEach(() => {
  fixture = FIXTURE
  posted = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: init?.method === 'POST' ? { saved: true } : fixture,
          meta: { dataSource: 'DEMO', generatedAt: '2026-09-02T06:00:00.000Z' },
        }),
      }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function draw(first = 'Регистрация') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  render(
    <QueryClientProvider client={client}>
      <RnpPage />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByRole('heading', { name: first })).toBeTruthy())
}

describe('RnpPage', () => {
  it('draws each block, a dash for a day with no figure, and a rate as a percent', async () => {
    await draw()

    expect(screen.getByRole('heading', { name: 'Sevinch РОП' })).toBeTruthy()

    const registration = screen.getByRole('heading', { name: 'Регистрация' }).closest('section')!
    const cells = [...registration.querySelectorAll('tbody td')].map((td) => td.textContent)
    // Reja, Kunlik reja, Fakt, Prognoz, Indeks, then the three days.
    expect(cells).toEqual(['—', '—', '12', '—', '—', '12', '—', '—'])
    expect(cells).not.toContain('0')

    expect(screen.getAllByText('85.3%').length).toBeGreaterThan(0)
  })

  it('narrows to one team’s blocks when a team is picked', async () => {
    await draw()

    const picker = screen.getByLabelText('Jamoa') as HTMLSelectElement
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      'Hammasi',
      'Sevinch · Sevinch Aliyeva',
      'Charos · Malika Rahmonova · БАЗА',
    ])

    await act(async () => {
      picker.value = 'Charos'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(screen.getByRole('heading', { name: 'Charos РОП — БАЗА' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sevinch РОП' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Регистрация' })).toBeNull()
  })

  it('saves a team’s FAKT 1 as a fakt pair, once, and a company plan as a row', async () => {
    const fakt1 = (label: string, plan: number | null) =>
      row({ key: label, label, unit: 'uzs', plan, planKey: { team: 'Sevinch', metric: 'fakt1' } })
    fixture = {
      ...FIXTURE,
      canEditPlans: true,
      settings: { usdRate: 12650, leadValues: [{ team: '', fromDay: 1, value: 50000 }] },
      blocks: [
        {
          id: 'marketing',
          kind: 'marketing',
          title: 'Маркетинг',
          subtitle: null,
          team: null,
          rows: [row({ key: 'meta:spend', label: 'Жами бюджет, $', unit: 'usd', planKey: { team: '', metric: 'budget' } })],
        },
        {
          id: 'team:Sevinch',
          kind: 'team',
          title: 'Sevinch РОП',
          subtitle: null,
          team: 'Sevinch',
          rows: [
            fakt1('Сумма ФАКТ 1', 100_000_000),
            row({ key: 'f2', label: 'Сумма ФАКТ 2', unit: 'uzs', plan: 80_000_000, planKey: { team: 'Sevinch', metric: 'fakt2' } }),
          ],
        },
        { id: 'summary', kind: 'summary', title: 'Свод', subtitle: null, team: null, rows: [fakt1('ФАКТ 1 · Sevinch', 100_000_000)] },
      ],
    }
    await draw('Маркетинг')

    fireEvent.click(screen.getByRole('button', { name: 'Rejalar' }))
    fireEvent.change(screen.getByLabelText('Свод · ФАКТ 1 · Sevinch'), { target: { value: '120000000' } })
    fireEvent.change(screen.getByLabelText('Маркетинг · Жами бюджет, $'), { target: { value: '1500.5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
    })

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      month: '2026-09',
      rows: [
        { team: '', metric: 'budget', fromDay: 1, value: 1500.5 },
        { team: '', metric: 'usd_rate', fromDay: 1, value: 12650 },
        { team: '', metric: 'lead_value', fromDay: 1, value: 50000 },
      ],
      fakt: [{ rop: 'Sevinch', fakt1: 120_000_000, fakt2: 80_000_000 }],
    })
  })
})
