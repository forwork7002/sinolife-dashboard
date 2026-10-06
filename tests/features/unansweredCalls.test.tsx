// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UnansweredCallsCard } from '@/features/calls/UnansweredCallsCard'

/** «Javobsiz qolgan raqamlar» — who to ring back, and whether somebody already did. */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const row = (key: string, group: string, callback: unknown, contact: unknown = null) => ({
  key,
  phone: `+998${key}`,
  tel: `+998${key}`,
  group,
  contact,
  calls: 2,
  firstCallAt: '2026-10-06T05:00:00.000Z',
  lastCallAt: '2026-10-06T06:00:00.000Z',
  operator: 'Aziza',
  callback,
})

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async () => ({
    data: {
      rows: [
        row('901110003', 'fresh', null, { name: 'Malika', bitrixId: '501' }),
        row('901110002', 'buyer', { at: '2026-10-06T06:30:00.000Z', talked: false, operator: 'Bekzod', attempts: 2 }),
        row('901110001', 'fresh', { at: '2026-10-06T06:40:00.000Z', talked: true, operator: 'Bekzod', attempts: 1 }),
      ],
      waiting: 1,
      calledBack: 2,
      reached: 1,
    },
    meta: {},
  }),
}))

const LABEL = {
  fresh: 'Соф янги',
  notReached: 'Бор, гаплашилмаган',
  talkedNoBuy: 'Гаплашилган, олмаган',
  buyer: 'Эски харидор',
  noDeal: 'Сделкасиз',
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnansweredCallsCard windowParams={{ preset: 'today' }} groupLabel={LABEL} />
    </QueryClientProvider>,
  )
}

describe('UnansweredCallsCard', () => {
  it('opens on the numbers nobody has rung back, each a phone link beside its Bitrix24 card', async () => {
    open()
    const phone = await screen.findByRole('link', { name: '+998901110003' })
    expect(phone.getAttribute('href')).toBe('tel:+998901110003')
    expect(screen.getByRole('link', { name: /Malika/ }).getAttribute('href')).toBe(
      'https://obey.bitrix24.kz/crm/contact/details/501/',
    )
    expect(screen.getByText('● Qilinmagan')).toBeTruthy()
    expect(screen.queryByText('+998901110001')).toBeNull()
    expect(screen.getByText('Qilinmagan · 1')).toBeTruthy()
    expect(screen.getByText('Ulanmadi · 1')).toBeTruthy()
  })

  /*
    A callback reaches `call_record` only with the three-hourly CALLS pass; the
    hint promised «bir-ikki daqiqa», so a reader could take a callback made,
    say, at 10:05 for one still owed until the next pass.
  */
  it('says callbacks arrive with the three-hourly import, not within a minute or two', async () => {
    open()
    await screen.findByText('+998901110003')
    expect(screen.getByText(/qayta qoʻngʻiroq ham — Bitrix24 dan har ~3 soatda keladi/)).toBeTruthy()
    expect(screen.queryByText(/bir-ikki daqiqa/)).toBeNull()
  })

  it('reads the other states and narrows by group', async () => {
    open()
    await screen.findByText('+998901110003')
    fireEvent.click(screen.getByText('Hammasi · 3'))
    expect(screen.getByText(/Ulanmadi \(2 urinish\)/)).toBeTruthy()
    expect(screen.getByText(/Gaplashildi,/)).toBeTruthy()
    fireEvent.click(screen.getByText('Эски харидор', { selector: 'button, button *' }))
    expect(screen.queryByText('+998901110003')).toBeNull()
    expect(screen.getByText('+998901110002')).toBeTruthy()
  })
})
