import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { statusOf } from '@/components/states/States'
import { ApiClientError } from '@/lib/api'

/**
 * THE ERROR CARD IS FOR HAVING NOTHING TO SHOW.
 *
 * TanStack Query 5 keeps the last good `data` when a refetch fails and still
 * reports `isError`. Every screen read `isError` alone, so one failed
 * background poll (two misses in a row on the 120 s timer) swapped figures
 * already on screen for «Qayta urinish» — the TV board, Logistika, «Lid
 * manbalari» — until the next good poll. These drive a real query observer
 * through each state, so a change in the library's behaviour shows up here
 * and not on the floor's television.
 */

function observe(read: () => Promise<{ readonly figure: number }>, key: readonly unknown[] = ['board']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return new QueryObserver(client, { queryKey: key, queryFn: read })
}

describe('statusOf', () => {
  it('is loading before the first answer, and ready once it lands', async () => {
    const observer = observe(async () => ({ figure: 12 }))
    expect(statusOf(observer.getCurrentResult())).toBe('loading')

    await observer.refetch()
    expect(statusOf(observer.getCurrentResult())).toBe('ready')
  })

  it('keeps the screen when a background refetch fails over data it already holds', async () => {
    let fail = false
    const observer = observe(async () => {
      if (fail) throw new Error('Server xatosi')
      return { figure: 12 }
    })
    await observer.refetch()

    fail = true
    await observer.refetch()
    const result = observer.getCurrentResult()

    // The library's half: the failure is reported AND the last answer is kept.
    expect(result.isError).toBe(true)
    expect(result.data).toEqual({ figure: 12 })
    // Ours: that is still a screen with figures on it.
    expect(statusOf(result)).toBe('ready')
  })

  it('is the error card when a poll is REFUSED, figures or not — a 401 or a 403 answers every poll after it the same', async () => {
    const cases: readonly [ApiClientError, 'error' | 'ready'][] = [
      // A revoked session (a password change signs the others out), an expired one.
      [new ApiClientError('UNAUTHENTICATED', 'Tizimga kirish talab qilinadi.', 401), 'error'],
      // The section taken away, the account deactivated.
      [new ApiClientError('FORBIDDEN', 'Bu boʻlim sizga berilmagan.', 403), 'error'],
      // …while a failure to answer is still a blip the next poll clears.
      [new ApiClientError('INTERNAL_ERROR', 'Kutilmagan xatolik yuz berdi.', 500), 'ready'],
      [new ApiClientError('UPSTREAM_UNAVAILABLE', 'Server vaqtincha javob bermadi.', 502), 'ready'],
    ]
    for (const [refusal, expected] of cases) {
      let fail = false
      const observer = observe(async () => {
        if (fail) throw refusal
        return { figure: 12 }
      })
      await observer.refetch()

      fail = true
      await observer.refetch()
      const result = observer.getCurrentResult()

      expect(result.data).toEqual({ figure: 12 })
      expect(statusOf(result), `${refusal.status}`).toBe(expected)
    }
  })

  it('is the error card when the first read fails — there is nothing to keep', async () => {
    const observer = observe(async () => {
      throw new Error('Server xatosi')
    })
    await observer.refetch()

    expect(statusOf(observer.getCurrentResult())).toBe('error')
  })

  it('is the error card when a NEW period fails, although the old one was on screen as a placeholder', async () => {
    let fail = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = async () => {
      if (fail) throw new Error('Server xatosi')
      return { figure: 12 }
    }
    const placeholderData = <T,>(previous: T) => previous
    const observer = new QueryObserver(client, { queryKey: ['board', 'today'], queryFn: read, placeholderData })
    await observer.refetch()

    fail = true
    observer.setOptions({ queryKey: ['board', 'this_month'], queryFn: read, placeholderData })
    // While the new window loads, the old figures stand in for it…
    expect(observer.getCurrentResult().isPlaceholderData).toBe(true)
    await observer.refetch()

    // …and once its read fails they are gone: placeholder data covers only a pending query.
    expect(observer.getCurrentResult().data).toBeUndefined()
    expect(statusOf(observer.getCurrentResult())).toBe('error')
  })
})
