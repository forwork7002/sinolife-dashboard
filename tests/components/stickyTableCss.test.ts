// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Pinned header and total cells keep the band they belong to.
 *
 * A DataTable with `stickyColumns` pins its first cells in every row — the
 * header's and the sticky total's too. `.tcol-sticky` (the pinned column's
 * ground, `--surface-raised`) is written AFTER `.thead-sticky` and
 * `.tfoot-sticky` at the same weight, so until 2026-10-06 it won: the pinned
 * header cell and the pinned «ИТОГО» cell were a raised patch in a sunken band
 * on about thirteen tables, their seam shadow replaced the band's own rule, the
 * header corner flipped colour under the pointer, and the total's unpinned
 * cells — later in their row at the same z-index — painted over its pinned one
 * as they scrolled under it.
 *
 * jsdom lays nothing out and resolves no var(), so this runs the stylesheet's
 * own cascade on the cells DataTable renders: every top-level rule whose
 * selector the cell matches, ranked by specificity and then source order, with
 * custom properties inherited and var() filled in. That is the question that
 * regressed — which declaration wins — asked of the real rules.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

interface Rule {
  readonly selectors: readonly string[]
  readonly declarations: ReadonlyMap<string, string>
  readonly order: number
}

/** Top-level rules only: no at-rule touches these cells' ground, seam or stacking. */
function topLevelRules(css: string): Rule[] {
  const rules: Rule[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const prelude = css.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (depth > 0 && j < css.length) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    if (!prelude.startsWith('@')) {
      const body = css.slice(open + 1, j - 1)
      const declarations = new Map<string, string>()
      for (const part of body.split(';')) {
        const colon = part.indexOf(':')
        if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
      }
      rules.push({ selectors: splitTopLevel(prelude), declarations, order: rules.length })
    }
    i = j
  }
  return rules
}

/** Splits on commas outside parentheses: `:is(a, b) c, d` is two selectors. */
function splitTopLevel(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let k = 0; k < list.length; k += 1) {
    if (list[k] === '(') depth += 1
    else if (list[k] === ')') depth -= 1
    else if (list[k] === ',' && depth === 0) {
      out.push(list.slice(start, k).trim())
      start = k + 1
    }
  }
  out.push(list.slice(start).trim())
  return out
}

/** [ids, classes + attributes + pseudo-classes, types]; :not/:is/:has count their argument, :where nothing. */
function specificity(selector: string): Specificity {
  let s = selector.replace(/:where\([^()]*\)/g, '').replace(/:(?:not|is|has)\(/g, ' (')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  s = s.replace(/#[\w-]+/g, ' ')
  const attrs = (s.match(/\[[^\]]*\]/g) ?? []).length
  s = s.replace(/\[[^\]]*\]/g, ' ')
  const classes = (s.match(/\.[\w-]+/g) ?? []).length
  s = s.replace(/\.[\w-]+/g, ' ')
  const pseudo = (s.match(/:[\w-]+/g) ?? []).length
  s = s.replace(/:[\w-]+/g, ' ')
  const types = (s.match(/(?:^|[\s>+~(])([a-z][\w-]*)/gi) ?? []).length
  return [ids, attrs + classes + pseudo, types]
}

const RULES = topLevelRules(CSS)

function matches(element: Element, selector: string): boolean {
  if (selector.includes('::')) return false
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

type Specificity = [number, number, number]

/** Specificity first, column by column; on a tie the later rule wins. */
function outranks(a: Specificity, aOrder: number, b: Specificity, bOrder: number): boolean {
  for (let k = 0; k < 3; k += 1) if (a[k] !== b[k]) return a[k]! > b[k]!
  return aOrder >= bOrder
}

/** The winning declaration of `property` on `element`, by specificity then order. */
function cascaded(element: Element, property: string): string | undefined {
  let best: { spec: Specificity; order: number; value: string } | undefined
  for (const rule of RULES) {
    const value = rule.declarations.get(property)
    if (value === undefined) continue
    for (const selector of rule.selectors) {
      if (!matches(element, selector)) continue
      const spec = specificity(selector)
      if (!best || outranks(spec, rule.order, best.spec, best.order)) best = { spec, order: rule.order, value }
    }
  }
  return best?.value
}

/** A custom property as the element computes it: its own, else inherited. */
function custom(element: Element | null, name: string): string | undefined {
  for (let at = element; at; at = at.parentElement) {
    const value = cascaded(at, name)
    if (value !== undefined) return resolve(at, value)
  }
  return undefined
}

/** Fills every var() in `value` as `element` would, fallbacks included. */
function resolve(element: Element, value: string): string {
  return value.replace(/var\((--[\w-]+)(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fallback?: string) =>
    custom(element, name) ?? (fallback !== undefined ? resolve(element, fallback.trim()) : `var(${name})`),
  )
}

const computed = (element: Element, property: string) => {
  const value = cascaded(element, property)
  return value === undefined ? undefined : resolve(element, value)
}

/**
 * The cells DataTable renders for a table with a pinned first column and a
 * pinned total row. The scroll state is marked on the BOX, as DataTable's own
 * scroll handler does (`[data-scrolled]`, `[data-scrolled-x]`), not on each cell.
 */
function table({ scrolledY = false, scrolledX = false } = {}) {
  document.body.innerHTML = `
    <div class="card"><div style="overflow-x:auto" ${scrolledY ? 'data-scrolled' : ''} ${scrolledX ? 'data-scrolled-x' : ''}><table>
      <thead><tr>
        <th class="thead-sticky tcol-sticky is-edge" id="corner">ROP</th>
        <th class="thead-sticky" id="head">FAKT 1</th>
      </tr></thead>
      <tbody>
        <tr><th class="tcol-sticky is-edge" id="pin">Sevinch</th><td id="cell">1</td></tr>
        <tr>
          <th class="tfoot-sticky tcol-sticky is-edge" id="total-pin">ИТОГО</th>
          <td class="tfoot-sticky" id="total">9</td>
        </tr>
      </tbody>
    </table></div></div>`
  const cell = (id: string) => document.getElementById(id)!
  return { corner: cell('corner'), head: cell('head'), pin: cell('pin'), totalPin: cell('total-pin'), total: cell('total') }
}

describe('a pinned header or total cell', () => {
  it('is painted in its band’s ground, not in the column’s', () => {
    const { corner, head, pin, totalPin, total } = table()

    expect(computed(head, 'background')).toBeDefined()
    expect(computed(corner, 'background')).toBe(computed(head, 'background'))
    expect(computed(totalPin, 'background')).toBe(computed(total, 'background'))
    // …while a body row's pinned cell keeps the card's colour.
    expect(computed(pin, 'background')).not.toBe(computed(head, 'background'))
  })

  it('stacks over the band’s own cells, which scroll under it later in the row', () => {
    const { corner, head, totalPin, total } = table()

    expect(Number(computed(corner, 'z-index'))).toBeGreaterThan(Number(computed(head, 'z-index')))
    expect(Number(computed(totalPin, 'z-index'))).toBeGreaterThan(Number(computed(total, 'z-index')))
  })

  it('keeps the band’s rule under its own seam: the scrolled header’s shadow, the total’s top line', () => {
    const scrolled = table({ scrolledY: true })
    const headerRule = computed(scrolled.head, 'box-shadow')!
    expect(headerRule).toContain('0 1px 0')
    expect(computed(scrolled.corner, 'box-shadow')).toContain(headerRule)

    const sideways = table({ scrolledX: true })
    const totalRule = computed(sideways.total, 'box-shadow')!
    expect(totalRule).toContain('0 -1px 0')
    expect(computed(sideways.totalPin, 'box-shadow')).toContain(totalRule)
    // …and still draws the divider the sideways scroll asks for.
    expect(computed(sideways.totalPin, 'box-shadow')).toContain('6px 0 12px -6px')
  })

  it('takes the row hover only in the body: a header or a total is not a row you point at', () => {
    const hover = RULES.filter((r) => r.selectors.some((s) => /:hover\s*>\s*\.tcol-sticky/.test(s)))
    expect(hover.length).toBeGreaterThan(0)
    for (const rule of hover) for (const selector of rule.selectors) expect(selector).toMatch(/^tbody tr:hover > /)
  })
})
