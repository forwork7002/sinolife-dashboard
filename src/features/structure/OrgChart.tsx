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
const MAX_SCALE = 1.6
const SCALE_STEP = 0.1

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
 * How far below the canvas top the first card starts when the chart is too big
 * to fit. The floating control row is 28px of button inside 4px of padding
 * inside a 12px inset, so anything less puts the root card under the search box.
 */
const TOOLBAR_CLEARANCE = 68

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
  height = '620px',
  panel,
}: {
  roots: readonly StructureDto[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Where «Meni topish» flies to. Null when the account is not linked. */
  viewerDepartmentId: string | null
  /** Any CSS length. Reaches `.org-canvas` as `--org-canvas-h`. */
  height?: string
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

  /** Derived, not seeded through an effect: no cascading render, and it is
   *  simply unused from the moment the reader folds anything themself. */
  const defaultCollapsed = useMemo(() => {
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
  const matches = useMemo(() => {
    if (!term) return null
    const hit = new Set<string>()
    for (const n of flat) {
      /*
        MEMBER NAMES ARE IN THE HAYSTACK, and they are the point.

        This screen was asked for so the floor can see who works under whom,
        and the first thing a seller types into it is their own name. Matching
        only the unit and its head answered «topilmadi» over a dimmed company
        while their row sat two clicks away in a panel — the one search result
        the page exists to give them. The names ride the tree's own payload, so
        this costs no request and no debounce.
      */
      const hay = [n.name, n.head?.name ?? '', n.head?.position ?? '', ...n.memberNames]
        .join(' ')
        .toLowerCase()
      if (hay.includes(term)) hit.add(n.id)
    }
    return hit
  }, [flat, term])

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
    const base: ReadonlySet<string> = collapsed ?? defaultCollapsed
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
  }, [collapsed, defaultCollapsed, matches, parentOf, selectedId])

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
      view.current = { x: vw / 2 - cx * scale, y: TOOLBAR_CLEARANCE, scale }
      setScalePct(Math.round(scale * 100))
      applyTransform()
      return
    }

    centreOn(layout.width / 2, layout.height / 2, scale)
  }, [layout.width, layout.height, layout.nodes, centreOn, applyTransform])

  /*
    FIT ONCE, ON THE FIRST TREE — AND NEVER AGAIN ON ITS OWN.

    Re-fitting whenever the shape changed was the obvious version and it is the
    wrong one: expanding «Тошкент онлайн» triples the chart's width, so the
    answer to "show me this branch" was the whole company zoomed to 35% and the
    branch smaller than it had been before the click. Expanding keeps the
    reader's zoom and holds the card they clicked still (see `anchor` below);
    «Sigʻdirish» is there for when they do want the whole thing back.
  */
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || layout.width === 0) return
    fitted.current = true
    fit()
  }, [layout.width, fit])

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
    Wheel zoom is bound imperatively because it must be able to preventDefault.

    React attaches wheel listeners as passive, so `onWheel` cannot stop the
    page from scrolling underneath — a pinch on a trackpad would zoom the chart
    AND scroll the dashboard. The `{ passive: false }` listener below is the
    only way to own the gesture.
  */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (event: WheelEvent) => {
      // A plain wheel is a scroll and belongs to the page. Only the pinch
      // gesture — which arrives as ctrl+wheel from every trackpad — zooms.
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAbout(
        view.current.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAbout])

  // --- Bringing a card into view -------------------------------------------

  const reveal = useCallback(
    (id: string) => {
      const at = positions.get(id)
      if (!at) return
      centreOn(at.x + DEFAULT_LAYOUT.cardWidth / 2, at.y + DEFAULT_LAYOUT.cardHeight / 2)
    },
    [positions, centreOn],
  )

  const findMe = () => {
    if (!viewerDepartmentId) return
    // Unfold everything above it first, or «Meni topish» centres on a card
    // that is not currently drawn and the canvas lands on empty space.
    setCollapsed((prev) => {
      const next = new Set(prev ?? defaultCollapsed)
      let parent = parentOf.get(viewerDepartmentId) ?? null
      while (parent) {
        next.delete(parent)
        parent = parentOf.get(parent) ?? null
      }
      return next
    })
    onSelect(viewerDepartmentId)
    setFocusedId(viewerDepartmentId)

    /*
      THE REVEAL WAITS FOR THE LAYOUT, IT DOES NOT GUESS AT A FRAME COUNT.

      This used to be a double `requestAnimationFrame` around `reveal(id)`, and
      `reveal` closes over the CURRENT `positions` map — the one from before the
      unfold, in which a card inside a folded branch does not exist at all. The
      first click therefore did nothing and the second one worked, which is
      exactly what a reader reports as "the button is broken".

      A card already on screen is centred straight away; one that has to be
      unfolded first is parked, and the layout effect below picks it up on the
      render where its position actually exists.
    */
    if (positions.has(viewerDepartmentId)) reveal(viewerDepartmentId)
    else pendingReveal.current = viewerDepartmentId
  }

  const toggle = (id: string) => {
    const at = positions.get(id)
    if (at) anchor.current = { id, x: at.x, y: at.y }
    setCollapsed((prev) => {
      const next = new Set(prev ?? defaultCollapsed)
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
  const allOpen = [...defaultCollapsed].every((id) => !effectiveCollapsed.has(id))

  const empty = layout.nodes.length === 0

  return (
    <div
      ref={canvasRef}
      className="org-canvas"
      style={{ '--org-canvas-h': height } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onKeyDown={onKeyDown}
    >
      {/* The control row the portal floats over its own canvas. */}
      <div className="org-float org-float--top">
        <div className="min-w-0 flex-1" style={{ maxWidth: 260 }}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Boʻlim, rahbar yoki xodim…"
          />
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
          {matches ? (matches.size === 0 ? 'topilmadi' : `${formatNumber(matches.size)} ta`) : ''}
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
            onClick={() => setCollapsed(allOpen ? defaultCollapsed : new Set())}
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
      </div>

      {/* Bottom-left, exactly where the source screen keeps it. */}
      <div className="org-float org-float--zoom">
        {viewerDepartmentId && (
          <button type="button" onClick={findMe} className="focusable org-float-btn">
            Meni topish
          </button>
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
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}->${edge.to}`}
              className="org-link"
              d={edge.d}
              data-active={edge.to === selectedId || undefined}
            />
          ))}
        </svg>

        {/*
          role=tree on the stage, not on the canvas: the canvas also holds the
          two floating control rows, and a toolbar inside a tree is not a
          treeitem — a screen reader would announce the zoom buttons as
          departments.
        */}
        <div role="tree" aria-label="Kompaniya tuzilmasi">
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
