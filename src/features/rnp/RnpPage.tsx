'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { useCohortRop } from '@/features/cohort/useCohortRop'
import { PageShell } from '@/features/shared/PageShell'
import { type Status, muted } from '@/features/reklama/reklamaUi'
import { apiGet } from '@/lib/api'
import { t } from '@/lib/messages'
import { useReducedMotion } from '@/lib/useReducedMotion'

import { RnpCompanySkeleton, RnpCompanyView } from './RnpCompanyView'
import { RnpPlanEditor } from './RnpPlanEditor'
import { RnpRopRail, RnpRopRailSkeleton } from './RnpRopRail'
import { RnpTeamView } from './RnpTeamView'
import type { RnpOverviewDto } from './rnpApi'
import { findRow, teamSummaries } from './rnpDerive'

/**
 * «RNP jadvali» — the client's «СентябрРНП» sheet, one calendar month, every
 * row built on the server from Bitrix24 and Meta (`rnpSheet.ts`).
 *
 * TWO READINGS OF ONE PAYLOAD. With no team chosen it is the company: its
 * headline rows as cards, FAKT by day, the lead funnel, the teams ranked, and
 * the sheet's company blocks folded underneath. With a team chosen
 * («har bir ROP ga alohida») it is that team alone: its cards, its two
 * charts, its block and its logistics block. Everything is derived in the
 * browser from `/rnp/overview` (`rnpDerive.ts`) — choosing a team costs no
 * request.
 *
 * THE TEAM IS IN THE URL (`?rop=`), through the same hook and for the same
 * reasons as the cohort screen's team cut: it decides which answer is on
 * screen and it is what somebody sends a colleague a link to. A `?rop=` the
 * month does not have is SAID, not silently answered with the company.
 *
 * ITS OWN MONTH, not the dashboard preset: the sheet is a calendar month by
 * construction, the same reason «Sotuv · ROP» keeps its own.
 */
export function RnpPage() {
  const [month, setMonth] = useState(() => thisMonth())
  const { rop, setRop } = useCohortRop()
  const top = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  const overview = useQuery({
    queryKey: ['rnp-overview', { month }],
    queryFn: ({ signal }) => apiGet<RnpOverviewDto>('/rnp/overview', { month }, signal),
    placeholderData: keepPreviousData,
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data
  const teams = useMemo(() => (data ? teamSummaries(data) : []), [data])
  const at = teams.findIndex((s) => s.team.rop === rop)
  const selected = at >= 0 ? teams[at]! : null
  const missing = rop !== null && data !== undefined && selected === null

  /** From the ranking, far down the page: bring the reader back to the top of the team. */
  const openFromBelow = (next: string) => {
    setRop(next)
    top.current?.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' })
  }

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
        <label className="flex items-center gap-2 text-xs" style={muted}>
          Oy
          <input
            type="month"
            value={month}
            max={thisMonth()}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="focusable h-11 rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
            style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
          />
        </label>
      }
    >
      <div ref={top} className="flex min-w-0 scroll-mt-4 flex-col gap-4">
        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : status === 'loading' || !data ? (
          <div className="flex flex-col gap-4" role="status" aria-label={t.state.loading}>
            <RnpRopRailSkeleton />
            <RnpCompanySkeleton />
          </div>
        ) : data.blocks.length === 0 ? (
          <Card className="p-5">
            <EmptyState title="Bu oy uchun jadval yoʻq" body="Bu oy uchun jadval hali yigʻilmagan — boshqa oyni tanlang." />
          </Card>
        ) : (
          <>
            <RnpRopRail teams={teams} company={findRow(data, 'co:fakt1')} value={selected?.team.rop ?? null} onChange={setRop} />
            {missing && (
              <p
                className="rounded-[var(--radius-panel-sm)] border px-3 py-2 text-xs"
                role="status"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}
              >
                «{rop}» jamoasi bu oyda yoʻq — butun kompaniya koʻrsatilmoqda.
              </p>
            )}
            {selected ? (
              <RnpTeamView
                key={selected.team.rop}
                data={data}
                summary={selected}
                count={teams.length}
                onSelect={setRop}
                prev={teams[at - 1]?.team.rop ?? null}
                next={teams[at + 1]?.team.rop ?? null}
              />
            ) : (
              <RnpCompanyView data={data} teams={teams} onSelect={openFromBelow} />
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
