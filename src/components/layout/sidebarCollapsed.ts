'use client'

/**
 * Whether the rail is collapsed to icons, remembered per browser.
 *
 * A preference about how somebody wants to look at the screen, not about the
 * data on it — so it belongs in the browser and not in the URL. Putting it in
 * the query string would make it travel with every shared link and force the
 * recipient's sidebar shut.
 *
 * Read through `useSyncExternalStore` for the same reason `periodMemory` is:
 * storage does not exist on the server, and a value read during render would
 * make the first client paint disagree with the markup that was sent. The
 * server snapshot is "open", which is also the right default.
 */

const KEY = 'sinolife.sidebar-collapsed.v1'

let snapshot = false
let loaded = false
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function publish(next: boolean): void {
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeSidebarCollapsed(onChange: () => void): () => void {
  const onStorage = () => publish(read())

  listeners.add(onChange)
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function sidebarCollapsedSnapshot(): boolean {
  if (!loaded) {
    loaded = true
    snapshot = read()
  }
  return snapshot
}

/** Open, always — the server has no browser to have a preference in. */
export function sidebarCollapsedServerSnapshot(): boolean {
  return false
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0')
  } catch {
    // The rail still moves; it just will not remember next time.
  }
  publish(collapsed)
}
