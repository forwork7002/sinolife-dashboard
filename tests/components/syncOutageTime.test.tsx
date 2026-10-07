// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE OUTAGE STARTS ON THE SAME CLOCK AS THE LAST GOOD SYNC.
 *
 * The chip's tooltip reads «Oxirgi sinx: 6-okt, 12:05. … 12:10 dan beri.»
 * The first time is Tashkent (`formatDateTime`); the second came off the
 * DEVICE clock, so a laptop left on UTC read «07:10 dan beri» — an outage
 * that began five hours before the last good sync. The device is put on UTC
 * here, because this machine and the office both sit in Tashkent and would
 * never show the fault.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

const zone = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'UTC'
})

afterAll(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

afterEach(cleanup)

const { DataSourceBadge } = await import('@/components/layout/Shell')

describe('the sync chip during an outage', () => {
  it('says when the block began in Tashkent time, whatever the device clock', async () => {
    render(
      <DataSourceBadge
        source="BITRIX24"
        // Half an hour without a good sync: the clock reads as stopped.
        syncedAt={new Date(Date.now() - 30 * 60_000).toISOString()}
        syncError={{
          code: 'OVERLOAD_LIMIT',
          kind: 'THROTTLE',
          entity: 'DEALS',
          entities: 3,
          at: new Date(Date.now() - 60_000).toISOString(),
          since: '2026-10-06T07:10:00.000Z', // 12:10 in Tashkent
        }}
      />,
    )

    // Hovering the chip opens its tooltip (the anchor is the chip's wrapper).
    fireEvent.mouseEnter(screen.getByText('Bitrix24 band').closest('[tabindex]')!.parentElement!)
    const tip = (await screen.findByRole('tooltip')).textContent ?? ''

    expect(tip).toContain('12:10 dan beri')
    expect(tip).not.toContain('07:10')
  })
})
