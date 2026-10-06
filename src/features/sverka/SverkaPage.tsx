'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Card, ChartCard } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { apiGet } from '@/lib/api'
import { formatDateTime, formatFullUzs, formatNumber, formatPercent, NO_VALUE } from '@/lib/format'
import { t } from '@/lib/messages'

import {
  ISSUE_TEXT,
  PHASE_LABEL,
  SVERKA_ISSUES,
  type SverkaIssue,
  type SverkaItemDto,
  type SverkaLineDto,
  type SverkaOverviewDto,
  type SverkaPairDto,
  type SverkaProductDto,
  type SverkaTeamDto,
  moyskladOrderUrl,
} from './sverkaApi'

type Status = 'loading' | 'error' | 'ready'

/**
 * «Sverka» — Bitrix24 against MoySklad, deal by deal (2026-10-06).
 *
 * ONE REQUEST. The tiles, the difference list, the products and the teams are
 * all built from the one `/sverka/overview` answer, so they cannot disagree.
 *
 * THE WINDOW SENDS ONLY ITSELF — the endpoint honours no employee, stage or
 * source filter, the reason CallsPage gives for the same choice.
 */
export function SverkaPage() {
  const { apiParams } = useDashboardFilters()

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const query = useQuery({
    queryKey: ['sverka-overview', windowParams],
    queryFn: ({ signal }) => apiGet<SverkaOverviewDto>('/sverka/overview', windowParams, signal),
  })

  const status: Status = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'

  return (
    <PageShell
      title={t.modules.sverka.title}
      description={t.modules.sverka.lead}
      accent="var(--series-2)"
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
    >
      <SverkaBody
        data={query.data?.data}
        status={status}
        errorMessage={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    </PageShell>
  )
}

/** The screen's body, separate from the query so it renders from a fixture. */
export function SverkaBody({
  data,
  status,
  errorMessage,
  onRetry,
}: {
  data: SverkaOverviewDto | undefined
  status: Status
  errorMessage?: string
  onRetry?: () => void
}) {
  const [issue, setIssue] = useState<SverkaIssue | 'ALL'>('ALL')
  const [openDeal, setOpenDeal] = useState<string | null>(null)

  if (status === 'error') {
    return (
      <Card className="p-5">
        <ErrorState message={errorMessage} onRetry={onRetry} />
      </Card>
    )
  }

  if (status === 'ready' && data && data.moysklad.orders === 0) {
    return (
      <Card className="p-5">
        <EmptyState
          title="MoySklad maʼlumoti hali yuklanmagan"
          body="Sinxronizatsiya MoySklad buyurtmalarini birinchi marta oʻqiyapti (bir necha daqiqa). Token sozlanmagan boʻlsa — administratorga MOYSKLAD_TOKEN ni qoʻyish kerak."
        />
      </Card>
    )
  }

  const totals = data?.totals
  const fakt1Orders = totals?.fakt1.bitrix.orders ?? 0
  const lines = data?.lines ?? []
  const visible = issue === 'ALL' ? lines : lines.filter((l) => l.issues.includes(issue))
  const flaggedTotal = data?.flaggedCount ?? 0
  const opened = openDeal ? lines.find((l) => lineKey(l) === openDeal) : undefined

  return (
    <div className="flex flex-col gap-4">
      <FreshLine data={data} />

      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <PairTile
          status={status}
          label="FAKT 1 — buyurtmalar"
          pair={totals?.fakt1}
          hint="Tasdiqlangan buyurtmalar va ularning MoySklad buyurtmasi"
          pending={totals?.pending}
        />
        <PairTile
          status={status}
          label="FAKT 2 — yetkazilgan"
          pair={totals?.fakt2}
          hint="Bitrix24 «Доставлено» · MoySklad «Успешно» + «Касса»"
        />
        <PairTile status={status} label="Yoʻlda" pair={totals?.transit} hint="Yoʻlda va pochtada · MoySklad «В пути»" />
        <PairTile
          status={status}
          label="Qaytgan / rad"
          pair={totals?.returned}
          hint="Bitrix24 «Возврат»/«Отказ» · MoySklad shu holatlar"
        />
        <MatchTile
          status={status}
          clean={totals?.clean ?? 0}
          fakt1={fakt1Orders}
          pending={totals?.pending.orders ?? 0}
          flagged={flaggedTotal}
        />
      </div>

      <ChartCard
        title="Farqlar"
        hint="Har bir qator — bitta bitim. Qatorni bossangiz ikki tizimdagi maʼlumot yonma-yon ochiladi."
      >
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Farq turi boʻyicha filtr">
          <IssueChip active={issue === 'ALL'} onClick={() => setIssue('ALL')} label="Hammasi" count={flaggedTotal} />
          {SVERKA_ISSUES.map((i) => (
            <IssueChip
              key={i}
              active={issue === i}
              onClick={() => setIssue(i)}
              label={ISSUE_TEXT[i].label}
              count={data?.issueCounts[i] ?? 0}
              tone={ISSUE_TEXT[i].tone}
              title={ISSUE_TEXT[i].hint}
            />
          ))}
        </div>
        {issue !== 'ALL' && (
          <p className="mb-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ISSUE_TEXT[issue].hint}
          </p>
        )}
        <DataTable
          columns={LINE_COLUMNS}
          rows={visible}
          rowKey={lineKey}
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
          onRowClick={(row) => setOpenDeal((current) => (current === lineKey(row) ? null : lineKey(row)))}
          emptyTitle="Farq topilmadi"
          emptyBody="Bu davrda ikki tizim bir xil koʻrsatyapti."
          minWidth={1080}
          initialRows={200}
          maxHeight="60dvh"
        />
        {data?.linesTruncated && (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            Faqat birinchi {formatNumber(lines.length)} ta qator koʻrsatildi — davrni qisqartiring.
          </p>
        )}
        {data && data.otherWindowOrders > 0 && (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            Shu davrda MoySkladʼda ochilgan yana {formatNumber(data.otherWindowOrders)} ta buyurtmaning bitimi boshqa
            kunda Tasdiqlashga tushgan — ular oʻz kunida solishtiriladi, bu farq emas.
          </p>
        )}
      </ChartCard>

      {opened && <LineDetail line={opened} onClose={() => setOpenDeal(null)} />}

      <div className="grid gap-4 2xl:grid-cols-2">
        <ChartCard
          title="Mahsulotlar — Bitrix24 va MoySklad"
          hint="FAKT 1 buyurtmalaridagi mahsulotlar. Kod boʻyicha: Bitrix24 XML_ID = MoySklad kodi; variant (masalan «kakao») oʻz mahsulotiga qoʻshiladi."
        >
          <DataTable
            columns={PRODUCT_COLUMNS}
            rows={data?.products ?? []}
            rowKey={(r) => r.key}
            status={status}
            errorMessage={errorMessage}
            onRetry={onRetry}
            emptyTitle="Mahsulot yoʻq"
            emptyBody="Bu davrda FAKT 1 buyurtmasi yoʻq."
            minWidth={640}
          />
        </ChartCard>
        <ChartCard
          title="ROP jamoalari — FAKT 1 va MoySklad"
          hint="Jamoa — bitimdagi «Организация сотрудника», FAKT 1 dagidek."
        >
          <DataTable
            columns={TEAM_COLUMNS}
            rows={data?.teams ?? []}
            rowKey={(r) => r.team}
            status={status}
            errorMessage={errorMessage}
            onRetry={onRetry}
            emptyTitle="Jamoa yoʻq"
            emptyBody="Bu davrda FAKT 1 buyurtmasi yoʻq."
            minWidth={640}
          />
        </ChartCard>
      </div>
    </div>
  )
}

const lineKey = (l: SverkaLineDto): string => l.dealId ?? `ms:${l.moysklad?.orderId ?? ''}`

function FreshLine({ data }: { data: SverkaOverviewDto | undefined }) {
  if (!data) return <div className="h-4" />
  const { lastSuccessAt, lastError } = data.moysklad
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        MoySklad: {formatNumber(data.moysklad.orders)} ta buyurtma
        {lastSuccessAt ? ` · oxirgi tekshiruv ${formatDateTime(lastSuccessAt)}` : ''} · davrda Tasdiqlashga tushgan{' '}
        {formatNumber(data.totals.cohortOrders)} ta bitim solishtirildi.
      </p>
      {/* A revoked token or a MoySklad outage leaves the figures standing; say they are stale. */}
      {lastError && (
        <p className="text-xs font-medium" role="status" style={{ color: 'var(--status-critical)' }}>
          MoySklad {formatDateTime(lastError.at)} dan beri oʻqilmayapti — raqamlar eskirgan boʻlishi mumkin ({lastError.message})
        </p>
      )}
    </div>
  )
}

/** One figure, two systems, and the gap — the whole screen in one card. */
function PairTile({
  status,
  label,
  pair,
  hint,
  pending,
}: {
  status: Status
  label: string
  pair: SverkaPairDto | undefined
  hint: string
  /**
   * FAKT 1 only: orders still being packed, which have no MoySklad order YET.
   * A gap made of exactly those is waiting, not wrong — amber, not red.
   */
  pending?: { readonly orders: number; readonly amount: number }
}) {
  if (status === 'loading' || !pair) {
    return (
      <Card className="p-4">
        <LoadingSkeleton rows={3} />
      </Card>
    )
  }
  const diffAmount = pair.moysklad.amount - pair.bitrix.amount
  const diffOrders = pair.moysklad.orders - pair.bitrix.orders
  const equal = Math.abs(diffAmount) < 1 && diffOrders === 0
  const waiting =
    !equal && pending !== undefined && pending.orders > 0 &&
    diffOrders === -pending.orders && Math.abs(diffAmount + pending.amount) < 1
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div>
        <h3 className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
          {label}
        </h3>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      </div>
      <SideRow name="Bitrix24" orders={pair.bitrix.orders} amount={pair.bitrix.amount} />
      <SideRow name="MoySklad" orders={pair.moysklad.orders} amount={pair.moysklad.amount} />
      <div
        className="mt-auto flex items-baseline justify-between gap-2 border-t pt-2 text-xs font-medium tabular-nums"
        style={{
          borderColor: 'var(--grid)',
          color: equal ? 'var(--status-good)' : waiting ? 'var(--status-warning)' : 'var(--status-critical)',
        }}
      >
        <span>{equal ? '✓ mos' : waiting ? 'Omborga tayyorlanmoqda' : 'Farq'}</span>
        {!equal && (
          <span className="text-right">
            {signed(diffOrders)} ta · {signedUzs(diffAmount)}
          </span>
        )}
      </div>
      {!equal && !waiting && pending !== undefined && pending.orders > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          shundan {formatNumber(pending.orders)} tasi hali omborga tayyorlanmoqda ({formatFullUzs(pending.amount)} soʻm)
        </p>
      )}
    </Card>
  )
}

function SideRow({ name, orders, amount }: { name: string; orders: number; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {name}
      </span>
      <span className="text-right tabular-nums">
        <span className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {formatFullUzs(amount)}
        </span>
        <span className="ml-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          soʻm · {formatNumber(orders)} ta
        </span>
      </span>
    </div>
  )
}

function MatchTile({
  status,
  clean,
  fakt1,
  pending,
  flagged,
}: {
  status: Status
  clean: number
  fakt1: number
  pending: number
  flagged: number
}) {
  if (status === 'loading') {
    return (
      <Card className="p-4">
        <LoadingSkeleton rows={3} />
      </Card>
    )
  }
  // Orders still being packed have no MoySklad order yet — neither clean nor wrong.
  const compared = fakt1 - pending
  const share = compared > 0 ? (clean / compared) * 100 : null
  const tone =
    share === null
      ? 'var(--ink-primary)'
      : share >= 98
        ? 'var(--status-good)'
        : share >= 90
          ? 'var(--status-warning)'
          : 'var(--status-critical)'
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <h3 className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
        Toʻliq mos
      </h3>
      <p className="text-2xl font-semibold tabular-nums" style={{ color: tone }}>
        {formatPercent(share)}
      </p>
      <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
        MoySkladʼga oʻtgan boʻlishi kerak boʻlgan {formatNumber(compared)} ta FAKT 1 buyurtmadan {formatNumber(clean)} tasi ikki tizimda bir xil
      </p>
      <p className="mt-auto text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {formatNumber(flagged)} ta farqli qator · {formatNumber(pending)} tasi hali MoySkladʼga oʻtmagan (omborga
        tayyorlanmoqda)
      </p>
    </Card>
  )
}

function IssueChip({
  active,
  onClick,
  label,
  count,
  tone,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  tone?: 'critical' | 'warning'
  title?: string
}) {
  const color =
    tone === 'critical'
      ? 'var(--status-critical)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : 'var(--ink-secondary)'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      disabled={count === 0 && !active}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40"
      style={{
        borderColor: active ? color : 'var(--grid)',
        background: active ? `color-mix(in oklab, ${color} 14%, transparent)` : 'transparent',
        color: active ? color : 'var(--ink-secondary)',
      }}
    >
      {label}
      <span className="tabular-nums" style={{ color: count > 0 && tone ? color : 'var(--ink-muted)' }}>
        {formatNumber(count)}
      </span>
    </button>
  )
}

const signed = (n: number) => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n))
const signedUzs = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatFullUzs(Math.abs(n))} soʻm`

const ink = (critical: boolean) => (critical ? 'var(--status-critical)' : undefined)

const LINE_COLUMNS: readonly Column<SverkaLineDto>[] = [
  {
    key: 'deal',
    header: 'Bitim',
    rowHeader: true,
    render: (l) =>
      l.dealId ? (
        <a
          href={bitrixDealUrl(l.dealId)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline-offset-2 hover:underline"
        >
          {l.dealId}
        </a>
      ) : (
        NO_VALUE
      ),
  },
  {
    key: 'issues',
    header: 'Farq',
    render: (l) => (
      <span className="flex flex-wrap gap-1">
        {l.issues.map((i) => (
          <StatusChip key={i} tone={ISSUE_TEXT[i].tone}>
            {ISSUE_TEXT[i].label}
          </StatusChip>
        ))}
      </span>
    ),
  },
  {
    key: 'bxSum',
    header: 'Bitrix24 summa',
    align: 'right',
    numeric: true,
    render: (l) => (
      <span style={{ color: ink(l.issues.includes('SUM')) }}>
        {l.bitrix ? formatFullUzs(l.bitrix.amount) : NO_VALUE}
      </span>
    ),
  },
  {
    key: 'msSum',
    header: 'MoySklad summa',
    align: 'right',
    numeric: true,
    render: (l) => (
      <span style={{ color: ink(l.issues.includes('SUM')) }}>
        {l.moysklad ? formatFullUzs(l.moysklad.amount) : NO_VALUE}
      </span>
    ),
  },
  {
    key: 'bxStage',
    header: 'Bitrix24 bosqich',
    render: (l) => (
      <span
        style={{
          color: ink(l.issues.includes('STATUS') || l.issues.includes('NOT_FAKT1')),
        }}
      >
        {l.bitrix?.stage ?? NO_VALUE}
      </span>
    ),
  },
  {
    key: 'msState',
    header: 'MoySklad holat',
    render: (l) =>
      l.moysklad ? (
        <a
          href={moyskladOrderUrl(l.moysklad.orderId)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline-offset-2 hover:underline"
          style={{ color: ink(l.issues.includes('STATUS')) }}
        >
          {l.moysklad.state ?? NO_VALUE} · {l.moysklad.orderName}
        </a>
      ) : (
        NO_VALUE
      ),
  },
  {
    key: 'seller',
    header: 'Sotuvchi',
    render: (l) => {
      const bx = l.bitrix?.seller?.trim()
      const ms = l.moysklad?.seller?.trim()
      if (l.issues.includes('SELLER')) {
        return (
          <span style={{ color: 'var(--status-critical)' }}>
            {bx} ≠ {ms}
          </span>
        )
      }
      return bx ?? ms ?? NO_VALUE
    },
  },
  {
    key: 'rop',
    header: 'ROP',
    render: (l) => l.bitrix?.rop ?? l.moysklad?.project ?? NO_VALUE,
  },
]

const PRODUCT_COLUMNS: readonly Column<SverkaProductDto>[] = [
  { key: 'name', header: 'Mahsulot', rowHeader: true, render: (p) => p.name },
  {
    key: 'bxQ',
    header: 'Bitrix24 dona',
    align: 'right',
    numeric: true,
    render: (p) => formatNumber(p.bitrixQuantity),
  },
  {
    key: 'msQ',
    header: 'MoySklad dona',
    align: 'right',
    numeric: true,
    render: (p) => formatNumber(p.moyskladQuantity),
  },
  {
    key: 'dQ',
    header: 'Farq',
    align: 'right',
    numeric: true,
    render: (p) => <DiffCell value={p.moyskladQuantity - p.bitrixQuantity} format={signed} />,
  },
  {
    key: 'bxM',
    header: 'Bitrix24 soʻm',
    align: 'right',
    numeric: true,
    render: (p) => formatFullUzs(p.bitrixAmount),
  },
  {
    key: 'msM',
    header: 'MoySklad soʻm',
    align: 'right',
    numeric: true,
    render: (p) => formatFullUzs(p.moyskladAmount),
  },
]

const TEAM_COLUMNS: readonly Column<SverkaTeamDto>[] = [
  { key: 'team', header: 'Jamoa', rowHeader: true, render: (r) => r.team },
  {
    key: 'bx',
    header: 'Bitrix24 FAKT 1',
    align: 'right',
    numeric: true,
    render: (r) => `${formatFullUzs(r.bitrix.amount)} · ${formatNumber(r.bitrix.orders)}`,
  },
  {
    key: 'ms',
    header: 'MoySklad',
    align: 'right',
    numeric: true,
    render: (r) => `${formatFullUzs(r.moysklad.amount)} · ${formatNumber(r.moysklad.orders)}`,
  },
  {
    key: 'diff',
    header: 'Farq',
    align: 'right',
    numeric: true,
    render: (r) => <DiffCell value={r.moysklad.amount - r.bitrix.amount} format={(n) => signedUzs(n)} />,
  },
  {
    key: 'issues',
    header: 'Farqli bitim',
    align: 'right',
    numeric: true,
    render: (r) => (
      <span
        style={{
          color: r.issues > 0 ? 'var(--status-critical)' : 'var(--ink-muted)',
        }}
      >
        {formatNumber(r.issues)}
      </span>
    ),
  },
]

function DiffCell({ value, format }: { value: number; format: (n: number) => string }) {
  if (Math.abs(value) < 1) return <span style={{ color: 'var(--status-good)' }}>✓</span>
  return <span style={{ color: 'var(--status-critical)' }}>{format(value)}</span>
}

/** Both sides of one deal, field by field. */
function LineDetail({ line, onClose }: { line: SverkaLineDto; onClose: () => void }) {
  const bx = line.bitrix
  const ms = line.moysklad
  // The panel opens under a long table — bring it to the reader, not the reader to it.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [line.dealId, ms?.orderId])
  return (
    <div ref={ref}>
      <Card className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
              Bitim {line.dealId ?? NO_VALUE} — ikki tizimda
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {line.issues.map((i) => ISSUE_TEXT[i].hint).join(' ')}
              {line.moyskladOrders > 1
                ? ` MoySkladʼda ${line.moyskladOrders} ta buyurtma, eng oxirgisi solishtirildi.`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 rounded-md px-2 text-xs"
            style={{
              color: 'var(--ink-secondary)',
              border: '1px solid var(--grid)',
            }}
          >
            Yopish
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SideDetail
            title="Bitrix24"
            rows={
              bx
                ? [
                    ['Summa', `${formatFullUzs(bx.amount)} soʻm`],
                    ['Bosqich', `${bx.stage} (${PHASE_LABEL[bx.phase]})`],
                    ['FAKT 1 / FAKT 2', `${bx.fakt1 ? 'ha' : 'yoʻq'} / ${bx.delivered ? 'ha' : 'yoʻq'}`],
                    ['Sotuvchi', bx.seller ?? NO_VALUE],
                    ['ROP', bx.rop ?? NO_VALUE],
                    ['Tasdiqlashga tushgan', bx.queuedAt ? formatDateTime(bx.queuedAt) : NO_VALUE],
                  ]
                : null
            }
            items={bx?.items ?? []}
            missing="Bu bitim davr kogortasida yoʻq yoki Bitrix24 da topilmadi."
          />
          <SideDetail
            title="MoySklad"
            rows={
              ms
                ? [
                    ['Summa', `${formatFullUzs(ms.amount)} soʻm`],
                    ['Holat', `${ms.state ?? NO_VALUE} (${PHASE_LABEL[ms.phase]})`],
                    ['Buyurtma', `${ms.orderName} · ${formatDateTime(ms.moment)}`],
                    ['Sotuvchi', ms.seller ?? NO_VALUE],
                    ['Loyiha (ROP)', ms.project ?? NO_VALUE],
                  ]
                : null
            }
            items={ms?.items ?? []}
            missing="MoySkladʼda bu bitimga buyurtma yoʻq."
          />
        </div>
      </Card>
    </div>
  )
}

function SideDetail({
  title,
  rows,
  items,
  missing,
}: {
  title: string
  rows: readonly (readonly [string, string])[] | null
  items: readonly SverkaItemDto[]
  missing: string
}) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--grid)' }}>
      <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
        {title}
      </h3>
      {rows === null ? (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {missing}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt style={{ color: 'var(--ink-muted)' }}>{k}</dt>
                <dd className="tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="mt-3 flex flex-col gap-1 text-xs">
            {items.length === 0 && <li style={{ color: 'var(--ink-muted)' }}>Mahsulot qatorlari yoʻq</li>}
            {items.map((item, index) => (
              <li key={`${item.code ?? item.name}-${index}`} className="flex justify-between gap-2 tabular-nums">
                <span style={{ color: 'var(--ink-primary)' }}>
                  {formatNumber(item.quantity)} × {item.name}
                </span>
                <span style={{ color: 'var(--ink-muted)' }}>{formatFullUzs(item.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
