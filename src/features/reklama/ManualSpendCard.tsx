'use client'

import { Card } from '@/components/ui/Card'
import type { ManualSpendDto, SaveManualSpendBody } from '@/features/leads/leadSourcesApi'
import { MONEY_USD, TypedField } from '@/features/rnp/RnpCostCell'
import { formatUsd } from '@/features/rnp/rnpFigures'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'
import { apiWrite } from '@/lib/api'

import { muted } from './reklamaUi'

/**
 * The sheet's «Telegram» block, as a card of «Targetologlar · kunlik»'s strip
 * (the client, 2026-10-07: «shu yerga telegramni ham qo'shishimiz kerak»).
 * The «Таргетолог» sheet keeps it beside the targetologs' blocks under
 * Zextra — one row a day, the dollars typed by hand, the lead columns at 0 —
 * so the card has the day and the dollars, and the period's total above the
 * days as every card here reads.
 *
 * TYPED IN PLACE, like RNP's cost lines: for a `kpi:manage` account each day
 * up to today is an open field (`TypedField`); Enter or leaving it saves,
 * the strip is refetched so the total follows. Everyone else reads the
 * figures, a day nobody typed a quiet dash. A card is drawn when the window
 * has any typed money, or for whoever may type it.
 */

/** The same tints as the targetologs' cards, so the strip reads as one sheet. */
const HEAD_TINT = 'color-mix(in oklab, var(--accent) 10%, var(--surface-raised))'
const TOTAL_TINT = 'color-mix(in oklab, var(--status-good) 14%, var(--surface-raised))'

const HINT: Record<ManualSpendDto['channel'], string> = {
  telegram: 'Telegram Ads sarfi — qoʻlda kiritiladi (Meta da yoʻq). Sheetdagi «Telegram» bloki.',
}

/** Whether the card is worth a place in the strip: typed money, or someone who may type it. */
export function showsManualSpend(block: ManualSpendDto, canEdit: boolean): boolean {
  return canEdit || block.totalUsd > 0
}

export function ManualSpendCard({ block, canEdit, today }: { block: ManualSpendDto; canEdit: boolean; today: string }) {
  const tone = PRODUCT_TONE[block.product]
  const saveDay = (day: string, value: number | null) => {
    const body: SaveManualSpendBody = { cells: [{ day, project: block.product, channel: block.channel, value }] }
    return apiWrite<{ saved: boolean }>('POST', '/reklama/manual-spend', body)
  }
  return (
    /* As wide as its two columns, like the targetologs' cards; a phone scrolls the table inside it. */
    <Card className="w-max max-w-[calc(100vw-2.5rem)] shrink-0 snap-start self-start overflow-hidden p-0">
      <h3
        className="px-3 py-2 text-sm font-semibold"
        style={{ background: `color-mix(in oklab, ${tone} 28%, var(--surface-raised))`, color: 'var(--ink-primary)' }}
        title={HINT[block.channel]}
      >
        {block.name}
        <span className="ml-1.5 text-xs font-normal" style={muted}>
          · {PRODUCT_LABEL[block.product]}
        </span>
      </h3>
      <div className="max-h-[70dvh] overflow-auto">
        <table aria-label={`${block.name} · ${PRODUCT_LABEL[block.product]} — kunlik`} className="border-separate border-spacing-0 text-[12.5px] tabular">
          <thead className="sticky top-0 z-[1]" style={{ background: 'var(--surface-raised)' }}>
            <tr style={{ background: HEAD_TINT }}>
              <th scope="col" className="px-2 py-1 text-left text-[11px] font-medium" style={muted}>
                Sana
              </th>
              <th scope="col" title={HINT[block.channel]} className="px-3 py-1 text-right text-[11px] font-medium whitespace-nowrap" style={muted}>
                {block.name} $
              </th>
            </tr>
            {/* Under the column name, so a screen reader names the total's column; still above the days, as in the sheet. */}
            <tr style={{ background: TOTAL_TINT }}>
              <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                Jami
              </th>
              <td className="px-3 py-1 text-right font-semibold whitespace-nowrap" style={block.totalUsd > 0 ? undefined : muted}>
                {block.totalUsd > 0 ? formatUsd(block.totalUsd) : '—'}
              </td>
            </tr>
          </thead>
          <tbody>
            {block.days.map((day) => (
              <tr key={day.date}>
                <th scope="row" className="border-t border-[var(--border)] px-2 py-1 text-left font-normal whitespace-nowrap">
                  {dayLabel(day.date)}
                </th>
                {canEdit && day.date <= today ? (
                  <td className="relative min-w-[6.5rem] border-t border-[var(--border)] p-0.5">
                    <TypedField
                      spec={MONEY_USD}
                      label={`${block.name} · ${PRODUCT_LABEL[block.product]}, ${dayLabel(day.date)}`}
                      value={day.spendUsd}
                      save={(value) => saveDay(day.date, value)}
                      invalidate={['reklama-targetologs']}
                    />
                  </td>
                ) : (
                  <td
                    className="border-t border-[var(--border)] px-3 py-1 text-right whitespace-nowrap"
                    style={day.spendUsd !== null && day.spendUsd > 0 ? undefined : muted}
                  >
                    {day.spendUsd !== null && day.spendUsd > 0 ? formatUsd(day.spendUsd) : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** «06.10» — the sheet's date, without the year every row repeats. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}
