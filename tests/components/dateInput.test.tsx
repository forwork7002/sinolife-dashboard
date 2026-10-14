// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DateInput, isDayWithin } from '@/components/ui/DateInput'
import { tashkentDay } from '@/lib/format'

/*
  A date box hands over a whole day inside its bounds, never a keystroke
  (2026-10-14, the user: «vaqtni tanlashda notoʻgʻri vaqt tanlanib
  ketmasligi zarur»). Typing «2026» in the year reports 0002 → 0020 → 0202 on
  the way; «Lid kogortasi» asked the API for each, and the day cards' picker
  put the old day back under the typing hand.
*/
afterEach(cleanup)

function box(onCommit = vi.fn(), value = '2026-10-10') {
  render(<DateInput aria-label="Kun" value={value} min="2025-01-01" max="2026-10-21" onCommit={onCommit} />)
  return { input: screen.getByLabelText('Kun') as HTMLInputElement, onCommit }
}

describe('DateInput', () => {
  it('commits none of a typed year’s steps, then the whole day', () => {
    const { input, onCommit } = box()
    for (const step of ['0002-10-10', '0020-10-10', '0202-10-10']) {
      fireEvent.change(input, { target: { value: step } })
      // What was typed stays in the box — it is not put back under the hand.
      expect(input.value).toBe(step)
    }
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '2025-10-10' } })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2025-10-10')
  })

  it('commits no day past its bounds or half typed, and a blur puts the committed day back', () => {
    const { input, onCommit } = box()
    fireEvent.change(input, { target: { value: '2026-10-22' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input.value).toBe('2026-10-10')
  })

  it('commits a day picked in the calendar at once', () => {
    const { input, onCommit } = box()
    fireEvent.change(input, { target: { value: '2026-10-21' } })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-10-21')
  })

  it('reads a real calendar day only', () => {
    expect(isDayWithin('2026-02-30')).toBe(false)
    expect(isDayWithin('2026-9-01')).toBe(false)
    expect(isDayWithin('2026-02-28', '2026-03-01')).toBe(false)
    expect(isDayWithin('2026-02-28')).toBe(true)
  })
})

describe('tashkentDay', () => {
  it('is the Tashkent calendar day, ISO order, whatever the device’s zone', () => {
    // 18:59 UTC is 23:59 in Tashkent; a minute later it is the next day there.
    expect(tashkentDay(new Date('2026-10-13T18:59:00Z'))).toBe('2026-10-13')
    expect(tashkentDay(new Date('2026-10-13T19:00:00Z'))).toBe('2026-10-14')
    expect(tashkentDay(new Date('2026-01-05T03:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
