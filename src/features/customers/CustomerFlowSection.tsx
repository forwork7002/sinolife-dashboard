'use client'

import dynamic from 'next/dynamic'

import { CategoryBarList, type CategoryBarRow } from '@/components/charts/CategoryBarList'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import type { CustomerFlowDto, PeriodDto } from '@/lib/api'
import { formatDate, formatNumber, formatPercent } from '@/lib/format'

/** See CallActivitySection — recharts arrives with its chart. */
const CustomerFlowChart = dynamic(
  () => import('@/components/charts/CustomerFlowChart').then((m) => m.CustomerFlowChart),
  { ssr: false, loading: () => <ChartSkeleton height={260} /> },
)

type Status = 'loading' | 'error' | 'ready'

/**
 * «Mijozlar oqimi» — how many customers, who arrived, who returned, who went
 * quiet, and who is in «База».
 *
 * ITS OWN NINETY DAYS, AND THE HEADING SAYS SO. The block above honours the
 * dashboard control and this one does not, which is the one thing a reader
 * could take for a bug. It is deliberate: each source's repeat rate is measured
 * on a ninety-day maturity horizon and the state rows are a fact about today,
 * so a window control over them would change the numbers without changing what
 * they mean. `/insights/customers` resolves the span itself and returns it in
 * `meta.period`; this heading prints the dates it actually got.
 *
 * THE SOURCE REPEAT RATE IS `share`, NOT `rate`. `rate` grades on 85 / 60,
 * right for a delivery rate and wrong for repeat purchase, which runs 9%–40%
 * here — every source would paint red and the screen would assert a benchmark
 * nothing in this business supports.
 *
 * «BAZADA» AND «BAZADA YOʻQ» SUM TO THE BUYER TOTAL, and the card says what the
 * split really measures: the portal places every DELIVERED customer in База
 * automatically (11 586 of 11 607 on 2026-09-16), so «Bazada yoʻq» is
 * overwhelmingly customers whose order was never delivered. It is NOT the
 * four-group «База» ladder on `CohortPage`, whose bars deliberately do not sum.
 */
export function CustomerFlowSection({
  data,
  resolvedWindow,
  status,
  errorMessage,
  onRetry,
}: {
  data: CustomerFlowDto | undefined
  /** The span `/insights/customers` resolved for itself — `meta.period`. */
  resolvedWindow: PeriodDto | undefined
  status: Status
  errorMessage?: string
  onRetry?: () => void
}) {
  const summary = data?.summary

  const hint = resolvedWindow
    ? `Buyurtma berilgan sana boʻyicha · ${formatDate(resolvedWindow.start)} – ${formatDate(
        new Date(new Date(resolvedWindow.end).getTime() - 1).toISOString(),
      )} · qoʻngʻiroqlar davriga bogʻliq emas`
    : 'Buyurtma berilgan sana boʻyicha · soʻnggi 90 kun · qoʻngʻiroqlar davriga bogʻliq emas'

  const sourceRows: CategoryBarRow[] = (data?.sources ?? []).map((source) => ({
    key: source.key || '__none__',
    label: source.label,
    value: source.newCustomers,
    display: `${formatNumber(source.newCustomers)} ta`,
    meta: source.sharePercent !== null ? formatPercent(source.sharePercent) : undefined,
  }))

  const repeatRows: CategoryBarRow[] = (data?.sources ?? []).map((source) => ({
    key: source.key || '__none__',
    label: source.label,
    value: source.repeatPercent,
    display: formatPercent(source.repeatPercent),
    meta: `${formatNumber(source.maturedCustomers)} ta mijoz 90 kundan oshgan`,
  }))

  return (
    <section className="flex flex-col gap-3" aria-label="Mijozlar oqimi">
      <SectionHeader title="Mijozlar oqimi" hint={hint} />

      <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          status={status}
          label="Mijozlar soni"
          value={summary?.activeCustomers ?? null}
          unit="count"
          hint="davrda buyurtma bergan"
        />
        <StatTile
          status={status}
          label="Yangi mijozlar"
          value={summary?.newCustomers ?? null}
          unit="count"
          hint={summary ? `${formatNumber(summary.newCustomersWon)} tasi sotib olgan` : undefined}
        />
        <StatTile
          status={status}
          label="Qaytgan mijozlar"
          value={summary?.returningCustomers ?? null}
          unit="count"
          hint="avval ham buyurtma bergan"
        />
        <StatTile
          status={status}
          label="Takroriy tushum ulushi"
          value={summary?.repeatRevenueSharePercent ?? null}
          unit="percent"
          hint="davrdagi tushumning qaytgan mijozlardan kelgani"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Yangi va qaytgan mijozlar" hint="Kunlik, buyurtma berilgan sana boʻyicha.">
          {status === 'loading' ? (
            <ChartSkeleton height={260} />
          ) : status === 'error' ? (
            <ErrorState message={errorMessage} onRetry={onRetry} />
          ) : (data?.series.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda buyurtma yoʻq" />
          ) : (
            <CustomerFlowChart data={data?.series ?? []} height={260} />
          )}
        </ChartCard>

        <ChartCard title="Mijozlar holati — bugun" hint="Davrga bogʻliq emas: bugungi holat.">
          <StateRows data={data} status={status} errorMessage={errorMessage} onRetry={onRetry} />
        </ChartCard>
      </div>

      <ChartCard
        title="Mijoz qayerdan kelayapti"
        hint="Yuqorida — yangi mijozlar manba boʻyicha, pastda — shu manbadan kelganlarning 90 kun ichida qayta xarid qilgani. Qatorlar tartibi bir xil."
      >
        <div className="flex flex-col gap-4">
          <CategoryBarList rows={sourceRows} mode="magnitude" status={status} />
          <CategoryBarList rows={repeatRows} mode="share" status={status} />
        </div>
      </ChartCard>
    </section>
  )
}

/**
 * Two partitions of the buyer base, hand-drawn.
 *
 * Five fixed rows need a colour chip, a number and a share, not a chart library
 * — the argument `CategoryBarList` makes for itself. Not that component,
 * because the state colours are fixed per state and carry meaning (red is
 * «Yoʻqotilgan» and nothing else on this screen), and its bars are one hue.
 *
 * EACH GROUP SUMS TO `states.customers`, and the share is taken against that
 * one server total — never re-summed here.
 */
function StateRows({
  data,
  status,
  errorMessage,
  onRetry,
}: {
  data: CustomerFlowDto | undefined
  status: Status
  errorMessage?: string
  onRetry?: () => void
}) {
  if (status === 'loading') {
    return (
      <div className="skeleton h-[220px] w-full rounded-lg" role="status">
        <span className="sr-only">Yuklanmoqda</span>
      </div>
    )
  }
  if (status === 'error') return <ErrorState message={errorMessage} onRetry={onRetry} />
  if (!data || data.states.customers === 0) return <EmptyState title="Mijoz topilmadi" />

  const { customers } = data.states
  const share = (value: number) => (customers > 0 ? (value / customers) * 100 : null)

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2.5" aria-label="Oxirgi buyurtmadan beri oʻtgan vaqt">
        {data.states.rows.map((row) => (
          <Row
            key={row.key}
            colour={`var(${row.colour})`}
            label={row.label}
            value={row.customers}
            share={share(row.customers)}
          />
        ))}
      </ul>

      <div style={{ borderTop: '1px solid var(--rule)' }} />

      <ul className="flex flex-col gap-2.5" aria-label="Baza">
        <Row colour="var(--series-1)" label="Bazada" value={data.states.inBase} share={share(data.states.inBase)} />
        <Row
          colour="var(--ink-muted)"
          label="Bazada yoʻq"
          value={data.states.notInBase}
          share={share(data.states.notInBase)}
        />
      </ul>

      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        Jami {formatNumber(customers)} ta mijoz. Yetkazilgan har bir mijoz bazaga avtomatik tushadi —
        «Bazada yoʻq» asosan buyurtmasi yetkazilmagan mijozlar.
      </p>
    </div>
  )
}

function Row({
  colour,
  label,
  value,
  share,
}: {
  colour: string
  label: string
  value: number
  share: number | null
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span
        aria-hidden
        style={{ width: 10, height: 10, borderRadius: 3, background: colour, flexShrink: 0 }}
      />
      <span className="min-w-0 flex-1" style={{ color: 'var(--ink-primary)' }}>
        {label}
      </span>
      <span className="tabular-nums font-medium" style={{ color: 'var(--ink-primary)' }}>
        {formatNumber(value)}
      </span>
      <span className="w-14 text-right text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
        {formatPercent(share)}
      </span>
    </li>
  )
}
