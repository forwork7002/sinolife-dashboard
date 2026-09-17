// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { dayPoints, hourPoints } from '@/components/charts/callTimePoints'
import { CallActivity } from '@/features/calls/CallsPage'
import { CallTable, callSpanText } from '@/features/calls/CallTable'
import type { CallActivityDto, CallRowDto, PeriodDto } from '@/lib/api'
import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import { NO_VALUE, formatDate, formatPercent } from '@/lib/format'

/**
 * «Qoʻngʻiroqlar» cannot be seen locally: the demo seed holds no calls at all.
 * The totals below are production, read above the data floor on 2026-09-16.
 *
 * What is pinned is what the client asked for on 2026-09-17 — who talks how
 * much, every figure with its exact time — and the readings a later edit could
 * quietly break: the median beside the mean, the floor caveat only when it bit,
 * and the server's ranking left alone.
 */

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` inside the count tiles asks it
  whether the reader wants motion. Answering "reduced" prints each figure once.
*/
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

beforeAll(() => {
  // DataTable's pinned columns measure with one; jsdom has none.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function row(key: string, overrides: Partial<CallRowDto> = {}): CallRowDto {
  return {
    key,
    label: key,
    team: null,
    calls: 0,
    connected: 0,
    connectPercent: null,
    talkSec: 0,
    medianSec: null,
    customers: 0,
    firstCallAt: null,
    lastCallAt: null,
    ...overrides,
  }
}

const OPERATORS: CallRowDto[] = [
  row('e1', {
    label: 'Ismoilova Malika',
    team: 'Sevinch',
    calls: 140,
    connected: 52,
    connectPercent: 37.1,
    talkSec: 11_545, // 3 soat 12 daq
    medianSec: 86,
    firstCallAt: '2026-09-16T04:02:00Z', // 09:02 Tashkent
    lastCallAt: '2026-09-16T13:47:00Z', // 18:47 Tashkent
  }),
  row('e2', {
    label: 'Karimov Aziz',
    team: 'Baza',
    calls: 3,
    connected: 0,
    connectPercent: 0,
    talkSec: 0,
    medianSec: null,
    firstCallAt: '2026-09-15T05:10:00Z',
    lastCallAt: '2026-09-16T06:40:00Z',
  }),
]

function activity(floorApplied: boolean): CallActivityDto {
  return {
    total: row('TOTAL', {
      label: 'Jami',
      calls: 11_230,
      connected: 3_261,
      connectPercent: 29,
      talkSec: 549_758, // mean 168.6 s → 2 daq 49 s
      medianSec: 53,
      customers: 7_355,
      lastCallAt: '2026-09-16T06:48:00Z', // 11:48 Tashkent
    }),
    operators: OPERATORS,
    teams: [row('Sevinch', { calls: 140, connected: 52, talkSec: 11_545 })],
    days: [],
    hours: [],
    floorApplied,
  }
}

const TODAY: PeriodDto = {
  preset: 'today',
  start: '2026-09-15T19:00:00.000Z',
  end: '2026-09-16T19:00:00.000Z',
  timeZone: 'Asia/Tashkent',
  days: 1,
}

describe('«Qoʻngʻiroqlar»', () => {
  it('puts the median and the mean on screen together, spelled in units', () => {
    render(<CallActivity data={activity(false)} period={TODAY} status="ready" />)

    expect(screen.getAllByText('Median suhbat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('53 s').length).toBeGreaterThan(0)
    expect(screen.getByText(/oʻrtacha 2 daq 49 s/)).toBeTruthy()
  })

  it('states the exact window and the newest call the sync has written', () => {
    render(<CallActivity data={activity(false)} period={TODAY} status="ready" />)
    const when = screen.getByTestId('calls-when').textContent ?? ''

    // The exclusive end is printed as the last minute inside the window.
    expect(when).toContain('Davr: 16-sen, 00:00 – 16-sen, 23:59')
    expect(when).toContain('oxirgi yozilgan qoʻngʻiroq: 16-sen, 11:48')
  })

  it('names the data floor only when the window reached below it', () => {
    const { rerender } = render(
      <CallActivity data={activity(true)} period={TODAY} status="ready" />,
    )
    const floor = formatDate(CALL_DATA_FLOOR.toISOString())
    expect(screen.getByText(new RegExp(`${floor} dan oldingi qoʻngʻiroqlar koʻrsatilmaydi`))).toBeTruthy()

    rerender(<CallActivity data={activity(false)} period={TODAY} status="ready" />)
    expect(screen.queryByText(/dan oldingi qoʻngʻiroqlar koʻrsatilmaydi/)).toBeNull()
  })
})

function rowOf(name: string): HTMLElement {
  const header = screen.getByRole('rowheader', { name: new RegExp(name) })
  const tr = header.closest('tr')
  expect(tr).not.toBeNull()
  return tr as HTMLElement
}

describe('the operator table', () => {
  it('leads with talk time spelled out, the team under the name, and when they were on the phone', () => {
    render(<CallTable kind="operator" rows={OPERATORS} totalTalkSec={11_545} status="ready" />)

    const malika = within(rowOf('Ismoilova Malika'))
    expect(malika.getByText('Sevinch')).toBeTruthy()
    expect(malika.getByText('3 soat 12 daq')).toBeTruthy()
    expect(malika.getByText(formatPercent(100))).toBeTruthy()
    expect(malika.getByText('16-sen, 09:02 – 18:47')).toBeTruthy()
    // Median and mean both, and they disagree: 86 s against 11 545 / 52.
    expect(malika.getByText('1 daq 26 s')).toBeTruthy()
    expect(malika.getByText('3 daq 42 s')).toBeTruthy()
  })

  it('prints no duration for a row that reached nobody', () => {
    render(<CallTable kind="operator" rows={OPERATORS} totalTalkSec={11_545} status="ready" />)
    // Median and mean absent — em dashes, never «0 s», a measurement nobody made.
    expect(within(rowOf('Karimov Aziz')).getAllByText(NO_VALUE)).toHaveLength(2)
  })

  it('keeps the order it was given and numbers it — the server ranked it', () => {
    render(<CallTable kind="operator" rows={OPERATORS} totalTalkSec={11_545} status="ready" />)
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(names[0]).toContain('Ismoilova Malika')
    expect(names[1]).toContain('Karimov Aziz')
  })

  it('prints both dates when a row’s first and last call fall on different days', () => {
    expect(callSpanText('2026-09-15T05:10:00Z', '2026-09-16T06:40:00Z')).toBe(
      '15-sen, 10:10 – 16-sen, 11:40',
    )
    expect(callSpanText(null, null)).toBe(NO_VALUE)
  })

  it('has loading, error and empty renderings, and they are three different things', () => {
    const { rerender } = render(
      <CallTable kind="operator" rows={[]} totalTalkSec={0} status="loading" />,
    )
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    rerender(
      <CallTable
        kind="operator"
        rows={[]}
        totalTalkSec={0}
        status="error"
        errorMessage="Olinmadi — qayta urinib koʻring"
      />,
    )
    expect(screen.getByText('Olinmadi — qayta urinib koʻring')).toBeTruthy()

    rerender(<CallTable kind="operator" rows={[]} totalTalkSec={0} status="ready" />)
    expect(screen.getByText('Bu davrda qoʻngʻiroq yoʻq')).toBeTruthy()
  })
})

describe('the time charts’ points', () => {
  it('fills the silent hours between the first busy hour and the last, and no further', () => {
    const points = hourPoints([
      row('9', { calls: 40, connected: 12 }),
      row('12', { calls: 10, connected: 3 }),
    ])
    expect(points.map((p) => p.label)).toEqual(['09:00', '10:00', '11:00', '12:00'])
    expect(points[1]).toEqual(expect.objectContaining({ calls: 0, connected: 0, medianSec: null }))
  })

  it('leaves the days exactly as the server sent them', () => {
    const points = dayPoints([row('2026-09-15'), row('2026-09-17')])
    expect(points.map((p) => p.key)).toEqual(['2026-09-15', '2026-09-17'])
  })

  it('draws nothing over no data', () => {
    expect(hourPoints([])).toEqual([])
  })
})
