'use client'

import { useMemo, useSyncExternalStore } from 'react'

/**
 * How wide each column of the «RNP» grid is, remembered per browser.
 *
 * The client asked (2026-09-29) for every column to be draggable: the label
 * column narrowed to see more days, the fact column widened for a
 * billion-soʻm figure. A preference about how somebody reads the screen, not
 * about the data — so it is browser storage, not the URL and not the account,
 * for the reasons `sidebarCollapsed.ts` gives.
 *
 * ONE WIDTH PER COLUMN KIND, NOT PER BLOCK. The page stacks forty blocks, and
 * the point of a sheet is that «Fakt» in one block sits straight above «Fakt»
 * in the next. Widths are keyed by kind (`label`, `plan`, … `day`) and shared
 * by every block, so resizing one resizes the column in all of them.
 *
 * ONE WIDTH FOR EVERY DAY. Thirty day columns dragged one at a time would be
 * absurd, and a month whose 14th is wider than its 15th reads as a mistake.
 * Dragging any day's edge moves all of them.
 *
 * ONLY WHAT WAS CHANGED IS STORED. A kind with nothing stored falls back to
 * its default in CSS (`var(--rnp-w-label, …)`), which is what lets the label
 * column's default be narrower on a phone without the server having to know
 * the viewport.
 *
 * Read through `useSyncExternalStore`, the snapshot a STRING (as
 * `periodMemory.ts` explains: a fresh object per read would re-render for
 * ever), the server snapshot empty so hydration matches, and every storage
 * access wrapped — storage can be missing or throw, and a forgotten width is
 * a small annoyance while a page that will not render is not.
 */

export type RnpColumnKind = 'label' | 'plan' | 'dayPlan' | 'fact' | 'forecast' | 'index' | 'share' | 'day'

export type RnpColumnWidths = Partial<Record<RnpColumnKind, number>>

export const RNP_COLUMN_KINDS: readonly RnpColumnKind[] = [
  'label',
  'plan',
  'dayPlan',
  'fact',
  'forecast',
  'index',
  'share',
  'day',
]

/** Wide enough for the longest figure each column prints at the table's type size. */
export const DEFAULT_WIDTH: Readonly<Record<RnpColumnKind, number>> = {
  label: 240,
  plan: 136,
  dayPlan: 120,
  fact: 136,
  forecast: 136,
  index: 112,
  share: 84,
  day: 84,
}

const MIN_NUMBER = 56
const MIN_LABEL = 140
const MAX_NUMBER = 320
const MAX_LABEL = 520

export function minWidth(kind: RnpColumnKind): number {
  return kind === 'label' ? MIN_LABEL : MIN_NUMBER
}

export function maxWidth(kind: RnpColumnKind): number {
  return kind === 'label' ? MAX_LABEL : MAX_NUMBER
}

/** A width the grid can use: whole pixels, inside the kind's bounds. */
export function clampWidth(kind: RnpColumnKind, px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_WIDTH[kind]
  return Math.min(maxWidth(kind), Math.max(minWidth(kind), Math.round(px)))
}

/** The CSS custom property a kind's width travels in, set on `RnpColumnScope`. */
export function widthVar(kind: RnpColumnKind): `--rnp-w-${RnpColumnKind}` {
  return `--rnp-w-${kind}`
}

/** A kind's width as CSS: the stored one when the scope sets it, else the default. */
export function widthCss(kind: RnpColumnKind): string {
  return `var(${widthVar(kind)}, ${DEFAULT_WIDTH[kind]}px)`
}

// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'sinolife.rnp-colwidths.v1'

/**
 * Whatever is in storage, reduced to widths the grid can use. Anything that is
 * not a known kind with a finite number is dropped; a number out of bounds is
 * clamped. Corrupt JSON is nothing stored.
 */
export function parseWidths(raw: string | null): RnpColumnWidths {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: RnpColumnWidths = {}
  for (const kind of RNP_COLUMN_KINDS) {
    const value = (parsed as Record<string, unknown>)[kind]
    if (typeof value === 'number' && Number.isFinite(value)) out[kind] = clampWidth(kind, value)
  }
  return out
}

function read(): RnpColumnWidths {
  try {
    return parseWidths(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return {}
  }
}

let snapshot = '{}'
let loaded = false
const listeners = new Set<() => void>()

function publish(next: RnpColumnWidths): void {
  const serialised = JSON.stringify(next)
  loaded = true
  if (serialised === snapshot) return
  snapshot = serialised
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === STORAGE_KEY) publish(read())
}

export function subscribeColumnWidths(onChange: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function columnWidthsSnapshot(): string {
  if (!loaded) {
    loaded = true
    snapshot = JSON.stringify(read())
  }
  return snapshot
}

/** Nothing stored — the server has no browser, and hydration must match it. */
export function columnWidthsServerSnapshot(): string {
  return '{}'
}

/** Re-read storage — what a `storage` event does, callable when the store was loaded before storage was ready. */
export function reloadColumnWidths(): void {
  publish(read())
}

let parsedFor: string | null = null
let parsed: RnpColumnWidths = {}

/** The stored widths now — parsed once per snapshot, since a thousand handles ask. */
export function storedWidths(): RnpColumnWidths {
  const raw = columnWidthsSnapshot()
  if (raw !== parsedFor) {
    parsedFor = raw
    parsed = parseWidths(raw)
  }
  return parsed
}

function write(next: RnpColumnWidths): void {
  try {
    if (Object.keys(next).length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The columns still move; they just will not be remembered next time.
  }
  publish(next)
}

/** Store a kind's width (clamped), returning what was stored. */
export function setColumnWidth(kind: RnpColumnKind, px: number): number {
  const width = clampWidth(kind, px)
  write({ ...storedWidths(), [kind]: width })
  return width
}

/** Forget one kind's width, so it falls back to its default. */
export function resetColumnWidth(kind: RnpColumnKind): void {
  const next = { ...storedWidths() }
  delete next[kind]
  write(next)
}

/** Forget every width. */
export function resetColumnWidths(): void {
  write({})
}

// ---------------------------------------------------------------------------

/** Every stored width, re-rendering only when one changes. */
export function useColumnWidths(): RnpColumnWidths {
  const raw = useSyncExternalStore(subscribeColumnWidths, columnWidthsSnapshot, columnWidthsServerSnapshot)
  return useMemo(() => parseWidths(raw), [raw])
}

/**
 * One kind's stored width, or null. The snapshot is a number, so a handle
 * re-renders only when ITS kind changes — there are a thousand of them on the
 * page and a drag of «Fakt» should not touch the day handles.
 */
export function useStoredWidth(kind: RnpColumnKind): number | null {
  return useSyncExternalStore(
    subscribeColumnWidths,
    () => storedWidths()[kind] ?? null,
    () => null,
  )
}
