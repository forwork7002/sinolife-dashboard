// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { CallActivitySection } from '@/features/customers/CallActivitySection'
import { CustomerFlowSection } from '@/features/customers/CustomerFlowSection'
import type { CallActivityDto, CallRowDto, CustomerFlowDto, PeriodDto } from '@/lib/api'
import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import { formatDate, formatNumber } from '@/lib/format'

/**
 * «Mijozlar va qoʻngʻiroqlar» cannot be seen locally: the demo seed holds no
 * calls at all, and no retention pipeline. The figures below are production,
 * read above the data floor on 2026-09-16.
 *
 * Three claims are pinned, each one a reading a later edit could quietly break:
 * the mean and the median are both on screen; the floor caveat appears only
 * when the window actually reached below the floor; and the customer block
 * names its OWN window, because it does not follow the page's control.
 */

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` inside the count tiles asks it
  whether the reader wants motion. Answering "reduced" prints each figure once
  rather than counting it up, so `getByText` reads the final value. The stub
  `faktQueueBand.test.tsx` and `confirmationFakt.test.tsx` install.
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
  // See callActivityBlock.test.tsx: DataTable's pinned column needs one, jsdom
  // has none, and DataTable.tsx reaches a screen the client put out of bounds.
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
    calls: 0,
    connected: 0,
    connectPercent: null,
    talkSec: 0,
    medianSec: null,
    p90Sec: null,
    customers: 0,
    ...overrides,
  }
}

function activity(floorApplied: boolean): CallActivityDto {
  return {
    total: row('TOTAL', {
      label: 'Jami',
      calls: 11_230,
      connected: 3_261,
      connectPercent: 29,
      talkSec: 549_758, // mean 168.6 s → 2:49
      medianSec: 53,
      p90Sec: 513,
      customers: 7_355,
    }),
    operators: [],
    teams: [],
    series: [],
    sides: [row('BAZA'), row('NOT_BAZA'), row('UNLINKED')],
    seriesBySide: [],
    durationBands: [],
    customerBands: [],
    unlinkedCalls: 135,
    floorApplied,
  }
}

describe('the call block', () => {
  it('puts the mean and the median side by side, and they disagree', () => {
    render(<CallActivitySection data={activity(false)} status="ready" />)

    expect(screen.getByText('Oʻrtacha suhbat')).toBeTruthy()
    expect(screen.getByText('Median suhbat')).toBeTruthy()
    expect(screen.getByText('2:49')).toBeTruthy()
    expect(screen.getByText('53 s')).toBeTruthy()
  })

  it('names the data floor only when the window reached below it', () => {
    const { rerender } = render(<CallActivitySection data={activity(true)} status="ready" />)
    // The house date format, from the floor constant — never a date typed here.
    const floor = formatDate(CALL_DATA_FLOOR.toISOString())
    expect(screen.getByText(new RegExp(`${floor} dan oldingi qoʻngʻiroqlar koʻrsatilmaydi`))).toBeTruthy()

    rerender(<CallActivitySection data={activity(false)} status="ready" />)
    expect(screen.queryByText(/dan oldingi qoʻngʻiroqlar koʻrsatilmaydi/)).toBeNull()
  })

  it('discloses the calls no customer is attached to, rather than dropping them', () => {
    render(<CallActivitySection data={activity(false)} status="ready" />)
    expect(screen.getByText(/135 ta qoʻngʻiroq hech bir mijozga bogʻlanmagan/)).toBeTruthy()
  })
})

const WINDOW: PeriodDto = {
  preset: 'custom',
  start: '2026-06-17T19:00:00.000Z',
  end: '2026-09-15T19:00:00.000Z',
  timeZone: 'Asia/Tashkent',
  days: 90,
}

const FLOW: CustomerFlowDto = {
  summary: {
    newCustomers: 6_012,
    returningCustomers: 804,
    activeCustomers: 6_816,
    newCustomersWon: 4_431,
    firstRevenue: { amountMinor: '0', amount: 0, currency: 'UZS' },
    repeatRevenue: { amountMinor: '0', amount: 0, currency: 'UZS' },
    repeatRevenueSharePercent: 11.2,
  },
  series: [],
  sources: [],
  states: {
    customers: 15_937,
    rows: [
      { key: 'ACTIVE', label: 'Faol', colour: '--series-3', customers: 4_719 },
      { key: 'AT_RISK', label: 'Xavf ostida', colour: '--series-5', customers: 5_130 },
      { key: 'LOST', label: 'Yoʻqotilgan', colour: '--series-8', customers: 6_088 },
    ],
    inBase: 11_751,
    notInBase: 4_186,
  },
}

describe('the customer block', () => {
  it('names the window it resolved for itself, not the page control’s', () => {
    render(<CustomerFlowSection data={FLOW} resolvedWindow={WINDOW} status="ready" />)
    expect(screen.getByText(new RegExp(formatDate(WINDOW.start)))).toBeTruthy()
    expect(screen.getByText(/qoʻngʻiroqlar davriga bogʻliq emas/)).toBeTruthy()
  })

  it('states the база split and what it really measures', () => {
    render(<CustomerFlowSection data={FLOW} resolvedWindow={WINDOW} status="ready" />)

    expect(screen.getByText('Bazada')).toBeTruthy()
    expect(screen.getByText('Bazada yoʻq')).toBeTruthy()
    expect(screen.getByText(formatNumber(11_751))).toBeTruthy()
    expect(screen.getByText(formatNumber(4_186))).toBeTruthy()
    expect(screen.getByText(/bazaga avtomatik tushadi/)).toBeTruthy()
  })

  it('shows «Yoʻqotilgan» — the churn the client asked for — among today’s states', () => {
    render(<CustomerFlowSection data={FLOW} resolvedWindow={WINDOW} status="ready" />)
    expect(screen.getByText('Yoʻqotilgan')).toBeTruthy()
    expect(screen.getByText(formatNumber(6_088))).toBeTruthy()
  })
})
