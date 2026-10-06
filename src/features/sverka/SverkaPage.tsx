'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card, ChartCard } from '@/components/ui/Card'
import { SearchInput } from '@/components/ui/Controls'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { apiGet } from '@/lib/api'
import {
  formatCompactUzs,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatFullUzs,
  formatNumber,
  formatPercent,
  NO_VALUE,
} from '@/lib/format'
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
  type SverkaProductDiffDto,
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
  const [search, setSearch] = useState('')
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
  const byIssue = issue === 'ALL' ? lines : lines.filter((l) => l.issues.includes(issue))
  const needle = search.trim().toLocaleLowerCase('ru')
  const visible = needle ? byIssue.filter((l) => lineText(l).includes(needle)) : byIssue
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
          beforeFloor={totals?.fakt1.beforeFloor.orders ?? 0}
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
              amount={data?.issueAmounts[i] ?? 0}
              tone={ISSUE_TEXT[i].tone}
              title={`${ISSUE_TEXT[i].hint} ${i === 'SUM' ? 'Summa — farqlar yigʻindisi.' : 'Summa — shu bitimlar puli.'}`}
            />
          ))}
        </div>
        {issue !== 'ALL' && (
          <p className="mb-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ISSUE_TEXT[issue].hint}
            {(data?.issueAmounts[issue] ?? 0) > 0 &&
              ` ${issue === 'SUM' ? 'Farqlar yigʻindisi' : 'Shu bitimlar puli'}: ${formatFullUzs(data?.issueAmounts[issue] ?? 0)} soʻm.`}
          </p>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Bitim, sotuvchi, buyurtma…" />
          <CopyLinesButton lines={visible} />
          {(needle || issue !== 'ALL') && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {formatNumber(visible.length)} ta qator
            </span>
          )}
        </div>
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
          minWidth={1500}
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
            minWidth={760}
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

/** Everything the search box matches a line by, folded once. */
function lineText(l: SverkaLineDto): string {
  return [
    l.dealId,
    l.moysklad?.orderName,
    l.bitrix?.seller,
    l.moysklad?.seller,
    l.bitrix?.stage,
    l.moysklad?.state,
    l.bitrix?.rop,
    l.moysklad?.project,
    l.bitrix?.region,
    l.moysklad?.region,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru')
}

/** «+1 Sedana Sinolife · −1 Collagen» — what a basket differs by, MoySklad against Bitrix24. */
function productDiffText(diff: readonly SverkaProductDiffDto[]): string {
  return diff
    .map((d) => {
      const delta = d.moyskladQuantity - d.bitrixQuantity
      return `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))} ${d.name}`
    })
    .join(' · ')
}

/**
 * The difference list, as the table shows it, onto the clipboard.
 *
 * Tab-separated for the same reason as the payroll's copy: it pastes into
 * Excel, Google Sheets and a Telegram message with no library and no download.
 * Full soʻm with no separators, so a spreadsheet reads them as money.
 */
function CopyLinesButton({ lines }: { lines: readonly SverkaLineDto[] }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  const copy = async () => {
    const header = [
      'Bitim',
      'Farq',
      'Tasdiqlashga tushgan',
      'Bitrix24 summa',
      'MoySklad summa',
      'Farq soʻm',
      'Mahsulot farqi',
      'Bitrix24 bosqich',
      'MoySklad holat',
      'MoySklad buyurtma',
      'Bitrix24 sotuvchi',
      'MoySklad sotuvchi',
      'Bitrix24 region',
      'MoySklad region',
      'ROP',
      'MoySklad loyiha',
    ].join('\t')
    const body = lines.map((l) =>
      [
        l.dealId ?? '',
        tsvCell(l.issues.map((i) => ISSUE_TEXT[i].label).join(', ')),
        l.bitrix?.queuedAt ? formatDateTime(l.bitrix.queuedAt) : '',
        l.bitrix ? Math.round(l.bitrix.amount) : '',
        l.moysklad ? Math.round(l.moysklad.amount) : '',
        l.diffAmount === null ? '' : Math.round(l.diffAmount),
        tsvCell(productDiffText(l.productDiff)),
        tsvCell(l.bitrix?.stage ?? ''),
        tsvCell(l.moysklad?.state ?? ''),
        tsvCell(l.moysklad?.orderName ?? ''),
        tsvCell(l.bitrix?.seller ?? ''),
        tsvCell(l.moysklad?.seller ?? ''),
        tsvCell(l.bitrix?.region ?? ''),
        tsvCell(l.moysklad?.region ?? ''),
        tsvCell(l.bitrix?.rop ?? ''),
        tsvCell(l.moysklad?.project ?? ''),
      ].join('\t'),
    )
    try {
      await navigator.clipboard.writeText([header, ...body].join('\n'))
      setState('done')
    } catch {
      // A browser that refuses the clipboard says so rather than pretending.
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2500)
  }

  return (
    <Button variant="ghost" onClick={copy} disabled={lines.length === 0}>
      {state === 'done' ? 'Nusxa olindi' : state === 'failed' ? 'Nusxa olinmadi' : 'Nusxa olish (Excel)'}
    </Button>
  )
}

/**
 * A text cell a spreadsheet takes as TEXT: a name opening with = + - @ would
 * run as a formula on paste, and a tab or line break inside one shifts every
 * column after it. The payroll page's rule.
 */
function tsvCell(value: string): string {
  const flat = value.replace(/[\t\r\n]+/g, ' ')
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat
}

function FreshLine({ data }: { data: SverkaOverviewDto | undefined }) {
  if (!data) return <div className="h-4" />
  const { lastSuccessAt, lastError } = data.moysklad
  const before = data.totals.beforeFloor
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        MoySklad: {formatNumber(data.moysklad.orders)} ta buyurtma
        {lastSuccessAt ? ` · oxirgi tekshiruv ${formatDateTime(lastSuccessAt)}` : ''} · davrda Tasdiqlashga tushgan{' '}
        {formatNumber(data.totals.cohortOrders - before.orders)} ta bitim solishtirildi.
      </p>
      {/*
        A window reaching back past MoySklad's first order: those deals are in
        the FAKT figures and in no comparison. Said here, or every tile's gap
        reads as a difference nobody can find.
      */}
      {before.orders > 0 && (
        <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
          MoySklad buyurtmalari {formatDate(data.moysklad.since)} dan boshlanadi — undan oldin Tasdiqlashga tushgan{' '}
          {formatNumber(before.orders)} ta bitim ({formatFullUzs(before.amount)} soʻm) MoySkladʼda yoʻq. Ular FAKT
          raqamlarida bor, lekin solishtirilmadi va mahsulot hamda ROP jadvallariga kirmadi.
        </p>
      )}
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
  /*
    Deals queued before MoySklad's first order stay in Bitrix24's figure —
    it is Savdo dinamikasi's — and leave the verdict: the gap is over the
    deals MoySklad could have held. When those are all there is, nothing was
    compared, and that is not «mos».
  */
  const before = pair.beforeFloor
  const diffAmount = pair.moysklad.amount - (pair.bitrix.amount - before.amount)
  const diffOrders = pair.moysklad.orders - (pair.bitrix.orders - before.orders)
  const uncompared = before.orders > 0 && before.orders === pair.bitrix.orders && pair.moysklad.orders === 0
  const equal = !uncompared && Math.abs(diffAmount) < 1 && diffOrders === 0
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
          color: uncompared
            ? 'var(--ink-muted)'
            : equal
              ? 'var(--status-good)'
              : waiting
                ? 'var(--status-warning)'
                : 'var(--status-critical)',
        }}
      >
        <span>{uncompared ? 'Solishtirilmadi' : equal ? '✓ mos' : waiting ? 'Omborga tayyorlanmoqda' : 'Farq'}</span>
        {!equal && !uncompared && (
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
      {before.orders > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Bitrix24 dagi {formatNumber(before.orders)} tasi ({formatFullUzs(before.amount)} soʻm) MoySklad boshlanishidan
          oldin tushgan — solishtirilmadi
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
  beforeFloor,
  flagged,
}: {
  status: Status
  clean: number
  fakt1: number
  pending: number
  /** FAKT 1 orders queued before MoySklad's first order — never in it, so out of the share. */
  beforeFloor: number
  flagged: number
}) {
  if (status === 'loading') {
    return (
      <Card className="p-4">
        <LoadingSkeleton rows={3} />
      </Card>
    )
  }
  // Orders still being packed have no MoySklad order yet, and orders older than MoySklad never will — neither clean nor wrong.
  const compared = fakt1 - pending - beforeFloor
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
  amount,
  tone,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  /** Soʻm at stake; drawn only when there is some. */
  amount?: number
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
      {count > 0 && amount !== undefined && amount >= 1 && (
        <span className="tabular-nums font-normal" style={{ color: 'var(--ink-muted)' }}>
          · {formatCompactUzs(amount)}
        </span>
      )}
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
    key: 'queued',
    header: 'Tasdiqqa tushgan',
    numeric: true,
    render: (l) => (l.bitrix?.queuedAt ? formatDateShort(l.bitrix.queuedAt) : l.moysklad ? `MS ${formatDateShort(l.moysklad.moment)}` : NO_VALUE),
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
    key: 'diff',
    header: 'Farq soʻm',
    align: 'right',
    numeric: true,
    render: (l) =>
      l.diffAmount === null ? NO_VALUE : <DiffCell value={l.diffAmount} format={(n) => signedUzs(n).replace(' soʻm', '')} />,
  },
  {
    key: 'products',
    header: 'Mahsulot farqi',
    render: (l) =>
      l.productDiff.length > 0 ? (
        <span className="block max-w-64 text-xs" style={{ color: 'var(--status-critical)' }}>
          {productDiffText(l.productDiff)}
        </span>
      ) : (
        NO_VALUE
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
    key: 'region',
    header: 'Region',
    render: (l) => {
      const bx = l.bitrix?.region?.trim()
      const ms = l.moysklad?.region?.trim()
      if (l.issues.includes('REGION')) {
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
    render: (l) => {
      if (l.issues.includes('ROP')) {
        return (
          <span style={{ color: 'var(--status-critical)' }}>
            {l.bitrix?.ropSource} ≠ {l.moysklad?.project}
          </span>
        )
      }
      return l.bitrix?.rop ?? l.moysklad?.project ?? NO_VALUE
    },
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
  {
    key: 'dM',
    header: 'Farq soʻm',
    align: 'right',
    numeric: true,
    render: (p) => <DiffCell value={p.moyskladAmount - p.bitrixAmount} format={(n) => signedUzs(n).replace(' soʻm', '')} />,
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
  const has = (i: SverkaIssue) => line.issues.includes(i)
  const rows: readonly FieldRow[] = [
    {
      label: 'Summa',
      bitrix: bx ? `${formatFullUzs(bx.amount)} soʻm` : null,
      moysklad: ms ? `${formatFullUzs(ms.amount)} soʻm` : null,
      verdict: bx && ms ? (has('SUM') ? 'diff' : 'same') : 'none',
      note: line.diffAmount !== null && has('SUM') ? signedUzs(line.diffAmount) : undefined,
    },
    {
      label: 'Holat',
      bitrix: bx ? `${bx.stage} · ${PHASE_LABEL[bx.phase]}` : null,
      moysklad: ms ? `${ms.state ?? NO_VALUE} · ${PHASE_LABEL[ms.phase]}` : null,
      verdict: bx && ms ? (has('STATUS') || has('NOT_FAKT1') ? 'diff' : bx.phase === 'OUTSIDE' ? 'none' : 'same') : 'none',
    },
    {
      label: 'FAKT 1 / FAKT 2',
      bitrix: bx ? `${bx.fakt1 ? 'ha' : 'yoʻq'} / ${bx.delivered ? 'ha' : 'yoʻq'}` : null,
      moysklad: ms ? `${ms.phase === 'RETURNED' ? 'qaytgan' : 'buyurtma bor'} / ${ms.phase === 'DELIVERED' ? 'ha' : 'yoʻq'}` : null,
      verdict: 'none',
    },
    {
      label: 'Sotuvchi',
      bitrix: bx ? (bx.seller ?? NO_VALUE) : null,
      moysklad: ms ? (ms.seller ?? NO_VALUE) : null,
      verdict: bx?.seller && ms?.seller ? (has('SELLER') ? 'diff' : 'same') : 'none',
    },
    {
      label: 'Region',
      bitrix: bx ? (bx.region ?? NO_VALUE) : null,
      moysklad: ms ? (ms.region ?? NO_VALUE) : null,
      verdict: line.regionMatch ?? 'none',
    },
    {
      label: 'ROP / loyiha',
      bitrix: bx ? (bx.ropSource ?? bx.rop ?? NO_VALUE) : null,
      moysklad: ms ? (ms.project ?? NO_VALUE) : null,
      verdict: line.ropMatch ?? 'none',
    },
    {
      label: 'Mahsulotlar',
      bitrix: bx ? `${formatNumber(bx.items.reduce((n, i) => n + i.quantity, 0))} dona` : null,
      moysklad: ms ? `${formatNumber(ms.items.reduce((n, i) => n + i.quantity, 0))} dona` : null,
      verdict: bx && ms && bx.items.length > 0 ? (has('PRODUCTS') ? 'diff' : 'same') : 'none',
      note: line.productDiff.length > 0 ? productDiffText(line.productDiff) : undefined,
    },
    {
      label: 'Sana',
      bitrix: bx ? (bx.queuedAt ? `Tasdiqqa: ${formatDateTime(bx.queuedAt)}` : NO_VALUE) : null,
      moysklad: ms ? `${ms.orderName} · ${formatDateTime(ms.moment)}` : null,
      verdict: 'none',
    },
    {
      label: 'Pul (MoySklad)',
      bitrix: bx ? NO_VALUE : null,
      moysklad: ms ? `toʻlangan ${formatFullUzs(ms.payed)} · joʻnatilgan ${formatFullUzs(ms.shipped)}` : null,
      verdict: 'none',
    },
    {
      label: 'Logistika',
      bitrix: bx ? NO_VALUE : null,
      moysklad: ms ? (ms.logistics ?? NO_VALUE) : null,
      verdict: 'none',
    },
  ]
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
            <p className="mt-1 flex flex-wrap gap-3 text-xs">
              {line.dealId && (
                <a href={bitrixDealUrl(line.dealId)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Bitrix24 da ochish
                </a>
              )}
              {ms && (
                <a href={moyskladOrderUrl(ms.orderId)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  MoySkladʼda ochish
                </a>
              )}
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className="py-1.5 pr-3 text-left font-medium">Maydon</th>
                <th className="py-1.5 pr-3 text-left font-medium">Bitrix24</th>
                <th className="py-1.5 pr-3 text-left font-medium">MoySklad</th>
                <th className="py-1.5 text-left font-medium">Natija</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-secondary)' }}>
                    {r.label}
                  </th>
                  <td className="py-1.5 pr-3 tabular-nums" style={{ color: r.bitrix === null ? 'var(--status-critical)' : 'var(--ink-primary)' }}>
                    {r.bitrix ?? 'Bitrix24 da yoʻq'}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums" style={{ color: r.moysklad === null ? 'var(--status-critical)' : 'var(--ink-primary)' }}>
                    {r.moysklad ?? 'MoySkladʼda yoʻq'}
                  </td>
                  <td className="py-1.5 tabular-nums">
                    <Verdict verdict={r.verdict} note={r.note} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(bx?.items.length ?? 0) + (ms?.items.length ?? 0) > 0 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
              Mahsulotlar — yonma-yon
            </h3>
            <ProductCompare bitrix={bx?.items ?? []} moysklad={ms?.items ?? []} />
          </div>
        )}

        {line.otherOrders.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
              Shu bitimga MoySkladʼdagi boshqa buyurtmalar
            </h3>
            <ul className="flex flex-col gap-1 text-xs">
              {line.otherOrders.map((o) => (
                <li key={o.orderId} className="flex flex-wrap justify-between gap-2 tabular-nums">
                  <a href={moyskladOrderUrl(o.orderId)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {o.orderName}
                  </a>
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {formatDateTime(o.moment)} · {o.state ?? NO_VALUE} · {formatFullUzs(o.amount)} soʻm
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}

type Verdict = 'same' | 'diff' | 'none'

interface FieldRow {
  readonly label: string
  /** null: the side has no record at all. */
  readonly bitrix: string | null
  readonly moysklad: string | null
  /** `none` — not compared (one side silent, or a field only one system has). */
  readonly verdict: Verdict
  readonly note?: string
}

function Verdict({ verdict, note }: { verdict: Verdict; note?: string }) {
  if (verdict === 'same') return <span style={{ color: 'var(--status-good)' }}>✓ mos</span>
  if (verdict === 'diff') {
    return (
      <span style={{ color: 'var(--status-critical)' }}>
        ✗ farq{note ? ` · ${note}` : ''}
      </span>
    )
  }
  return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
}

/** One row per product code, both systems' pieces and money beside each other. */
function ProductCompare({ bitrix, moysklad }: { bitrix: readonly SverkaItemDto[]; moysklad: readonly SverkaItemDto[] }) {
  const rows = new Map<string, { name: string; bq: number; bm: number; mq: number; mm: number }>()
  // The server's `itemKey`: code, else the name folded as `normaliseName` folds it.
  const keyOf = (i: SverkaItemDto) =>
    i.code ? `code:${i.code}` : `name:${i.name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru')}`
  for (const i of bitrix) {
    const r = rows.get(keyOf(i)) ?? { name: i.name, bq: 0, bm: 0, mq: 0, mm: 0 }
    r.bq += i.quantity
    r.bm += i.amount
    rows.set(keyOf(i), r)
  }
  for (const i of moysklad) {
    const r = rows.get(keyOf(i)) ?? { name: i.name, bq: 0, bm: 0, mq: 0, mm: 0 }
    r.mq += i.quantity
    r.mm += i.amount
    // MoySklad's catalogue has one name per code; the portal names the offer.
    r.name = i.name
    rows.set(keyOf(i), r)
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs tabular-nums">
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            <th className="py-1 pr-3 text-left font-medium">Mahsulot</th>
            <th className="py-1 pr-3 text-right font-medium">Bitrix24 dona</th>
            <th className="py-1 pr-3 text-right font-medium">MoySklad dona</th>
            <th className="py-1 pr-3 text-right font-medium">Bitrix24 soʻm</th>
            <th className="py-1 text-right font-medium">MoySklad soʻm</th>
          </tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([key, r]) => {
            const off = Math.abs(r.bq - r.mq) > 1e-6
            const ink = off ? 'var(--status-critical)' : 'var(--ink-primary)'
            return (
              <tr key={key} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                <th scope="row" className="py-1 pr-3 text-left font-normal" style={{ color: ink }}>
                  {r.name}
                </th>
                <td className="py-1 pr-3 text-right" style={{ color: ink }}>
                  {formatNumber(r.bq)}
                </td>
                <td className="py-1 pr-3 text-right" style={{ color: ink }}>
                  {formatNumber(r.mq)}
                </td>
                <td className="py-1 pr-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                  {formatFullUzs(r.bm)}
                </td>
                <td className="py-1 text-right" style={{ color: 'var(--ink-muted)' }}>
                  {formatFullUzs(r.mm)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
