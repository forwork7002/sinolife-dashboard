'use client'

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { Button } from '@/components/ui/Button'
import { StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { ApiClientError, apiGet } from '@/lib/api'
import { useServerViewer } from '@/lib/viewer'
import { formatCompactUzs, formatDateShort, formatDateTime, formatNumber, formatPercent, formatUzs } from '@/lib/format'

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

const pct = (bp: number | null) => formatPercent(bp === null ? null : bp / 100)
const share = (part: number, whole: number) => (whole === 0 ? formatNumber(part) : `${formatNumber(part)} (${formatPercent((part / whole) * 100, 0)})`)
const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${formatNumber(Math.round(h))} soat` : `${formatNumber(Math.round(h / 24))} kun`)
const uzs = (m: Money | null) => (m === null ? '—' : formatCompactUzs(m.amount))

/**
 * «AI registrator» (the owner, 2026-10-22: «AI registrator kimga ulab berdi,
 * sotuvchi qaysi sdelkalarga oʻtkazdi … AI ulab berishi yaxshimi yoki
 * mutaxassisga ulagani yaxshimi»): the voice agent's calls in the window, the
 * leads it put through to a seller followed to their sales, and the same
 * window's human-registrar leads beside them. Every definition is
 * `domain/aiRegistrator/aiRegistrator.ts`.
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
      description="AI registrator (ovozli agent) qoʻngʻiroqlari, u sotuvchiga ulab bergan lidlar va ular Bitrix24da qayerga borgani — xuddi shu davrdagi oddiy registrator lidlari bilan yonma-yon. Vaqt — Toshkent."
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
      <div className="flex flex-col gap-6">
        {status === 'error' ? (
          <ErrorState
            message={report.error instanceof ApiClientError ? report.error.message : undefined}
            onRetry={() => void report.refetch()}
          />
        ) : (
          <>
            <Funnel data={data} status={status} onDrill={setDrill} />
            <Comparison data={data} status={status} />
            <Sellers data={data} status={status} onDrill={setDrill} />
            <Extensions data={data} status={status} onDrill={setDrill} />
            <Deals data={data} status={status} />
            {data && <Definitions data={data} />}
          </>
        )}
      </div>
      {drill && <AiCallsDrawer drill={drill} windowParams={windowParams} windowText={windowText} onClose={() => setDrill(null)} />}
    </PageShell>
  )
}

/** «22.10 – 23.10»; the end is exclusive, so the last day named is the one before it. */
function spanText(start: string, end: string): string {
  const first = formatDateShort(start)
  const last = formatDateShort(new Date(new Date(end).getTime() - 1).toISOString())
  return first === last ? first : `${first} – ${last}`
}

/**
 * A number that opens the calls behind it. A real button around the tile — a
 * keyboard reaches it — lifting a little under the pointer, with «roʻyxat →»
 * under the figure so it reads as something to press.
 */
function DrillTile({ label, onOpen, children }: { readonly label: string; readonly onOpen: () => void; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label} — qoʻngʻiroqlar roʻyxatini ochish`}
      className="focusable group block h-full w-full cursor-pointer rounded-[var(--radius-panel)] text-left transition-transform duration-150 hover:-translate-y-0.5 [&>div]:h-full [&>div]:transition-shadow hover:[&>div]:shadow-[0_0_0_1px_var(--accent-line)]"
    >
      {children}
    </button>
  )
}

const OPEN_CUE = (
  <span className="text-[11px] font-medium opacity-70 transition-opacity group-hover:opacity-100" style={{ color: 'var(--accent-ink)' }}>
    roʻyxat →
  </span>
)

/** A figure in a table that opens the calls behind it — underlined on hover, a button to the keyboard. */
function DrillLink({ onOpen, title, children }: { readonly onOpen: () => void; readonly title: string; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="focusable cursor-pointer rounded-[4px] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent-ink)] hover:decoration-solid"
    >
      {children}
    </button>
  )
}

function Funnel({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  const f = data?.funnel
  const transferred = f?.byOutcome.interested_transferred ?? 0
  const failed = f?.byOutcome.transfer_failed ?? 0
  return (
    <section className="flex flex-col gap-3" aria-label="AI qoʻngʻiroqlari">
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <DrillTile label="AI qoʻngʻiroqlari" onOpen={() => onDrill({ title: 'AI qoʻngʻiroqlari', kind: 'all' })}>
          <StatTile status={status} label="AI qoʻngʻiroqlari" value={f?.calls ?? null} unit="count" hint={f && f.tests > 0 ? `+${f.tests} sinov qoʻngʻirogʻi hisobga kirmaydi` : 'sinov qoʻngʻiroqlarisiz'} context={OPEN_CUE} />
        </DrillTile>
        <DrillTile label="Xil lid" onOpen={() => onDrill({ title: 'Xil lidlar — har bitimning oxirgi qoʻngʻirogʻi', kind: 'unique' })}>
          <StatTile status={status} label="Xil lid" value={f?.deals ?? null} unit="count" hint="bir bitim bir marta" context={OPEN_CUE} />
        </DrillTile>
        <DrillTile label="Mijoz koʻtardi" onOpen={() => onDrill({ title: 'Mijoz koʻtargan qoʻngʻiroqlar', kind: 'answered' })}>
          <StatTile status={status} label="Mijoz koʻtardi" value={f?.answered ?? null} unit="count" context={OPEN_CUE} />
        </DrillTile>
        <DrillTile label="Sotuvchiga ulandi" onOpen={() => onDrill({ title: 'Sotuvchiga ulangan qoʻngʻiroqlar', kind: 'outcome', outcome: 'interested_transferred' })}>
          <StatTile status={status} label="Sotuvchiga ulandi" value={f ? transferred : null} unit="count" tone="good" hint="qoʻngʻiroq soni" context={OPEN_CUE} />
        </DrillTile>
        <DrillTile label="Ulanmadi" onOpen={() => onDrill({ title: 'Ulanmadi — qiziqdi, sotuvchi javob bermadi', kind: 'outcome', outcome: 'transfer_failed' })}>
          <StatTile status={status} label="Ulanmadi" value={f ? failed : null} unit="count" tone={failed > 0 ? 'critical' : 'neutral'} hint="qiziqdi, lekin sotuvchilar javob bermadi" context={OPEN_CUE} />
        </DrillTile>
        <DrillTile label="Buyurtma (AI lidlari)" onOpen={() => onDrill({ title: 'Buyurtma boʻlgan AI lidlari', kind: 'ordered' })}>
          <StatTile status={status} label="Buyurtma (AI lidlari)" value={data?.ai.ordered ?? null} unit="count" hint={data ? `${data.ai.leads} ta ulangan liddan` : undefined} context={OPEN_CUE} />
        </DrillTile>
      </div>
      <ChartCard title="Qoʻngʻiroqlar natijasi" hint="Davrdagi har bir AI qoʻngʻirogʻi, agent yozgan natija boʻyicha · qatorni bosing — oʻsha qoʻngʻiroqlar raqamlari bilan">
        {status === 'loading' || !data ? (
          <LoadingSkeleton rows={3} />
        ) : Object.keys(data.funnel.byOutcome).length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Bu davrda AI qoʻngʻirogʻi yoʻq
          </p>
        ) : (
          <table aria-label="Qoʻngʻiroqlar natijasi" className="w-full max-w-xl text-xs tabular-nums">
            <tbody>
              {Object.entries(data.funnel.byOutcome)
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, n]) => (
                  <tr key={outcome} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                    <th scope="row" className="py-1 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                      <DrillLink
                        title="Shu natijali qoʻngʻiroqlarni ochish"
                        onOpen={() => onDrill({ title: OUTCOME_LABEL[outcome] ?? outcome, kind: 'outcome', outcome })}
                      >
                        {OUTCOME_LABEL[outcome] ?? outcome}
                      </DrillLink>
                    </th>
                    <td className="py-1 text-right">{share(n, data.funnel.calls)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </ChartCard>
    </section>
  )
}

const GROUP_COLUMNS: readonly { readonly label: string; readonly cell: (g: Group) => string; readonly strong?: boolean }[] = [
  { label: 'Lid', cell: (g) => formatNumber(g.leads), strong: true },
  { label: 'Sotuv bitimi ochildi', cell: (g) => share(g.withSalesDeal, g.leads) },
  { label: 'Buyurtma', cell: (g) => formatNumber(g.ordered) },
  { label: 'Buyurtma %', cell: (g) => pct(g.orderedRateBp), strong: true },
  { label: 'Buyurtma summasi', cell: (g) => uzs(g.orderSum) },
  { label: 'Yetkazildi', cell: (g) => formatNumber(g.sold) },
  { label: 'Yetkazildi %', cell: (g) => pct(g.soldRateBp), strong: true },
  { label: 'Yetkazilgan summa', cell: (g) => uzs(g.soldSum) },
  { label: '1 lidga tushum', cell: (g) => uzs(g.soldPerLead) },
  { label: 'Buyurtmagacha (mediana)', cell: (g) => hours(g.medianHoursToOrder) },
  { label: 'Yoʻqotildi / bitimsiz', cell: (g) => `${formatNumber(g.lost)} / ${formatNumber(g.noDeal)}` },
]

function Comparison({ data, status }: { readonly data: ReportDto | undefined; readonly status: Status }) {
  return (
    <ChartCard
      title="AI ulab berdi vs oddiy registrator"
      hint="Ikkala guruh ham sotuvchiga oʻtgan paytidan sanaladi: AI — ulagan qoʻngʻiroq vaqti, registrator — «Сделка успешна» vaqti · natija — bugungi holat"
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="flex flex-col gap-3">
          <VerdictLine data={data} />
          <div className="overflow-x-auto">
            <table aria-label="AI ulab berdi vs oddiy registrator" className="w-full min-w-[900px] text-xs tabular-nums">
              <thead>
                <tr style={{ color: 'var(--ink-muted)' }}>
                  <th className="py-1 pr-3 text-left font-medium">Yoʻl</th>
                  {GROUP_COLUMNS.map((c) => (
                    <th key={c.label} className="py-1 pr-3 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['AI → sotuvchi (jonli ulash)', data.ai],
                    ['Registrator → mutaxassis', data.classic],
                  ] as const
                ).map(([label, g]) => (
                  <tr key={label} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--ink-primary)' }}>
                      {label}
                    </th>
                    {GROUP_COLUMNS.map((c) => (
                      <td key={c.label} className={`py-1.5 pr-3 text-right ${c.strong ? 'font-semibold' : ''}`}>
                        {c.cell(g)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ChartCard>
  )
}

/** The comparison in one sentence — and, below the floor, that there is none yet. */
function VerdictLine({ data }: { readonly data: ReportDto }) {
  const { ai, classic } = data
  if (!data.enoughToCompare) {
    return (
      <p className="text-xs leading-5" style={{ color: 'var(--status-warning)' }}>
        Xulosa uchun hali erta: AI tomonda {formatNumber(ai.leads)} ta lid bor, kamida {data.minLeads} ta kerak — bitta buyurtma foizni 5 punktdan koʻproq
        siljitadi. Davrni kengaytiring (masalan, «Shu hafta») yoki yana bir-ikki kun kuting.
      </p>
    )
  }
  const a = ai.orderedRateBp
  const c = classic.orderedRateBp
  if (a === null || c === null) return null
  const diff = (a - c) / 100
  const better = diff > 0 ? 'AI ulashida' : diff < 0 ? 'oddiy registrator yoʻlida' : null
  return (
    <p className="text-xs leading-5" style={{ color: 'var(--ink-secondary)' }}>
      Buyurtma foizi: AI → sotuvchi {pct(a)}, registrator → mutaxassis {pct(c)}
      {better ? ` — ${better} ${formatPercent(Math.abs(diff))} punkt yuqori` : ' — teng'}. Yetkazilgan sotuv hali yoʻlda boʻlishi mumkin (Доставка bir
      necha kun oladi), shuning uchun yangi lidlar uchun «Buyurtma %» — ertaroq koʻrsatkich.
    </p>
  )
}

function Sellers({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  return (
    <ChartCard
      title="Sotuvchilar boʻyicha"
      hint="Har bir sotuvchi: AI unga ulab bergan lidlar va xuddi shu davrda unga oddiy registrator orqali kelgan lidlar · sotuvchi ichki raqami boʻyicha aniqlanadi · AI «lid» sonini bosing — qaysi raqamlar ulangan"
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={3} />
      ) : data.sellers.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Bu davrda AI hech kimga ulamagan
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Sotuvchilar boʻyicha" className="w-full min-w-[860px] text-xs tabular-nums">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th rowSpan={2} className="py-1 pr-3 text-left font-medium">Sotuvchi</th>
                <th colSpan={4} className="py-1 pr-3 text-center font-medium">AI ulab bergan</th>
                <th colSpan={4} className="py-1 text-center font-medium">Registrator orqali</th>
              </tr>
              <tr style={{ color: 'var(--ink-muted)' }}>
                {['lid', 'buyurtma', 'yetkazildi', 'summa', 'lid', 'buyurtma', 'yetkazildi', 'summa'].map((h, i) => (
                  <th key={`${h}${i}`} className="py-1 pr-3 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.sellers.map((s) => (
                <tr key={s.key} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                    {s.name ?? 'Aniqlanmagan'}
                    {s.ext ? <span style={{ color: 'var(--ink-muted)' }}> · {s.ext}</span> : null}
                  </th>
                  <td className="py-1.5 pr-3 text-right font-semibold">
                    {s.ai.leads > 0 ? (
                      <DrillLink
                        title="AI shu sotuvchiga ulagan lidlarni ochish"
                        onOpen={() => onDrill({ title: `AI ulab bergan lidlar · ${s.name ?? 'Aniqlanmagan'}${s.ext ? ` · ${s.ext}` : ''}`, kind: 'seller', seller: s.key })}
                      >
                        {formatNumber(s.ai.leads)}
                      </DrillLink>
                    ) : (
                      formatNumber(s.ai.leads)
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{share(s.ai.ordered, s.ai.leads)}</td>
                  <td className="py-1.5 pr-3 text-right">{share(s.ai.sold, s.ai.leads)}</td>
                  <td className="py-1.5 pr-3 text-right">{uzs(s.ai.soldSum)}</td>
                  <td className="py-1.5 pr-3 text-right font-semibold">{formatNumber(s.classic.leads)}</td>
                  <td className="py-1.5 pr-3 text-right">{share(s.classic.ordered, s.classic.leads)}</td>
                  <td className="py-1.5 pr-3 text-right">{share(s.classic.sold, s.classic.leads)}</td>
                  <td className="py-1.5 text-right">{uzs(s.classic.soldSum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  )
}

function Extensions({ data, status, onDrill }: { readonly data: ReportDto | undefined; readonly status: Status; readonly onDrill: (drill: AiDrill) => void }) {
  return (
    <ChartCard title="Ulash urinishlari" hint="AI navbat bilan teradi: band yoki javob bermasa — keyingi raqamga oʻtadi · har bir urinish alohida · sonini bosing — shu raqamga urinilgan qoʻngʻiroqlar">
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={3} />
      ) : data.extensions.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Bu davrda ulash urinishi yoʻq
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Ulash urinishlari" className="w-full min-w-[600px] text-xs tabular-nums">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className="py-1 pr-3 text-left font-medium">Ichki raqam</th>
                <th className="py-1 pr-3 text-right font-medium">Urinish</th>
                <th className="py-1 pr-3 text-right font-medium">Koʻtardi</th>
                <th className="py-1 pr-3 text-right font-medium" title="Boshqa odam bilan gaplashayotgan edi">
                  Band
                </th>
                <th className="py-1 pr-3 text-right font-medium" title="Jiringladi, qizil tugmani bosib rad etdi">
                  Rad etdi
                </th>
                <th className="py-1 pr-3 text-right font-medium" title="Jiringladi, koʻtarmadi">
                  Koʻtarmadi
                </th>
                <th className="py-1 text-right font-medium" title="Telefon stansiyasi (ATS) ulamadi">
                  ATS
                </th>
              </tr>
            </thead>
            <tbody>
              {data.extensions.map((e) => (
                <tr key={e.ext} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                    {e.ext}
                    {e.name ? <span style={{ color: 'var(--ink-muted)' }}> · {e.name}</span> : null}
                  </th>
                  <td className="py-1.5 pr-3 text-right font-semibold">
                    <DrillLink
                      title="Shu ichki raqamga urinilgan qoʻngʻiroqlarni ochish"
                      onOpen={() => onDrill({ title: `Ichki raqam ${e.ext}${e.name ? ` · ${e.name}` : ''} — urinishlar`, kind: 'ext', ext: e.ext })}
                    >
                      {formatNumber(e.tried)}
                    </DrillLink>
                  </td>
                  <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--status-good)' }}>
                    {share(e.answered, e.tried)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{share(e.busy, e.tried)}</td>
                  <td className="py-1.5 pr-3 text-right" style={e.rejected > 0 ? { color: 'var(--status-critical)' } : undefined}>
                    {share(e.rejected, e.tried)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{share(e.noAnswer, e.tried)}</td>
                  <td className="py-1.5 text-right">{formatNumber(e.failed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  )
}

type DealFilter = 'all' | 'transferred' | 'failed'
const DEAL_OPTIONS: readonly { readonly value: DealFilter; readonly label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'transferred', label: 'Ulanganlar' },
  { value: 'failed', label: 'Ulanmaganlar' },
]

function Deals({ data, status }: { readonly data: ReportDto | undefined; readonly status: Status }) {
  const [filter, setFilter] = useState<DealFilter>('all')
  const rows = useMemo(
    () =>
      (data?.deals ?? []).filter((d) =>
        filter === 'all' ? true : filter === 'failed' ? d.verdict === 'not_transferred' : d.verdict !== 'not_transferred',
      ),
    [data, filter],
  )
  return (
    <ChartCard
      title="Lidlar — bitimma-bitim"
      hint="AI ulagan (yoki ulay olmagan) har bir lid: kimga ulandi, Bitrix24da hozir qayerda va undan keyin ochilgan har bir bitim"
      action={<SegmentedControl value={filter} options={DEAL_OPTIONS} onChange={setFilter} ariaLabel="Lidlar" />}
    >
      {status === 'loading' || !data ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="max-h-[70dvh] overflow-auto">
          <table aria-label="Lidlar — bitimma-bitim" className="w-full min-w-[1100px] text-xs tabular-nums">
            <thead className="sticky top-0" style={{ background: 'var(--surface-raised)' }}>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className="py-1 pr-3 text-left font-medium">Vaqt</th>
                <th className="py-1 pr-3 text-left font-medium">Lid</th>
                <th className="py-1 pr-3 text-left font-medium">Ulash</th>
                <th className="py-1 pr-3 text-left font-medium">AI yozgani</th>
                <th className="py-1 pr-3 text-left font-medium">Lid hozir</th>
                <th className="py-1 pr-3 text-left font-medium">Keyingi bitimlar</th>
                <th className="py-1 text-left font-medium">Natija</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <td colSpan={7} className="py-1.5" style={{ color: 'var(--ink-muted)' }}>
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
    </ChartCard>
  )
}

function DealLine({ d }: { readonly d: DealRow }) {
  const verdict = VERDICT[d.verdict]
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--grid)' }}>
      <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(d.at)}</td>
      <td className="py-1.5 pr-3">
        <a href={bitrixDealUrl(d.dealId)} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2" style={{ color: 'var(--ink-primary)' }}>
          {d.title ?? `#${d.dealId}`}
        </a>
        <div className="tabular" style={{ color: 'var(--ink-muted)' }}>{phoneText(d.phone)}</div>
      </td>
      <td className="py-1.5 pr-3">
        {d.transferredTo ? (
          <div className="font-medium" style={{ color: 'var(--ink-primary)' }}>
            {d.transferredTo}
            {d.seller ? ` · ${d.seller}` : ''}
          </div>
        ) : null}
        {d.attempts.length > 0 && (
          <div style={{ color: 'var(--ink-muted)' }}>{d.attempts.map((a) => `${a.ext} ${ATTEMPT_LABEL[a.result] ?? a.result}`).join(' → ')}</div>
        )}
        {d.soldBy ? <div style={{ color: 'var(--status-warning)' }}>Bitim: {d.soldBy}</div> : null}
      </td>
      <td className="max-w-[260px] py-1.5 pr-3">
        {d.problem ? <div>{d.problem}</div> : null}
        {d.summary ? <div style={{ color: 'var(--ink-muted)' }}>{d.summary}</div> : null}
        {!d.problem && !d.summary ? '—' : null}
      </td>
      <td className="py-1.5 pr-3">{d.lead ? [d.lead.pipeline, d.lead.stage].filter(Boolean).join(' · ') || '—' : '—'}</td>
      <td className="py-1.5 pr-3">
        {d.sales.length === 0
          ? '—'
          : d.sales.map((s) => (
              <div key={s.dealId}>
                <a href={bitrixDealUrl(s.dealId)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {[s.pipeline, s.stage].filter(Boolean).join(' · ') || `#${s.dealId}`}
                </a>
                {s.amount.amount > 0 ? <span title={formatUzs(s.amount.amount)}> · {formatCompactUzs(s.amount.amount)}</span> : null}
              </div>
            ))}
      </td>
      <td className="py-1.5 font-semibold whitespace-nowrap" style={{ color: verdict.color }}>
        {verdict.label}
      </td>
    </tr>
  )
}

function Definitions({ data }: { readonly data: ReportDto }) {
  return (
    <section aria-label="Taʼriflar" className="flex flex-col gap-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>
      <p>
        <b>AI → sotuvchi</b> — AI qoʻngʻiroq qilib, mijozni jonli sotuvchiga ulagan Регистрация lidi; davrga ulagan qoʻngʻiroq vaqti boʻyicha kiradi (bir
        lid — bir marta). Sinov qoʻngʻiroqlari kirmaydi.
      </p>
      <p>
        <b>Registrator → mutaxassis</b> — davrda oddiy registrator «Сделка успешна» qilgan («Регистрация» maydoni toʻldirilgan) va AI umuman qoʻngʻiroq
        qilmagan Регистрация lidi; davrga «Сделка успешна» vaqti boʻyicha kiradi.
      </p>
      <p>
        <b>Keyingi bitimlar</b> — shu kontaktning Первичный отдел / Тасдиклаш / Доставка bitimlari: sotuvchiga oʻtgandan {data.slackMinutes} daqiqa oldindan{' '}
        {data.followDays} kungacha ochilgani. Bitim kontaktning oʻzidan oldingi eng soʻnggi lidiga yoziladi — bitta sotuv ikki lidga sanalmaydi.
      </p>
      <p>
        <b>Buyurtma</b> — Тасдиклаш yoki Доставка bitimi bor. <b>Yetkazildi</b> — Доставка bitimi «yutildi» (haqiqiy tushum). Summa — bitim summasi; buyurtma
        summasi Доставка boʻlsa undan, boʻlmasa Тасдиклашdan olinadi. Natija — bugungi holat: yangi lidlar hali yoʻlda.
      </p>
      <p>
        <b>Sotuvchi</b> — AI tomonda ulangan ichki raqam (115, 112, 114 …) sotuvchi ismidagi raqam boʻyicha; registrator tomonda buyurtmani yozgan sotuvchi,
        buyurtma boʻlmasa birinchi sotuv bitimining egasi. «Bitim: …» — AI boshqa sotuvchiga ulagan, lekin bitimni boshqasi yozgan.
      </p>
    </section>
  )
}
