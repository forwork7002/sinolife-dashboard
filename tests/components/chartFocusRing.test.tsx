// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render } from '@testing-library/react'
import { Line, LineChart } from 'recharts'
import { describe, expect, it } from 'vitest'

/**
 * A keyboard reader tabbing onto a chart has to see where they are.
 *
 * globals.css removes the browser's outline from the chart and draws the house
 * ring on `:focus-visible` instead. That ring was written on
 * `.recharts-wrapper`, which recharts 3 never focuses — so for every chart in
 * the product the outline was taken away and nothing replaced it, the exact
 * failure the rule's own comment says it exists to prevent. Both halves are
 * pinned: which element recharts makes the tab stop, and that the ring is on
 * that element.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

describe('the chart focus ring', () => {
  it('lands on the element recharts makes the tab stop: the svg surface', () => {
    // Fixed size, so no ResponsiveContainer has to measure anything in jsdom.
    const { container } = render(
      <LineChart width={320} height={160} data={[{ x: 1 }, { x: 3 }, { x: 2 }]}>
        <Line dataKey="x" isAnimationActive={false} />
      </LineChart>,
    )

    const stops = container.querySelectorAll('[tabindex="0"]')
    expect(stops).toHaveLength(1)
    expect(stops[0]!.tagName.toLowerCase()).toBe('svg')
    expect(stops[0]!.classList.contains('recharts-surface')).toBe(true)
    expect(container.querySelector('.recharts-wrapper')!.hasAttribute('tabindex')).toBe(false)
  })

  it('is drawn on .recharts-surface for the keyboard, and nowhere on the wrapper', () => {
    const ring = /\.recharts-surface:focus-visible\s*\{([^}]*)\}/.exec(CSS)
    expect(ring).not.toBeNull()
    expect(ring![1]).toMatch(/outline:\s*2px solid var\(--accent\)/)

    // The outline it replaces is removed on the same element…
    expect(CSS).toMatch(/\.recharts-surface:focus\s*\{\s*outline:\s*none;\s*\}/)
    // …and no rule is left on the box that never takes focus.
    expect(CSS).not.toMatch(/\.recharts-wrapper:focus/)
  })
})
