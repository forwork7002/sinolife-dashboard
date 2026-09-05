/**
 * Where every card and every connector goes.
 *
 * A pure function over the tree, deliberately outside the component: the chart
 * has to place twenty absolutely-positioned cards without one overlapping
 * another, and "does this layout overlap" is a question a test can answer in a
 * millisecond and an eye cannot answer reliably at all.
 *
 * The algorithm is the simple two-pass tidy tree — measure each subtree's
 * width bottom-up, then hand each child its slice of the parent's span top-down
 * — and NOT the "give every leaf the next free column" shortcut. The shortcut
 * is one pass shorter and produces crossed connectors the moment two branches
 * have different depths, which this tree has: «Навоий» carries six teams while
 * «Операцион» beside it carries none.
 */

/** One node as the layout needs it. Deliberately not the DTO: the layout does
 *  not care what a department is, only what hangs off it. */
export interface LayoutInput {
  readonly id: string
  readonly children: readonly LayoutInput[]
}

export interface LayoutNode {
  readonly id: string
  /** Left edge, in canvas units. Cards are all one width. */
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly parentId: string | null
}

export interface LayoutEdge {
  readonly from: string
  readonly to: string
  /** An SVG path, in the same canvas units as the nodes. */
  readonly d: string
}

export interface Layout {
  readonly nodes: readonly LayoutNode[]
  readonly edges: readonly LayoutEdge[]
  readonly width: number
  readonly height: number
}

export interface LayoutOptions {
  readonly cardWidth: number
  readonly cardHeight: number
  /** Gap between two siblings. */
  readonly columnGap: number
  /** Gap between one row of cards and the next. */
  readonly rowGap: number
  /**
   * Which nodes are drawn with their children hidden.
   *
   * A collapsed node contributes its own width and nothing else, which is what
   * makes collapsing useful: the twenty-card tree folds to five and the row of
   * nine stops being the thing that decides the canvas width.
   */
  readonly collapsed: ReadonlySet<string>
  /** Corner radius on the elbow connectors. */
  readonly elbowRadius: number
}

/**
 * The card's box, and why it is fixed.
 *
 * Every connector is drawn against these numbers, so a card that grew to fit a
 * long name or a second line of position would leave its own elbow hanging in
 * space. 150 is what the tallest content actually needs — title, a two-line
 * head row, the subordinate pill and the money strip, plus the footer — and it
 * was measured, not guessed: at 132 the footer of every childless card
 * overflowed its own border by eight pixels.
 */
export const DEFAULT_LAYOUT: Omit<LayoutOptions, 'collapsed'> = {
  cardWidth: 236,
  cardHeight: 152,
  columnGap: 20,
  rowGap: 56,
  elbowRadius: 10,
}

/**
 * Lay a forest out top-down.
 *
 * A FOREST, not a tree: `department.parentId` is nullable and a portal can
 * hand us more than one root — this database currently holds two, the demo
 * company and an imported one, and a layout that assumed a single root would
 * stack them on top of each other at the same coordinates.
 */
export function layoutTree(roots: readonly LayoutInput[], options: LayoutOptions): Layout {
  const { cardWidth, cardHeight, columnGap, rowGap, collapsed, elbowRadius } = options

  const centreOf = new Map<string, number>()
  const placed = new Map<string, { y: number; depth: number; parentId: string | null }>()
  const order: LayoutInput[] = []

  /**
   * How wide this subtree needs to be.
   *
   * At least one card — a leaf is its own width — and otherwise as wide as its
   * children laid side by side. Taking the MAX rather than the children's sum
   * is what keeps a wide parent from being narrower than the row beneath it.
   *
   * Memoised because the placement pass asks for the same subtree's width once
   * per ancestor, which on a chain is quadratic and on a real tree is simply
   * wasted work repeated at every level.
   */
  const widths = new Map<string, number>()
  const widthOf = (node: LayoutInput): number => {
    const cached = widths.get(node.id)
    if (cached !== undefined) return cached

    const kids = collapsed.has(node.id) ? [] : node.children
    const width =
      kids.length === 0
        ? cardWidth
        : Math.max(
            cardWidth,
            kids.reduce((sum, kid) => sum + widthOf(kid), 0) + columnGap * (kids.length - 1),
          )

    widths.set(node.id, width)
    return width
  }

  /**
   * Place one subtree inside the span it was given, and report its centre.
   *
   * The centre is the MIDPOINT OF THE FIRST AND LAST CHILD, not the middle of
   * the span. The two only differ when the outer children carry subtrees of
   * different sizes — «Навоий» has six teams under it and «Операцион» beside it
   * has none — and it is the child midpoint that looks like an org chart: the
   * parent sits over the row it commands rather than over the empty space its
   * widest branch happens to occupy. The card can never escape its own span
   * either way, because the midpoint is bounded by the first and last child
   * centres and every child is at least one card wide.
   */
  const place = (node: LayoutInput, left: number, depth: number, parentId: string | null): number => {
    order.push(node)

    const span = widthOf(node)
    const kids = collapsed.has(node.id) ? [] : node.children

    let centre: number
    if (kids.length === 0) {
      centre = left + span / 2
    } else {
      const inner =
        kids.reduce((sum, kid) => sum + widthOf(kid), 0) + columnGap * (kids.length - 1)
      // Centred inside the span, which matters only for a parent whose own card
      // is wider than everything beneath it.
      let cursor = left + (span - inner) / 2
      const centres: number[] = []

      for (const kid of kids) {
        centres.push(place(kid, cursor, depth + 1, node.id))
        cursor += widthOf(kid) + columnGap
      }

      centre = (centres[0]! + centres[centres.length - 1]!) / 2
    }

    centreOf.set(node.id, centre)
    placed.set(node.id, { y: depth * (cardHeight + rowGap), depth, parentId })
    return centre
  }

  let cursor = 0
  for (const root of roots) {
    place(root, cursor, 0, null)
    cursor += widthOf(root) + columnGap * 2
  }

  /*
    Emitted in the order they were WALKED, which is the tree's reading order.

    The cards are absolutely positioned, so their coordinates carry no meaning
    for a screen reader or for the tab key — DOM order is the only thing that
    does. Placing children before their parent (the order the maths above
    computes them in) would hand a keyboard user the leaves first.
  */
  const nodes: LayoutNode[] = order.map((n) => {
    const p = placed.get(n.id)!
    return { id: n.id, x: centreOf.get(n.id)! - cardWidth / 2, y: p.y, depth: p.depth, parentId: p.parentId }
  })

  // Connectors, once every centre is known. Drawn parent-down: out of the
  // parent's bottom edge, along a bus halfway down the gap, then into the
  // child's top edge. One shape for every edge in the chart, so a tree with a
  // row of nine and a tree with one child look like the same drawing.
  const edges: LayoutEdge[] = []
  for (const node of nodes) {
    if (!node.parentId) continue
    const parent = placed.get(node.parentId)
    if (!parent) continue

    const x1 = centreOf.get(node.parentId)!
    const y1 = parent.y + cardHeight
    const x2 = centreOf.get(node.id)!
    const y2 = node.y
    const bus = y1 + rowGap / 2

    edges.push({ from: node.parentId, to: node.id, d: elbow(x1, y1, x2, y2, bus, elbowRadius) })
  }

  const width = nodes.reduce((max, n) => Math.max(max, n.x + cardWidth), 0)
  const height = nodes.reduce((max, n) => Math.max(max, n.y + cardHeight), 0)

  return { nodes, edges, width, height }
}

/**
 * One connector: down, across, down — with rounded corners.
 *
 * Straight diagonals were the first attempt and they read as a network graph
 * rather than an org chart; the source screen draws orthogonal elbows and a
 * reader follows them by eye down a column. The radius is clamped to half the
 * horizontal run so a child almost directly below its parent gets a small
 * curve instead of an arc that doubles back on itself.
 */
function elbow(x1: number, y1: number, x2: number, y2: number, bus: number, radius: number): string {
  const dx = x2 - x1
  // Within a pixel, a straight line — an arc here would be a visible wobble.
  if (Math.abs(dx) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`

  const r = Math.min(radius, Math.abs(dx) / 2, Math.abs(bus - y1), Math.abs(y2 - bus))
  const dir = dx > 0 ? 1 : -1

  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${bus - r}`,
    `Q ${x1} ${bus} ${x1 + dir * r} ${bus}`,
    `L ${x2 - dir * r} ${bus}`,
    `Q ${x2} ${bus} ${x2} ${bus + r}`,
    `L ${x2} ${y2}`,
  ].join(' ')
}
