'use client'

import { type MouseEvent, type PointerEvent, useRef } from 'react'

/**
 * Drag a wide table sideways with the mouse — the client, 2026-09-29:
 * «malumotlar uzun bo'lib ketsa ham … mouse orqali o'ng chapga burilganda …
 * scroll qilinishi kerak». A month is thirty-odd columns of full numbers, and
 * the scrollbar at the bottom of a tall block is a long way from the row being
 * read.
 *
 * MOUSE ONLY. A finger already swipes a scroll box natively, and a pen is
 * usually selecting; `pointerType !== 'mouse'` is left entirely alone.
 *
 * A THRESHOLD, so a click is still a click. Nothing happens until the pointer
 * has travelled `DRAG_THRESHOLD` px sideways; only then is it captured, the
 * text selection dropped and the box panned. A pan that happened swallows the
 * click that ends it, so releasing over a tooltip button does not open it.
 *
 * NOT FROM EVERYWHERE. A press on a column's resize handle, on anything
 * interactive, or on a row's label (so its text can still be selected and
 * copied) does not start a pan — `NO_PAN`.
 *
 * The wheel is untouched: a vertical wheel stays the page's (and this box's)
 * vertical scroll, and Shift+wheel and a trackpad's sideways swipe scroll the
 * box natively.
 */
export const DRAG_THRESHOLD = 4

const NO_PAN = '[role="separator"], button, a, input, select, textarea, label, [data-no-pan], th[scope="row"]'

export function useDragScroll<T extends HTMLElement>() {
  const pan = useRef<{ id: number; x: number; left: number; active: boolean } | null>(null)
  const swallowClick = useRef(false)

  const onPointerDown = (e: PointerEvent<T>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if (e.target instanceof Element && e.target.closest(NO_PAN)) return
    pan.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, active: false }
  }

  const onPointerMove = (e: PointerEvent<T>) => {
    const p = pan.current
    if (!p || e.pointerId !== p.id) return
    const box = e.currentTarget
    const dx = e.clientX - p.x
    if (!p.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      p.active = true
      box.setPointerCapture?.(e.pointerId)
      box.dataset.panning = ''
      window.getSelection?.()?.removeAllRanges()
    }
    e.preventDefault()
    box.scrollLeft = p.left - dx
  }

  const end = (e: PointerEvent<T>) => {
    const p = pan.current
    if (!p || e.pointerId !== p.id) return
    pan.current = null
    if (!p.active) return
    const box = e.currentTarget
    delete box.dataset.panning
    box.releasePointerCapture?.(e.pointerId)
    swallowClick.current = true
    // A click follows pointerup in the same task, or not at all.
    setTimeout(() => {
      swallowClick.current = false
    }, 0)
  }

  const onClickCapture = (e: MouseEvent<T>) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture }
}
