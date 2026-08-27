'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Controls'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { ApiClientError, apiGet, type MoneyDto } from '@/lib/api'
import { NO_VALUE, formatDate, formatNumber, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

interface DealDetail {
  readonly id: string
  readonly title: string
  readonly amount: MoneyDto
  readonly status: string
  readonly createdAt: string
  readonly closedAt: string | null
  readonly employee: { readonly id: string; readonly fullName: string; readonly position: string | null }
  readonly stage: { readonly id: string; readonly name: string; readonly category: string }
  readonly customer: {
    readonly id: string
    readonly name: string
    readonly isCompany: boolean
    readonly phone: string | null
    readonly region: string | null
  } | null
  readonly source: { readonly id: string; readonly name: string } | null
  readonly items: readonly {
    readonly productId: string
    readonly name: string
    readonly quantity: number
    readonly unitPrice: MoneyDto
    readonly total: MoneyDto
  }[]
  readonly payments: readonly {
    readonly id: string
    readonly amount: MoneyDto
    readonly paidAt: string
    readonly method: string
  }[]
  readonly settlement: {
    readonly paid: MoneyDto
    readonly outstanding: MoneyDto
    readonly status: string
  }
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Naqd',
  BANK_TRANSFER: 'Bank oʻtkazmasi',
  CARD: 'Karta',
  OTHER: 'Boshqa',
}

/**
 * Deal drill-down, as a side panel.
 *
 * A panel rather than a route because the deal list is the context: an
 * operator scans the table, opens one deal, closes it and carries on. A full
 * page navigation would lose the scroll position and the filters each time.
 */
export function DealDetailPanel({
  dealId,
  onClose,
}: {
  dealId: string | null
  onClose: () => void
}) {
  const query = useQuery({
    queryKey: ['deal', dealId],
    queryFn: ({ signal }) => apiGet<DealDetail>(`/deals/${dealId}`, {}, signal),
    enabled: dealId !== null,
  })

  useEffect(() => {
    if (!dealId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dealId, onClose])

  if (!dealId) return null

  const deal = query.data?.data

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/*
        House scrim, not an ad-hoc black wash: `.backdrop-dim` tints from
        --page so the dimming matches the theme (a black veil over a light
        theme read as a different app), and it degrades per
        prefers-reduced-transparency in one place for every overlay.
      */}
      <button
        type="button"
        aria-label="Yopish"
        onClick={onClose}
        className="backdrop-dim absolute inset-0"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t.table.deal}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l"
        /*
          --shadow-ambient, not a Tailwind shadow: in light it is the house
          float stack, in dark it swaps to the zero-offset halo — floating
          chrome in a room with no sun to cast a directional shadow.
        */
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border-strong)',
          boxShadow: 'var(--shadow-ambient)',
        }}
      >
        <header
          className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="min-w-0">
            <h2
              className="truncate text-sm font-semibold"
              style={{ color: 'var(--ink-primary)' }}
            >
              {deal?.title ?? t.state.loading}
            </h2>
            {deal && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {formatDate(deal.createdAt)}
                {deal.closedAt && ` → ${formatDate(deal.closedAt)}`}
              </p>
            )}
          </div>
          {/* The kit's ghost button, not a hand-rolled one — same height,
              radius, hover and focus ring as every other quiet action. The
              glyph is the drawn ×, which inherits the button's ink. */}
          <Button variant="ghost" size="sm" aria-label="Yopish" onClick={onClose}>
            <MultiplyGlyph size={14} />
          </Button>
        </header>

        <div className="flex-1 px-5 py-4">
          {query.isError ? (
            <ErrorState
              message={query.error instanceof ApiClientError ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : !deal ? (
            <LoadingSkeleton rows={8} />
          ) : (
            <div className="space-y-5">
              <div className="flex items-baseline justify-between gap-3">
                {/* `.figure` for tabular, lining digits — the panel's headline
                    amount speaks the same numeral voice as every tile. */}
                <p
                  className="figure text-2xl font-semibold tracking-tight"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {formatUzs(deal.amount.amount)}
                </p>
                <StatusBadge status={deal.status} />
              </div>

              <Section title="Tafsilotlar">
                <Row label={t.table.employee} value={deal.employee.fullName} />
                <Row label={t.table.stage} value={deal.stage.name} />
                <Row label={t.table.source} value={deal.source?.name ?? NO_VALUE} />
                <Row
                  label="Mijoz"
                  value={
                    deal.customer
                      ? `${deal.customer.name}${deal.customer.region ? ` · ${deal.customer.region}` : ''}`
                      : NO_VALUE
                  }
                />
                {deal.customer?.phone && <Row label="Telefon" value={deal.customer.phone} />}
              </Section>

              <Section title={`${t.table.product} (${deal.items.length})`}>
                {deal.items.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {t.state.emptyTitle}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {deal.items.map((item) => (
                      <li
                        key={item.productId}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="min-w-0 truncate" style={{ color: 'var(--ink-primary)' }}>
                          {item.name}
                          <span className="ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                            ×{formatNumber(item.quantity)}
                          </span>
                        </span>
                        <span className="tabular shrink-0" style={{ color: 'var(--ink-secondary)' }}>
                          {formatUzs(item.total.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Toʻlovlar">
                <div className="mb-2 grid grid-cols-3 gap-2">
                  <Figure label="Summa" value={formatUzs(deal.amount.amount)} />
                  <Figure label="Toʻlangan" value={formatUzs(deal.settlement.paid.amount)} />
                  <Figure
                    label="Qoldiq"
                    value={formatUzs(deal.settlement.outstanding.amount)}
                    emphasis={deal.settlement.outstanding.amount > 0}
                  />
                </div>

                {deal.payments.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Toʻlov qayd etilmagan
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {deal.payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span style={{ color: 'var(--ink-secondary)' }}>
                          {formatDate(payment.paidAt)}
                          <span className="ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                            {METHOD_LABELS[payment.method] ?? payment.method}
                          </span>
                        </span>
                        <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
                          {formatUzs(payment.amount.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      {/* `.eyebrow` — the ONE positive-tracked style, rationed to section and
          table headers. This is a section header, so it wears the class
          instead of a hand-tuned copy of it drifting out of sync. */}
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
      <span className="truncate text-right" style={{ color: 'var(--ink-primary)' }}>
        {value}
      </span>
    </div>
  )
}

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div
      className="rounded-lg px-2.5 py-2"
      style={{ background: 'var(--grid)' }}
    >
      <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </p>
      <p
        className="tabular mt-0.5 text-[11px] font-medium"
        style={{ color: emphasis ? 'var(--status-critical)' : 'var(--ink-primary)' }}
      >
        {value}
      </p>
    </div>
  )
}
