'use client'

import { useQuery } from '@tanstack/react-query'
import { Fragment, useState, type ReactNode } from 'react'

import { statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { StatTile } from '@/components/ui/Stat'
import { apiGet } from '@/lib/api'
import { NO_VALUE, formatDateTime, formatNumber, formatPercent } from '@/lib/format'

import { GROUP_CALLERS_ID, GroupCallersCard } from './GroupCallersCard'
import { ReturningCallersCard } from './ReturningCallersCard'
import { UnansweredCallsCard } from './UnansweredCallsCard'

/**
 * «Kiruvchi qoʻngʻiroqlar» — the client's inbound-call report, 2026-10-05.
 * Mirrors `InboundCallsDto` in `server/services/inboundCallsService.ts`;
 * nothing checks the mirror, edit both.
 */
const GROUPS = ['fresh', 'notReached', 'talkedNoBuy', 'buyer', 'noDeal'] as const
type Group = (typeof GROUPS)[number]
type GroupCounts = Record<Group, number>

interface InboundDayDto {
  readonly day: string
  readonly calls: number
  readonly numbers: number
  readonly talked: number
  readonly talkedPercent: number | null
  readonly outbound: number
  readonly groups: GroupCounts
  readonly unfinished: boolean
}

export interface InboundCallsDto {
  readonly days: readonly InboundDayDto[]
  readonly total: {
    readonly calls: number
    readonly numbers: number
    readonly talked: number
    readonly talkedPercent: number | null
    readonly outbound: number
    readonly groups: GroupCounts
    readonly unreached: GroupCounts
  }
  readonly lastCallAt: string | null
  readonly undatedContacts: number
  readonly floorApplied: boolean
}

const GROUP_LABEL: Record<Group, string> = {
  fresh: 'Соф янги',
  notReached: 'Бор, гаплашилмаган',
  talkedNoBuy: 'Гаплашилган, олмаган',
  buyer: 'Эски харидор',
  noDeal: 'Сделкасиз',
}

const GROUP_RULE: Record<Group, string> = {
  fresh: 'Qoʻngʻiroq paytida raqam Bitrix24da yoʻq edi — kontakt birinchi qoʻngʻiroqdan 5 daqiqa oldin yoki undan keyin yaratilgan.',
  notReached: 'Kontakt avval bor, sdelkalari hanuz Регистрацияda — sotuv boʻlimiga hech qachon oʻtmagan.',
  talkedNoBuy: 'Первичка yoki Тасдиклашga oʻtgan sdelkasi bor (yoki Регистрацияda «Сделка успешна»), lekin xarid yoʻq.',
  buyer: 'Доставка yoki База voronkasida sdelkasi bor.',
  noDeal: 'Kontakt bor, lekin qoʻngʻiroqdan oldin birorta sdelkasi yoʻq.',
}

/**
 * The client's «Кирувчи қўнғироқлар таҳлили» (CLAUDE.md, 2026-10-22) — its two
 * figures followed to the end, on this screen's tiles. Mirrors the parts of
 * `InboundAnalysisDto` (`server/services/inboundAnalysisService.ts`) read here.
 */
interface AnalysisOutcome {
  readonly numbers: number
  readonly answered: number
  readonly calledBack: number
  readonly talked: number
  readonly lost: number
}

export interface InboundAnalysisSummary {
  readonly days: readonly { readonly day: string; readonly returning: AnalysisOutcome }[]
  readonly total: { readonly fresh: AnalysisOutcome; readonly returning: AnalysisOutcome }
  readonly returning: { readonly medianDays: number | null; readonly longestDays: number | null }
  /** The window began before 01.10.2026, where the analysis starts. */
  readonly floorApplied: boolean
}

const RETURNING_RULE =
  'Доставка/Базада sdelkasi yoʻq, oxirgi haqiqiy suhbatdan 14 kundan koʻp oʻtib oʻzi qoʻngʻiroq qilgan. Suhbatlar 15.09 dan qidiriladi — son eng kami.'

/** «yakunda» — any conversation from the first call on, our callback included, to now. */
const endLine = (o: AnalysisOutcome) => `Yakunda: ${formatNumber(o.talked)} tasi gaplashildi · ${formatNumber(o.lost)} tasi yoʻqotildi`

const muted = { color: 'var(--ink-muted)' } as const

type Tile = Group | 'returning'

const tileId = (g: Tile) => `inbound-group-tile-${g}`

/** `2026-10-05` → `05.10`. */
const dayLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

type Row = InboundDayDto & { readonly isTotal?: boolean; readonly returning?: number }

const count = (n: number) => formatNumber(n)

const COLUMNS: readonly Column<Row>[] = [
  {
    key: 'day',
    header: 'Kun',
    rowHeader: true,
    render: (r) =>
      r.isTotal ? (
        'Davr jami'
      ) : (
        <span>
          {dayLabel(r.day)}
          {r.unfinished && (
            <span className="ml-1.5 text-[11px] font-normal" style={muted} title="Bugun — kun hali tugamagan, raqamlar oʻsadi">
              · tugamagan
            </span>
          )}
        </span>
      ),
  },
  { key: 'calls', header: 'Kiruvchi', align: 'right', numeric: true, render: (r) => count(r.calls) },
  { key: 'numbers', header: 'Xil raqam', align: 'right', numeric: true, render: (r) => count(r.numbers) },
  { key: 'talked', header: 'Gaplashilgan', align: 'right', numeric: true, render: (r) => count(r.talked) },
  {
    key: 'talkedPercent',
    header: '%',
    align: 'right',
    numeric: true,
    render: (r) => (r.talkedPercent === null ? NO_VALUE : formatPercent(r.talkedPercent)),
  },
  { key: 'outbound', header: 'Chiquvchi', align: 'right', numeric: true, render: (r) => count(r.outbound) },
  ...GROUPS.flatMap((g): Column<Row>[] => {
    const column: Column<Row> = {
      key: g,
      header: GROUP_LABEL[g],
      align: 'right',
      numeric: true,
      render: (r) => count(r.groups[g]),
    }
    if (g !== 'fresh') return [column]
    // «Қайта мурожат» beside «Соф янги», the CLAUDE.md's two figures side by side.
    return [
      column,
      {
        key: 'returning',
        header: 'Қайта мурожат',
        align: 'right',
        numeric: true,
        render: (r) => (r.returning === undefined ? NO_VALUE : count(r.returning)),
      },
    ]
  }),
]

function OpenLine({ open }: { readonly open: boolean }) {
  return (
    <p className="mt-1.5 text-[11.5px] font-medium" style={{ color: 'var(--accent-ink)' }}>
      {open ? 'Roʻyxatni yopish ↑' : 'Raqamlarni koʻrish ↓'}
    </p>
  )
}

/*
  The whole tile is the button — the figure is what gets pressed. A ring, not a
  fill, marks the open one: `fill` already means «find this tile» (green).
*/
function pressable(
  key: Tile,
  tile: ReactNode,
  enabled: boolean,
  open: boolean,
  setOpen: (next: Tile | null) => void,
): ReactNode {
  if (!enabled) return <Fragment key={key}>{tile}</Fragment>
  return (
    <button
      key={key}
      id={tileId(key)}
      type="button"
      onClick={() => setOpen(open ? null : key)}
      aria-expanded={open}
      aria-controls={open ? GROUP_CALLERS_ID : undefined}
      className="focusable flex min-w-0 cursor-pointer flex-col rounded-[var(--radius-panel)] text-left [&>.card]:flex-1"
      style={open ? { boxShadow: '0 0 0 2px var(--accent)' } : undefined}
    >
      {tile}
    </button>
  )
}

/**
 * Its own request on its own key: the operators' report above it is one
 * statement and stays one, and this one is ~three times heavier (a month is
 * every inbound call plus every deal its callers hold).
 */
export function InboundCallsSection({ windowParams }: { windowParams: Record<string, string | number> }) {
  const query = useQuery({
    queryKey: ['insights-calls-inbound', windowParams],
    queryFn: ({ signal }) => apiGet<InboundCallsDto>('/insights/calls/inbound', windowParams, signal),
  })
  // The CLAUDE.md's figures on their own key: each caller's conversations either way is a heavier read.
  const analysis = useQuery({
    queryKey: ['inbound-analysis', windowParams],
    queryFn: ({ signal }) => apiGet<InboundAnalysisSummary>('/insights/calls/analysis', windowParams, signal),
  })
  const status = statusOf(query)
  return (
    <InboundCalls
      data={query.data?.data}
      status={status}
      errorMessage={query.error instanceof Error ? query.error.message : undefined}
      onRetry={() => void query.refetch()}
      analysis={analysis.data?.data}
      analysisStatus={statusOf(analysis)}
      returningList={({ onClose }) => <ReturningCallersCard windowParams={windowParams} onClose={onClose} />}
      unanswered={<UnansweredCallsCard windowParams={windowParams} groupLabel={GROUP_LABEL} />}
      groupList={({ group, onClose }) => (
        <GroupCallersCard
          key={group}
          windowParams={windowParams}
          group={group}
          label={GROUP_LABEL[group]}
          onClose={onClose}
        />
      )}
    />
  )
}

export function InboundCalls({
  data,
  status,
  errorMessage,
  onRetry,
  unanswered,
  groupList,
  analysis,
  analysisStatus = 'loading',
  returningList,
}: {
  data: InboundCallsDto | undefined
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
  /** «Javobsiz qolgan raqamlar», under the tiles it opens up. */
  unanswered?: ReactNode
  /** A pressed group tile's numbers; without it the tiles are not buttons. */
  groupList?: (args: { group: Group; onClose: () => void }) => ReactNode
  /** The CLAUDE.md's «Соф янги» / «Қайта мурожат» to the end; without it no «Қайта мурожат» tile. */
  analysis?: InboundAnalysisSummary
  analysisStatus?: 'loading' | 'error' | 'ready'
  /** The pressed «Қайта мурожат» tile's numbers. */
  returningList?: (args: { onClose: () => void }) => ReactNode
}) {
  const [openGroup, setOpenGroup] = useState<Tile | null>(null)
  // «Yopish» unmounts the card under the reader's focus: hand it back to the tile.
  const closeList = () => {
    if (openGroup) document.getElementById(tileId(openGroup))?.focus()
    setOpenGroup(null)
  }
  const total = data?.total
  // Shown only where the analysis covers the whole window: before 01.10 it would count part of it.
  const covered = analysis && !analysis.floorApplied ? analysis : undefined
  const returningByDay = new Map((covered?.days ?? []).map((d) => [d.day, d.returning.numbers]))
  const rows: Row[] = data
    ? [
        ...data.days.map((d) => ({ ...d, returning: covered ? (returningByDay.get(d.day) ?? 0) : undefined })),
        {
          returning: covered?.total.returning.numbers,
          day: 'total',
          calls: data.total.calls,
          numbers: data.total.numbers,
          talked: data.total.talked,
          talkedPercent: data.total.talkedPercent,
          outbound: data.total.outbound,
          groups: data.total.groups,
          unfinished: false,
          isTotal: true,
        },
      ]
    : []

  return (
    <section className="flex flex-col gap-3" aria-labelledby="inbound-calls-title" data-testid="inbound-calls">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="inbound-calls-title" className="eyebrow">
          Kiruvchi qoʻngʻiroqlar
        </h2>
        {data && (
          <p className="text-[11px]" style={muted}>
            {data.lastCallAt ? `Oxirgi kiruvchi qoʻngʻiroq: ${formatDateTime(data.lastCallAt)}` : 'Bu davrda kiruvchi qoʻngʻiroq yoʻq'}
            {' · raqam oxirgi 9 raqami boʻyicha'}
          </p>
        )}
      </div>

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          status={status}
          label="Kiruvchi qoʻngʻiroq"
          value={total?.calls ?? null}
          unit="count"
          hint="mijozlar bizga qilgan qoʻngʻiroqlar"
        />
        <StatTile
          status={status}
          label="Xil raqam"
          value={total?.numbers ?? null}
          unit="count"
          hint="nechta raqamdan kelgan · bir raqam bir marta"
        />
        <StatTile
          status={status}
          label="Gaplashilgan raqam"
          value={total?.talked ?? null}
          unit="count"
          hint={total ? `${formatPercent(total.talkedPercent)} · kamida bir marta suhbat boʻlgan` : undefined}
        />
        <StatTile
          status={status}
          label="Chiquvchi qoʻngʻiroq"
          value={total?.outbound ?? null}
          unit="count"
          hint="xodimlar oʻzi qilgan qoʻngʻiroqlar"
        />
      </div>

      <div
        className={`stagger grid grid-cols-2 gap-3 md:grid-cols-3 ${returningList ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}
        data-testid="inbound-groups"
      >
        {GROUPS.flatMap((g) => {
          const open = openGroup === g
          const tile = (
            <StatTile
              compact
              status={status}
              label={GROUP_LABEL[g]}
              value={total?.groups[g] ?? null}
              unit="count"
              fill={g === 'fresh' ? 'good' : undefined}
              hint={total ? `shundan ${formatNumber(total.unreached[g])} tasi qoʻngʻiroq qilgan, lekin ulanmagan` : undefined}
              context={
                <>
                  {g === 'fresh' && covered && (
                    <p className="mb-1 text-[11.5px] font-medium tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                      {endLine(covered.total.fresh)}
                    </p>
                  )}
                  <p className="text-[11px] leading-snug" style={muted}>
                    {GROUP_RULE[g]}
                  </p>
                  {groupList && <OpenLine open={open} />}
                </>
              }
            />
          )
          const tiles = [pressable(g, tile, groupList !== undefined, open, setOpenGroup)]
          if (g !== 'fresh' || !returningList) return tiles
          // «Қайта мурожат» beside «Соф янги», green as it is: the CLAUDE.md's two figures, found at a glance.
          const returningOpen = openGroup === 'returning'
          const returning = (
            <StatTile
              compact
              status={covered ? 'ready' : analysis ? 'ready' : analysisStatus}
              label="Қайта мурожат"
              value={covered?.total.returning.numbers ?? null}
              unit="count"
              fill="good"
              hint={
                covered
                  ? `shundan ${formatNumber(covered.total.returning.answered)} tasi kiruvchida ulangan`
                  : analysis?.floorApplied
                    ? '01.10.2026 dan oldingi davrga hisoblanmaydi'
                    : undefined
              }
              context={
                <>
                  {covered && (
                    <p className="mb-1 text-[11.5px] font-medium tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                      {endLine(covered.total.returning)}
                    </p>
                  )}
                  <p className="text-[11px] leading-snug" style={muted}>
                    {RETURNING_RULE}
                    {covered && covered.returning.medianDays !== null
                      ? ` Jim turgan: mediana ${formatNumber(covered.returning.medianDays)} kun, eng uzogʻi ${formatNumber(covered.returning.longestDays ?? 0)} kun.`
                      : ''}
                  </p>
                  {covered && <OpenLine open={returningOpen} />}
                </>
              }
            />
          )
          return [...tiles, pressable('returning', returning, covered !== undefined, returningOpen, setOpenGroup)]
        })}
      </div>
      {openGroup === 'returning'
        ? returningList?.({ onClose: closeList })
        : groupList && openGroup && groupList({ group: openGroup, onClose: closeList })}
      <div className="flex flex-col gap-1 text-[11px] leading-snug" style={muted} data-testid="inbound-unreached-rule">
        <p>
          «Ulanmagan» — qoʻngʻiroqlar soni emas, raqamlar soni: shu davrda bizga qoʻngʻiroq qilgan, lekin
          kiruvchi qoʻngʻiroqlarining birortasida ham suhbat boʻlmagan (hammasi 0 soniya) raqamlar. Sababi ikki xil:
          hech kim koʻtarmagan yoki mijoz ulanmasdan oʻzi qoʻyib qoʻygan — Bitrix24 bularni ajratmaydi.
        </p>
        <p>
          Bu son faqat kiruvchi qoʻngʻiroqlarga va faqat tanlangan davrga qaraydi: xodim keyin oʻzi qayta qoʻngʻiroq
          qilib gaplashgan boʻlsa ham raqam shu sonda qoladi. Qayta qoʻngʻiroq qilingan-qilinmagani quyidagi
          roʻyxatda koʻrinadi.
        </p>
        <p>
          Guruh (Соф янги, Эски харидор va boshqalar) — raqam egasining davrdagi birinchi qoʻngʻirogʻi paytida
          Bitrix24da kim boʻlgani. Qoʻngʻiroqlar Bitrix24 telefoniyasidan taxminan har 3 soatda yuklanadi.
        </p>
      </div>
      {unanswered}

      {data && data.undatedContacts > 0 && (
        <p className="text-xs" style={{ color: 'var(--status-warning)' }} data-testid="inbound-undated">
          {formatNumber(data.undatedContacts)} ta kontaktning Bitrix24da yaratilgan vaqti hali olinmagan — ular
          «Соф янги» boʻla olmaydi. Tungi yangilanishdan keyin toʻgʻrilanadi.
        </p>
      )}

      <ChartCard
        title="Kunlar boʻyicha"
        hint="Har kuni raqam bir marta, oʻsha kundagi birinchi qoʻngʻirogʻi boʻyicha guruhlanadi. «Davr jami»da raqam butun davrda bir marta — shuning uchun kunlar yigʻindisidan kam. Guruhlar CRMning bugungi holati boʻyicha (qoʻngʻiroqdan oldin ochilgan sdelkalar)."
      >
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.day}
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
          stickyLastRow
          stickyColumns={1}
          minWidth={1080}
          emptyTitle="Kiruvchi qoʻngʻiroq yoʻq"
        />
      </ChartCard>
    </section>
  )
}
