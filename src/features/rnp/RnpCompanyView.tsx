'use client'

import { ChartCard } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/Stat'
import { formatNumber, formatPercent } from '@/lib/format'

import { RnpBlockTable } from './RnpBlockTable'
import { RnpDailyChart } from './RnpDailyChart'
import { RnpFunnel } from './RnpFunnel'
import { RnpKpiCard, formatValue } from './RnpKpi'
import { RnpRanking } from './RnpRanking'
import type { RnpBlockDto, RnpOverviewDto, RnpRowDto } from './rnpApi'
import { type RnpTeamSummary, findRow, leadFunnel } from './rnpDerive'

/**
 * The whole company: the month's headline rows as cards, FAKT 1 / FAKT 2 by
 * day, the lead funnel, the teams ranked — and under it the company blocks of
 * the sheet itself, folded to one line each until somebody opens one.
 */
export function RnpCompanyView({
  data,
  teams,
  onSelect,
}: {
  data: RnpOverviewDto
  teams: readonly RnpTeamSummary[]
  onSelect: (rop: string) => void
}) {
  const row = (key: string) => findRow(data, key)
  const fakt1 = row('co:fakt1')
  const orders1 = row('co:orders1')
  const success = row('co:success')
  const cac = row('meta:cac')
  const qualifiedPct = row('reg:qualified_pct')
  const orders2 = row('co:orders2')
  // In the server's order, which is the sheet's: «ижтимоий тармоқлар» before «Маркетинг», HR just before the «Свод», the brand projects after it.
  const sections = data.blocks.filter((b) => b.team === null && b.kind !== 'team')

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <RnpKpiCard label="FAKT 1" row={fakt1} />
        <RnpKpiCard label="FAKT 2" row={row('co:fakt2')} note={success?.fact != null ? `Успешность ${formatPercent(success.fact)}` : undefined} />
        <RnpKpiCard
          label="Buyurtma (FAKT 1)"
          row={orders1}
          note={orders2?.fact != null ? `FAKT 2 da ${formatNumber(Math.round(orders2.fact))} ta` : undefined}
        />
        <RnpKpiCard
          label="Kval lid"
          row={row('reg:qualified')}
          note={qualifiedPct?.fact != null ? `tushgan lidning ${formatPercent(qualifiedPct.fact)}` : undefined}
        />
        <RnpKpiCard label="ROP olgan lid" row={row('reg:distributed')} />
        <RnpKpiCard label="Meta byudjet, $" row={row('meta:spend')} note={cac?.fact != null ? `CAC ${formatValue(cac.fact, 'usd')}` : undefined} />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <ChartCard title="FAKT 1 va FAKT 2 kunlik" hint="Tasdiqlash navbatiga tushgan kun boʻyicha" className="min-w-0 lg:col-span-2">
          <RnpDailyChart
            days={data.days}
            today={data.today}
            unit="uzs"
            bar={{ label: 'FAKT 1', color: 'var(--series-2)', row: fakt1 }}
            line={{ label: 'FAKT 2', color: 'var(--series-3)', row: row('co:fakt2') }}
            dayPlan={fakt1?.dayPlan ?? null}
            extraRows={(i) => dayCount('Buyurtma', orders1, i)}
          />
        </ChartCard>
        <RnpFunnel funnel={leadFunnel(data)} />
      </div>

      {teams.length > 0 && <RnpRanking teams={teams} days={data.days} today={data.today} onSelect={onSelect} />}

      {sections.length > 0 && (
        <section className="flex min-w-0 flex-col gap-3" aria-label="Batafsil jadval">
          <SectionHeader
            title="Batafsil jadval"
            hint={`Mijozning «РНП» jadvali, blokma-blok. Prognoz — oxirgi toʻliq kungacha boʻlgan fakt ÷ ${data.elapsedDays} kun × ${data.days.length} kun; nisbatlar yigʻindilar nisbati.`}
          />
          {sections.map((b) => (
            <RnpBlockTable
              key={b.id}
              block={b}
              days={data.days}
              today={data.today}
              canEdit={data.canEditPlans}
              collapsible={{ summary: summaryOf(b) }}
            />
          ))}
        </section>
      )}
    </div>
  )
}

/** A day's figure of a count row, as a tooltip line. */
export function dayCount(label: string, row: RnpRowDto | null, i: number) {
  const v = row?.days[i] ?? null
  return v === null ? [] : [{ label, value: formatNumber(Math.round(v)) }]
}

/** Which rows stand for a folded block, and under what short name. */
const SUMMARY: Record<string, readonly (readonly [string, string])[]> = {
  marketing: [
    ['meta:spend', 'Byudjet'],
    ['meta:leads', 'Lid'],
    ['meta:cpl', 'CPL'],
  ],
  registration: [
    ['reg:leads', 'Tushgan'],
    ['reg:qualified', 'Kval'],
    ['reg:qualified_pct', 'Kval %'],
  ],
  company: [
    ['co:fakt1', 'FAKT 1'],
    ['co:fakt2', 'FAKT 2'],
    ['co:success', 'Успешность'],
  ],
  warehouse: [
    ['wh:entered', 'Zakaz'],
    ['wh:not_packed', 'Не собран'],
  ],
  logistics: [
    ['lg:success', 'Успешность'],
    ['lg:refused_pct', 'Отказ'],
    ['lg:open_pct', 'Jarayonda'],
  ],
  hr: [
    ['in:hr_applications', 'Мурожаат'],
    ['in:hr_hired', 'Ишга олинган'],
  ],
  summary: [
    ['sv:fakt1', 'FAKT 1'],
    ['sv:fakt2', 'FAKT 2'],
  ],
}

function summaryOf(block: RnpBlockDto): string {
  if (block.id === 'social') return socialSummary(block)
  const parts = (block.kind === 'project' ? projectSummary(block) : (SUMMARY[block.id] ?? []))
    .map(([key, label]) => {
      const r = block.rows.find((x) => x.key === key)
      if (!r || r.fact === null) return null
      const v = formatValue(r.fact, r.unit, r.additive)
      return `${label} ${r.unit === 'uzs' ? `${v} soʻm` : v}`
    })
    .filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : `${formatNumber(block.rows.length)} ta koʻrsatkich`
}

/** A brand project («project:collagen») folded: its FAKT 2, its whole marketing cost and its CAC. */
function projectSummary(block: RnpBlockDto): readonly (readonly [string, string])[] {
  const k = `pj:${block.id.slice('project:'.length)}`
  return [
    [`${k}:fakt2`, 'ФАКТ 2'],
    [`${k}:cost_fact`, 'Маркетинг харажат'],
    [`${k}:cac`, 'CAC'],
  ]
}

/**
 * The social block folded: the month's Instagram follower gain, every
 * account's typed «Кол подпис» row summed. Nobody typed any — the rows count.
 */
function socialSummary(block: RnpBlockDto): string {
  const followers = block.rows.filter((r) => r.inputKey?.metric.startsWith('ig_followers') && r.fact !== null)
  if (followers.length === 0) return `${formatNumber(block.rows.length)} ta koʻrsatkich`
  const total = followers.reduce((s, r) => s + (r.fact ?? 0), 0)
  return `Instagram obunachi ${formatNumber(Math.round(total))}`
}

/** Skeleton of the company view, card for card. */
export function RnpCompanySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card flex flex-col px-4 py-3.5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton mt-3 h-[26px] w-2/3 sm:h-[30px]" />
            <div className="skeleton mt-3 h-1.5 w-full" />
            <div className="skeleton mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="skeleton h-4 w-48" />
          <div className="skeleton mt-4 h-[260px] w-full" />
        </div>
        <div className="card p-5">
          <div className="skeleton h-4 w-32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton mt-5 h-2.5" style={{ width: `${100 - i * 16}%` }} />
          ))}
        </div>
      </div>
      <div className="card p-5">
        <div className="skeleton h-4 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton mt-3 h-[38px] w-full" />
        ))}
      </div>
    </div>
  )
}
