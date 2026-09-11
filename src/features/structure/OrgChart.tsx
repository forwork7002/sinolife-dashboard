'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { SearchInput } from '@/components/ui/Controls'
import type { StructureDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

import { OrgCard } from './OrgCard'
import { DEFAULT_LAYOUT, type LayoutInput, layoutTree } from './orgLayout'

const MIN_SCALE = 0.35
/*
  2, not 1.6. The canvas is the whole page now, so zooming in is how somebody
  reads a card from across a desk or shows it on a meeting screen — and at 1.6
  a 12.5px name is still 20px. Zooming OUT stops at 0.35 for the opposite
  reason: below that the names are gone and the chart stops being one.
*/
const MAX_SCALE = 2
const SCALE_STEP = 0.1

/**
 * How hard one wheel notch bites.
 *
 * A mouse notch is deltaY 100, so 100/700 is a factor of 0.87 — about a
 * seventh of the scale per notch, which crosses the whole range in a dozen
 * notches without overshooting the card the reader was aiming at. The
 * exponential is what makes a trackpad's forty small deltas add up to the same
 * gesture as a mouse's three big ones instead of slamming into a limit.
 */
const WHEEL_DIVISOR = 700

/** How many search rows fit over the chart without becoming the chart. */
const SEARCH_HIT_CAP = 12

/** One row of the search answer: a person, or a unit. */
interface SearchHit {
  readonly key: string
  /** The unit to select — a person's row selects the unit they sit in. */
  readonly unitId: string
  readonly label: string
  readonly sub: string
  /** Set on a person's row, so the panel can mark them. */
  readonly person?: string
}

/**
 * The smallest scale FIT is allowed to choose on its own.
 *
 * A card's name is 12.5px, so below about half size it is gone — and fitting
 * this portal's fully-open tree into a phone works out at 23%, which is a
 * screen of grey rectangles with no text in them at all. Past this floor,
 * fitting stops being a service: the chart starts at the top of the company at
 * a size that can be read and the reader pans, which is what the source screen
 * does too. The reader can still zoom further out by hand — that is their
 * decision about their own screen, and MIN_SCALE is where it stops.
 */
const FIT_FLOOR = 0.5

/**
 * How far below the canvas top the first card may start.
 *
 * MEASURED, not assumed. It used to be the constant 68 — 28px of button inside
 * 4px of padding inside a 12px inset — and the control row is no longer one
 * row: an account linked to an employee gets a second line carrying its own
 * chain of command, which put the top of the company behind the very strip
 * describing it. The fallback is the old number, for the render before the row
 * has been laid out.
 */
const TOOLBAR_FALLBACK = 68

/**
 * The company as a chart, on a canvas you can move.
 *
 * A faithful reading of `obey.bitrix24.kz/hr/structure/`: cards on a pannable,
 * zoomable surface, orthogonal connectors behind them, a floating control row
 * at the top and a zoom stepper bottom-left. Geometry comes from
 * `orgLayout.ts`; this file owns the viewport and the interaction.
 *
 * THE VIEWPORT IS A REF, NOT STATE. Pan writes the transform straight onto the
 * stage node and commits nothing, because a chart that re-rendered twenty cards
 * on every pointermove would spend a frame's whole budget producing a matrix
 * the compositor applies for free. Only the zoom READOUT is state, and it moves
 * in discrete steps.
 */
export function OrgChart({
  roots,
  selectedId,
  onSelect,
  viewerDepartmentId,
  panel,
}: {
  roots: readonly StructureDto[]
  selectedId: string | null
  /**
   * A unit was picked, and — when the search is what picked it — the person
   * whose name matched, so the panel can mark their row.
   */
  onSelect: (id: string | null, personName?: string) => void
  /** Where «Meni topish» flies to. Null when the account is not linked. */
  viewerDepartmentId: string | null
  /**
   * The department panel, rendered INSIDE the canvas.
   *
   * A prop rather than a sibling because the panel is positioned against the
   * canvas: docked over the chart, the viewport never changes size when it
   * opens, so the card the reader just clicked stays exactly where they
   * clicked it. Beside the canvas it would narrow the chart and re-lay every
   * card at the moment of the click.
   */
  panel?: ReactNode
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  /** Whatever the floating row currently occupies, plus its own inset. */
  const clearance = useCallback(
    () => (toolbarRef.current?.offsetHeight ?? TOOLBAR_FALLBACK - 24) + 24,
    [],
  )

  /*
    THE SAME MEASUREMENT, PUBLISHED TO CSS.

    The roster docks inside the canvas and has to start below the control row —
    and that row is one line for most readers and two for anybody linked to an
    employee, whose chain of command rides a second line. A constant `top` put
    the panel over the very strip naming their manager. A custom property is
    the only way the stylesheet can know a number only the layout has.

    A ResizeObserver rather than a one-off read: the row wraps at narrow widths
    and grows a line when a search runs, and neither of those re-renders this
    component with the new height available.
  */
  useEffect(() => {
    const bar = toolbarRef.current
    const canvas = canvasRef.current
    if (!bar || !canvas) return

    const publish = () =>
      canvas.style.setProperty('--org-toolbar-h', `${bar.offsetHeight}px`)
    publish()

    // jsdom has no ResizeObserver, and a component test that threw here would
    // fail fifteen assertions about the tree over a measurement none of them
    // makes. The one-off read above is what those tests get.
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  /** The live viewport. Written during a drag; never a render trigger. */
  const view = useRef({ x: 0, y: 0, scale: 1 })
  const [scalePct, setScalePct] = useState(100)
  const [query, setQuery] = useState('')

  /*
    THE SECOND LEVEL DOWN STARTS FOLDED, AND THAT IS NOT A PREFERENCE.

    Fully expanded, this portal's tree is 4 332 canvas units wide — a row of
    nine teams under «Тошкент онлайн» and six under «Навоий». Fitted into a
    1 500px card that is 35% zoom, where a card is 83px across and its name is
    four pixels tall: a chart nobody can read, on first paint, for every reader.
    The source screen behaves the same way — its own «9 отделов» sits folded in
    the screenshot this was built from — and the reader opens the one branch
    they came for.

    Null until the first answer arrives, because the set is derived from the
    tree and there is no tree yet; after that it is the reader's and nothing
    recomputes it.
  */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string> | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  /**
   * The card being LOOKED AT — under the pointer, or reached by the arrow keys.
   *
   * One state for both, because the chain highlight has to follow whichever
   * the reader is using. Keyed on DOM focus alone it froze for a keyboard
   * reader the moment anything was selected, and a selection is easy to
   * acquire here and hard to shed. Cleared when the pointer leaves the card and
   * when focus leaves the tree, so a stale peek cannot outrank a selection
   * made from the panel's breadcrumb.
   */
  const [peekId, setPeekId] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  /** Derived, not seeded through an effect: no cascading render, and it is
   *  simply unused from the moment the reader folds anything themself. */
  const structuralDefault = useMemo(() => {
    const folded = new Set<string>()
    const walk = (nodes: readonly StructureDto[], depth: number) => {
      for (const n of nodes) {
        if (depth >= 1 && n.children.length > 0) folded.add(n.id)
        walk(n.children, depth + 1)
      }
    }
    walk(roots, 0)
    return folded
  }, [roots])

  const flat = useMemo(() => flatten(roots), [roots])
  const byId = useMemo(() => new Map(flat.map((n) => [n.id, n])), [flat])

  /*
    The search lights matches and dims the rest, and OPENS THE WAY TO THEM.

    A match inside a folded branch would otherwise be lit and invisible. Folding
    is the reader's, so this does not rewrite it: the ancestors of a match are
    treated as open for as long as the search runs, and the reader's own folds
    come back the moment the box is cleared.
  */
  const term = query.trim().toLowerCase()

  /*
    ONE PREDICATE FOR THE LIGHTS AND THE LIST.

    The cards that light, the cards that dim, the count the live region
    announces and the rows under the box are all derived from THIS list, so
    they cannot disagree. They did: the highlighter matched a head's job title
    and the list did not, so «menejer» dimmed the company, lit two cards, flew
    to the first of them and printed «Topilmadi» underneath.

    MEMBER NAMES ARE IN THE HAYSTACK, and they are the point. This screen was
    asked for so the floor can see who works under whom, and the first thing a
    seller types into it is their own name. Matching only the unit and its head
    answered «topilmadi» over a dimmed company while their row sat two clicks
    away in a panel — the one search result the page exists to give them. The
    names ride the tree's own payload, so this costs no request.

    Keyed by INDEX among the members, not by name: two people who genuinely
    share a full name are two rows, which is the honest answer to a search for
    that name, and two rows may not share a React key.
  */
  const hits = useMemo(() => {
    if (!term) return [] as SearchHit[]
    const rows: SearchHit[] = []
    const has = (text: string | null | undefined) => (text ?? '').toLowerCase().includes(term)

    for (const n of flat) {
      if (has(n.name)) rows.push({ key: `u:${n.id}`, unitId: n.id, label: n.name, sub: 'boʻlim' })

      /*
        The head is usually one of the members too, and would then be listed
        twice — but not always: a unit whose named head does not sit in it has
        no membership row at all («Навоий»), and that person is exactly the one
        somebody searching for a manager is looking for. A head matches by
        name or by job title.
      */
      if (n.head && !n.memberNames.includes(n.head.name) && (has(n.head.name) || has(n.head.position))) {
        rows.push({
          key: `h:${n.id}`,
          unitId: n.id,
          label: n.head.name,
          sub: `${n.name} · rahbar`,
          person: n.head.name,
        })
      }

      n.memberNames.forEach((name, i) => {
        const isHead = n.head?.name === name
        if (!has(name) && !(isHead && has(n.head?.position))) return
        rows.push({
          key: `m:${n.id}:${i}`,
          unitId: n.id,
          label: name,
          /*
            THE MANAGER'S NAME, ON THE HIT ROW.

            The whole point of this search is «kim kimning qoʻl ostida», and the
            row printed the person and their unit — so the reader had to click,
            wait for the roster and read the head there to get the answer they
            typed the name for. `head` is already on the same node.
          */
          sub: isHead ? `${n.name} · rahbar` : n.head ? `${n.name} · ${n.head.name}` : n.name,
          person: name,
        })
      })
    }
    return rows
  }, [flat, term])

  /** The units that lit — derived from the rows, never computed beside them. */
  const matches = useMemo(
    () => (term ? new Set(hits.map((h) => h.unitId)) : null),
    [term, hits],
  )

  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>()
    const walk = (nodes: readonly StructureDto[], parent: string | null) => {
      for (const n of nodes) {
        map.set(n.id, parent)
        walk(n.children, n.id)
      }
    }
    walk(roots, null)
    return map
  }, [roots])

  /*
    THE OPENING FOLD IS THE READER'S OWN BRANCH, ALREADY OPEN.

    `structuralDefault` folds everything below the first level, which is right
    for somebody who came to look at the organisation and wrong for the person
    this screen was asked for: a seller's first frame was four root units, none
    of them theirs, with the useful one behind a control in the corner they had
    to notice first.

    Derived rather than written into state by an effect, because an effect that
    calls setState on the first paint is a second render of twenty cards before
    anything is on screen — and because the fold this produces is not the
    reader's decision, so «Hammasini yopish» must still return them to the
    structural default and not to this.
  */
  const openingCollapsed = useMemo(() => {
    if (!viewerDepartmentId) return structuralDefault
    const open = new Set(structuralDefault)
    let parent = parentOf.get(viewerDepartmentId) ?? null
    while (parent) {
      open.delete(parent)
      parent = parentOf.get(parent) ?? null
    }
    return open
  }, [structuralDefault, parentOf, viewerDepartmentId])

  /*
    THE SEARCH ANSWERS WITH NAMES, NOT WITH A COUNT.

    Typing «malika» used to produce «3 ta» and one card silently centred:
    nothing said WHICH Malika, and the second and third were unreachable. Each
    row names the person and the unit they sit in, and clicking it selects that
    unit, flies to its card and marks the row in the roster — which turns the
    box from a highlighter into the company's directory.

    Capped at twelve with the remainder counted out loud, because a term like
    «a» matches most of a 290-name roster and a list that long would cover the
    chart it is meant to point into.
  */
  const results = useMemo(
    () => ({
      rows: hits.slice(0, SEARCH_HIT_CAP),
      more: Math.max(0, hits.length - SEARCH_HIT_CAP),
    }),
    [hits],
  )

  /*
    WHOSE CHAIN IS LIT, in priority order.

    The peek comes first, so the chain follows the pointer — or the arrow keys
    — over a chart the reader has not committed to yet; a selection holds it
    still once they have; and with nothing picked at all it falls back to the
    READER'S OWN unit — so the first frame already answers «kim kimning qoʻl
    ostida ishlayapti» for the person looking at it, without them touching
    anything.
  */
  const chainEnd = peekId ?? selectedId ?? viewerDepartmentId

  /*
    THE CHAIN OF COMMAND, AS A SET OF IDS — the page's whole reason for being.

    Everything from that card up to the company root. The cards on it are washed
    and the connectors along it are lit, so the question is answered by the
    drawing instead of by the reader tracing nineteen identical grey lines with
    a finger.
  */
  const lineage = useMemo(() => {
    const chain = new Set<string>()
    let at: string | null = chainEnd
    while (at) {
      chain.add(at)
      at = parentOf.get(at) ?? null
    }
    return chain
  }, [chainEnd, parentOf])

  /** The reader's own chain, root first — printed in words at the top. */
  const yourChain = useMemo(() => {
    if (!viewerDepartmentId) return [] as StructureDto[]
    const up: StructureDto[] = []
    let at: string | null = viewerDepartmentId
    while (at) {
      const node = byId.get(at)
      if (node) up.unshift(node)
      at = parentOf.get(at) ?? null
    }
    return up
  }, [viewerDepartmentId, byId, parentOf])

  /*
    WHO THE READER ANSWERS TO — their unit's head, or the nearest one above it.

    Not every unit has one. «Тошкент онлайн» names no `UF_HEAD` at all and
    «Навоий» names somebody the portal does not list inside it, and in both
    cases the card draws no head row — so a line that stopped at the reader's
    own unit would tell a third of this floor «Rahbar tayinlanmagan», which is
    true of the unit and useless to the person.
  */
  const yourManager = useMemo(
    () => [...yourChain].reverse().find((n) => n.head)?.head ?? null,
    [yourChain],
  )

  /*
    WHAT MUST BE ON SCREEN WHATEVER THE READER HAS FOLDED.

    Two things force a branch open without touching the reader's own folds: a
    search match, which would otherwise be lit and invisible, and the SELECTED
    unit. The second is what makes «?dep=…» a shareable link — somebody pastes
    "this is the team, look" into a chat, and before this the recipient got the
    panel over a default folded tree with no card selected anywhere in it,
    because the selection had never been through a card click that unfolds.

    Derived rather than written into `collapsed`: the reader's folds are theirs
    and come back the moment the search is cleared or the panel is closed.
  */
  const effectiveCollapsed = useMemo(() => {
    const base: ReadonlySet<string> = collapsed ?? openingCollapsed
    const reveal = [...(matches ?? []), ...(selectedId ? [selectedId] : [])]
    if (reveal.length === 0) return base

    const open = new Set<string>()
    for (const id of reveal) {
      let parent = parentOf.get(id) ?? null
      while (parent) {
        open.add(parent)
        parent = parentOf.get(parent) ?? null
      }
    }
    return new Set([...base].filter((id) => !open.has(id)))
  }, [collapsed, openingCollapsed, matches, parentOf, selectedId])

  const layout = useMemo(
    () => layoutTree(roots as readonly LayoutInput[], { ...DEFAULT_LAYOUT, collapsed: effectiveCollapsed }),
    [roots, effectiveCollapsed],
  )

  const positions = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout])
  /** Only the cards the layout actually placed — a folded branch has none. */
  const visible = useMemo(
    () => layout.nodes.map((n) => byId.get(n.id)).filter((n): n is StructureDto => Boolean(n)),
    [layout, byId],
  )

  /** The topmost match in reading order — where a multi-hit search lands. */
  const firstMatch = useMemo(
    () => (matches ? (layout.nodes.find((n) => matches.has(n.id))?.id ?? null) : null),
    [matches, layout.nodes],
  )

  const applyTransform = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const { x, y, scale } = view.current
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }, [])

  /** Put a point of the LAYOUT at the centre of the viewport. */
  const centreOn = useCallback(
    (cx: number, cy: number, scale = view.current.scale) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { width: vw, height: vh } = canvas.getBoundingClientRect()
      view.current = { x: vw / 2 - cx * scale, y: vh / 2 - cy * scale, scale }
      setScalePct(Math.round(scale * 100))
      applyTransform()
    },
    [applyTransform],
  )

  /**
   * Fit the whole chart, then stop.
   *
   * Capped at 1 rather than scaled up to fill: a four-department demo blown up
   * to 180% is a screen of enormous cards, and the client reads this page
   * beside the portal's own, which never enlarges either.
   */
  const fit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || layout.width === 0) return
    const { width: vw, height: vh } = canvas.getBoundingClientRect()
    const pad = 48

    const ideal = Math.min(1, (vw - pad * 2) / layout.width, (vh - pad * 2) / layout.height)
    const scale = Math.max(FIT_FLOOR, ideal)

    /*
      When the floor bit, the whole chart does not fit — so open on the TOP of
      the company rather than on its geometric centre, which on a wide tree is
      empty canvas between two branches.

      Written straight into the viewport instead of going through `centreOn`,
      because only the horizontal axis is being centred: vertically the root
      goes just below the floating control row, and centring it would put the
      first card underneath the search box.
    */
    if (ideal < FIT_FLOOR) {
      const root = layout.nodes[0]
      const cx = root ? root.x + DEFAULT_LAYOUT.cardWidth / 2 : layout.width / 2
      view.current = { x: vw / 2 - cx * scale, y: clearance(), scale }
      setScalePct(Math.round(scale * 100))
      applyTransform()
      return
    }

    centreOn(layout.width / 2, layout.height / 2, scale)
  }, [layout.width, layout.height, layout.nodes, centreOn, applyTransform, clearance])

  const fitted = useRef(false)

  /*
    Expanding a branch must not move the card that was clicked.

    Every card to the right of a newly-opened branch shifts by that branch's
    width, and the parent itself re-centres over its new children — so without
    this the card under the cursor jumps hundreds of pixels sideways and the
    reader has to find it again. The correction is one subtraction: whatever
    the anchor card moved by in layout space, the viewport moves by the same
    amount, scaled.
  */
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null)
  /** A card «Meni topish» asked for before the unfold that would place it. */
  const pendingReveal = useRef<string | null>(null)
  /** The last card centred on its own, so an arrival is centred once and not
   *  re-centred on every refetch or fold. */
  const revealed = useRef<string | null>(null)

  useLayoutEffect(() => {
    const held = anchor.current
    anchor.current = null
    if (held) {
      const now = positions.get(held.id)
      if (now) {
        view.current.x -= (now.x - held.x) * view.current.scale
        view.current.y -= (now.y - held.y) * view.current.scale
        applyTransform()
      }
    }

    /*
      Three things ask to be brought into view, and each asks exactly once.

      «Meni topish» parks an id here. A selection that arrived in the URL rather
      than from a click has to be found too — the card may be anywhere in a
      4 000-unit-wide tree. And a search match that the unfold pushed off the
      canvas was lit, counted in the readout, and nowhere on screen.

      A click is deliberately NOT in this list: the card the reader just
      clicked is already under their cursor, and moving it would be the chart
      snatching itself away from them.
    */
    const arrival =
      pendingReveal.current ??
      (selectedId && selectedId !== revealed.current ? selectedId : null) ??
      (firstMatch && firstMatch !== revealed.current ? firstMatch : null)

    if (arrival) {
      const at = positions.get(arrival)
      if (at) {
        pendingReveal.current = null
        revealed.current = arrival
        centreOn(at.x + DEFAULT_LAYOUT.cardWidth / 2, at.y + DEFAULT_LAYOUT.cardHeight / 2)
      }
    }
    if (!selectedId && !firstMatch) revealed.current = null
  }, [positions, applyTransform, centreOn, selectedId, firstMatch])

  // --- Pan ------------------------------------------------------------------

  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    /*
      Only the BACKGROUND pans.

      `.org-panel` is in this list because the panel is docked INSIDE the canvas
      — that is what stops the chart resizing when it opens — so without it
      every pointerdown in the roster started a pan and captured the pointer,
      and the close button, the scrollbar and any attempt to select a name went
      to the canvas instead of to the panel.
    */
    if ((event.target as HTMLElement).closest('.org-card, .org-float, .org-panel')) return
    if (event.button !== 0) return

    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.panning = 'true'
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    view.current.x += event.clientX - d.x
    view.current.y += event.clientY - d.y
    d.x = event.clientX
    d.y = event.clientY
    applyTransform()
  }

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return
    drag.current = null
    delete event.currentTarget.dataset.panning
  }

  // --- Zoom -----------------------------------------------------------------

  /** Zoom about a point in VIEWPORT coordinates, so the point stays put. */
  const zoomAbout = useCallback(
    (next: number, px: number, py: number) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
      const { x, y, scale: old } = view.current
      if (scale === old) return
      view.current = {
        scale,
        x: px - ((px - x) / old) * scale,
        y: py - ((py - y) / old) * scale,
      }
      setScalePct(Math.round(scale * 100))
      applyTransform()
    },
    [applyTransform],
  )

  const step = (delta: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height: h } = canvas.getBoundingClientRect()
    zoomAbout(view.current.scale + delta, width / 2, h / 2)
  }

  /*
    A PLAIN WHEEL ZOOMS. It could not before, and the reason it can now is that
    the canvas became the page.

    This used to return early unless ctrl or meta was held, because the canvas
    was a card inside a scrolling `main` — a wheel that always called
    preventDefault would have trapped the page around it, so only the pinch
    gesture (which every trackpad sends as ctrl+wheel) was allowed to zoom.
    The chart now fills the viewport and there is nothing behind it left to
    scroll, so the gesture the client asked for is free to take: «sichqoncha
    scroll orqali katta-kichik».

    Bound imperatively because React attaches wheel listeners as PASSIVE, and a
    passive listener cannot preventDefault at all.

    THE HONEST COST: a Mac trackpad's two-finger scroll now zooms rather than
    pans, because a trackpad sends a plain wheel for scrolling and ctrl+wheel
    for pinching, and nothing in the event tells the two devices apart. This
    dashboard is read on office PCs with mice, one behaviour is right, and the
    trackpad's pan is a drag on the background — or Shift+wheel, below.
  */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (event: WheelEvent) => {
      /*
        THE ROSTER SCROLLS, AND ITS WHEEL IS NOT OURS.

        `.org-panel` is docked INSIDE the canvas — that is what stops the chart
        resizing when it opens — and its body is `overflow-y: auto`. Without
        this the wheel over an eighteen-person roster zoomed the chart behind
        it and the list simply would not move, with nothing on screen saying
        why. Same guard, same idiom, as `onPointerDown`.
      */
      if ((event.target as HTMLElement).closest('.org-panel, .org-hits')) return
      event.preventDefault()

      const rect = canvas.getBoundingClientRect()

      /*
        deltaMode says what the number means — pixels, lines or pages — and
        Firefox reports a mouse notch as three LINES. Both branches below need
        the same normalisation; the sideways pan once forgot it and moved the
        chart three pixels per notch, which on a tree four thousand units wide
        is indistinguishable from nothing happening.
      */
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1

      /*
        Shift is what the wheel's old job becomes.

        A wide tree is panned sideways far more than up and down, and a mouse
        with one wheel has no other way to ask for it now that plain wheel is
        the zoom.
      */
      if (event.shiftKey) {
        view.current.x -= (event.deltaY || event.deltaX) * unit
        applyTransform()
        return
      }

      /*
        SCALED BY HOW FAR THE WHEEL TURNED, not just which way.

        A fixed step per event is right for a mouse notch and wrong for a
        trackpad, which fires dozens of small deltas per flick and would cross
        the whole zoom range in one gesture. The clamp keeps one violent flick
        from jumping the chart across two scales at once.
      */
      const delta = Math.max(-240, Math.min(240, event.deltaY * unit))
      zoomAbout(
        view.current.scale * Math.exp(-delta / WHEEL_DIVISOR),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAbout, applyTransform])

  // --- Bringing a card into view -------------------------------------------

  const reveal = useCallback(
    (id: string) => {
      const at = positions.get(id)
      if (!at) return
      centreOn(at.x + DEFAULT_LAYOUT.cardWidth / 2, at.y + DEFAULT_LAYOUT.cardHeight / 2)
    },
    [positions, centreOn],
  )

  /**
   * Open the way to a card and put it in the middle of the screen.
   *
   * THE REVEAL WAITS FOR THE LAYOUT, IT DOES NOT GUESS AT A FRAME COUNT.
   *
   * This used to be a double `requestAnimationFrame` around `reveal(id)`, and
   * `reveal` closes over the CURRENT `positions` map — the one from before the
   * unfold, in which a card inside a folded branch does not exist at all. The
   * first click therefore did nothing and the second one worked, which is
   * exactly what a reader reports as "the button is broken".
   *
   * A card already on screen is centred straight away; one that has to be
   * unfolded first is parked, and the layout effect above picks it up on the
   * render where its position actually exists.
   */
  const bringIntoView = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev ?? openingCollapsed)
        let parent = parentOf.get(id) ?? null
        while (parent) {
          next.delete(parent)
          parent = parentOf.get(parent) ?? null
        }
        return next
      })

      if (positions.has(id)) reveal(id)
      else pendingReveal.current = id
    },
    [openingCollapsed, parentOf, positions, reveal],
  )

  const findMe = () => {
    if (!viewerDepartmentId) return
    onSelect(viewerDepartmentId)
    setFocusedId(viewerDepartmentId)
    bringIntoView(viewerDepartmentId)
  }

  /**
   * A search row was picked: go to the unit, mark the person in it — and put
   * the list away. The selection and the flight ARE the answer; left open, the
   * twelve rows sat over the chart as twelve stale tab stops with the rest of
   * the company still dimmed underneath them.
   */
  const openHit = (hit: SearchHit) => {
    onSelect(hit.unitId, hit.person)
    setFocusedId(hit.unitId)
    bringIntoView(hit.unitId)
    setQuery('')
  }

  /*
    THE FIRST FRAME LANDS ON THE READER, NOT ON THE COMPANY.

    Fitting the whole tree is the right opening for somebody who came to look at
    the organisation. It is the wrong one for the person this screen was asked
    for: a seller's first frame was four root units, none of them theirs, with
    the useful view one click away on a 28px control in the far corner that they
    had to discover. An account linked to an employee now opens unfolded to its
    own unit, centred, with the SIZ badge on it and its chain to the root already
    lit — the client's sentence answered before the reader does anything.

    It does NOT select the unit. Selecting opens the roster panel over a third of
    the chart and writes `?dep=` into an address the reader did not choose.

    FIT ONCE, AND NEVER AGAIN ON ITS OWN. Re-fitting whenever the shape changed
    was the obvious version and it is the wrong one: expanding «Тошкент онлайн»
    triples the chart's width, so the answer to "show me this branch" was the
    whole company zoomed to 35% and the branch smaller than before the click.
    Expanding keeps the reader's zoom and holds the card they clicked still (see
    `anchor` above); «Sigʻdirish» is there for when they do want the whole thing
    back — which is also the way back from this opening frame.

    Guarded on both `selectedId` and `term`: a pasted `?dep=` link and a search
    are each somebody asking for a different card, and this must not fight them.
  */
  useEffect(() => {
    if (fitted.current || layout.width === 0) return
    fitted.current = true

    /*
      The card is already PLACED — `openingCollapsed` unfolded the way to it
      before this render — so all that is left is to move the viewport, which
      is why nothing here changes the fold and no state is written.
    */
    const canvas = canvasRef.current
    const own = viewerDepartmentId && !selectedId && !term ? viewerDepartmentId : null

    /*
      FIT THE CHAIN, NOT THE CARD — and not the company either.

      Centring the reader's own unit was the obvious opening and it hides the
      exact thing they came for: the card lands in the middle of the canvas and
      everybody above them goes up behind the floating control row. Fitting the
      whole company is the other obvious opening and it is the one this
      replaces, because a seller's first frame was then four root units, none of
      them theirs.

      So the opening frame is the CHAIN's own bounding box — the company at the
      top, the reader at the bottom, everyone between them in view. It has to be
      the box and not just the height: the root sits over the middle of its
      children, so a chain hanging off the leftmost branch is as wide as it is
      tall and a phone showed the reader's card with the connector running off
      the right edge to a root that was not on screen.

      Scaled DOWN only, never up, and never below the same legibility floor
      `fit` uses. If even that will not hold the chain, `y` slides up so the
      reader's own card stays on screen — losing the top of the company rather
      than losing them.
    */
    const chain = own
      ? [...lineage].map((id) => positions.get(id)).filter((at) => at !== undefined)
      : []

    if (canvas && chain.length > 0) {
      const { width: vw, height: vh } = canvas.getBoundingClientRect()
      const top = clearance()

      const left = Math.min(...chain.map((at) => at.x))
      const right = Math.max(...chain.map((at) => at.x + DEFAULT_LAYOUT.cardWidth))
      const bottom = Math.max(...chain.map((at) => at.y + DEFAULT_LAYOUT.cardHeight))
      const width = right - left
      const height = bottom - Math.min(...chain.map((at) => at.y))

      const scale = Math.max(
        FIT_FLOOR,
        Math.min(1, (vw - 32) / width, (vh - top - 24) / height),
      )

      view.current = {
        x: vw / 2 - (left + width / 2) * scale,
        y: Math.min(top, vh - 24 - bottom * scale),
        scale,
      }
      setScalePct(Math.round(scale * 100))
      applyTransform()
    } else {
      fit()
    }
    // Deliberately once, on the first tree. The guards above are read at that
    // moment only, which is why they are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width])

  const toggle = (id: string) => {
    const at = positions.get(id)
    if (at) anchor.current = { id, x: at.x, y: at.y }
    setCollapsed((prev) => {
      const next = new Set(prev ?? openingCollapsed)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // --- Keyboard -------------------------------------------------------------

  /*
    The tree's keyboard contract, over cards that have no document flow.

    `visible` is the layout's own pre-order, which is the reading order, so
    up/down step through the chart the way a reader would say it aloud. Right
    opens a branch or descends into it, left closes one or climbs out — the
    WAI-ARIA tree pattern, and the only navigation a keyboard user has here,
    since absolutely-positioned cards give the tab key nothing to follow.
  */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    /*
      ONLY WHEN FOCUS IS ON A CARD.

      This listener is on the canvas, and the canvas also contains the search
      box and the zoom buttons — so without this guard, pressing SPACE in the
      search box was swallowed by the tree and selected a department instead of
      typing a space, and Home / End / ArrowLeft / ArrowRight moved the tree
      rather than the text cursor. The foot button is excluded too: it handles
      its own Enter, and letting the event through as well both folded the
      branch and opened the panel.
    */
    const target = event.target as HTMLElement
    if (!target.closest('[role="treeitem"]')) return
    if (target.closest('.org-card-foot-btn')) return

    const current = focusedId ?? visible[0]?.id
    if (!current) return
    const index = visible.findIndex((n) => n.id === current)
    if (index < 0) return

    const move = (to: string | undefined) => {
      if (!to) return
      event.preventDefault()
      setFocusedId(to)
      // The arrow keys are the keyboard's pointer: the chain follows them.
      setPeekId(to)
      reveal(to)
    }

    const node = visible[index]!
    const isOpen = node.childCount > 0 && !effectiveCollapsed.has(node.id)

    switch (event.key) {
      case 'ArrowDown':
        return move(visible[index + 1]?.id)
      case 'ArrowUp':
        return move(visible[index - 1]?.id)
      case 'Home':
        return move(visible[0]?.id)
      case 'End':
        return move(visible[visible.length - 1]?.id)
      case 'ArrowRight':
        if (node.childCount === 0) return
        if (!isOpen) {
          event.preventDefault()
          return toggle(node.id)
        }
        return move(node.children[0]?.id)
      case 'ArrowLeft':
        if (isOpen) {
          event.preventDefault()
          return toggle(node.id)
        }
        return move(parentOf.get(node.id) ?? undefined)
      case 'Enter':
      case ' ':
        event.preventDefault()
        onSelect(node.id === selectedId ? null : node.id)
        return
      default:
    }
  }

  /*
    MOVE FOCUS WHEN THE SELECTION MOVES — NOT WHEN THE LAYOUT DOES.

    This effect used to depend on `layout` as well, so that a card revealed by
    unfolding its branch would exist by the time focus was sent to it. But the
    layout is recomputed on every keystroke in the search box (the matches open
    the way to themselves) and on every 60-second refetch, so after the reader
    had once clicked a card, typing into the search box pulled focus out of the
    input on the first character and every poll stole it back.

    Keyed on the selection alone, with one retry a frame later for the case the
    dependency was there for: after a fold change the card may not be in the
    DOM yet on this tick, and a second attempt costs nothing when it already is.
  */
  const appliedFocus = useRef<string | null>(null)
  useEffect(() => {
    if (!focusedId || appliedFocus.current === focusedId) return
    appliedFocus.current = focusedId

    /*
      The TREEITEM is the focus target, not anything inside it.

      This used to reach for `.org-card-hit`, which was a <button> until the
      card was restructured to satisfy `role="tree"` — it is a plain div now,
      `focus()` on it is a no-op, and every arrow key moved the highlight while
      DOM focus stayed wherever it had been. A keyboard reader heard nothing.
    */
    const send = () =>
      canvasRef.current
        ?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(focusedId)}"]`)
        ?.focus({ preventScroll: true })

    if (!send()) {
      const frame = requestAnimationFrame(() => send())
      return () => cancelAnimationFrame(frame)
    }
  }, [focusedId])

  /*
    THE ONE TAB STOP, AND IT IS NEVER NOWHERE.

    Read straight off `focusedId`, the chart lost its only tab stop whenever
    the focused card stopped being drawn: search for a leaf, arrow onto it,
    then clear the search — the branch folds back, that card unmounts, and
    every remaining treeitem is `tabIndex={-1}`. A keyboard reader could then
    tab past the whole chart and never get back into it. The first placed card
    takes the stop whenever the focused one is not on screen.
  */
  const tabStop =
    focusedId && positions.has(focusedId) ? focusedId : (layout.nodes[0]?.id ?? null)

  /** Nothing the default would have folded is folded — so the button folds. */
  const allOpen = [...structuralDefault].every((id) => !effectiveCollapsed.has(id))

  const empty = layout.nodes.length === 0

  return (
    <div
      ref={canvasRef}
      className="org-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onKeyDown={onKeyDown}
    >
      {/*
        THE SURFACE A FINGER PANS, and the only element that refuses the
        browser its gestures.

        `touch-action: none` has to live on the thing being dragged and not on
        the canvas, because the property composes by INTERSECTION down the
        tree: a descendant cannot opt back in. On the canvas it silently took
        touch scrolling away from the two scrollers docked inside it — the
        roster sheet and the result list — so a phone could open a unit of
        eighteen and never reach the last eight. The stage carries the same
        rule; the floating chrome and the panel keep the default.
      */}
      <div className="org-backdrop" aria-hidden="true" />

      {/* The control row the portal floats over its own canvas. */}
      <div ref={toolbarRef} className="org-float org-float--top">
        {/*
          «MENI TOPISH» LEADS THE ROW, and it is the only filled button here.

          It used to be a 28px ghost pill wedged between «−», «100 %» and «+» in
          the bottom-left corner, where it read as a third zoom control. The
          client's goal makes finding yourself THE task on this screen, so it
          takes the first slot, the accent fill and the unit's name in its
          tooltip. It is absent — not disabled — for an account with no linked
          employee, because there is nowhere for it to fly to.
        */}
        {viewerDepartmentId && (
          <button
            type="button"
            onClick={findMe}
            className="focusable org-float-btn org-float-btn--primary"
            title={
              byId.get(viewerDepartmentId)
                ? `${byId.get(viewerDepartmentId)!.name} — sizning boʻlimingiz`
                : 'Sizning boʻlimingiz'
            }
          >
            <PinGlyph />
            Meni topish
          </button>
        )}

        <div
          className="org-search"
          /*
            Escape clears the search FIRST. The roster panel closes on Escape
            from anywhere on the page, so without stopping it here a reader
            trying to dismiss the result list lost the department they had
            open and kept the list.
          */
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !query) return
            event.stopPropagation()
            setQuery('')
          }}
        >
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Boʻlim, rahbar yoki xodim…"
          />

          {/*
            The answer, under the box that asked for it.

            Absolutely positioned so opening it never reflows the control row —
            the row wraps on a phone, and a list that pushed the buttons down
            would move the target out from under a finger already on its way.
            It sits inside `.org-float`, so the canvas's own pan guard already
            treats a drag in here as a drag on a control and not on the chart.
          */}
          {term.length > 0 && (
            <div className="org-hits">
              {results.rows.length === 0 ? (
                /*
                  THE SCOPE, because the haystack is active-only. `memberNames`
                  carries live employees, so a fired or suspended person — who
                  is exactly who somebody chasing an old order looks up —
                  returned a bare «Topilmadi» over a dimmed company,
                  indistinguishable from a typo. The roster panel can and does
                  render that person, with a «Faol emas» tag.
                */
                <p className="org-hit-empty">Topilmadi — qidiruv faqat faol xodimlar boʻyicha</p>
              ) : (
                <>
                  {results.rows.map((hit) => (
                    <button
                      key={hit.key}
                      type="button"
                      className="focusable org-hit"
                      onClick={() => openHit(hit)}
                    >
                      <span className="org-hit-name">{hit.label}</span>
                      <span className="org-hit-sub">{hit.sub}</span>
                    </button>
                  ))}
                  {results.more > 0 && (
                    <p className="org-hit-empty">
                      va yana {formatNumber(results.more)} ta — qidiruvni aniqlashtiring
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/*
          Always rendered, empty until there is a count.

          A live region has to be in the document BEFORE its content changes;
          one that appears already holding text is, to most screen readers, a
          new element rather than an update, and the result count went
          unannounced. `aria-live="polite"` and no `minWidth` collapse when
          there is nothing to say, so an empty search costs no layout either.
        */}
        <span
          className="org-zoom-value"
          role="status"
          aria-live="polite"
          style={{ minWidth: matches ? 78 : 0 }}
        >
          {/*
            THE ROWS, NOT THE UNITS. `matches` counts the cards that lit, and
            the list beside it counts people — so a term matching one unit and
            three of its people announced «1 ta» over four rows. This is the
            same number the reader can see.
          */}
          {matches
            ? results.rows.length === 0
              ? 'topilmadi'
              : `${formatNumber(results.rows.length + results.more)} ta`
            : ''}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/*
            A TOGGLE, because the open state has no way back on its own.

            Fully open, this portal's tree is 4 332 canvas units wide, and
            «Sigʻdirish» stops at the legibility floor — so a reader who
            expanded everything once had to fold twenty units by hand to get
            the readable default back.
          */}
          <button
            type="button"
            onClick={() => setCollapsed(allOpen ? structuralDefault : new Set())}
            className="focusable org-float-btn"
            title={
              allOpen
                ? 'Boʻlimlarni boshlangʻich holatga qaytarish'
                : 'Barcha boʻlimlarni ochish'
            }
          >
            {allOpen ? 'Hammasini yopish' : 'Hammasini ochish'}
          </button>
          <button
            type="button"
            onClick={fit}
            className="focusable org-float-btn"
            title="Butun tuzilmani ekranga sigʻdirish"
          >
            Sigʻdirish
          </button>
        </div>

        {/*
          THE CLIENT'S SENTENCE, PRINTED — «kim kimning qoʻl ostida ishlaydi».

          A second line of the same floating panel rather than a strip of its
          own, so it cannot collide with the roster docked on the right or with
          the zoom cluster at the bottom, and so it wraps with everything else on
          a phone. `flex-basis: 100%` is what puts it on its own line.

          It is the one affordance on this page that needs no interaction at
          all: a seller who does not yet know the canvas is draggable still
          reads their own chain of command on first paint. Every crumb selects
          that unit, so it doubles as the way up the tree.
        */}
        {yourChain.length > 0 && (
          <div className="org-you">
            <span className="org-you-label">Siz</span>
            <nav className="org-you-trail" aria-label="Sizning boʻlimingiz zanjiri">
              {yourChain.map((step, i) => (
                <span key={step.id} className="org-trail-step">
                  {i > 0 && (
                    <span className="org-trail-sep" aria-hidden="true">
                      ›
                    </span>
                  )}
                  <button
                    type="button"
                    className="focusable org-trail-link"
                    data-own={i === yourChain.length - 1 || undefined}
                    onClick={() => {
                      onSelect(step.id)
                      setFocusedId(step.id)
                      bringIntoView(step.id)
                    }}
                  >
                    {step.name}
                  </button>
                </span>
              ))}
            </nav>
            {yourManager && (
              <span className="org-you-boss">
                Rahbaringiz: <strong>{yourManager.name}</strong>
              </span>
            )}
          </div>
        )}
        {/*
          AND WHEN THERE IS NO CHAIN, SAY WHY.

          «Meni topish» and the chain line both render only for a reader whose
          account is linked to an employee. An unlinked account therefore opened
          on four folded root units with nothing personalised and nothing
          explaining the difference — the page looked broken rather than
          unconfigured. One muted line in the same slot, and the search box
          above it is the way through.
        */}
        {yourChain.length === 0 && (
          <div className="org-you">
            <span className="org-you-boss">
              Hisobingiz xodimga bogʻlanmagan — oʻzingizni qidiruvdan toping
            </span>
          </div>
        )}
      </div>

      {/* Bottom-left, exactly where the source screen keeps it. */}
      <div
        className="org-float org-float--zoom"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !helpOpen) return
          event.stopPropagation()
          setHelpOpen(false)
        }}
      >
        {/*
          THE ONLY PLACE LEFT THAT CAN EXPLAIN THE CANVAS.

          The instructions used to live in the card header's `hint` — «Kartani
          bosing… Fonni sudrab suring, Ctrl bilan gʻildirak — masshtab» — and
          that header is gone with the card, on a screen whose audience is
          sellers who have never used a pannable canvas. Six lines, behind a
          «?», rather than a permanent paragraph over the chart: the reader
          needs it once.
        */}
        <button
          type="button"
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          aria-controls="org-help-note"
          aria-label="Qanday ishlatiladi"
          className="focusable org-float-btn"
        >
          ?
        </button>
        {helpOpen && (
          <div id="org-help-note" className="org-help" role="note">
            <p><strong>Sudrab suring</strong> — fonni ushlab, chizmani suring.</p>
            <p><strong>Gʻildirak</strong> — kattalashtirish va kichraytirish.</p>
            <p><strong>Shift + gʻildirak</strong> — chapga-oʻngga surish.</p>
            <p><strong>Kartani bosing</strong> — boʻlim xodimlari roʻyxati ochiladi.</p>
            <p><strong>Yoʻnalish tugmalari</strong> — tuzilma boʻylab yurish.</p>
            <p><strong>Sigʻdirish</strong> — butun kompaniyani ekranga sigʻdirish.</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => step(-SCALE_STEP)}
          disabled={scalePct <= MIN_SCALE * 100}
          aria-label="Kichraytirish"
          className="focusable org-float-btn"
        >
          −
        </button>
        <span className="org-zoom-value" aria-live="off">
          {scalePct} %
        </span>
        <button
          type="button"
          onClick={() => step(SCALE_STEP)}
          disabled={scalePct >= MAX_SCALE * 100}
          aria-label="Kattalashtirish"
          className="focusable org-float-btn"
        >
          +
        </button>
      </div>

      <div ref={stageRef} className="org-stage">
        <svg
          className="org-links"
          width={Math.max(1, layout.width)}
          height={Math.max(1, layout.height)}
          aria-hidden="true"
        >
          {/*
            EVERY CONNECTOR ON THE CHAIN, not just the last hop.

            `edge.to === selectedId` lit exactly one line — the reader was told
            who their immediate parent was and left to trace the rest by eye
            across nineteen identical grey connectors. Every edge of the chain
            has its `to` inside `lineage`, so the mechanism generalises by one
            word and the picture becomes the answer.
          */}
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}->${edge.to}`}
              className="org-link"
              d={edge.d}
              data-active={lineage.has(edge.to) || undefined}
            />
          ))}
        </svg>

        {/*
          role=tree on the stage, not on the canvas: the canvas also holds the
          two floating control rows, and a toolbar inside a tree is not a
          treeitem — a screen reader would announce the zoom buttons as
          departments.
        */}
        <div
          role="tree"
          aria-label="Kompaniya tuzilmasi"
          /*
            A keyboard peek dies with the tree's focus. Without this, arrowing
            onto a card and then clicking a crumb in the panel left the chain
            lit on the card the keys had reached rather than on the unit the
            crumb had just selected.
          */
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPeekId(null)
          }}
        >
          {layout.nodes.map((placed) => {
            const node = byId.get(placed.id)
            if (!node) return null
            const siblings = placed.parentId
              ? (byId.get(placed.parentId)?.children ?? [])
              : roots

            return (
                <OrgCard
                  key={placed.id}
                  node={node}
                  x={placed.x}
                  y={placed.y}
                  width={DEFAULT_LAYOUT.cardWidth}
                  height={DEFAULT_LAYOUT.cardHeight}
                  selected={placed.id === selectedId}
                  collapsed={effectiveCollapsed.has(placed.id)}
                  matched={Boolean(matches?.has(placed.id))}
                  dimmed={Boolean(matches && !matches.has(placed.id))}
                  onSelect={() => {
                    setFocusedId(placed.id)
                    /*
                      A CLICK IS NOT AN ARRIVAL.

                      The layout effect flies to a selection it has not seen
                      before, which is what makes a pasted «?dep=» link land on
                      its card. A click sets the same state — so without
                      marking it here the chart also flew to the card the
                      reader had just clicked, sliding the whole tree under
                      their cursor and pushing the root behind the toolbar.
                      Claiming it now means the effect finds nothing to do.
                    */
                    revealed.current = placed.id
                    onSelect(placed.id === selectedId ? null : placed.id)
                  }}
                  onToggle={() => toggle(placed.id)}
                  /*
                    THE WHOLE CHAIN, ITS END INCLUDED — it is a path, not a set
                    of superiors. The picked card wears `selected` on top of it,
                    which wins by source order in globals.css.

                    `onPointerEnter` and not `mousemove`: one event per card
                    crossed rather than sixty a second, and guarded on a live
                    drag so panning the canvas does not repaint twenty cards
                    every frame it passes under the cursor.
                  */
                  onChain={lineage.has(placed.id)}
                  onHover={(over) => {
                    if (drag.current) return
                    setPeekId((prev) => (over ? placed.id : prev === placed.id ? null : prev))
                  }}
                  index={siblings.findIndex((s) => s.id === placed.id) + 1}
                  total={siblings.length}
                  /*
                    ROVING TABINDEX: exactly one card is in the tab order.

                    Twenty focusable cards would be twenty tab stops between the
                    search box and the zoom control, which is what the WAI-ARIA
                    tree pattern exists to avoid. Tab reaches the tree once and
                    the arrow keys steer inside it. The first card carries the
                    stop until the reader picks another, so the tree is always
                    reachable even before anything is selected.
                  */
                  tabbable={placed.id === tabStop}
                />
            )
          })}
        </div>
      </div>

      {panel}

      {empty && (
        <p
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          Bitrix24 kompaniya strukturasi import qilinmagan.
        </p>
      )}
    </div>
  )
}

function flatten(nodes: readonly StructureDto[]): StructureDto[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** A map pin, so «Meni topish» reads as a place rather than a zoom step. */
function PinGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path
        d="M8 14.5s5-4.2 5-8a5 5 0 0 0-10 0c0 3.8 5 8 5 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6.4" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
