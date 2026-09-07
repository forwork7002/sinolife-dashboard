/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Light or dark, chosen by the reader.
 *
 * The cases worth pinning are the ones nothing on screen would report. The
 * store writes ONE attribute and the stylesheet does the rest, so every way
 * this breaks is a way the attribute and the CSS stop agreeing — and the page
 * still renders, in the wrong colours, with no error anywhere.
 */

const KEY = 'sinolife.theme.v1'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage
}

function install(storage: Storage, dark = false): void {
  vi.stubGlobal('localStorage', storage)
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** Fresh module state per test — the store latches its first storage read. */
async function load() {
  vi.resetModules()
  return import('@/lib/theme')
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = ''
  install(fakeStorage())
})

afterEach(() => vi.unstubAllGlobals())

describe('the stored choice', () => {
  it('is «Tizim» until somebody decides otherwise', async () => {
    const theme = await load()

    expect(theme.themeSnapshot()).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('writes the attribute the stylesheet reads, and remembers it', async () => {
    const storage = fakeStorage()
    install(storage)
    const theme = await load()

    theme.setTheme('dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(storage.getItem(KEY)).toBe('dark')
  })

  it('forces LIGHT with an attribute too, not by removing one', async () => {
    /*
      The half a reader on a dark machine depends on. «Yorugʻ» has to be a
      positive statement — `data-theme="light"` — because the media query is
      what would otherwise answer, and it answers dark. Removing the attribute
      instead would make «Yorugʻ» a no-op on exactly the machines it exists
      for, and it would look like the button was dead.
    */
    const theme = await load()

    theme.setTheme('light')

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('lets «Tizim» be taken back, by clearing the attribute', async () => {
    const theme = await load()

    theme.setTheme('dark')
    theme.setTheme('system')

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(theme.themeSnapshot()).toBe('system')
  })

  it('reads anything it does not recognise as «Tizim»', async () => {
    // A hand-edited key, or a value left by a future version.
    install(fakeStorage({ [KEY]: 'midnight' }))
    const theme = await load()

    expect(theme.themeSnapshot()).toBe('system')
  })

  it('still changes colour when storage refuses to be written', async () => {
    // A private window or blocked site data must cost the MEMORY of the
    // choice, not the choice itself.
    install({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    } as unknown as Storage)
    const theme = await load()

    expect(() => theme.setTheme('dark')).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('resolving «Tizim»', () => {
  it('asks the machine, and answers for itself otherwise', async () => {
    install(fakeStorage(), true)
    const theme = await load()

    expect(theme.resolveTheme('system')).toBe('dark')
    expect(theme.resolveTheme('light')).toBe('light')

    install(fakeStorage(), false)
    expect(theme.resolveTheme('system')).toBe('light')
  })

  it('subscribes to the machine as well as to the store', async () => {
    /*
      On «Tizim» the CSS repaints itself when the OS flips at sunset, but the
      header's icon is JavaScript reading the same media query — without this
      listener it would go on offering the mode already on screen until some
      unrelated render happened to correct it.
    */
    const listeners: string[] = []
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (event: string) => listeners.push(event),
      removeEventListener: () => {},
    }))
    const theme = await load()

    const stop = theme.subscribeTheme(() => {})
    expect(listeners).toContain('change')
    stop()
  })

  it('survives an environment with no matchMedia at all', async () => {
    /*
      jsdom has none, and jsdom is where every component test that renders the
      shell runs. A subscription that throws inside an effect takes the whole
      page down with it — this exact shape broke four unrelated PageShell
      tests the first time the listener went in unguarded. Missing resolves to
      light, which is the answer a browser that never heard of the query gives.
    */
    vi.stubGlobal('matchMedia', undefined)
    const theme = await load()

    expect(theme.resolveTheme('system')).toBe('light')
    expect(() => theme.subscribeTheme(() => {})()).not.toThrow()
  })
})

describe('the copy of the key that cannot import the module', () => {
  it('is the same key in layout.tsx and in lib/theme.ts', () => {
    /*
      The theme has to be on <html> before the body is parsed or every cold
      load flashes white at a dark reader, and a script that runs that early
      cannot import a client module — so the key is written out twice. This is
      the only thing that notices when one of them moves. The symptom it
      prevents is silent: the preference is still stored and still applied on
      hydration, just one full paint too late.
    */
    const root = resolve(process.cwd())
    const source = readFileSync(resolve(root, 'src/lib/theme.ts'), 'utf8')
    const layout = readFileSync(resolve(root, 'src/app/layout.tsx'), 'utf8')

    const declared = /const KEY = '([^']+)'/.exec(source)?.[1]
    expect(declared).toBe(KEY)
    expect(layout).toContain(`localStorage.getItem('${declared}')`)
  })

  it('sets the attribute for exactly the two forced modes', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8')

    // «Tizim» must leave the attribute off; writing `data-theme="system"`
    // would match neither CSS block and quietly pin everyone to light.
    expect(layout).toContain("c==='light'||c==='dark'")
    expect(layout).not.toContain("'system'")
  })
})

describe('the stylesheet contract the attribute depends on', () => {
  it('lets an explicit «Yorugʻ» beat a dark machine preference', () => {
    /*
      `applyTheme` is one line; ALL of its meaning is in globals.css. If the
      dark media-query block ever loses its `:not([data-theme="light"])`
      guard, «Yorugʻ» stops working on precisely the machines that need it —
      and nothing in this store, in the components, or in a typecheck would
      know.
    */
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toMatch(/:root:where\(:not\(\[data-theme="light"\]\)\)/)
    expect(css).toContain(':root[data-theme="dark"]')
  })
})
