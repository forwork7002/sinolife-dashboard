// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { NARROW_NBSP, formatSomFull } from '@/lib/format'

/**
 * `AnimatedNumber` prints its figure ONCE (EFIR Premium spec §9).
 *
 * The audit of the television board found every seat figure doubled in
 * `textContent` — a settled `sr-only` copy beside the counting one. One text
 * node now carries the value, and its U+202F separators stay inside that node.
 */
const S = NARROW_NBSP

function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeAll(() => stubMatchMedia(true))
afterEach(cleanup)

describe('AnimatedNumber — one text node', () => {
  it('carries the figure exactly once in textContent', () => {
    const { container } = render(<AnimatedNumber value={79_600_000} format={formatSomFull} />)
    const figure = `79${S}600${S}000`
    expect(container.textContent).toBe(figure)
    expect(container.textContent!.split(figure)).toHaveLength(2)
  })

  it('renders one element holding one text node — no sr-only twin, no wrapped separators', () => {
    const { container } = render(<AnimatedNumber value={1_580_275_000} format={formatSomFull} />)
    const root = container.firstElementChild!
    expect(root.children).toHaveLength(0)
    expect(root.childNodes).toHaveLength(1)
    expect(root.firstChild!.nodeType).toBe(Node.TEXT_NODE)
    expect(container.querySelector('.sr-only, [aria-hidden]')).toBeNull()
  })

  it('still prints one figure when the value changes', () => {
    const { container, rerender } = render(<AnimatedNumber value={1_000} format={formatSomFull} />)
    rerender(<AnimatedNumber value={2_500} format={formatSomFull} />)
    expect(container.textContent).toBe(`2${S}500`)
  })
})
