import { describe, expect, it } from 'vitest'

import type { RnpBlockDto, RnpRowDto } from '@/features/rnp/rnpApi'
import { contentMinWidths, figureText, formatUsd } from '@/features/rnp/rnpFigures'

/**
 * «sonlar to'liq yozilishi kerak» — every figure of the RNP screen in full,
 * and every column wide enough for the widest one it prints.
 */

function row(over: Partial<RnpRowDto> & Pick<RnpRowDto, 'key' | 'label'>): RnpRowDto {
  return {
    unit: 'count',
    additive: true,
    better: 'up',
    plan: null,
    dayPlan: null,
    fact: null,
    forecast: null,
    index: null,
    days: [null, null],
    planKey: null,
    sheet: null,
    share: null,
    tone: 'plain',
    hint: null,
    reliableFrom: null,
    ...over,
  }
}

const block = (rows: RnpRowDto[]): RnpBlockDto => ({ id: 'b', kind: 'company', title: 'B', subtitle: null, team: null, sheet: null, rows })

describe('figureText', () => {
  it('writes soʻm to the last soʻm, never compact', () => {
    expect(figureText(3_589_815_001, 'uzs')).toBe('3,589,815,001')
    expect(figureText(1_200_000, 'uzs')).toBe('1,200,000')
    expect(figureText(3_589_815_001, 'uzs')).not.toMatch(/mln|mlrd|ming/)
  })

  it('keeps the grid’s rounding: a count whole, dollars and rates to one decimal', () => {
    expect(figureText(16.67, 'count')).toBe('17')
    expect(figureText(1234.56, 'usd')).toBe('$1,234.6')
    expect(formatUsd(2.25)).toBe('$2.3')
    expect(figureText(33.333, 'percent')).toMatch(/^33\.3/)
  })
})

describe('contentMinWidths', () => {
  // 8px a character — enough to compare kinds against each other.
  const measure = (text: string) => text.length * 8

  it('sizes each kind to its widest figure across every block, plus the cell padding', () => {
    const widths = contentMinWidths(
      [
        block([row({ key: 'a', label: 'A', unit: 'uzs', plan: 4_781_250_000, fact: 2_000_000, days: [159_375_000, null] })]),
        block([row({ key: 'b', label: 'B', plan: 300, fact: 25, index: 1666.7, days: [12, 13] })]),
      ],
      measure,
    )
    // «4,781,250,000» is 13 characters: 104 + 24 padding + 4 slack.
    expect(widths.plan).toBe(13 * 8 + 24 + 4)
    // The day kind is sized by the MONEY block's day, so the count block's days line up with it.
    expect(widths.day).toBe('159,375,000'.length * 8 + 24 + 8 + 4)
    // The index is a pill: its own padding on top.
    expect(widths.index).toBeGreaterThan(measure('1,666.7%') + 24)
    // A kind with no figure anywhere says nothing (the default stands).
    expect(widths.forecast).toBeUndefined()
  })
})
