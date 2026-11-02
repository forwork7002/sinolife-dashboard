'use client'

import { useQuery } from '@tanstack/react-query'
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { AiNowPanel, inked } from '@/features/aiRegistrator/AiNowPanel'
import { useServerNow } from '@/features/aiRegistrator/aiClock'
import type { AiStatus } from '@/features/aiRegistrator/aiLiveLogic'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatCompactUzs, formatDateShort, formatDateTime, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { useServerViewer } from '@/lib/viewer'

import { type AiDrill, AiCallsDrawer, OUTCOME_LABEL, phoneText } from './AiCallsDrawer'

/* Mirrors `AiRegistratorDto` in `src/server/services/aiRegistratorService.ts` — nothing checks the mirror. */
interface Money {
  readonly amountMinor: string
  readonly currency: string
  readonly amount: number
}

interface Group {
  readonly leads: number
  readonly withSalesDeal: number
  readonly ordered: number
  readonly orderSum: Money
  readonly sold: number
  readonly soldSum: Money
  readonly lost: number
  readonly noDeal: number
  readonly orderedRateBp: number | null
  readonly soldRateBp: number | null
  readonly soldPerLead: Money | null
  readonly medianHoursToOrder: number | null
}

type Verdict = 'sold' | 'ordered' | 'with_seller' | 'lost' | 'no_deal' | 'not_transferred' | 'not_synced'

interface DealRow {
  readonly dealId: string
  readonly title: string | null
  readonly phone: string
  readonly at: string
  readonly outcome: string
  readonly transferredTo: string | null
  readonly seller: string | null
  readonly attempts: readonly { readonly ext: string; readonly result: string }[]
  readonly problem: string | null
  readonly summary: string | null
  readonly lead: { readonly pipeline: string | null; readonly stage: string | null; readonly status: string } | null
  readonly sales: readonly {
    readonly dealId: string
    readonly pipeline: string | null
    readonly stage: string | null
    readonly status: 'OPEN' | 'WON' | 'LOST'
    readonly amount: Money
    readonly createdAt: string
  }[]
  readonly soldBy: string | null
  readonly verdict: Verdict
}

interface ReportDto {
  readonly funnel: {
    readonly calls: number
    readonly deals: number
    readonly answered: number
    readonly tests: number
    readonly byOutcome: Readonly<Record<string, number>>
  }
  readonly ai: Group
  readonly classic: Group
  readonly sellers: readonly {
    readonly key: string
    readonly employeeId: string | null
    readonly name: string | null
    readonly ext: string | null
    readonly ai: Group
    readonly classic: Group
  }[]
  readonly extensions: readonly {
    readonly ext: string
    readonly name: string | null
    readonly tried: number
    readonly answered: number
    readonly busy: number
    readonly rejected: number
    readonly noAnswer: number
    readonly failed: number
  }[]
  readonly deals: readonly DealRow[]
  readonly enoughToCompare: boolean
  readonly minLeads: number
  readonly followDays: number
  readonly slackMinutes: number
}


/* Mirrors `AiLiveDto` in `src/server/services/aiRegistratorControlService.ts` — the 5 s read of `/leads/ai-registrator/live`. */
interface AiLiveDto {
  readonly status: AiStatus | null
  readonly staleAfterSec: number
}

type Status = 'loading' | 'error' | 'ready'

const ATTEMPT_LABEL: Readonly<Record<string, string>> = {
  answered: 'koʻtardi',
  busy: 'band (boshqa qoʻngʻiroqda)',
  rejected: 'rad etdi',
  no_answer: 'koʻtarmadi',
  caller_left: 'mijoz kutmadi',
  failed: 'ATS ulamadi',
}

const VERDICT: Readonly<Record<Verdict, { readonly label: string; readonly color?: string }>> = {
  sold: { label: 'Sotildi (yetkazildi)', color: 'var(--status-good)' },
  ordered: { label: 'Buyurtma bor', color: 'var(--status-good)' },
  with_seller: { label: 'Sotuvchida, buyurtma yoʻq', color: 'var(--status-warning)' },
  lost: { label: 'Yoʻqotildi', color: 'var(--status-critical)' },
  no_deal: { label: 'Bitim ochilmagan', color: 'var(--status-critical)' },
  not_transferred: { label: 'Ulanmadi — sotuvchi javob bermadi', color: 'var(--status-critical)' },
  not_synced: { label: 'Bitrix24dan hali oʻqilmagan' },
}

/** Each outcome's bar: put through green, the promise blue, a failed hand-off amber, not interested orange, the rest quiet. */
const OUTCOME_BAR: Readonly<Record<string, string>> = {
  interested_transferred: 'var(--status-good)',
  interested_callback: 'var(--series-1)',
  transfer_failed: 'var(--status-warning)',
  not_interested: 'var(--series-2)',
  ats_rejected: 'var(--status-critical)',
  error: 'var(--status-critical)',
}

/** A sales pipeline's chip colour, as the lead moves on: Регистрация → Первичный отдел → Тасдиклаш → Доставка. */
function pipelineColor(pipeline: string | null): string {
  const p = (pipeline ?? '').toLowerCase()
  if (p.includes('достав')) return 'var(--status-good)'
  if (p.includes('тасдик')) return 'var(--status-warning)'
  if (p.includes('первич')) return 'var(--series-1)'
  return 'var(--ink-muted)'
}

const pct = (bp: number | null) => formatPercent(bp === null ? null : bp / 100)
const share = (part: number, whole: number) => (whole === 0 ? formatNumber(part) : `${formatNumber(part)} (${formatPercent((part / whole) * 100, 0)})`)
const ratio = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : null)
const hours = (h: number | null) => (h === null ? '—' : h < 1 ? `${formatNumber(Math.round(h * 60))} daqiqa` : h < 48 ? `${formatNumber(Math.round(h))} soat` : `${formatNumber(Math.round(h / 24))} kun`)
const uzs = (m: Money | null) => (m === null ? '—' : formatCompactUzs(m.amount))

/** «Sirojov 115 Davlatbek» → «Davlatbek»-less first word, the extension apart — the floor's «Sirojov». */
const firstName = (name: string | null, ext: string | null) =>
  (name ?? '')
    .split(/\s+/)
    .filter((w) => w !== '' && w !== ext && !/^[-\d]+$/.test(w))
    .slice(0, 2)
    .join(' ') || null

/**
 * «AI registrator» (the owner, 2026-10-22: «AI registrator kimga ulab berdi,
 * sotuvchi qaysi sdelkalarga oʻtkazdi … AI ulab berishi yaxshimi yoki
 * mutaxassisga ulagani yaxshimi»): the voice agent's calls in the window, the
 * leads it put through to a seller followed to their sales, and the same
 * window's human-registrar leads beside them. Every definition is
 * `domain/aiRegistrator/aiRegistrator.ts`.
 *
 * LAID OUT BY THE OWNER'S DESIGN CANVAS (2026-11-02, «Hisobot — jonli
 * monitoring + tahlil»: «koʻrinishi menga yoqdi»): what the AI does NOW on
 * top (`AiNowPanel`, its own 5 s read), then «Natijalar» — four cards, how the
 * calls ended, AI against the registrars, the sellers, the tries, every lead.
 * Every number still opens the calls behind it (`AiCallsDrawer`).
 */
export function AiRegistratorPage() {
  const { apiParams } = useDashboardFilters()
  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const report = useQuery({
    queryKey: ['ai-registrator', windowParams],
    queryFn: ({ signal }) => apiGet<ReportDto>('/leads/ai-registrator', windowParams, signal),
    placeholderData: (previous) => previous,
  })
  const status = statusOf(report)
  const data = report.data?.data
  // The number opened — every figure on the page opens the calls behind it (`AiCallsDrawer`).
  const [drill, setDrill] = useState<AiDrill | null>(null)
  const period = report.data?.meta.period
  const windowText = period ? spanText(period.start, period.end) : ''
  // «Boshqaruv» — only the accounts the owner named (`auth/aiControl.ts`); the page and its API refuse anyone else.
  const viewer = useServerViewer()

  return (
    <PageShell
      title="AI registrator"
      description="AI lidlarga qoʻngʻiroq qiladi, qiziqqanini sotuvchiga ulab beradi. Bu yerda — hozir nima boʻlyapti, natija qanday va AI oddiy registratordan yaxshiroqmi. Vaqt — Toshkent."
      accent="var(--series-1)"
      meta={report.data?.meta}
      stale={report.isPlaceholderData}
      actions={
        viewer?.aiControl ? (
          <Button href="/leads/ai-registrator/boshqaruv" variant="primary" size="sm">
            Boshqaruv →
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <LiveSection />
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-1">
          <h2 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Natijalar
          </h2>
          <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            {windowText ? `${windowText} · ` : ''}Toshkent vaqti · davr — yuqoridagi filtrda
          </span>
        </header>
        {status === 'error' ? (
          <ErrorState message={report.error instanceof ApiClientError ? report.error.message : undefined} onRetry={() => void report.refetch()} />
        ) : (
          <>
            <Kpis data={data} status={status} onDrill={setDrill} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Outcomes data={data} status={status} onDrill={setDrill} />
              <Comparison data={data} status={status} />
            </div>
            <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
              <Sellers data={data} status={status} onDrill={setDrill} />
              <Extensions data={data} status={status} onDrill={setDrill} />
            </div>
            <Deals data={data} status={status} />
            {data && <Definitions data={data} />}
          </>
        )}
      </div>
      {drill && <AiCallsDrawer drill={drill} windowParams={windowParams} windowText={windowText} onClose={() => setDrill(null)} />}
    </PageShell>
  )
}

/**
 * «Hozir · jonli» — the agent's last report alone, every 5 s while the tab is
 * in view (the agent reports every 5 s while a line is busy, every 30 s
 * otherwise). Its own read, so the minute-old report never holds it back.
 */
function LiveSection() {
  const live = useQuery({
    queryKey: ['ai-registrator', 'live'],
    queryFn: ({ signal }) => apiGet<AiLiveDto>('/leads/ai-registrator/live', {}, signal),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 4_000,
  })
  const skew = live.data ? new Date(live.data.meta.generatedAt).getTime() - live.dataUpdatedAt : 0
  // A response without a readable clock moves nothing — a NaN here would stop every timer on the page.
  const skewMs = Number.isFinite(skew) ? skew : 0
  const now = useServerNow(skewMs)
  const status = live.data?.data.status ?? null
  const names = new Map((status?.report.sellers ?? []).map((s) => [s.ext, s.name?.trim() || null]))
  if (!live.data) {
    return live.isError ? (
      <ErrorState message={live.error instanceof ApiClientError ? live.error.message : undefined} onRetry={() => void live.refetch()} />
    ) : (
      <LoadingSkeleton rows={4} />
    )
  }
  return (
    <AiNowPanel
      status={status}
      saved={null}
      staleAfterSec={live.data.data.staleAfterSec}
      now={now}
      updatedAt={live.data.meta.generatedAt}
      updateFailed={live.isError}
      nameOf={(ext) => names.get(ext) ?? null}
    />
  )
}

/** «22.10 – 23.10»; the end is exclusive, so the last day named is the one before it. */
function spanText(start: string, end: string): string {
  const first = formatDateShort(start)
  const last = formatDateShort(new Date(new Date(end).getTime() - 1).toISOString())
  return first === last ? first : `${first} – ${last}`
}

/** A section card: a title, one line under it, the body. */
function Panel({
  title,
  lead,
  action,
  label,
  className = '',
  children,
}: {
  readonly title: string
  readonly lead?: ReactNode
  readonly action?: ReactNode
  readonly label?: string
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <Card className={`flex min-w-0 flex-col gap-4 p-4 sm:p-5 ${className}`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 aria-label={label} className="text-[17px] font-bold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            {title}
          </h2>
          {lead && (
            <p className="mt-1 max-w-3xl text-[13px] leading-5" style={{ color: 'var(--ink-secondary)' }}>
              {lead}
            </p>
          )}
        </div>
        {action}
      </header>
      {children}
    </Card>
  )
}

/** A figure in a table that opens the calls behind it — underlined on hover, a button to the keyboard. */
function DrillLink({ onOpen, title, children }: { readonly onOpen: () => void; readonly title: string; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="focusable cursor-pointer rounded-[4px] font-bold underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent-ink)] hover:decoration-solid"
      style={{ color: 'var(--accent-ink)' }}
    >
      {children}
    </button>
  )
}

/* ── Natijalar: the four cards ──────────────────────────────────────────── */

/**
 * A card that opens the calls behind its number. A real button around it — a
 * keyboard reaches it — lifting a little under the pointer, «roʻyxat →» under
 * the figure so it reads as something to press.
 */
function KpiCard({
  label,
  value,
  sub,
  badge,
  color,
  lit = false,
  status,
  onOpen,
}: {
  readonly label: string
  readonly value: number | null
  readonly sub: string | null
  readonly badge: string | null
  readonly color?: string
  readonly lit?: boolean
  readonly status: Status
  readonly onOpen: () => void
}) {
  const ink = color ? inked(color) : 'var(--ink-primary)'
  const style: CSSProperties | undefined = lit && color ? { borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, background: `linear-gradient(180deg, color-mix(in oklab, ${color} 12%, transparent), transparent)` } : undefined
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label} — qoʻngʻiroqlar roʻyxatini ochish`}
      className="focusable group card card-button relative flex h-full w-full cursor-pointer flex-col gap-1.5 p-4 text-left transition-transform duration-150 hover:-translate-y-0.5"
      style={style}
    >
      {badge && (
        <span
          className="absolute top-3.5 right-3.5 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums"
          style={{ background: `color-mix(in oklab, ${color ?? 'var(--series-1)'} 16%, transparent)`, color: color ? ink : inked('var(--series-1)') }}
        >
          {badge}
        </span>
      )}
      <span className="text-[13px] font-semibold" style={{ color: lit ? ink : 'var(--ink-secondary)' }}>
        {label}
      </span>
      <span className="text-[36px] leading-none font-extrabold tracking-tight tabular-nums" style={{ color: ink }}>
        {status === 'loading' || value === null ? '—' : formatNumber(value)}
      </span>
      {sub && (
        <span className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {sub}
        </span>
      )}
      <span className="mt-auto pt-1 text-[12.5px] font-semibold opacity-75 transition-opacity group-hover:opacity-100" style={{ color: 'var(--accent-ink)' }}>
        roʻyxat →
      </span>
    </button>
  )
}

/** A narrow card under the four: a figure, what it means, its list. */
function SmallFigure({
  value,
  title,
  sub,
  color,
  onOpen,
  open,
}: {
  readonly value: string
  readonly title: string
  readonly sub: string
  readonly color?: string
  readonly onOpen: () => void
  readonly open: string
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${title} — qoʻngʻiroqlar roʻyxatini ochish`}
      className="focusable group card card-button flex min-w-0 flex-1 basis-72 cursor-pointer items-center gap-4 px-4 py-3 text-left"
    >
      <span className="text-[26px] font-extrabold tabular-nums" style={{ color: color ? inked(color) : 'var(--ink-primary)' }}>
        {value}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold" style={{ color: 'var(--ink-primary)' }}>
          {title}
        </span>
        <span className="block text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {sub}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-[12.5px] font-semibold opacity-75 group-hover:opacity-100" style={{ color: 'var(--accent-ink)' }}>
        {open}
      </span>
    </button>
  )
}

function Kpis({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  const f = data?.funnel
  const transferred = f?.byOutcome.interested_transferred ?? 0
  const failed = f?.byOutcome.transfer_failed ?? 0
  return (
    <section aria-label="AI qoʻngʻiroqlari" className="flex flex-col gap-3">
      <div className="stagger grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="AI qoʻngʻiroq qildi"
          value={f?.calls ?? null}
          sub={f ? `${formatNumber(f.deals)} ta turli lidga · ${f.tests > 0 ? `+${formatNumber(f.tests)} sinov kirmaydi` : 'sinovlarsiz'}` : null}
          badge={null}
          status={status}
          onOpen={() => onDrill({ title: 'AI qoʻngʻiroqlari', kind: 'all' })}
        />
        <KpiCard
          label="Mijoz koʻtardi"
          value={f?.answered ?? null}
          sub={f ? 'qoʻngʻiroqlardan javob berganlari' : null}
          badge={f ? ratio(f.answered, f.calls) : null}
          color="var(--series-1)"
          status={status}
          onOpen={() => onDrill({ title: 'Mijoz koʻtargan qoʻngʻiroqlar', kind: 'answered' })}
        />
        <KpiCard
          label="Sotuvchiga ulandi"
          value={f ? transferred : null}
          sub={f ? 'koʻtarganlardan sotuvchiga ulanganlari' : null}
          badge={f ? ratio(transferred, f.answered) : null}
          color="var(--status-good)"
          lit
          status={status}
          onOpen={() => onDrill({ title: 'Sotuvchiga ulangan qoʻngʻiroqlar', kind: 'outcome', outcome: 'interested_transferred' })}
        />
        <KpiCard
          label="Buyurtma boʻldi"
          value={data?.ai.ordered ?? null}
          sub={data ? `ulangan ${formatNumber(data.ai.leads)} liddan · ${uzs(data.ai.orderSum)}` : null}
          badge={data ? pct(data.ai.orderedRateBp) : null}
          color="var(--status-warning)"
          status={status}
          onOpen={() => onDrill({ title: 'Buyurtma boʻlgan AI lidlari', kind: 'ordered' })}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <SmallFigure
          value={f ? formatNumber(failed) : '—'}
          title="Ulanmadi"
          sub="Mijoz qiziqdi, lekin hech bir sotuvchi telefonni olmadi"
          color={failed > 0 ? 'var(--status-warning)' : undefined}
          open="kimlar →"
          onOpen={() => onDrill({ title: 'Ulanmadi — qiziqdi, sotuvchi javob bermadi', kind: 'outcome', outcome: 'transfer_failed' })}
        />
        <SmallFigure
          value={f ? formatNumber(f.deals) : '—'}
          title="Xil lid"
          sub="Bitta bitim bir marta — har birining oxirgi qoʻngʻirogʻi"
          open="roʻyxat →"
          onOpen={() => onDrill({ title: 'Xil lidlar — har bitimning oxirgi qoʻngʻirogʻi', kind: 'unique' })}
        />
      </div>
    </section>
  )
}

/* ── Qoʻngʻiroqlar qanday tugadi ───────────────────────────────────────── */

function Outcomes({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  const entries = data ? Object.entries(data.funnel.byOutcome).sort((a, b) => b[1] - a[1]) : []
  const total = data?.funnel.calls ?? 0
  return (
    <Panel title="Qoʻngʻiroqlar qanday tugadi" lead="AI har suhbatdan keyin yozgan natija. Qatorni bosing — oʻsha qoʻngʻiroqlar raqamlari bilan chiqadi.">
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={4} />
      ) : entries.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Bu davrda AI qoʻngʻirogʻi yoʻq
        </p>
      ) : (
        <ul aria-label="Qoʻngʻiroqlar natijasi" className="flex flex-col gap-2.5">
          {entries.map(([outcome, n]) => {
            const label = OUTCOME_LABEL[outcome] ?? outcome
            const width = total > 0 ? Math.max(2, (n / total) * 100) : 0
            return (
              <li key={outcome}>
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => onDrill({ title: label, kind: 'outcome', outcome })}
                  className="focusable grid w-full cursor-pointer grid-cols-[minmax(9rem,1.2fr)_2fr_auto] items-center gap-3 rounded-[6px] text-left text-[13.5px] hover:opacity-90"
                >
                  <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {label}
                  </span>
                  <span aria-hidden className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${width}%`, background: OUTCOME_BAR[outcome] ?? 'var(--axis)' }} />
                  </span>
                  <span className="text-right font-extrabold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                    {share(n, total)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ── AI yoki oddiy registrator ──────────────────────────────────────────── */

const GROUP_ROWS: readonly { readonly label: string; readonly cell: (g: Group) => string; readonly better?: (g: Group) => number | null }[] = [
  { label: 'Lid', cell: (g) => formatNumber(g.leads) },
  { label: 'Sotuv bitimi ochildi', cell: (g) => share(g.withSalesDeal, g.leads) },
  { label: 'Buyurtma', cell: (g) => `${formatNumber(g.ordered)} · ${pct(g.orderedRateBp)}`, better: (g) => g.orderedRateBp },
  { label: 'Buyurtma summasi', cell: (g) => uzs(g.orderSum) },
  { label: 'Yetkazildi', cell: (g) => `${formatNumber(g.sold)} · ${pct(g.soldRateBp)}`, better: (g) => g.soldRateBp },
  { label: 'Yetkazilgan summa', cell: (g) => uzs(g.soldSum) },
  { label: '1 lidga tushum', cell: (g) => uzs(g.soldPerLead), better: (g) => g.soldPerLead?.amount ?? null },
  { label: 'Buyurtmagacha (mediana)', cell: (g) => hours(g.medianHoursToOrder) },
  { label: 'Yoʻqotildi / bitimsiz', cell: (g) => `${formatNumber(g.lost)} / ${formatNumber(g.noDeal)}` },
]

function Comparison({ data, status }: { readonly data: ReportDto | undefined; readonly status: Status }) {
  return (
    <Panel
      title="AI yoki oddiy registrator — kim yaxshi?"
      lead="Ikkalasi ham lid sotuvchiga oʻtgan paytdan sanaladi: AI — ulagan qoʻngʻiroq vaqti, registrator — «Сделка успешна» vaqti. Natija — bugungi holat."
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="flex flex-col gap-3">
          <VerdictBox data={data} />
          <div className="overflow-x-auto">
            <table aria-label="AI ulab berdi vs oddiy registrator" className="w-full min-w-[420px] overflow-hidden rounded-[var(--radius-panel-sm)] text-[13.5px] tabular-nums" style={{ border: '1px solid var(--border)' }}>
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
                    <span className="sr-only">Koʻrsatkich</span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-extrabold" style={{ background: 'color-mix(in oklab, var(--series-1) 14%, transparent)', color: inked('var(--series-1)') }}>
                    AI → sotuvchi
                  </th>
                  <th className="px-3 py-2.5 text-left font-extrabold" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}>
                    Registrator → mutaxassis
                  </th>
                </tr>
              </thead>
              <tbody>
                {GROUP_ROWS.map((r) => {
                  const a = r.better?.(data.ai) ?? null
                  const c = r.better?.(data.classic) ?? null
                  const aiWins = data.enoughToCompare && a !== null && c !== null && a > c
                  const classicWins = data.enoughToCompare && a !== null && c !== null && c > a
                  return (
                    <tr key={r.label} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                      <th scope="row" className="px-3 py-2 text-left font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        {r.label}
                      </th>
                      <td className="px-3 py-2 font-bold" style={{ background: 'color-mix(in oklab, var(--series-1) 5%, transparent)', color: aiWins ? inked('var(--status-good)') : 'var(--ink-primary)' }}>
                        {r.cell(data.ai)}
                      </td>
                      <td className="px-3 py-2 font-bold" style={{ color: classicWins ? inked('var(--status-good)') : 'var(--ink-primary)' }}>
                        {r.cell(data.classic)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** The comparison in one sentence — and, below the floor, that there is none yet. */
function VerdictBox({ data }: { readonly data: ReportDto }) {
  const { ai, classic } = data
  if (!data.enoughToCompare) {
    return (
      <Note color="var(--status-warning)">
        Xulosa uchun hali erta: AI tomonda {formatNumber(ai.leads)} ta lid bor, kamida {data.minLeads} ta kerak — bitta buyurtma foizni 5 punktdan koʻproq
        siljitadi. Davrni kengaytiring (masalan, «Shu hafta») yoki yana bir-ikki kun kuting.
      </Note>
    )
  }
  const a = ai.orderedRateBp
  const c = classic.orderedRateBp
  if (a === null || c === null) return null
  const times = c > 0 ? a / c : null
  const both = `${pct(a)} va ${pct(c)}`
  const enough = `Xulosaga yetarli: ${formatNumber(ai.leads)} ta lid (kamida ${data.minLeads} kerak).`
  if (a === c) return <Note color="var(--ink-muted)">Buyurtma foizi teng — {pct(a)}. {enough}</Note>
  const aiBetter = a > c
  const headline =
    times !== null && (times >= 1.5 || times <= 1 / 1.5)
      ? `${aiBetter ? 'AI lidlaridan' : 'Registrator lidlaridan'} buyurtma ${formatNumber(Math.round((aiBetter ? times : 1 / times) * 10) / 10)} barobar koʻp`
      : `${aiBetter ? 'AI ulashida' : 'Registrator yoʻlida'} buyurtma ${formatPercent(Math.abs(a - c) / 100)} punkt yuqori`
  return (
    <Note color={aiBetter ? 'var(--status-good)' : 'var(--status-warning)'}>
      <b style={{ color: inked(aiBetter ? 'var(--status-good)' : 'var(--status-warning)') }}>{headline}</b> — {both}. {enough} Yetkazilgan sotuv hali yoʻlda boʻlishi
      mumkin (Доставка bir necha kun oladi), shuning uchun yangi lidlar uchun «Buyurtma» — ertaroq koʻrsatkich.
    </Note>
  )
}

function Note({ color, children }: { readonly color: string; readonly children: ReactNode }) {
  return (
    <p
      className="rounded-[var(--radius-panel-sm)] border px-3.5 py-3 text-[13.5px] leading-5"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, background: `color-mix(in oklab, ${color} 9%, transparent)`, color: 'var(--ink-primary)' }}
    >
      {children}
    </p>
  )
}

/* ── Sotuvchilar boʻyicha ──────────────────────────────────────────────── */

function RateBar({ part, whole }: { readonly part: number; readonly whole: number }) {
  const value = whole > 0 ? (part / whole) * 100 : null
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
        <span className="block h-full rounded-full" style={{ width: `${value ?? 0}%`, background: 'var(--status-good)' }} />
      </span>
      <span className="w-10 text-right text-[12px] font-bold tabular-nums" style={{ color: value ? inked('var(--status-good)') : 'var(--ink-muted)' }}>
        {value === null ? '—' : `${Math.round(value)}%`}
      </span>
    </span>
  )
}

function Sellers({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  return (
    <Panel
      title="Sotuvchilar boʻyicha"
      lead="Har sotuvchiga AI qancha lid ulab berdi va xuddi shu davrda registratordan qancha keldi. AI lid sonini bosing — qaysi raqamlar."
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={4} />
      ) : data.sellers.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Bu davrda AI hech kimga ulamagan
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Sotuvchilar boʻyicha" className="w-full min-w-[680px] text-[13.5px] tabular-nums">
            <thead>
              <tr className="text-[11.5px] font-bold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
                <th className="px-2 py-2 text-left">Sotuvchi</th>
                <th className="px-2 py-2 text-right">AI lid</th>
                <th className="px-2 py-2 text-right">AI buyurtma</th>
                <th className="w-[22%] px-2 py-2 text-left">AI konversiya</th>
                <th className="px-2 py-2 text-right">AI yetkazildi</th>
                <th className="px-2 py-2 text-right">Registrator lid</th>
                <th className="px-2 py-2 text-right">Reg. buyurtma</th>
              </tr>
            </thead>
            <tbody>
              {data.sellers.map((s) => {
                const who = firstName(s.name, s.ext) ?? 'Aniqlanmagan'
                return (
                  <tr key={s.key} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                    <th scope="row" className="px-2 py-2.5 text-left font-bold" style={{ color: 'var(--ink-primary)' }} title={s.name ?? undefined}>
                      {who}
                      {s.ext ? <span className="font-medium" style={{ color: 'var(--ink-muted)' }}> {s.ext}</span> : null}
                    </th>
                    <td className="px-2 py-2.5 text-right">
                      {s.ai.leads > 0 ? (
                        <DrillLink title="AI shu sotuvchiga ulagan lidlarni ochish" onOpen={() => onDrill({ title: `AI ulab bergan lidlar · ${s.name ?? 'Aniqlanmagan'}${s.ext ? ` · ${s.ext}` : ''}`, kind: 'seller', seller: s.key })}>
                          {formatNumber(s.ai.leads)}
                        </DrillLink>
                      ) : (
                        formatNumber(s.ai.leads)
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">{formatNumber(s.ai.ordered)}</td>
                    <td className="px-2 py-2.5">
                      <RateBar part={s.ai.ordered} whole={s.ai.leads} />
                    </td>
                    <td className="px-2 py-2.5 text-right" title={formatUzs(s.ai.soldSum.amount)}>
                      {formatNumber(s.ai.sold)}
                    </td>
                    <td className="px-2 py-2.5 text-right">{formatNumber(s.classic.leads)}</td>
                    <td className="px-2 py-2.5 text-right">{share(s.classic.ordered, s.classic.leads)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ── Ulash urinishlari ─────────────────────────────────────────────────── */

const TRY_PARTS = [
  { key: 'answered', label: 'Oldi', color: 'var(--status-good)' },
  { key: 'busy', label: 'Band edi', color: 'var(--series-7)' },
  { key: 'rejected', label: 'Rad etdi', color: 'var(--status-critical)' },
  { key: 'noAnswer', label: 'Javob bermadi', color: 'var(--series-2)' },
  { key: 'failed', label: 'ATS ulamadi', color: 'var(--axis)' },
] as const

/** An extension that let the AI's call ring out this many times in the window is worth a look at its MicroSIP. */
const NO_ANSWER_ALERT = 3

function Extensions({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  const silent = (data?.extensions ?? []).filter((e) => e.noAnswer >= NO_ANSWER_ALERT && e.answered === 0)
  return (
    <Panel title="Ulash urinishlari" lead="AI sotuvchilarni navbat bilan chaqiradi: band yoki javob bermasa — keyingisiga oʻtadi. Sonini bosing — shu raqamga urinilgan qoʻngʻiroqlar.">
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={4} />
      ) : data.extensions.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Bu davrda ulash urinishi yoʻq
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul aria-label="Belgilar" className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
            {TRY_PARTS.map((p) => (
              <li key={p.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                {p.label}
              </li>
            ))}
          </ul>
          <ul aria-label="Ulash urinishlari" className="flex flex-col gap-2.5">
            {data.extensions.map((e) => {
              const who = firstName(e.name, e.ext)
              const title = TRY_PARTS.map((p) => `${p.label}: ${formatNumber(e[p.key])}`).join(' · ')
              return (
                <li key={e.ext} aria-label={`Ichki raqam ${e.ext}`} className="grid grid-cols-[minmax(7rem,9rem)_1fr_2.5rem] items-center gap-3 text-[13px]">
                  <span className="truncate font-semibold" style={{ color: 'var(--ink-primary)' }} title={e.name ?? undefined}>
                    {who ? `${who} ` : ''}
                    <span className="tabular-nums" style={{ color: who ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>
                      {e.ext}
                    </span>
                  </span>
                  <span role="img" aria-label={title} title={title} className="flex h-3 gap-0.5 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
                    {TRY_PARTS.map((p) => (e[p.key] > 0 ? <span key={p.key} style={{ flex: e[p.key], background: p.color }} /> : null))}
                  </span>
                  <span className="text-right tabular-nums">
                    <DrillLink title="Shu ichki raqamga urinilgan qoʻngʻiroqlarni ochish" onOpen={() => onDrill({ title: `Ichki raqam ${e.ext}${e.name ? ` · ${e.name}` : ''} — urinishlar`, kind: 'ext', ext: e.ext })}>
                      {formatNumber(e.tried)}
                    </DrillLink>
                  </span>
                </li>
              )
            })}
          </ul>
          {silent.length > 0 && (
            <p className="text-[12.5px] leading-5" style={{ color: inked('var(--status-warning)') }}>
              {silent.map((e) => `${firstName(e.name, e.ext) ?? e.ext} ${formatNumber(e.noAnswer)} marta javob bermadi`).join(', ')} — MicroSIP ochiq ekanini tekshiring.
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

/* ── Har bir lid — qayerga bordi ───────────────────────────────────────── */

type DealFilter = 'all' | 'transferred' | 'failed'
const DEAL_OPTIONS: readonly { readonly value: DealFilter; readonly label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'transferred', label: 'Ulanganlar' },
  { value: 'failed', label: 'Ulanmaganlar' },
]

function Deals({ data, status }: { readonly data: ReportDto | undefined; readonly status: Status }) {
  const [filter, setFilter] = useState<DealFilter>('all')
  const rows = useMemo(
    () => (data?.deals ?? []).filter((d) => (filter === 'all' ? true : filter === 'failed' ? d.verdict === 'not_transferred' : d.verdict !== 'not_transferred')),
    [data, filter],
  )
  return (
    <Panel
      title="Har bir lid — qayerga bordi"
      lead="AI ulagan (yoki ulay olmagan) har bir mijoz: kimga ulandi, Bitrix24da hozir qayerda va keyin qanday bitimlar ochildi."
      action={<SegmentedControl value={filter} options={DEAL_OPTIONS} onChange={setFilter} ariaLabel="Lidlar" />}
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="max-h-[70dvh] overflow-auto">
          <table aria-label="Lidlar — bitimma-bitim" className="w-full min-w-[1040px] text-[13.5px] tabular-nums">
            <thead className="sticky top-0 z-[1]" style={{ background: 'var(--surface-raised)' }}>
              <tr className="text-[11.5px] font-bold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
                <th className="px-2 py-2 text-left">Vaqt</th>
                <th className="px-2 py-2 text-left">Mijoz</th>
                <th className="px-2 py-2 text-left">Ulash</th>
                <th className="px-2 py-2 text-left">AI yozgani</th>
                <th className="px-2 py-2 text-left">Bitrix24da hozir</th>
                <th className="px-2 py-2 text-left">Keyingi bitimlar</th>
                <th className="px-2 py-2 text-left">Natija</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <td colSpan={7} className="px-2 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                    Bu tanlovda lid yoʻq
                  </td>
                </tr>
              ) : (
                rows.map((d) => <DealLine key={d.dealId} d={d} />)
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function StageChip({ pipeline, stage, href, extra }: { readonly pipeline: string | null; readonly stage: string | null; readonly href?: string; readonly extra?: string }) {
  const color = pipelineColor(pipeline)
  const text = [pipeline, stage].filter(Boolean).join(' · ') || '—'
  const style: CSSProperties = { background: `color-mix(in oklab, ${color} 15%, transparent)`, color: color === 'var(--ink-muted)' ? 'var(--ink-secondary)' : inked(color) }
  const className = 'inline-flex max-w-full items-center gap-1 rounded-[7px] px-2 py-0.5 text-[12px] font-bold'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`focusable ${className} underline-offset-2 hover:underline`} style={style}>
      <span className="truncate">{text}</span>
      {extra ? <span className="font-medium">· {extra}</span> : null}
    </a>
  ) : (
    <span className={className} style={style}>
      <span className="truncate">{text}</span>
    </span>
  )
}

function DealLine({ d }: { readonly d: DealRow }) {
  const verdict = VERDICT[d.verdict]
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--grid)' }}>
      <td className="px-2 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-secondary)' }}>
        {formatDateTime(d.at)}
      </td>
      <td className="px-2 py-2.5">
        <a href={bitrixDealUrl(d.dealId)} target="_blank" rel="noreferrer" className="font-bold underline-offset-2 hover:underline" style={{ color: 'var(--ink-primary)' }}>
          {d.title ?? `#${d.dealId}`}
        </a>
        <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {phoneText(d.phone)}
        </div>
      </td>
      <td className="px-2 py-2.5">
        {d.transferredTo ? (
          <div className="font-bold" style={{ color: inked('var(--status-good)') }}>
            → {d.transferredTo}
            {d.seller ? ` ${firstName(d.seller, d.transferredTo) ?? ''}` : ''}
          </div>
        ) : (
          <div className="font-bold" style={{ color: inked('var(--status-warning)') }}>
            Ulanmadi
          </div>
        )}
        {d.attempts.length > 0 && (
          <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {d.attempts.map((a) => `${a.ext} ${ATTEMPT_LABEL[a.result] ?? a.result}`).join(' → ')}
          </div>
        )}
        {d.soldBy ? (
          <div className="text-[12px]" style={{ color: inked('var(--status-warning)') }}>
            Bitim: {d.soldBy}
          </div>
        ) : null}
      </td>
      <td className="max-w-[260px] px-2 py-2.5" style={{ color: 'var(--ink-primary)' }}>
        {d.problem ? <div>{d.problem}</div> : null}
        {d.summary ? <div style={{ color: 'var(--ink-muted)' }}>{d.summary}</div> : null}
        {!d.problem && !d.summary ? '—' : null}
      </td>
      <td className="px-2 py-2.5">{d.lead ? <StageChip pipeline={d.lead.pipeline} stage={d.lead.stage} /> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}</td>
      <td className="px-2 py-2.5">
        {d.sales.length === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {d.sales.map((s) => (
              <StageChip
                key={s.dealId}
                pipeline={s.pipeline}
                stage={s.stage}
                href={bitrixDealUrl(s.dealId)}
                extra={s.amount.amount > 0 ? formatCompactUzs(s.amount.amount) : undefined}
              />
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-2.5 font-bold whitespace-nowrap" style={{ color: verdict.color ? inked(verdict.color) : 'var(--ink-secondary)' }}>
        {verdict.label}
      </td>
    </tr>
  )
}

/* ── Taʼriflar ─────────────────────────────────────────────────────────── */

function Definitions({ data }: { readonly data: ReportDto }) {
  const items: readonly { readonly title: string; readonly text: ReactNode }[] = [
    {
      title: 'AI → sotuvchi',
      text: 'AI qoʻngʻiroq qilib, mijozni jonli sotuvchiga ulagan Регистрация lidi; davrga ulagan qoʻngʻiroq vaqti boʻyicha kiradi. Bir lid bir marta sanaladi, sinov qoʻngʻiroqlari kirmaydi.',
    },
    {
      title: 'Registrator → mutaxassis',
      text: 'Oddiy registrator «Сделка успешна» qilgan («Регистрация» maydoni toʻldirilgan) va AI umuman qoʻngʻiroq qilmagan lid; davrga «Сделка успешна» vaqti boʻyicha kiradi.',
    },
    {
      title: 'Buyurtma va Yetkazildi',
      text: 'Buyurtma — Тасдиклаш yoki Доставка bitimi bor (summa Доставкадан, boʻlmasa Тасдиклашдан). Yetkazildi — Доставка yutildi, yaʼni haqiqiy pul tushdi.',
    },
    {
      title: 'Keyingi bitimlar',
      text: `Ulashdan ${data.slackMinutes} daqiqa oldin – ${data.followDays} kun keyin ochilgan Первичный отдел / Тасдиклаш / Доставка bitimlari. Bitta sotuv ikki lidga sanalmaydi.`,
    },
    {
      title: 'Sotuvchi',
      text: 'AI tomonda — ulangan ichki raqam egasi; registrator tomonda — buyurtmani yozgan sotuvchi, boʻlmasa birinchi sotuv bitimi egasi. «Bitim: …» — AI boshqasiga ulagan, bitimni boshqasi yozgan.',
    },
  ]
  return (
    <section aria-label="Taʼriflar" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
      {items.map((i) => (
        <Card key={i.title} className="p-4">
          <h3 className="mb-1.5 text-[13.5px] font-bold" style={{ color: 'var(--ink-primary)' }}>
            {i.title}
          </h3>
          <p className="text-[12.5px] leading-5" style={{ color: 'var(--ink-secondary)' }}>
            {i.text}
          </p>
        </Card>
      ))}
    </section>
  )
}
