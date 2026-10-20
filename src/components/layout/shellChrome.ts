'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * What the open page tells the shell about itself.
 *
 * Since 2026-10-20 the shell is drawn ONCE, by `src/app/(app)/layout.tsx`, and
 * stays mounted across navigations — it used to be rendered inside every page
 * by `PageShell`, so each click tore down and rebuilt the rail and the header
 * with the page (the client: «page dan page o'tishim … silliq … qotmasdan»).
 * Two facts it took as props from the page now arrive through here instead:
 *
 * - `periodAware` — whether the page has a reporting window, so the ⌘K palette
 *   offers the «Davr» presets only where something reads them (see `Shell`).
 *   It can change while a page is open: the confirmation board drops its
 *   window in backlog mode.
 * - `dataSource` — the source chip in the header, from the page's own
 *   response; the shell falls back to the application's (`/meta/filters`)
 *   while no page has said, so the chip holds still across a navigation.
 *
 * A page announces both from a layout effect and takes them back when it
 * unmounts, so a screen that announces nothing (`/account`) is read as having
 * no window — the shell's default. In one commit the old page's
 * cleanup runs before the new page's effect, so the new page's word is the
 * last one.
 */
export interface ShellChrome {
  readonly periodAware: boolean
  readonly dataSource: 'DEMO' | 'BITRIX24' | 'MANUAL' | undefined
}

const NONE: ShellChrome = { periodAware: false, dataSource: undefined }

let snapshot: ShellChrome = NONE
const listeners = new Set<() => void>()

function publish(next: ShellChrome): void {
  if (next.periodAware === snapshot.periodAware && next.dataSource === snapshot.dataSource) return
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

const read = () => snapshot
const readOnServer = () => NONE

/** The open page's facts, for the shell. */
export function useShellChrome(): ShellChrome {
  return useSyncExternalStore(subscribe, read, readOnServer)
}

/** Called by the page frame (`PageShell`): tells the shell what this page is. */
export function useAnnounceShellChrome(
  periodAware: boolean,
  dataSource: ShellChrome['dataSource'],
): void {
  useLayoutEffect(() => {
    publish({ periodAware, dataSource })
  }, [periodAware, dataSource])
  useLayoutEffect(() => () => publish(NONE), [])
}
