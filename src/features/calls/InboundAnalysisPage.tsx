'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { StatTile } from '@/components/ui/Stat'
import { bitrixContactUrl } from '@/features/calls/UnansweredCallsCard'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'

/* Mirrors `InboundAnalysisDto` / `AnalysisNumbersDto` in `src/server/services/inboundAnalysisService.ts` — nothing checks the mirror. */
type Group = 'fresh' | 'returning'

interface Outcome {
  readonly numbers: number
  readonly answered: number
  readonly calledBack: number
  readonly talked: number
  readonly lost: number
}

interface DayRow {
  readonly day: string
  readonly calls: number
  readonly numbers: number
  readonly fresh: Outcome
  readonly returning: Outcome
  readonly unfinished: boolean
}

interface AnalysisDto {
  readonly days: readonly DayRow[]
  readonly total: { readonly calls: number; readonly numbers: number; readonly fresh: Outcome; readonly returning: Outcome }
  readonly returning: {
    readonly buckets: Readonly<Record<'d14_30' | 'm1_3' | 'm3_6' | 'm6', number>>
    readonly medianDays: number | null
    readonly longestDays: number | null
    readonly funnels: readonly { readonly funnel: string; readonly numbers: number }[]
  }
  readonly analysisFrom: string
  readonly historyFrom: string
  readonly floorApplied: boolean
}

interface NumberRow {
  readonly key: string
  readonly phone: string | null
  readonly tel: string | null
  readonly group: Group
  readonly firstCallAt: string
  readonly calls: number
  readonly answered: boolean
  readonly calledBack: boolean
  readonly talked: boolean
  readonly silenceDays: number | null
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  readonly state: string | null
}

const GROUP_LABEL: Record<Group, string> = { fresh: 'Соф янги', returning: 'Қайта мурожат' }

const BUCKETS: readonly { readonly key: keyof AnalysisDto['returning']['buckets']; readonly label: string }[] = [
  { key: 'd14_30', label: '14–30 kun' },
  { key: 'm1_3', label: '1–3 oy' },
  { key: 'm3_6', label: '3–6 oy' },
  { key: 'm6', label: '6+ oy' },
]

const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100))
const yesNo = (v: boolean) => (v ? 'ha' : 'yoʻq')
const dayLabel = (day: string) => formatDate(`${day}T07:00:00Z`)

/**
 * «Kiruvchi tahlil» (the client, 2026-10-22: «qoʻngʻiroqlar boʻlimiga huddi
 * CLAUDE.md da yozilganidek alohida yangi boʻlim»): «Соф янги» and «Қайта
 * мурожат» among the numbers that rang us, each followed to the end — answered
 * on the inbound call, reached on a callback, talked at all, or lost — with the
 * day table, the returning callers' silence and funnel, and the numbers
 * themselves to export. Every definition is `domain/calls/inboundAnalysis.ts`.
 */
export function InboundAnalysisPage() {
  const { apiParams } = useDashboardFilters()
  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const report = useQuery({
    queryKey: ['inbound-analysis', windowParams],
    queryFn: ({ signal }) => apiGet<AnalysisDto>('/insights/calls/analysis', windowParams, signal),
    placeholderData: (previous) => previous,
  })
  const status = statusOf(report)
  const data = report.data?.data

  return (
    <PageShell
      title="Kiruvchi tahlil"
      description="Bizga qoʻngʻiroq qilgan raqamlar orasida Соф янги va Қайта мурожат — har biri oxirigacha kuzatilgan: kiruvchida ulanganmi, keyin qayta qoʻngʻiroqda gaplashildimi, umuman gaplashildimi yoki yoʻqotildimi. Vaqt — Toshkent."
      accent="var(--series-1)"
      meta={report.data?.meta}
      stale={report.isPlaceholderData}
    >
      <div className="flex flex-col gap-6">
        {data && <FloorNote data={data} />}
        {status === 'error' ? (
          <ErrorState
            message={report.error instanceof ApiClientError ? report.error.message : undefined}
            onRetry={() => void report.refetch()}
          />
        ) : (
          <>
            <Outcomes data={data} status={status} />
            <ReturningDetail data={data} status={status} />
            <DayTable data={data} status={status} />
            <NumbersCard windowParams={windowParams} />
          </>
        )}
      </div>
    </PageShell>
  )
}

function FloorNote({ data }: { readonly data: AnalysisDto }) {
  return (
    <p className="text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>
      Tahlil {formatDate(data.analysisFrom)} dan boshlanadi{data.floorApplied ? ' — tanlangan davrning undan oldingi qismi kirmaydi' : ''}.
      Oldingi suhbatlar {formatDate(data.historyFrom)} dan qidiriladi: undan oldin oxirgi marta gaplashilgan mijoz «oldin suhbat
      boʻlmagan» deb oʻqiladi, shuning uchun Қайта мурожат — eng kam son, haqiqiysi biroz koʻproq. Guruh raqamning davrdagi birinchi
      qoʻngʻiroqida aniqlanadi; kun qatorida — oʻsha kundagi birinchi qoʻngʻirogʻida.
    </p>
  )
}

function Outcomes({ data, status }: { readonly data: AnalysisDto | undefined; readonly status: 'loading' | 'error' | 'ready' }) {
  const groups: readonly Group[] = ['fresh', 'returning']
  return (
    <section className="flex flex-col gap-3" aria-label="Guruhlar natijasi">
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile status={status} label="Kiruvchi qoʻngʻiroq" value={data?.total.calls ?? null} unit="count" />
        <StatTile status={status} label="Xil raqam" value={data?.total.numbers ?? null} unit="count" hint="bir raqam bir marta" />
        <StatTile
          status={status}
          label="Соф янги"
          value={data?.total.fresh.numbers ?? null}
          unit="count"
          hint="qoʻngʻiroq paytida raqam Bitrix24da yoʻq edi"
          tone="good"
        />
        <StatTile
          status={status}
          label="Қайта мурожат"
          value={data?.total.returning.numbers ?? null}
          unit="count"
          hint="oxirgi suhbatdan 14 kundan koʻp oʻtgan, Доставка/Базада emas"
          tone="warning"
        />
      </div>
      <ChartCard title="Guruhlar boʻyicha natija" hint="Har bir raqam oxirigacha: kiruvchida ulanganmi → keyin qayta qoʻngʻiroqda gaplashildimi → yakunda gaplashildimi">
        {status === 'loading' || !data ? (
          <LoadingSkeleton rows={2} />
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Guruhlar boʻyicha natija" className="w-full min-w-[640px] text-xs tabular-nums">
              <thead>
                <tr style={{ color: 'var(--ink-muted)' }}>
                  <th className="py-1 pr-3 text-left font-medium">Guruh</th>
                  <th className="py-1 pr-3 text-right font-medium">Raqam</th>
                  <th className="py-1 pr-3 text-right font-medium">Kiruvchida ulangan</th>
                  <th className="py-1 pr-3 text-right font-medium">Keyin qayta qoʻngʻiroqda gaplashildi</th>
                  <th className="py-1 pr-3 text-right font-medium">Yakunda gaplashildi</th>
                  <th className="py-1 text-right font-medium">Yoʻqotildi</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const o = data.total[g]
                  return (
                    <tr key={g} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                      <th scope="row" className="py-1.5 pr-3 text-left font-semibold" style={{ color: 'var(--ink-primary)' }}>
                        {GROUP_LABEL[g]}
                      </th>
                      <td className="py-1.5 pr-3 text-right font-semibold">{formatNumber(o.numbers)}</td>
                      <td className="py-1.5 pr-3 text-right">{withShare(o.answered, o.numbers)}</td>
                      <td className="py-1.5 pr-3 text-right">{withShare(o.calledBack, o.numbers)}</td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--status-good)' }}>
                        {withShare(o.talked, o.numbers)}
                      </td>
                      <td className="py-1.5 text-right font-semibold" style={{ color: o.lost > 0 ? 'var(--status-critical)' : undefined }}>
                        {formatNumber(o.lost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </section>
  )
}

function withShare(part: number, whole: number): string {
  const p = percent(part, whole)
  return p === null ? formatNumber(part) : `${formatNumber(part)} (${p}%)`
}

function ReturningDetail({ data, status }: { readonly data: AnalysisDto | undefined; readonly status: 'loading' | 'error' | 'ready' }) {
  return (
    <ChartCard title="Қайта мурожат — jim turgan vaqt va hozirgi voronka" hint="Oxirgi haqiqiy suhbatdan birinchi qoʻngʻiroqqacha necha kun oʻtgani · voronka — kontaktning eng yangi bitimi, bugungi holat">
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BUCKETS.map((b) => (
              <StatTile key={b.key} status={status} compact label={b.label} value={data.returning.buckets[b.key]} unit="count" />
            ))}
            <StatTile status={status} compact label="Mediana" value={data.returning.medianDays} unit="days" />
            <StatTile status={status} compact label="Eng uzoq" value={data.returning.longestDays} unit="days" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Hozir qaysi voronkada
            </p>
            {data.returning.funnels.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Bu davrda Қайта мурожат yoʻq
              </p>
            ) : (
              <table aria-label="Hozir qaysi voronkada" className="w-full text-xs tabular-nums">
                <tbody>
                  {data.returning.funnels.map((f) => (
                    <tr key={f.funnel} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                      <th scope="row" className="py-1 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                        {f.funnel}
                      </th>
                      <td className="py-1 text-right">{formatNumber(f.numbers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </ChartCard>
  )
}

function DayTable({ data, status }: { readonly data: AnalysisDto | undefined; readonly status: 'loading' | 'error' | 'ready' }) {
  return (
    <ChartCard
      title="Kunlik jadval"
      hint="Har kun alohida: raqam oʻsha kundagi birinchi qoʻngʻirogʻida guruhlanadi, shuning uchun kunlar yigʻindisi davr jamidan katta boʻlishi mumkin · * — tugamagan kun"
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Kunlik jadval" className="w-full min-w-[760px] text-xs tabular-nums">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th rowSpan={2} className="tcol-sticky is-edge left-0 py-1 pr-3 text-left font-medium">Kun</th>
                <th rowSpan={2} className="py-1 pr-3 text-right font-medium">Qoʻngʻiroq</th>
                <th rowSpan={2} className="py-1 pr-3 text-right font-medium">Xil raqam</th>
                <th colSpan={3} className="py-1 pr-3 text-center font-medium">Соф янги</th>
                <th colSpan={3} className="py-1 text-center font-medium">Қайта мурожат</th>
              </tr>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className="py-1 pr-3 text-right font-medium">raqam</th>
                <th className="py-1 pr-3 text-right font-medium">gaplashildi</th>
                <th className="py-1 pr-3 text-right font-medium">yoʻqotildi</th>
                <th className="py-1 pr-3 text-right font-medium">raqam</th>
                <th className="py-1 pr-3 text-right font-medium">gaplashildi</th>
                <th className="py-1 text-right font-medium">yoʻqotildi</th>
              </tr>
            </thead>
            <tbody>
              {data.days.length === 0 ? (
                <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <td colSpan={9} className="py-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Bu davrda kiruvchi qoʻngʻiroq yoʻq
                  </td>
                </tr>
              ) : (
                data.days.map((d) => (
                  <tr key={d.day} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                    <th scope="row" className="tcol-sticky is-edge left-0 py-1.5 pr-3 text-left font-medium whitespace-nowrap" style={{ color: 'var(--ink-primary)' }}>
                      {dayLabel(d.day)}
                      {d.unfinished ? '*' : ''}
                    </th>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(d.calls)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(d.numbers)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{formatNumber(d.fresh.numbers)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(d.fresh.talked)}</td>
                    <td className="py-1.5 pr-3 text-right" style={{ color: d.fresh.lost > 0 ? 'var(--status-critical)' : undefined }}>
                      {formatNumber(d.fresh.lost)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{formatNumber(d.returning.numbers)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(d.returning.talked)}</td>
                    <td className="py-1.5 text-right" style={{ color: d.returning.lost > 0 ? 'var(--status-critical)' : undefined }}>
                      {formatNumber(d.returning.lost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {data.days.length > 0 && (
              <tfoot>
                <tr className="border-t-2" style={{ borderColor: 'var(--grid)' }}>
                  <th scope="row" className="tcol-sticky is-edge left-0 pt-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-secondary)' }}>
                    Davr jami
                  </th>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.calls)}</td>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.numbers)}</td>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.fresh.numbers)}</td>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.fresh.talked)}</td>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.fresh.lost)}</td>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.returning.numbers)}</td>
                  <td className="pt-2 pr-3 text-right font-semibold">{formatNumber(data.total.returning.talked)}</td>
                  <td className="pt-2 text-right font-semibold">{formatNumber(data.total.returning.lost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </ChartCard>
  )
}

type GroupFilter = 'all' | Group
type OutcomeFilter = 'lost' | 'all'

const GROUP_OPTIONS: readonly { readonly value: GroupFilter; readonly label: string }[] = [
  { value: 'all', label: 'Ikkala guruh' },
  { value: 'fresh', label: 'Соф янги' },
  { value: 'returning', label: 'Қайта мурожат' },
]
const OUTCOME_OPTIONS: readonly { readonly value: OutcomeFilter; readonly label: string }[] = [
  { value: 'lost', label: 'Yoʻqotilganlar' },
  { value: 'all', label: 'Hammasi' },
]

/** The CLAUDE.md's CSV, «;»-separated, a BOM in front so Excel reads the Cyrillic. */
export function numbersCsv(rows: readonly NumberRow[]): string {
  const head = [
    '№',
    'Vaqt (Toshkent)',
    'Telefon',
    'Guruh',
    'Qoʻngʻiroq soni',
    'Kiruvchida ulangan',
    'Keyin gaplashildi',
    'YAKUN: gaplashilganmi',
    'Necha kun jim turgan',
    'Kontakt ID',
    'Ism',
    'Hozirgi holat',
    'Havola',
  ]
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = rows.map((r, i) =>
    [
      String(i + 1),
      formatDateTime(r.firstCallAt),
      r.phone ?? r.key,
      GROUP_LABEL[r.group],
      String(r.calls),
      yesNo(r.answered),
      yesNo(r.calledBack),
      yesNo(r.talked),
      r.silenceDays === null ? '' : String(r.silenceDays),
      r.contact?.bitrixId ?? '',
      r.contact?.name ?? '',
      r.state ?? '',
      r.contact?.bitrixId ? bitrixContactUrl(r.contact.bitrixId) : '',
    ]
      .map(cell)
      .join(';'),
  )
  return `﻿${[head.join(';'), ...lines].join('\r\n')}`
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function NumbersCard({ windowParams }: { readonly windowParams: Record<string, string | number> }) {
  const [group, setGroup] = useState<GroupFilter>('all')
  const [outcome, setOutcome] = useState<OutcomeFilter>('lost')
  const query = useQuery({
    queryKey: ['inbound-analysis-numbers', windowParams],
    queryFn: ({ signal }) => apiGet<{ rows: readonly NumberRow[] }>('/insights/calls/analysis/numbers', windowParams, signal),
    placeholderData: (previous) => previous,
  })
  const status = statusOf(query)
  const rows = useMemo(
    () =>
      (query.data?.data.rows ?? []).filter((r) => (group === 'all' || r.group === group) && (outcome === 'all' || !r.talked)),
    [query.data, group, outcome],
  )

  return (
    <ChartCard
      title="Raqamlar roʻyxati"
      hint="Har bir raqam — davrdagi birinchi qoʻngʻirogʻi vaqti bilan · «Yoʻqotilganlar» — hech qachon gaplashilmagan · CSV — CLAUDE.md ustunlarida"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={group} options={GROUP_OPTIONS} onChange={setGroup} ariaLabel="Guruh" />
          <SegmentedControl value={outcome} options={OUTCOME_OPTIONS} onChange={setOutcome} ariaLabel="Natija" />
          <button
            type="button"
            className="focusable rounded-[var(--radius-panel-sm)] px-2.5 py-1 text-xs font-medium"
            style={{ background: 'var(--glass-well)', color: 'var(--ink-primary)' }}
            disabled={rows.length === 0}
            onClick={() => download(`kiruvchi-tahlil-${group}-${outcome}.csv`, numbersCsv(rows))}
          >
            CSV yuklab olish
          </button>
        </div>
      }
    >
      {status === 'loading' ? (
        <LoadingSkeleton rows={6} />
      ) : status === 'error' ? (
        <ErrorState
          message={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="max-h-[70dvh] overflow-auto">
          <table aria-label="Raqamlar roʻyxati" className="w-full min-w-[1000px] text-xs tabular-nums">
            <thead className="sticky top-0" style={{ background: 'var(--surface-raised)' }}>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className="py-1 pr-3 text-left font-medium">Vaqt</th>
                <th className="py-1 pr-3 text-left font-medium">Telefon</th>
                <th className="py-1 pr-3 text-left font-medium">Guruh</th>
                <th className="py-1 pr-3 text-right font-medium">Qoʻngʻiroq</th>
                <th className="py-1 pr-3 text-left font-medium">Kiruvchida ulangan</th>
                <th className="py-1 pr-3 text-left font-medium">Keyin gaplashildi</th>
                <th className="py-1 pr-3 text-left font-medium">Yakun</th>
                <th className="py-1 pr-3 text-right font-medium">Jim (kun)</th>
                <th className="py-1 pr-3 text-left font-medium">Kontakt</th>
                <th className="py-1 text-left font-medium">Hozirgi holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <td colSpan={10} className="py-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Bu tanlovda raqam yoʻq
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.group}|${r.key}`} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(r.firstCallAt)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium" style={{ color: 'var(--ink-primary)' }}>
                      {r.tel ? (
                        <a href={`tel:${r.tel}`} className="underline underline-offset-2">
                          {r.phone ?? r.key}
                        </a>
                      ) : (
                        (r.phone ?? r.key)
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{GROUP_LABEL[r.group]}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(r.calls)}</td>
                    <td className="py-1.5 pr-3">{yesNo(r.answered)}</td>
                    <td className="py-1.5 pr-3">{yesNo(r.calledBack)}</td>
                    <td className="py-1.5 pr-3 font-semibold" style={{ color: r.talked ? 'var(--status-good)' : 'var(--status-critical)' }}>
                      {r.talked ? 'gaplashildi' : 'yoʻqotildi'}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{r.silenceDays === null ? '—' : formatNumber(r.silenceDays)}</td>
                    <td className="py-1.5 pr-3">
                      {r.contact?.bitrixId ? (
                        <a href={bitrixContactUrl(r.contact.bitrixId)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          {r.contact.name || `#${r.contact.bitrixId}`}
                        </a>
                      ) : (
                        (r.contact?.name ?? '—')
                      )}
                    </td>
                    <td className="py-1.5">{r.state ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  )
}
