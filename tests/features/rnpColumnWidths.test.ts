import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_WIDTH,
  STORAGE_KEY,
  clampWidth,
  columnWidthsServerSnapshot,
  columnWidthsSnapshot,
  maxWidth,
  minWidth,
  parseWidths,
  reloadColumnWidths,
  resetColumnWidth,
  resetColumnWidths,
  setColumnWidth,
  storedWidths,
  subscribeColumnWidths,
  widthCss,
} from '@/features/rnp/rnpColumnWidths'

/**
 * The «RNP» grid's column widths, remembered per browser.
 *
 * Storage is the part most likely to misbehave — missing, throwing, or
 * holding something an older build or a hand wrote — and a table that will
 * not draw because a width could not be read is far worse than a width that
 * was forgotten.
 */

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage,
  }
}

function install(storage: Storage): void {
  vi.stubGlobal('window', { localStorage: storage, addEventListener: () => {}, removeEventListener: () => {} })
}

let data: Map<string, string>

beforeEach(() => {
  const fake = fakeStorage()
  data = fake.data
  install(fake.storage)
  reloadColumnWidths()
})
afterEach(() => vi.unstubAllGlobals())

describe('clampWidth', () => {
  it('keeps a number column between 56 and its ceiling, the label column from 140', () => {
    expect(clampWidth('fact', 10)).toBe(56)
    expect(clampWidth('day', 10)).toBe(56)
    expect(clampWidth('label', 10)).toBe(140)
    expect(clampWidth('fact', 10_000)).toBe(maxWidth('fact'))
    expect(clampWidth('label', 10_000)).toBe(maxWidth('label'))
    expect(minWidth('label')).toBe(140)
  })

  it('rounds to whole pixels, and falls back to the default for a non-number', () => {
    expect(clampWidth('plan', 100.6)).toBe(101)
    expect(clampWidth('plan', Number.NaN)).toBe(DEFAULT_WIDTH.plan)
    expect(clampWidth('plan', Number.POSITIVE_INFINITY)).toBe(DEFAULT_WIDTH.plan)
  })
})

describe('parseWidths', () => {
  it('reads nothing out of corrupt or foreign JSON', () => {
    expect(parseWidths(null)).toEqual({})
    expect(parseWidths('')).toEqual({})
    expect(parseWidths('{not json')).toEqual({})
    expect(parseWidths('[1,2]')).toEqual({})
    expect(parseWidths('42')).toEqual({})
    expect(parseWidths('null')).toEqual({})
  })

  it('keeps only known kinds with finite numbers, clamped', () => {
    expect(parseWidths(JSON.stringify({ fact: 150, day: 9, label: '300', bogus: 99, index: null }))).toEqual({ fact: 150, day: 56 })
  })
})

describe('the store', () => {
  it('stores a width per kind, clamped, under one key, and tells its subscribers', () => {
    const heard = vi.fn()
    const off = subscribeColumnWidths(heard)

    expect(setColumnWidth('fact', 180)).toBe(180)
    expect(setColumnWidth('day', 20)).toBe(56)

    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual({ fact: 180, day: 56 })
    expect(storedWidths()).toEqual({ fact: 180, day: 56 })
    expect(heard).toHaveBeenCalledTimes(2)
    off()
  })

  it('does not notify when nothing changed', () => {
    setColumnWidth('plan', 150)
    const heard = vi.fn()
    const off = subscribeColumnWidths(heard)
    setColumnWidth('plan', 150)
    expect(heard).not.toHaveBeenCalled()
    off()
  })

  it('resets one kind, then all of them, and leaves no key behind', () => {
    setColumnWidth('fact', 180)
    setColumnWidth('label', 300)

    resetColumnWidth('fact')
    expect(storedWidths()).toEqual({ label: 300 })

    resetColumnWidths()
    expect(storedWidths()).toEqual({})
    expect(data.has(STORAGE_KEY)).toBe(false)
  })

  it('survives corrupt storage: it reads as nothing stored, and the next write replaces it', () => {
    data.set(STORAGE_KEY, '{"fact": 1')
    reloadColumnWidths()
    expect(storedWidths()).toEqual({})

    setColumnWidth('fact', 170)
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual({ fact: 170 })
  })

  it('survives storage that throws: the width still applies, it just is not remembered', () => {
    install({
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    } as unknown as Storage)
    reloadColumnWidths()

    expect(() => setColumnWidth('day', 90)).not.toThrow()
    expect(storedWidths()).toEqual({ day: 90 })
    expect(() => resetColumnWidths()).not.toThrow()
    expect(storedWidths()).toEqual({})
  })

  it('renders on the server as nothing stored, whatever the browser holds', () => {
    setColumnWidth('fact', 200)
    expect(columnWidthsServerSnapshot()).toBe('{}')
    expect(columnWidthsSnapshot()).toBe('{"fact":200}')
  })
})

describe('widthCss', () => {
  it('reads the scope variable and falls back to the default', () => {
    expect(widthCss('day')).toBe(`var(--rnp-w-day, ${DEFAULT_WIDTH.day}px)`)
  })
})
