import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LAYOUT,
  type LayoutInput,
  layoutTree,
} from '@/features/structure/orgLayout'

const OPTS = { ...DEFAULT_LAYOUT, collapsed: new Set<string>() }

const node = (id: string, ...children: LayoutInput[]): LayoutInput => ({ id, children })

/**
 * The live portal's own shape, so the tests are about a tree that exists.
 *
 * NEWGEN over four units, one of which carries six teams and another nine, and
 * two of which carry none. That asymmetry is the whole difficulty: a layout
 * that walks leaves left to right handles a balanced tree perfectly and starts
 * crossing connectors here.
 */
const PORTAL: LayoutInput = node(
  'NEWGEN',
  node('Navoiy', node('sevinch'), node('gulzora'), node('lola'), node('baza'), node('maftuna'), node('kompaniya')),
  node('operatsion'),
  node('registratsiya'),
  node(
    'toshkent',
    node('asliddin'), node('azizbek'), node('saidaziz'), node('marjona'), node('sevinchxon'),
    node('new'), node('saida'), node('hayot'), node('charos'),
  ),
)

/** Every pair of cards on the same row, checked for overlap. */
function overlaps(layout: ReturnType<typeof layoutTree>, cardWidth: number) {
  const clashes: string[] = []
  const rows = new Map<number, typeof layout.nodes>()
  for (const n of layout.nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n])

  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      if (cur.x < prev.x + cardWidth) clashes.push(`${prev.id} / ${cur.id}`)
    }
  }
  return clashes
}

describe('org chart layout', () => {
  it('never overlaps two cards on the real portal shape', () => {
    const layout = layoutTree([PORTAL], OPTS)
    expect(layout.nodes).toHaveLength(20)
    expect(overlaps(layout, OPTS.cardWidth)).toEqual([])
  })

  /**
   * A parent sits over the MIDDLE of its children, not over the first one.
   *
   * This is the difference between an org chart and a file tree, and it is the
   * property the two-pass measure exists to buy: the row of nine under
   * «Тошкент онлайн» is 2 300 canvas units wide and its parent belongs above
   * the middle of it.
   */
  it('centres every parent over its own children', () => {
    const layout = layoutTree([PORTAL], OPTS)
    const by = new Map(layout.nodes.map((n) => [n.id, n]))
    const centre = (id: string) => by.get(id)!.x + OPTS.cardWidth / 2

    for (const n of layout.nodes) {
      const kids = layout.nodes.filter((k) => k.parentId === n.id)
      if (kids.length === 0) continue
      const first = Math.min(...kids.map((k) => centre(k.id)))
      const last = Math.max(...kids.map((k) => centre(k.id)))
      expect(centre(n.id)).toBeCloseTo((first + last) / 2, 6)
    }
  })

  it('puts each level on its own row, in order', () => {
    const layout = layoutTree([PORTAL], OPTS)
    const rowFor = (depth: number) => depth * (OPTS.cardHeight + OPTS.rowGap)
    for (const n of layout.nodes) expect(n.y).toBe(rowFor(n.depth))
  })

  /**
   * Collapsing hides the subtree and gives the canvas its width back.
   *
   * Not cosmetic: the row of nine is what makes this chart 2 300 units wide,
   * and a reader who only wants «Навоий» should not have to pan past it.
   */
  it('drops a collapsed node children and shrinks the canvas', () => {
    const open = layoutTree([PORTAL], OPTS)
    const shut = layoutTree([PORTAL], { ...OPTS, collapsed: new Set(['toshkent']) })

    expect(shut.nodes.map((n) => n.id)).not.toContain('charos')
    expect(shut.nodes).toHaveLength(20 - 9)
    expect(shut.width).toBeLessThan(open.width)
    expect(overlaps(shut, OPTS.cardWidth)).toEqual([])
  })

  it('collapsing the root leaves exactly one card', () => {
    const layout = layoutTree([PORTAL], { ...OPTS, collapsed: new Set(['NEWGEN']) })
    expect(layout.nodes).toHaveLength(1)
    expect(layout.width).toBe(OPTS.cardWidth)
    expect(layout.height).toBe(OPTS.cardHeight)
    expect(layout.edges).toEqual([])
  })

  /**
   * A FOREST, because `department.parentId` is nullable.
   *
   * The portal hands us one root today, but the column has no constraint
   * saying so and this database has held two at once. Two roots laid out at
   * the same origin would draw one company on top of another.
   */
  it('lays two roots side by side rather than on top of each other', () => {
    const layout = layoutTree([node('a', node('a1'), node('a2')), node('b', node('b1'))], OPTS)
    expect(overlaps(layout, OPTS.cardWidth)).toEqual([])
    const a = layout.nodes.find((n) => n.id === 'a')!
    const b = layout.nodes.find((n) => n.id === 'b')!
    expect(b.x).toBeGreaterThan(a.x + OPTS.cardWidth)
  })

  it('draws exactly one connector per non-root card', () => {
    const layout = layoutTree([PORTAL], OPTS)
    expect(layout.edges).toHaveLength(layout.nodes.length - 1)
    const ids = new Set(layout.nodes.map((n) => n.id))
    for (const e of layout.edges) {
      expect(ids.has(e.from)).toBe(true)
      expect(ids.has(e.to)).toBe(true)
      expect(e.d.startsWith('M ')).toBe(true)
      expect(e.d).not.toContain('NaN')
    }
  })

  /**
   * A child directly below its parent gets a straight line, not an arc.
   *
   * With one child the two centres coincide, and an elbow radius applied to a
   * zero-length horizontal run draws a visible S-shaped wobble on what should
   * be a plain vertical drop.
   */
  it('draws a straight connector to an only child', () => {
    const layout = layoutTree([node('p', node('c'))], OPTS)
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]!.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
  })

  /**
   * DOM ORDER IS THE ONLY READING ORDER AN ABSOLUTELY-POSITIONED CHART HAS.
   *
   * The maths places children before their parent, because a parent's centre
   * is the midpoint of theirs. Emitting in that order would hand a keyboard
   * user «Charos(ROP)» before «NEWGEN» and read the company bottom-up.
   */
  it('emits parents before their children', () => {
    const layout = layoutTree([PORTAL], OPTS)
    const at = new Map(layout.nodes.map((n, i) => [n.id, i]))
    for (const n of layout.nodes) {
      if (n.parentId) expect(at.get(n.parentId)!).toBeLessThan(at.get(n.id)!)
    }
    expect(layout.nodes[0]!.id).toBe('NEWGEN')
  })

  it('handles an empty forest without throwing', () => {
    const layout = layoutTree([], OPTS)
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
    expect(layout.width).toBe(0)
    expect(layout.height).toBe(0)
  })

  /**
   * A deep chain must not be laid out as a diagonal staircase.
   *
   * Every node in a single-child chain has the same centre, so the whole chain
   * is one column exactly one card wide.
   */
  it('keeps a single-child chain in one column', () => {
    const chain = node('l0', node('l1', node('l2', node('l3'))))
    const layout = layoutTree([chain], OPTS)
    const xs = new Set(layout.nodes.map((n) => n.x))
    expect(xs.size).toBe(1)
    expect(layout.width).toBe(OPTS.cardWidth)
  })
})
