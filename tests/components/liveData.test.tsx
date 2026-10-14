// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRESH_TOAST_MS, isPageQuery, useFreshDataAt } from '@/components/layout/liveData'

/*
  «Yangi maʼlumot keldi» — the shell's answer to «how do I know it refreshed»
  (the client, 2026-10-14). It must say so when a page's figures MOVED on a
  re-ask, and stay quiet on a first answer, an identical answer, the shell's
  own polls and a reader's own save.
*/

const envelope = (data: unknown, at: string) => ({ data, meta: { generatedAt: at } })

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useFreshDataAt(), { wrapper })
  const answer = async (key: unknown[], data: unknown, at: string) => {
    await act(async () => {
      await client.fetchQuery({ queryKey: key, queryFn: async () => envelope(data, at), staleTime: 0 })
    })
  }
  return { client, hook, answer }
}

afterEach(() => vi.useRealTimers())

describe('isPageQuery', () => {
  it('leaves out the shell\'s own polls and keeps every page question', () => {
    expect(isPageQuery({ queryKey: ['meta', 'alerts'] })).toBe(false)
    expect(isPageQuery({ queryKey: ['filters'] })).toBe(false)
    expect(isPageQuery({ queryKey: ['search', '998'] })).toBe(false)
    expect(isPageQuery({ queryKey: ['leads', 'watch', 'summary'] })).toBe(false)
    expect(isPageQuery({ queryKey: ['leads', 'watch'] })).toBe(true)
    expect(isPageQuery({ queryKey: ['sverka', { preset: 'this_month' }] })).toBe(true)
  })
})

describe('useFreshDataAt', () => {
  it('is quiet on a first answer and on a re-ask whose figures did not move', async () => {
    const { hook, answer } = setup()
    await answer(['sverka'], { fakt1: 10 }, '10:00')
    expect(hook.result.current).toBeNull()
    // Only `meta.generatedAt` moved: structural sharing keeps `data`, nothing is new.
    await answer(['sverka'], { fakt1: 10 }, '10:02')
    expect(hook.result.current).toBeNull()
  })

  it('names the moment a re-ask came back with different figures, then lets it go', async () => {
    // Faked from the start (React and the query client schedule on the same clock);
    // `shouldAdvanceTime` keeps their own zero-delay work running.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { hook, answer } = setup()
    await answer(['sverka'], { fakt1: 10 }, '10:00')
    const before = Date.now()
    await answer(['sverka'], { fakt1: 11 }, '10:02')
    expect(hook.result.current).toBeGreaterThanOrEqual(before)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESH_TOAST_MS)
    })
    expect(hook.result.current).toBeNull()
  })

  it('is quiet when a new filter asks a new question, and on the shell\'s own polls', async () => {
    const { hook, answer } = setup()
    await answer(['sverka', 'today'], { fakt1: 10 }, '10:00')
    await answer(['sverka', 'this_month'], { fakt1: 90 }, '10:01')
    await answer(['meta', 'alerts'], { pending: 1 }, '10:00')
    await answer(['meta', 'alerts'], { pending: 2 }, '10:01')
    expect(hook.result.current).toBeNull()
  })

  it('is quiet on a write the reader made themselves', async () => {
    const { client, hook, answer } = setup()
    await answer(['rnp'], { plan: 1 }, '10:00')
    act(() => {
      client.setQueryData(['rnp'], envelope({ plan: 2 }, '10:01'))
    })
    expect(hook.result.current).toBeNull()
  })
})

describe('the stylesheet', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')

  it('never blurs for a poll — only the stale body, and never under forced colours', () => {
    expect(css).toMatch(/\.data-stale\s*\{[^}]*filter: blur\(/)
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.data-stale\s*\{\s*filter: none;/)
    expect(css).not.toMatch(/\.sync-line[^{]*\{[^}]*filter:/)
  })

  it('slides the sync line only for a reader who has not asked for less motion', () => {
    const slide = css.indexOf('animation: sync-slide')
    const guard = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', slide)
    expect(slide).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(-1)
    expect(css.slice(guard, slide)).not.toContain('}\n}')
  })
})
