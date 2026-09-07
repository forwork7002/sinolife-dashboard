'use client'

import { useSyncExternalStore } from 'react'

/**
 * Light or dark, chosen by the reader and remembered per browser.
 *
 * The palette has shipped both modes since it was written — `globals.css`
 * carries a full second set of tokens — but the only thing that could reach
 * them was the operating system's own setting. This floor reads the dashboard
 * beside Bitrix24 all day and asked for the switch on the screen; somebody on
 * a machine pinned to light by IT policy had no way to get the dark one at all.
 *
 * THREE choices, not two. «Tizim» is not a third theme — it is the absence of
 * a decision, and it has to stay reachable, because a reader who once clicked
 * dark on a laptop that later moved to automatic day/night would otherwise be
 * stuck in whichever mode they last pressed with nothing on screen explaining
 * why the machine's own switch stopped working. It is also the default: an
 * account that has never touched this follows the OS exactly as before.
 *
 * The stylesheet does every bit of the actual work. `:root[data-theme="dark"]`
 * forces dark, the `prefers-color-scheme: dark` block is guarded with
 * `:not([data-theme="light"])` so the attribute can force light back, and
 * neither block exists if the attribute is absent. So this module writes ONE
 * attribute and nothing else — no class list, no inline colours, no second
 * palette in JavaScript that could drift from the CSS.
 *
 * Read through `useSyncExternalStore` for the reason `periodMemory` and
 * `sidebarCollapsed` are: storage does not exist on the server, and a value
 * read during render would make the first client paint disagree with the
 * markup that was sent.
 */

export const THEME_CHOICES = ['system', 'light', 'dark'] as const

export type ThemeChoice = (typeof THEME_CHOICES)[number]

/** What the page is actually painted in once «Tizim» has been resolved. */
export type ResolvedTheme = 'light' | 'dark'

/**
 * Versioned like every other preference key here. Changing it forgets every
 * reader's choice and drops them back on the system setting — survivable, but
 * it is a decision, not a rename.
 */
const KEY = 'sinolife.theme.v1'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * The forced browser-chrome colour, prepended to <head> so it beats the
 * media-scoped pair `layout.tsx` renders.
 *
 * A phone paints its address bar from `<meta name="theme-color">`, and the
 * layout's two are keyed to `prefers-color-scheme` — which is exactly the
 * thing a forced theme is overriding. Without this, a reader who picks light
 * on a dark phone gets a black bar over a white page. The spec says the FIRST
 * matching meta wins, hence `prepend`.
 */
const CHROME_META_ID = 'sinolife-theme-color'

function isThemeChoice(raw: unknown): raw is ThemeChoice {
  return THEME_CHOICES.includes(raw as ThemeChoice)
}

function read(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(KEY)
    return isThemeChoice(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The machine's own preference, where there is a machine to ask.
 *
 * `matchMedia` is universal in browsers and absent in jsdom, which is where
 * every component test that renders the shell runs — and a subscription that
 * throws inside an effect takes the page down with it. Missing resolves to
 * light, the same answer a browser that has never heard of the query gives.
 */
function darkMedia(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
  } catch {
    return null
  }
}

function prefersDark(): boolean {
  return darkMedia()?.matches ?? false
}

/** «Tizim» asked of the machine; anything else answers for itself. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice
  return prefersDark() ? 'dark' : 'light'
}

/**
 * The colour of the page in whatever theme is now in force, read back OUT of
 * the stylesheet rather than restated here.
 *
 * `--page` is defined once per theme in `globals.css`; a hex literal in this
 * file would be a second definition, and the one that goes stale silently is
 * always the copy nobody is looking at.
 */
function pageColour(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--page').trim()
  } catch {
    return ''
  }
}

function paintBrowserChrome(choice: ThemeChoice): void {
  const existing = document.getElementById(CHROME_META_ID) as HTMLMetaElement | null

  // On «Tizim» there is nothing to override: the layout's own media-scoped
  // pair is already the right answer, and ours would only pin it.
  const colour = choice === 'system' ? '' : pageColour()
  if (!colour) {
    existing?.remove()
    return
  }

  const meta = existing ?? document.createElement('meta')
  meta.id = CHROME_META_ID
  meta.name = 'theme-color'
  meta.content = colour
  if (!existing) document.head.prepend(meta)
}

/**
 * Paint the choice onto <html>.
 *
 * Exported because the same one line runs twice: here, on every change, and
 * inline in `layout.tsx` before the first byte of the body is parsed. The
 * inline copy is what stops a dark reader seeing a white flash on every cold
 * load, and it cannot import this module — a script that has to run before
 * hydration cannot wait for the bundle.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  paintBrowserChrome(choice)
}

let snapshot: ThemeChoice = 'system'
let loaded = false
const listeners = new Set<() => void>()

function publish(next: ThemeChoice): void {
  if (next === snapshot) return
  snapshot = next
  applyTheme(next)
  for (const listener of listeners) listener()
}

export function subscribeTheme(onChange: () => void): () => void {
  /*
    RECONCILE ON MOUNT, because the inline script does not do all of this.

    That script runs before the bundle exists and sets the attribute — which
    is the part that has to happen before the first paint. The browser-chrome
    meta does not: it is read once the page is up, and its colour has to be
    read back out of the stylesheet, which means waiting for the attribute the
    script just wrote. So the first load arrives with the right colours and
    the layout's own media-scoped pair still in charge of the address bar, and
    this is where that is corrected.

    Subscribing is React calling us from an effect, so touching the DOM here
    is legal in a way that doing it from `themeSnapshot` — a render-phase read
    — would not be. `applyTheme` is idempotent, so several subscribers cost
    nothing.

    /login is the one screen this never runs on: it renders bare, with no
    shell and no settings card, so nothing there subscribes. The page is still
    painted in the right theme by the attribute; only the address bar behind
    it follows the machine until the reader is through the door.
  */
  applyTheme(themeSnapshot())

  const onStorage = () => publish(read())

  listeners.add(onChange)
  window.addEventListener('storage', onStorage)

  /*
    The OS setting is part of this store too, not a separate concern. On
    «Tizim» a machine that switches to night at sunset has to move the page
    with it — the CSS does that on its own, but `useResolvedTheme` reads the
    machine, so the icon in the header would go on offering the mode already
    on screen until something else happened to re-render.
  */
  const media = darkMedia()
  media?.addEventListener('change', onChange)

  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
    media?.removeEventListener('change', onChange)
  }
}

export function themeSnapshot(): ThemeChoice {
  if (!loaded) {
    loaded = true
    snapshot = read()
  }
  return snapshot
}

/** «Tizim», always — the server has no browser to have a preference in. */
export function themeServerSnapshot(): ThemeChoice {
  return 'system'
}

export function setTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(KEY, choice)
  } catch {
    // The page still changes colour; it just will not remember next time.
  }
  // Storage events do not fire in the tab that wrote them, so publish here.
  // `loaded` is forced because a choice made before anything read the store
  // must not be overwritten by a later lazy read of what storage used to hold.
  loaded = true
  publish(choice)
}

/** The reader's choice, including «Tizim» — what a settings control shows. */
export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, themeServerSnapshot)
}

/**
 * What the page is painted in right now — what a two-state toggle needs.
 *
 * Server snapshot is `light` because that is what the markup is sent as; the
 * store re-renders with the truth on hydration, which is exactly the contract
 * `useSyncExternalStore` exists to provide.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribeTheme,
    () => resolveTheme(themeSnapshot()),
    () => 'light' as const,
  )
}
