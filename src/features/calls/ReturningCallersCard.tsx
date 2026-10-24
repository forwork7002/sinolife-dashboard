'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { downloadCsvText } from '@/features/shared/download'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'

import { GROUP_CALLERS_ID } from './GroupCallersCard'
import { bitrixContactUrl } from './UnansweredCallsCard'

/** Mirrors `AnalysisNumberDto` in `src/server/services/inboundAnalysisService.ts` — nothing checks the mirror. */
export interface AnalysisNumberRow {
  readonly key: string
  readonly phone: string | null
  readonly tel: string | null
  readonly group: 'fresh' | 'returning'
  readonly firstCallAt: string
  readonly calls: number
  readonly answered: boolean
  readonly calledBack: boolean
  readonly talked: boolean
  readonly silenceDays: number | null
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  readonly state: string | null
}

type Outcome = 'lost' | 'all'

const OUTCOME_OPTIONS: readonly { readonly value: Outcome; readonly label: string }[] = [
  { value: 'lost', label: 'Yoʻqotilganlar' },
  { value: 'all', label: 'Hammasi' },
]

const yesNo = (v: boolean) => (v ? 'ha' : 'yoʻq')

/** The CLAUDE.md's CSV of the lost: «;»-separated, a BOM in front so Excel reads the Cyrillic. */
export function returningCsv(rows: readonly AnalysisNumberRow[]): string {
  const head = [
    '№',
    'Vaqt (Toshkent)',
    'Telefon',
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

/**
 * «Қайта мурожат» opened up — the CLAUDE.md's list of the returning callers,
 * each followed to the end (answered, rung back, talked at all), lost ones
 * first, with its CSV. Under the tiles, where a group tile's list opens.
 */
export function ReturningCallersCard({
  windowParams,
  onClose,
}: {
  readonly windowParams: Record<string, string | number>
  readonly onClose: () => void
}) {
  const [outcome, setOutcome] = useState<Outcome>('lost')
  const ref = useRef<HTMLDivElement>(null)
  const query = useQuery({
    queryKey: ['inbound-analysis-numbers', windowParams],
    queryFn: ({ signal }) => apiGet<{ rows: readonly AnalysisNumberRow[] }>('/insights/calls/analysis/numbers', windowParams, signal),
  })

  // The tiles sit above the card: on a phone the list opens below the fold.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const status = statusOf(query)
  const all = useMemo(() => (query.data?.data.rows ?? []).filter((r) => r.group === 'returning'), [query.data])
  const rows = outcome === 'all' ? all : all.filter((r) => !r.talked)
  const lost = all.filter((r) => !r.talked).length
  const muted = { color: 'var(--ink-muted)' }

  return (
    <div ref={ref} id={GROUP_CALLERS_ID} data-testid="returning-callers">
      <ChartCard
        title={`Қайта мурожат — raqamlar roʻyxati${query.data ? ` · ${formatNumber(all.length)} ta` : ''}`}
        hint="Har bir raqam — davrdagi birinchi qoʻngʻirogʻi vaqti bilan. «Keyin gaplashildi» — biz qilgan qoʻngʻiroqda suhbat boʻlgan (bugungacha). «Yoʻqotilgan» — hech qachon gaplashilmagan. «Jim» — oxirgi suhbatdan birinchi qoʻngʻiroqqacha kun."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={outcome}
              options={OUTCOME_OPTIONS.map((o) =>
                query.data ? { ...o, label: `${o.label} · ${formatNumber(o.value === 'lost' ? lost : all.length)}` } : o,
              )}
              onChange={setOutcome}
              ariaLabel="Natija"
            />
            <Button variant="ghost" size="sm" disabled={rows.length === 0} onClick={() => downloadCsvText(`qayta-murojat-${outcome}.csv`, returningCsv(rows))}>
              CSV
            </Button>
            <Button variant="ghost" size="sm" icon={<MultiplyGlyph />} onClick={onClose} aria-label="Roʻyxatni yopish">
              Yopish
            </Button>
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
            <table aria-label="Қайта мурожат raqamlari" className="w-full min-w-[960px] text-xs tabular-nums">
              <thead className="sticky top-0" style={{ background: 'var(--surface-raised)' }}>
                <tr style={muted}>
                  <th className="py-1 pr-3 text-left font-medium">Vaqt</th>
                  <th className="py-1 pr-3 text-left font-medium">Telefon</th>
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
                    <td colSpan={9} className="py-1.5" style={muted}>
                      {outcome === 'lost' ? 'Yoʻqotilgan raqam yoʻq' : 'Bu davrda Қайта мурожат yoʻq'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.key} className="border-t" style={{ borderColor: 'var(--grid)' }}>
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
    </div>
  )
}
