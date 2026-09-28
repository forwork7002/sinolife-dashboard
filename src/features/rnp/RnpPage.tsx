'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/features/shared/PageShell'
import { type Status, SlicePicker, muted } from '@/features/reklama/reklamaUi'
import { apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

import { RnpBlockTable } from './RnpBlockTable'
import { RnpPlanEditor } from './RnpPlanEditor'
import type { RnpBlockKind, RnpOverviewDto, RnpTeamDto } from './rnpApi'

/**
 * «RNP jadvali» — the client's «СентябрРНП» sheet, one calendar month, every
 * row built on the server from Bitrix24 and Meta (`rnpSheet.ts`).
 *
 * THE SHEET'S SHAPE IS KEPT: a card per block, a row per metric, and across
 * it the plan, the fact, the forecast and every day. What the reader gets on
 * top of the sheet is two narrowings — one team (its ROP block and its
 * logistics block, nothing else) and one kind of block.
 *
 * ITS OWN MONTH, not the dashboard preset: the sheet is a calendar month by
 * construction, the same reason «Sotuv · ROP» keeps its own.
 */
type KindFilter = 'all' | RnpBlockKind

const KINDS: readonly { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'marketing', label: 'Маркетинг' },
  { value: 'registration', label: 'Регистрация' },
  { value: 'team', label: 'ROP' },
  { value: 'company', label: 'Sinolife' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'logistics', label: 'Логистика' },
  { value: 'summary', label: 'Свод' },
]

export function RnpPage() {
  const [month, setMonth] = useState(() => thisMonth())
  const [team, setTeam] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')

  const overview = useQuery({
    queryKey: ['rnp-overview', { month }],
    queryFn: ({ signal }) => apiGet<RnpOverviewDto>('/rnp/overview', { month }, signal),
    placeholderData: keepPreviousData,
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data
  // A team kept from another month that has no such team shows everything.
  const activeTeam = data?.teams.some((x) => x.rop === team) ? team : ''
  const blocks = (data?.blocks ?? []).filter(
    (b) => (activeTeam === '' || b.team === activeTeam) && (kind === 'all' || b.kind === kind),
  )

  return (
    <PageShell
      title={t.modules.rnp.title}
      description={t.modules.rnp.lead}
      accent="var(--series-7)"
      meta={overview.data?.meta}
      stale={overview.isPlaceholderData}
      period={false}
      actions={data?.canEditPlans ? <RnpPlanEditor key={data.month} data={data} /> : undefined}
      toolbar={
        <>
          <label className="flex items-center gap-2 text-xs" style={muted}>
            Oy
            <input
              type="month"
              value={month}
              max={thisMonth()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="focusable h-9 rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
            />
          </label>
          <TeamPicker teams={data?.teams ?? []} value={activeTeam} onChange={setTeam} />
          <SlicePicker<KindFilter> ariaLabel="Qaysi bloklar" value={kind} onChange={setKind} options={KINDS} />
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : status === 'loading' || !data ? (
          <Loading />
        ) : (
          <>
            <p className="text-xs" style={muted}>
              Prognoz — oxirgi toʻliq kungacha boʻlgan fakt ÷ {data.elapsedDays} kun × {data.days.length} kun. Nisbatlar
              kunma-kun va oy boʻyicha yigʻindilar nisbati.
            </p>
            {blocks.length === 0 ? (
              <Card className="p-5">
                <EmptyState
                  title="Bu tanlovda blok yoʻq"
                  body={
                    data.blocks.length === 0
                      ? 'Bu oy uchun jadval hali yigʻilmagan.'
                      : 'Jamoa yoki blok turini oʻzgartiring — «Hammasi» barcha bloklarni koʻrsatadi.'
                  }
                />
              </Card>
            ) : (
              blocks.map((b) => <RnpBlockTable key={b.id} block={b} days={data.days} today={data.today} />)
            )}
          </>
        )}
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------

function thisMonth(): string {
  // The reader's calendar month in Tashkent, where the floor works.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7)
}

function TeamPicker({
  teams,
  value,
  onChange,
}: {
  teams: readonly RnpTeamDto[]
  value: string
  onChange: (rop: string) => void
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs" style={muted}>
      Jamoa
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focusable h-9 max-w-[16rem] min-w-0 rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
        style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
      >
        <option value="">Hammasi</option>
        {teams.map((x) => (
          <option key={x.rop} value={x.rop}>
            {`${x.head ? `${x.rop} · ${x.head}` : x.rop}${x.isBase ? ' · БАЗА' : ''}`}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Card-shaped, so the page does not jump when the blocks land. */
function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={t.state.loading}>
      {[0, 1].map((i) => (
        <Card key={i} className="p-5">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton mt-4 h-[30px] w-full" />
          {Array.from({ length: 5 }).map((_, j) => (
            <div key={j} className="skeleton mt-2 h-[30px]" style={{ width: `${100 - j * 4}%` }} />
          ))}
        </Card>
      ))}
    </div>
  )
}
