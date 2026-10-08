'use client'

import type { ReactNode } from 'react'

import { Card } from '@/components/ui/Card'
import type { ManualSpendDto, SaveManualSpendBody } from '@/features/leads/leadSourcesApi'
import { MONEY_USD, TypedField } from '@/features/rnp/RnpCostCell'
import { formatUsd, rnpNumber, rnpPercent } from '@/features/rnp/rnpFigures'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'
import { apiWrite } from '@/lib/api'

import { muted } from './reklamaUi'

/**
 * The sheet's «Telegram» block, as a card of «Targetologlar · kunlik»'s strip
 * (the client, 2026-10-07: «shu yerga telegramni ham qo'shishimiz kerak»).
 * The «Таргетолог» sheet keeps it beside the targetologs' blocks under
 * Zextra with the SAME columns — «$ · лид · лид $ · % · кв лид · кв лид $»
 * (2026-10-08: «faqat bitta sarfni kiritiladigan qilgansan, jadvalda
 * bundan ko'proq narsalar bor edi»). So: the dollars typed by hand (Telegram
 * Ads has no feed), the leads the portal filed under Telegram and their kval
 * read from Bitrix24, and the three prices derived as the targetologs' cards
 * derive theirs; the period's total above the days as every card here reads.
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
const LEAD_TINT = 'color-mix(in oklab, var(--status-warning) 16%, transparent)'

const COLUMNS = ['$', 'Bitrix лид', 'лид $', '%', 'кв лид', 'кв лид $'] as const
type Column = (typeof COLUMNS)[number]

const HINT: Record<ManualSpendDto['channel'], string> = {
  telegram: 'Sheetdagi «Telegram» bloki: sarf qoʻlda kiritiladi (Meta da yoʻq), lid va kval — Bitrix24 ga Telegram manbasidan tushgan bitimlar.',
}

const COLUMN_HINT: Record<Column, string> = {
  $: 'Qoʻlda kiritilgan sarf (Telegram Ads)',
  'Bitrix лид': 'Bitrix24 Регистрация ga Telegram manbasidan (bot, ochiq liniya, kanal) tushgan lidlar — brendi «Проект» maydonidan; «Проект» yozilmagani Brendsiz boʻlib, kartaga kirmaydi',
  'лид $': '$ ÷ Bitrix лид',
  '%': 'кв лид ÷ Bitrix лид',
  'кв лид': 'Bitrix лид dan kval boʻlgani',
  'кв лид $': '$ ÷ кв лид',
}

/** Whether the card is worth a place in the strip: typed money or leads, or someone who may type. */
export function showsManualSpend(block: ManualSpendDto, canEdit: boolean): boolean {
  return canEdit || block.totalUsd > 0 || block.leads > 0
}

export function ManualSpendCard({ block, canEdit, today }: { block: ManualSpendDto; canEdit: boolean; today: string }) {
  const tone = PRODUCT_TONE[block.product]
  const saveDay = (day: string, value: number | null) => {
    const body: SaveManualSpendBody = { cells: [{ day, project: block.product, channel: block.channel, value }] }
    return apiWrite<{ saved: boolean }>('POST', '/reklama/manual-spend', body)
  }
  const total = { spendUsd: block.totalUsd, leads: block.leads, success: block.success }
  return (
    /* As wide as its columns, like the targetologs' cards; a phone scrolls the table inside it. */
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
              {COLUMNS.map((c) => (
                <th
                  key={c}
                  scope="col"
                  title={COLUMN_HINT[c]}
                  className="px-2 py-1 text-right text-[11px] font-medium whitespace-nowrap"
                  style={{ ...muted, background: columnTint(c) }}
                >
                  {c === '$' ? `${block.name} $` : c}
                </th>
              ))}
            </tr>
            {/* Under the column names, so a screen reader names each total's column; still above the days, as in the sheet. */}
            <tr style={{ background: TOTAL_TINT }}>
              <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                Jami
              </th>
              <Figures cells={total} strong />
            </tr>
          </thead>
          <tbody>
            {block.days.map((day) => (
              <tr key={day.date}>
                <th scope="row" className="border-t border-[var(--border)] px-2 py-1 text-left font-normal whitespace-nowrap">
                  {dayLabel(day.date)}
                </th>
                <Figures
                  cells={day}
                  field={
                    canEdit && day.date <= today ? (
                      <TypedField
                        spec={MONEY_USD}
                        label={`${block.name} · ${PRODUCT_LABEL[block.product]}, ${dayLabel(day.date)}`}
                        value={day.spendUsd}
                        save={(value) => saveDay(day.date, value)}
                        invalidate={['reklama-targetologs']}
                      />
                    ) : undefined
                  }
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const columnTint = (c: Column) => (c === 'Bitrix лид' ? LEAD_TINT : undefined)

/**
 * The row's figures, derived as the targetologs' cards derive theirs: the
 * dollars (an open field where `field` is given), the leads and kval, and
 * the three prices — a dash where there is nothing to divide.
 */
function Figures({
  cells,
  field,
  strong = false,
}: {
  cells: { spendUsd: number | null; leads: number; success: number }
  field?: ReactNode
  strong?: boolean
}) {
  const spend = cells.spendUsd ?? 0
  const usd = (v: number) => (v > 0 ? formatUsd(v) : null)
  const count = (v: number) => (v > 0 ? rnpNumber(v) : null)
  const per = (n: number) => (spend > 0 && n > 0 ? formatUsd(spend / n) : null)
  const value: Record<Column, string | null> = {
    $: usd(spend),
    'Bitrix лид': count(cells.leads),
    'лид $': per(cells.leads),
    '%': cells.leads > 0 ? rnpPercent((cells.success / cells.leads) * 100) : null,
    'кв лид': count(cells.success),
    'кв лид $': per(cells.success),
  }
  const border = strong ? '' : 'border-t border-[var(--border)]'
  return (
    <>
      {COLUMNS.map((c) =>
        c === '$' && field !== undefined ? (
          <td key={c} className={`relative min-w-[6.5rem] ${border} p-0.5`}>
            {field}
          </td>
        ) : (
          <td
            key={c}
            className={`px-2 py-1 text-right whitespace-nowrap ${strong ? 'font-semibold' : ''} ${border}`}
            style={{ background: columnTint(c), ...(value[c] === null ? muted : null) }}
          >
            {value[c] ?? '—'}
          </td>
        ),
      )}
    </>
  )
}

/** «06.10» — the sheet's date, without the year every row repeats. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}
