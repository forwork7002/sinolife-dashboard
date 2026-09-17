'use client'

import { type RefObject, useEffect, useState } from 'react'

/**
 * The height, in whole CSS pixels, that an element's container gives it.
 *
 * WHY IT EXISTS (EFIR Premium spec §5, §6). A list on the television must
 * never rest on half a row: the sellers list is sized to a whole multiple of
 * its row (`Math.floor(h / 43) * 43`), and the teams list divides its height
 * among its teams (`clamp(40, Math.floor(h / n), 52)`). Both need the space
 * the column leaves them — a number CSS alone cannot round.
 *
 * WHAT IS MEASURED IS THE PARENT, NEVER THE ELEMENT. The caller sets the
 * element's height from this number; measuring the element itself would feed
 * that height straight back in and the list would ratchet down a row at a
 * time. So the contract is: put the list inside a slot that takes the
 * remaining space on its own (`flex: 1; min-height: 0`, or a grid track) and
 * whose size does not depend on the list — the hook reports that slot's
 * content-box height. With no parent, the element itself is observed.
 *
 * SSR-SAFE AND HONEST ABOUT NOT KNOWING. The server and the first client
 * render answer 0, which means «not measured yet», never «no room»: a caller
 * should fall back to its natural CSS size on 0 rather than drawing zero
 * rows. Where `ResizeObserver` does not exist (jsdom, an ancient TV browser)
 * the answer stays 0 for the same reason.
 *
 * The ref is read once, after mount. A list that mounts its element later
 * than its hook (a conditional render) must own the hook in the component
 * that renders the element.
 */
export function useAvailableHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const target = element.parentElement ?? element

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      const box = entry.contentBoxSize?.[0]
      const px = box ? box.blockSize : entry.contentRect.height
      // Whole pixels, floored: a list sized from a rounded-UP height would
      // overflow its slot by the fraction and show a hairline of the next row.
      const next = Math.max(0, Math.floor(px))
      // Same value, same state object — React bails out, nothing re-renders.
      setHeight(next)
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [ref])

  return height
}
