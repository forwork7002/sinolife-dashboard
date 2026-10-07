// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * SCROLLING MARKS THE BOX AND REDRAWS NO ROW.
 *
 * The header's floating shadow and the pinned column's divider follow the
 * scroll position. Held in React state, the first wheel tick, the first
 * sideways drag and every return to an edge re-ran every row's and every
 * cell's `render` — thousands of cells on Roistat's «Продавец» or Sverka's
 * 200 rows, a hitch exactly as the scroll began. They are attributes on the
 * scroll box now (`[data-scrolled]`, `[data-scrolled-x]`), read by globals.css,
 * as the «RNP» sheet's `markScrolledX` already did.
 */

beforeAll(() => {
  // The pinned columns measure their offsets with one; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

interface Row {
  readonly name: string
}

function table(stickyColumns = 0) {
  let renders = 0
  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'NOMI',
      rowHeader: true,
      render: (row) => {
        renders += 1
        return row.name
      },
    },
    { key: 'more', header: 'YANA', render: (row) => row.name.length },
  ]
  const rows = ['birinchi', 'ikkinchi', 'uchinchi'].map((name) => ({ name }))
  const { container } = render(
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.name} status="ready" stickyColumns={stickyColumns} />,
  )
  const box = container.querySelector('table')!.parentElement!
  return { box, renders: () => renders }
}

/** Where the box has been scrolled to — jsdom lays nothing out, so it is set by hand. */
function scrollTo(box: HTMLElement, top: number, left = 0) {
  Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => top })
  Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => left })
  fireEvent.scroll(box)
}

describe('DataTable while scrolling', () => {
  it('marks the box when the rows move under the header, and clears it back at the top, with no re-render', () => {
    const { box, renders } = table()
    const before = renders()

    scrollTo(box, 40)
    expect(box.hasAttribute('data-scrolled')).toBe(true)

    scrollTo(box, 0)
    expect(box.hasAttribute('data-scrolled')).toBe(false)

    expect(renders()).toBe(before)
  })

  it('marks the sideways scroll only where a column is pinned', () => {
    const pinned = table(1)
    scrollTo(pinned.box, 0, 30)
    expect(pinned.box.hasAttribute('data-scrolled-x')).toBe(true)
    scrollTo(pinned.box, 0, 0)
    expect(pinned.box.hasAttribute('data-scrolled-x')).toBe(false)
    cleanup()

    const plain = table()
    scrollTo(plain.box, 0, 30)
    expect(plain.box.hasAttribute('data-scrolled-x')).toBe(false)
  })
})

/*
 * …AND THE STYLESHEET HAS TO READ THEM. The marks are half of it; the rules
 * keyed on them are the other half, in another file, and the two can part
 * with neither failing on its own: globals.css keyed the same shadows on
 * `.is-scrolled` / `.is-scrolled-x` classes on each cell, which DataTable no
 * longer writes, so a stylesheet that went back to them would draw no header
 * shadow and no divider on any DataTable while every other test passed. These
 * run jsdom's own selector matching over globals.css on the cells DataTable
 * renders, before and after its own scroll handler marks the box.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  readonly selectors: readonly string[]
  readonly body: string
}

/** Splits a selector list on its own commas, not on those inside `:where(…)` or `:not(…)`. */
function splitSelectors(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '(') depth += 1
    else if (list[i] === ')') depth -= 1
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(list.slice(start).trim())
  return out
}

/** Top-level rules only: no at-rule reads the scroll marks. */
const RULES: readonly Rule[] = (() => {
  const out: Rule[] = []
  let at = 0
  while (at < CSS.length) {
    const open = CSS.indexOf('{', at)
    if (open < 0) break
    let depth = 1
    let end = open + 1
    for (; depth > 0 && end < CSS.length; end += 1) {
      if (CSS[end] === '{') depth += 1
      else if (CSS[end] === '}') depth -= 1
    }
    const prelude = CSS.slice(at, open).trim()
    if (!prelude.startsWith('@')) out.push({ selectors: splitSelectors(prelude), body: CSS.slice(open + 1, end - 1) })
    at = end
  }
  return out
})()

function applies(rule: Rule, cell: Element): boolean {
  return rule.selectors.some((selector) => {
    if (selector.includes('::')) return false
    try {
      return cell.matches(selector)
    } catch {
      return false
    }
  })
}

/** The rules that start to apply to `cell` once `scroll` has run — what the mark switches on. */
function switchedOn(cell: Element, scroll: () => void): Rule[] {
  const before = new Set(RULES.filter((rule) => applies(rule, cell)))
  scroll()
  return RULES.filter((rule) => !before.has(rule) && applies(rule, cell))
}

describe('globals.css, reading the marks DataTable writes', () => {
  it('floats every header cell once the rows move under it', () => {
    const { box } = table(1)
    const heads = [...box.querySelectorAll('thead th')]
    expect(heads.length).toBe(2)

    for (const head of heads) {
      const on = switchedOn(head, () => scrollTo(box, 40))
      scrollTo(box, 0)
      // The band's hairline in `--border-strong`, as the shadow itself or as the variable it is drawn from.
      expect(on.some((rule) => /box-shadow\s*:/.test(rule.body) && rule.body.includes('0 1px 0 var(--border-strong)'))).toBe(true)
    }
  })

  it('deepens the pinned column’s divider, header cell included, once the rows move sideways', () => {
    const { box } = table(1)
    const edges = [...box.querySelectorAll('.tcol-sticky.is-edge')]
    // The header's corner and the three rows' names.
    expect(edges.length).toBe(4)

    for (const edge of edges) {
      const on = switchedOn(edge, () => scrollTo(box, 0, 30))
      scrollTo(box, 0, 0)
      expect(on.some((rule) => /box-shadow\s*:[^;]*6px 0 12px -6px/.test(rule.body))).toBe(true)
    }
  })
})
