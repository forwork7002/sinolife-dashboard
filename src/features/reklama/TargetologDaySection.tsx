'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/Stat'
import type { FormDayDto, FormOwnerDto, LeadSourcesOverviewDto } from '@/features/leads/leadSourcesApi'
import { formatUsd, rnpNumber, rnpPercent } from '@/features/rnp/rnpFigures'
import type { MetaProduct } from '@/features/target/targetApi'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'
import { apiGet } from '@/lib/api'

import { SlicePicker, muted } from './reklamaUi'

/**
 * «Targetologlar · kunlik» — the client's per-targetolog sheet, as they keep
 * it (2026-10-05, a screenshot of «Элдор / Umar / Timur» side by side):
 * one block per targetolog, a row per day, «$ · лид · лид $ · % · кв лид ·
 * кв лид $», the period's total above the days.
 *
 * $ is the targetolog's lead-form campaigns' spend (Meta, OUTCOME_LEADS) and
 * matches the sheet to the dollar (03.09: Eldor 284,6 / 284,0, Umar 229,9 /
 * 229,8, Timur 163,2 / 164,3). The sheet's лид matched NO source exactly —
 * 03.09 sheet | Meta | Bitrix24: Eldor 187 | 213 | 159, Umar 210 | 225 | 160,
 * Timur 145 | 151 | 0 (his forms reach no portal deal) — so both are printed,
 * the user's choice of 2026-10-05: «Meta лид» prices лид $, «Bitrix лид» (the
 * Регистрация deals the targetolog's CRM forms opened) carries % and кв лид,
 * which is the sheet's within the kval that landed after it was typed. The
 * same `forms` block «Lidlar» → «Lid manbalari» shows, so the two screens
 * agree to the lead. Its own request, so the Meta tables above do not wait on
 * the deal scan.
 */

type Params = Readonly<Record<string, string | number>>

type Data = Pick<LeadSourcesOverviewDto, 'forms' | 'importedAt'>

const COLUMNS = ['$', 'Meta лид', 'Bitrix лид', 'лид $', '%', 'кв лид', 'кв лид $'] as const

const COLUMN_HINT: Partial<Record<(typeof COLUMNS)[number], string>> = {
  'Meta лид': 'Meta hisoblagan lid-forma lidlari',
  'Bitrix лид': 'Targetolog CRM-formasi Bitrix24 Регистрация ga ochgan bitimlar',
  'лид $': '$ ÷ Meta лид',
  '%': 'кв лид ÷ Bitrix лид',
  'кв лид': 'Bitrix лид dan kval boʻlgani',
  'кв лид $': '$ ÷ кв лид',
}

/** The sheet's yellow «лид» column, as a tint that reads in both themes. */
const LEAD_TINT = 'color-mix(in oklab, var(--status-warning) 16%, transparent)'
const HEAD_TINT = 'color-mix(in oklab, var(--accent) 10%, var(--surface-raised))'
const TOTAL_TINT = 'color-mix(in oklab, var(--status-good) 14%, var(--surface-raised))'

export function TargetologDaySection({ params }: { params: Params }) {
  const query = useQuery({
    queryKey: ['reklama-targetologs', params],
    queryFn: ({ signal }) => apiGet<Data>('/reklama/targetologs', params, signal),
  })
  const [picked, setPicked] = useState<MetaProduct>('Collagen')

  const owners = query.data?.data.forms.owners ?? []
  const products = (['Collagen', 'Zextra', 'Boshqa'] as const).filter((p) => owners.some((o) => o.product === p))
  // The product picked may have no targetolog this period: fall back to the first that has one.
  const product = products.includes(picked) ? picked : (products[0] ?? picked)
  // The biggest spender first, as the sheet opens on Eldor.
  const shown = owners.filter((o) => o.product === product).sort((a, b) => b.spendUsd - a.spendUsd)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Targetologlar · kunlik"
        hint="Har targetolog alohida, kunma-kun: $ — lid-forma kampaniyalari sarfi (Meta); Meta лид — Meta hisoblagan lidlar; Bitrix лид — uning CRM-formalari Bitrix24 Регистрация ga ochgan lidlar; кв лид — ulardan kval boʻlgani. лид $ = $ ÷ Meta лид, % = кв лид ÷ Bitrix лид, кв лид $ = $ ÷ кв лид. Bitrix лид 0 boʻlsa — formasi Bitrix24 ga ulanmagan."
      />
      {products.length > 1 && (
        <SlicePicker<MetaProduct>
          ariaLabel="Qaysi mahsulot"
          value={product}
          onChange={setPicked}
          options={products.map((p) => ({ value: p, label: PRODUCT_LABEL[p] }))}
        />
      )}

      {query.isError ? (
        <Card className="p-5">
          <ErrorState
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.isPending ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="w-[30rem] max-w-full shrink-0 p-4">
              <div className="skeleton h-[28rem] rounded" />
            </Card>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Card className="p-5">
          <EmptyState title="Bu davrda lid-forma sarfi yoʻq" />
        </Card>
      ) : (
        /* Side by side like the sheet; a phone swipes from one targetolog to the next. */
        <div
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2"
          style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}
        >
          {shown.map((owner) => (
            <OwnerSheet key={owner.key} owner={owner} />
          ))}
        </div>
      )}
    </section>
  )
}

function OwnerSheet({ owner }: { owner: FormOwnerDto }) {
  const tone = PRODUCT_TONE[owner.product]
  // The server's own totals, never the rounded days re-added: «Lid manbalari» prints the same figures.
  const total = {
    spendUsd: owner.spendUsd,
    metaLeads: owner.metaLeads,
    leads: owner.outcome.leads,
    success: owner.outcome.success,
  }
  return (
    /* As wide as its eight columns, never wider than a phone: there the table scrolls inside the card. */
    <Card className="w-max max-w-[calc(100vw-2.5rem)] shrink-0 snap-start overflow-hidden p-0">
      <h3
        className="px-3 py-2 text-sm font-semibold"
        style={{ background: `color-mix(in oklab, ${tone} 28%, var(--surface-raised))`, color: 'var(--ink-primary)' }}
        title={[...owner.accounts, ...owner.forms].join(', ') || undefined}
      >
        {owner.targetolog}
        <span className="ml-1.5 text-xs font-normal" style={muted}>
          · {PRODUCT_LABEL[owner.product]}
        </span>
      </h3>
      {/* A year's window is ~280 rows a card: the days scroll under the pinned names and total. */}
      <div className="max-h-[70dvh] overflow-auto">
        <table
          aria-label={`${owner.targetolog} · ${PRODUCT_LABEL[owner.product]} — kunlik`}
          className="border-separate border-spacing-0 text-[12.5px] tabular"
        >
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
                  style={{ ...muted, background: c === 'Meta лид' ? LEAD_TINT : undefined }}
                >
                  {c}
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
            {owner.days.map((day) => (
              <tr key={day.date}>
                <th scope="row" className="border-t border-[var(--border)] px-2 py-1 text-left font-normal whitespace-nowrap">
                  {dayLabel(day.date)}
                </th>
                <Figures cells={day} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** The figures of a row: what the sheet derives, derived here from the same four counts. */
function Figures({
  cells,
  strong = false,
}: {
  cells: Pick<FormDayDto, 'spendUsd' | 'metaLeads' | 'leads' | 'success'>
  strong?: boolean
}) {
  const { spendUsd, metaLeads, leads, success } = cells
  const values = [
    spendUsd > 0 ? formatUsd(spendUsd) : null,
    metaLeads > 0 ? rnpNumber(metaLeads) : null,
    leads > 0 ? rnpNumber(leads) : null,
    spendUsd > 0 && metaLeads > 0 ? formatUsd(spendUsd / metaLeads) : null,
    leads > 0 ? rnpPercent((success / leads) * 100) : null,
    success > 0 ? rnpNumber(success) : null,
    spendUsd > 0 && success > 0 ? formatUsd(spendUsd / success) : null,
  ]
  return (
    <>
      {values.map((v, i) => (
        <td
          key={COLUMNS[i]}
          className={`px-2 py-1 text-right whitespace-nowrap ${strong ? 'font-semibold' : ''} ${strong ? '' : 'border-t border-[var(--border)]'}`}
          style={{ background: COLUMNS[i] === 'Meta лид' ? LEAD_TINT : undefined, ...(v === null ? muted : null) }}
        >
          {v ?? '—'}
        </td>
      ))}
    </>
  )
}

/** «02.09» — the sheet's date, without the year every row repeats. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}
