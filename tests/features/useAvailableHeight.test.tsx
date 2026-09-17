// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useAvailableHeight } from '@/features/sellers/useAvailableHeight'

/**
 * `useAvailableHeight` — the px a list's container gives it (EFIR Premium
 * spec §5, §6). jsdom has no `ResizeObserver`; a stub records what is
 * observed and lets the test fire resizes by hand.
 */
class StubObserver {
  static instances: StubObserver[] = []
  observed: Element[] = []
  disconnected = false
  constructor(private readonly callback: ResizeObserverCallback) {
    StubObserver.instances.push(this)
  }
  observe(target: Element) {
    this.observed.push(target)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  /** Fire a resize on the first observed target. */
  fire(height: number, { withBoxSize = true } = {}) {
    const target = this.observed[0]!
    const entry = {
      target,
      contentRect: { height } as DOMRectReadOnly,
      contentBoxSize: withBoxSize ? [{ blockSize: height, inlineSize: 100 }] : undefined,
    } as unknown as ResizeObserverEntry
    this.callback([entry], this as unknown as ResizeObserver)
  }
}

const original = globalThis.ResizeObserver

beforeEach(() => {
  StubObserver.instances = []
  globalThis.ResizeObserver = StubObserver as unknown as typeof ResizeObserver
})
afterEach(() => {
  cleanup()
  globalThis.ResizeObserver = original
})

function Probe() {
  const ref = useRef<HTMLDivElement>(null)
  const h = useAvailableHeight(ref)
  return (
    <div data-testid="slot">
      <div ref={ref} data-h={h} data-rows={Math.floor(h / 43)}>
        {h}
      </div>
    </div>
  )
}

describe('useAvailableHeight', () => {
  it('answers 0 until measured, then the container’s height in whole px', () => {
    const { container } = render(<Probe />)
    const list = container.querySelector('[data-h]')!
    expect(list.getAttribute('data-h')).toBe('0')

    const [observer] = StubObserver.instances
    act(() => observer!.fire(473.6))
    expect(list.getAttribute('data-h')).toBe('473')
    expect(list.getAttribute('data-rows')).toBe('11')

    act(() => observer!.fire(516))
    expect(list.getAttribute('data-h')).toBe('516')
    expect(list.getAttribute('data-rows')).toBe('12')
  })

  it('observes the PARENT, never the element it sizes', () => {
    const { container } = render(<Probe />)
    const [observer] = StubObserver.instances
    expect(observer!.observed).toEqual([container.querySelector('[data-testid="slot"]')])
  })

  it('falls back to contentRect where contentBoxSize is missing', () => {
    const { container } = render(<Probe />)
    act(() => StubObserver.instances[0]!.fire(300.9, { withBoxSize: false }))
    expect(container.querySelector('[data-h]')!.getAttribute('data-h')).toBe('300')
  })

  it('disconnects on unmount', () => {
    const { unmount } = render(<Probe />)
    const [observer] = StubObserver.instances
    unmount()
    expect(observer!.disconnected).toBe(true)
  })

  it('stays 0 where ResizeObserver does not exist', () => {
    // @ts-expect-error — removing the API on purpose
    delete globalThis.ResizeObserver
    const { container } = render(<Probe />)
    expect(container.querySelector('[data-h]')!.getAttribute('data-h')).toBe('0')
  })
})
