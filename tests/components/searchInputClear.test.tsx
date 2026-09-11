// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SearchInput } from '@/components/ui/Controls'

/**
 * The search box's own clear — red, like every clear in the application.
 *
 * Asked for on 2026-09-11 («barcha tozalash va oʻchirish funksiyalari
 * aniqroq koʻrinsin»). The browser's native ✕ was a 9px grey mark, and it
 * cleared THROUGH the 350ms debounce; this one is visible, and immediate.
 */
describe('the search box clear', () => {
  it('is offered only while there is text to clear', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Qidirish" />)
    expect(screen.queryByRole('button', { name: 'Qidiruvni tozalash' })).toBeNull()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '945' } })
    expect(screen.getByRole('button', { name: 'Qidiruvni tozalash' })).toBeTruthy()
  })

  it('clears at once, without waiting out the typing debounce', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<SearchInput value="945" onChange={onChange} placeholder="Qidirish" />)

    fireEvent.click(screen.getByRole('button', { name: 'Qidiruvni tozalash' }))

    // No timer advanced: the table is asked the moment the reader decides.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Qidiruvni tozalash' })).toBeNull()

    // And the debounce does not fire a second, stale request afterwards.
    vi.advanceTimersByTime(1000)
    expect(onChange).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
