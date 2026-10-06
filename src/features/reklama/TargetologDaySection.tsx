'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/Stat'
import type { FormDayDto, FormOwnerDto, LeadSourcesOverviewDto } from '@/features/leads/leadSourcesApi'
import { formatUsd, rnpNumber, rnpPercent } from '@/features/rnp/rnpFigures'
import type { DashboardBrand } from '@/features/shared/useDashboardFilters'
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
 * $ (now «Rasxod $», the website campaigns apart) is the targetolog's
 * lead-form campaigns' spend (Meta, OUTCOME_LEADS); it matched the sheet to the dollar (03.09: Eldor 284,6 / 284,0, Umar 229,9 /
 * 229,8, Timur 163,2 / 164,3). The sheet's лид matched NO source exactly —
 * 03.09 sheet | Meta | Bitrix24: Eldor 187 | 213 | 159, Umar 210 | 225 | 160,
 * Timur 145 | 151 | 0 (his forms reach no portal deal) — so both are printed,
 * the user's choice of 2026-10-05: «Meta лид» prices лид $, «Bitrix лид» (the
 * Регистрация deals the targetolog's CRM forms opened) carries % and кв лид,
 * which is the sheet's within the kval that landed after it was typed. The
 * same `forms` block «Lidlar» → «Lid manbalari» shows, so the two screens
 * agree to the lead. Its own request, so the Meta tables above do not wait on
 * the deal scan.
 *
 * Every other dollar of the targetolog's accounts sits beside it, as Umar
 * reports his day (03.10.2026: «Rasxod 223.87$ · Lid 248 · Cpl 0.90$», «Sms
 * rasxod 48.44$ · Sms soni 291», «Sayt rasxod 11.86$ · Lid 1»): the website
 * campaigns come out of the forms' $ into «Sayt» (so «лид $» and «кв лид $»
 * here price the forms alone, while «Lid manbalari» still divides the forms
 * with the site), the message campaigns are
 * «SMS», hiring is «HR», and «Jami $» is all of it — the card had read the
 * forms and the site together (235,8 $) and nothing else.
 */

type Params = Readonly<Record<string, string | number>>

type Data = Pick<LeadSourcesOverviewDto, 'forms' | 'importedAt'>

const COLUMNS = [
  'Rasxod $',
  'Meta лид',
  'лид $',
  'Sayt $',
  'Sayt лид',
  'SMS $',
  'SMS soni',
  'SMS narxi',
  'HR $',
  'Boshqa $',
  'Jami $',
  'Bitrix лид',
  '%',
  'кв лид',
  'кв лид $',
] as const

type Column = (typeof COLUMNS)[number]

const COLUMN_HINT: Partial<Record<Column, string>> = {
  'Rasxod $': 'Lid-forma kampaniyalari sarfi (Sayt kampaniyalarisiz)',
  'Meta лид': 'Meta hisoblagan lid-forma lidlari (Sayt lidlarisiz)',
  'лид $': 'Rasxod $ ÷ Meta лид',
  'Sayt $': 'Nomida «Sayt» boʻlgan lid kampaniyalari sarfi',
  'Sayt лид': 'Sayt kampaniyalari lidlari (Meta)',
  'SMS $': 'Xabar (DM, Sms) kampaniyalari sarfi',
  'SMS soni': 'Meta hisoblagan boshlangan yozishmalar',
  'SMS narxi': 'SMS $ ÷ SMS soni',
  'HR $': 'Ishga olish (vakansiya) kampaniyalari sarfi',
  'Boshqa $': 'Trafik, sotuv va boshqa maqsadli kampaniyalar',
  'Jami $': 'Rasxod + Sayt + SMS + HR + Boshqa — akkauntlardan ketgan hamma pul',
  'Bitrix лид': 'Targetolog CRM-formasi Bitrix24 Регистрация ga ochgan bitimlar',
  '%': 'кв лид ÷ Bitrix лид',
  'кв лид': 'Bitrix лид dan kval boʻlgani',
  'кв лид $': 'Rasxod $ ÷ кв лид',
}

/** The sheet's yellow «лид» column, as a tint that reads in both themes. */
const LEAD_TINT = 'color-mix(in oklab, var(--status-warning) 16%, transparent)'
const HEAD_TINT = 'color-mix(in oklab, var(--accent) 10%, var(--surface-raised))'
const TOTAL_TINT = 'color-mix(in oklab, var(--status-good) 14%, var(--surface-raised))'
/** «Jami $» down the card, so the day's whole spend is found at a glance. */
const SUM_TINT = 'color-mix(in oklab, var(--status-good) 10%, transparent)'

const columnTint = (c: Column) => (c === 'Meta лид' ? LEAD_TINT : c === 'Jami $' ? SUM_TINT : undefined)

export function TargetologDaySection({ params, brand }: { params: Params; brand: DashboardBrand }) {
  const query = useQuery({
    queryKey: ['reklama-targetologs', params],
    queryFn: ({ signal }) => apiGet<Data>('/reklama/targetologs', params, signal),
  })
  const [picked, setPicked] = useState<MetaProduct>('Collagen')

  const owners = query.data?.data.forms.owners ?? []
  const products = (['Collagen', 'Zextra', 'Boshqa'] as const).filter((p) => owners.some((o) => o.product === p))
  // The page's brand switch wins over this picker, which then steps aside — two switches would contradict.
  // «Brendsiz» is the forms no brand claims («Boshqa»). The product picked may have no targetolog this
  // period: fall back to the first that has one.
  const product: MetaProduct =
    brand === 'none' ? 'Boshqa' : brand !== 'all' ? brand : products.includes(picked) ? picked : (products[0] ?? picked)
  // The biggest spender first, as the sheet opens on Eldor.
  const shown = owners.filter((o) => o.product === product).sort((a, b) => b.spendUsd - a.spendUsd)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Targetologlar · kunlik"
        hint="Har targetolog alohida, kunma-kun: Rasxod $ — lid-forma kampaniyalari sarfi (Meta); Sayt $ — «Sayt» kampaniyalari; SMS $ — xabar (DM, Sms) kampaniyalari, SMS soni — yozishmalar; HR $ — vakansiya kampaniyalari; Jami $ — akkauntlardan ketgan hamma pul. Meta лид — Meta hisoblagan lidlar; Bitrix лид — uning CRM-formalari Bitrix24 Регистрация ga ochgan lidlar; кв лид — ulardan kval boʻlgani. лид $ = Rasxod $ ÷ Meta лид, % = кв лид ÷ Bitrix лид, кв лид $ = Rasxod $ ÷ кв лид. Bitrix лид 0 boʻlsa — formasi Bitrix24 ga ulanmagan."
      />
      {brand === 'all' && products.length > 1 && (
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
  const total = { ...owner, leads: owner.outcome.leads, success: owner.outcome.success }
  // «Boshqa $» only on a card that has any: most targetologs run nothing but forms and messages.
  const columns = COLUMNS.filter((c) => c !== 'Boshqa $' || owner.otherUsd > 0)
  return (
    /* As wide as its columns, never wider than a phone: there the table scrolls inside the card. */
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
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  title={COLUMN_HINT[c]}
                  className="px-2 py-1 text-right text-[11px] font-medium whitespace-nowrap"
                  style={{ ...muted, background: columnTint(c) }}
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
              <Figures cells={total} columns={columns} strong />
            </tr>
          </thead>
          <tbody>
            {owner.days.map((day) => (
              <tr key={day.date}>
                <th scope="row" className="border-t border-[var(--border)] px-2 py-1 text-left font-normal whitespace-nowrap">
                  {dayLabel(day.date)}
                </th>
                <Figures cells={day} columns={columns} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

type Cells = Omit<FormDayDto, 'date'>

/**
 * The figures of a row: what the sheet derives, derived here from the
 * server's counts. «Rasxod» and «Meta лид» are the forms less the website
 * campaigns, which have columns of their own.
 */
function Figures({ cells, columns, strong = false }: { cells: Cells; columns: readonly Column[]; strong?: boolean }) {
  const { formUsd, metaLeads, leads, success, siteUsd, siteLeads, smsUsd, smsCount, hrUsd, otherUsd, totalUsd } = cells
  const formLeads = metaLeads - siteLeads
  const usd = (v: number) => (v > 0 ? formatUsd(v) : null)
  const count = (v: number) => (v > 0 ? rnpNumber(v) : null)
  const per = (spend: number, n: number) => (spend > 0 && n > 0 ? formatUsd(spend / n) : null)
  const value: Record<Column, string | null> = {
    'Rasxod $': usd(formUsd),
    'Meta лид': count(formLeads),
    'лид $': per(formUsd, formLeads),
    'Sayt $': usd(siteUsd),
    'Sayt лид': count(siteLeads),
    'SMS $': usd(smsUsd),
    'SMS soni': count(smsCount),
    'SMS narxi': per(smsUsd, smsCount),
    'HR $': usd(hrUsd),
    'Boshqa $': usd(otherUsd),
    'Jami $': usd(totalUsd),
    'Bitrix лид': count(leads),
    '%': leads > 0 ? rnpPercent((success / leads) * 100) : null,
    'кв лид': count(success),
    'кв лид $': per(formUsd, success),
  }
  return (
    <>
      {columns.map((c) => (
        <td
          key={c}
          className={`px-2 py-1 text-right whitespace-nowrap ${strong || c === 'Jami $' ? 'font-semibold' : ''} ${strong ? '' : 'border-t border-[var(--border)]'}`}
          style={{ background: columnTint(c), ...(value[c] === null ? muted : null) }}
        >
          {value[c] ?? '—'}
        </td>
      ))}
    </>
  )
}

/** «02.09» — the sheet's date, without the year every row repeats. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}
