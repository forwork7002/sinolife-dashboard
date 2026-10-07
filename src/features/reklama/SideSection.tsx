'use client'

import { EmptyState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/Stat'
import { formatUsd } from '@/features/rnp/rnpFigures'
import { isOneBrand } from '@/features/shared/BrandSwitch'
import type { DashboardBrand } from '@/features/shared/useDashboardFilters'

import type { SideColumnDto } from './reklamaApi'
import { type Status, muted } from './reklamaUi'

/**
 * The client's narrow side table — «Сентябрь 269,0$ / Навой HR», one row a
 * day — asked for on 2026-09-28 for Eldor's HR and Kosmetika accounts. The
 * period's total heads the table, the way the sheet reads, not at its foot.
 *
 * HR is every hiring campaign on any account (the «vakansiya» DM campaign on
 * Sinolife family Eldor, Collagen Eldor's «Vacancy» ones, and HR Eldor
 * itself); Kosmetika is Kosmetika Eldor's other campaigns. Neither is in the
 * DM sheet; Kosmetika's lead forms are also in «Отчёт Т» under «Boshqa».
 *
 * Neither belongs to Collagen or Zextra: the table is «Brendsiz»'s, drawn
 * under «Hammasi» and «Brendsiz», and under one brand it says so instead of
 * printing that brand's (empty) rows.
 *
 * DRAWN AS ONE MORE «Targetologlar · kunlik» CARD since 2026-10-07 (the
 * user: «hr va kosmetika notoʻgʻriroq joyda turibdi, bir-biriga uygʻun»): it
 * had been a sticky 18rem aside beside the DM sheet, in «9.12 $» while every
 * sheet around it reads «$9,12», and floated next to a table it has nothing
 * to do with. Now it sits under the targetologs' money, with their dates,
 * figures, tints and a «Jami $» column.
 */

const HINT = 'Meta sarfi, kunma-kun. Hech bir brendga kirmaydi, DM jadvaliga ham qoʻshilmaydi.'

const COLUMN_HINT: Record<SideColumnDto['key'], string> = {
  hr: 'Barcha akkauntlardagi ishga olish (vakansiya) kampaniyalari va HR Eldor akkaunti',
  kosmetika: 'Kosmetika Eldor akkauntining vakansiyadan boshqa kampaniyalari',
}

/** The same tints as «Targetologlar · kunlik», so the two read as one sheet. */
const HEAD_TINT = 'color-mix(in oklab, var(--accent) 10%, var(--surface-raised))'
const TITLE_TINT = 'color-mix(in oklab, var(--accent) 22%, var(--surface-raised))'
const TOTAL_TINT = 'color-mix(in oklab, var(--status-good) 14%, var(--surface-raised))'
const SUM_TINT = 'color-mix(in oklab, var(--status-good) 10%, transparent)'

export function SideSection({
  side,
  status,
  brand,
}: {
  side: readonly SideColumnDto[] | undefined
  status: Status
  brand: DashboardBrand
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader title="HR · Kosmetika" hint={HINT} />
      <Body side={side} status={status} brand={brand} />
    </section>
  )
}

function Body({ side, status, brand }: { side: readonly SideColumnDto[] | undefined; status: Status; brand: DashboardBrand }) {
  if (isOneBrand(brand)) {
    return (
      <Card className="p-5">
        <EmptyState title="Brend boʻyicha ajratilmaydi" body="HR va Kosmetika na Collagen, na Zextra — «Brendsiz» va «Hammasi» da koʻrinadi." />
      </Card>
    )
  }
  if (status === 'loading' || !side) {
    return (
      <Card className="w-[22rem] max-w-full p-4">
        <div className="skeleton h-48 rounded" />
      </Card>
    )
  }
  const days = side[0]?.days ?? []
  if (days.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState title="Bu davrda maʼlumot yoʻq" />
      </Card>
    )
  }

  const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)
  const totals = side.map((c) => c.totalUsd)
  return (
    /* As wide as its columns, like a targetolog's card; a phone scrolls the table inside it. */
    <Card className="w-max max-w-[calc(100vw-2.5rem)] overflow-hidden p-0">
      <h3 className="px-3 py-2 text-sm font-semibold" style={{ background: TITLE_TINT, color: 'var(--ink-primary)' }}>
        HR · Kosmetika
        <span className="ml-1.5 text-xs font-normal" style={muted}>
          · Brendsiz
        </span>
      </h3>
      <div className="max-h-[70dvh] overflow-auto">
        <table aria-label="HR · Kosmetika — kunlik" className="border-separate border-spacing-0 text-[12.5px] tabular">
          <thead className="sticky top-0 z-[1]" style={{ background: 'var(--surface-raised)' }}>
            <tr style={{ background: HEAD_TINT }}>
              <th scope="col" className="px-2 py-1 text-left text-[11px] font-medium" style={muted}>
                Sana
              </th>
              {side.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  title={COLUMN_HINT[c.key]}
                  className="px-3 py-1 text-right text-[11px] font-medium whitespace-nowrap"
                  style={muted}
                >
                  {c.name} $
                </th>
              ))}
              <th
                scope="col"
                title="HR + Kosmetika"
                className="px-3 py-1 text-right text-[11px] font-medium whitespace-nowrap"
                style={{ ...muted, background: SUM_TINT }}
              >
                Jami $
              </th>
            </tr>
            {/* Under the column names, so a screen reader names each total's column; still above the days, as in the sheet. */}
            <tr style={{ background: TOTAL_TINT }}>
              <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                Jami
              </th>
              <Figures values={[...totals, sum(totals)]} strong />
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => {
              const values = side.map((c) => c.days[i]?.spendUsd ?? 0)
              return (
                <tr key={day.date}>
                  <th scope="row" className="border-t border-[var(--border)] px-2 py-1 text-left font-normal whitespace-nowrap">
                    {dayLabel(day.date)}
                  </th>
                  <Figures values={[...values, sum(values)]} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** The row's dollars, the last one the row's sum; a day without spend is a quiet dash, as the sheet leaves it blank. */
function Figures({ values, strong = false }: { values: readonly number[]; strong?: boolean }) {
  return (
    <>
      {values.map((v, i) => (
        <td
          key={i}
          className={`px-3 py-1 text-right whitespace-nowrap ${strong ? 'font-semibold' : 'border-t border-[var(--border)]'}`}
          style={{ ...(v > 0 ? null : muted), background: i === values.length - 1 ? SUM_TINT : undefined }}
        >
          {v > 0 ? formatUsd(v) : '—'}
        </td>
      ))}
    </>
  )
}

/** «06.10» — the sheet's date, without the year every row repeats. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}
