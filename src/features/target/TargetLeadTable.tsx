'use client'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { Pagination, SearchInput } from '@/components/ui/Controls'
import { NO_VALUE, formatDateTime, formatUzs } from '@/lib/format'

import { type TargetLeadDto, type TargetLeadSaleDto, bitrixDealUrl } from './targetApi'

/**
 * Every lead, one row each — who, from where, whose ad, and what became of it.
 *
 * THE LEFT HALF IS THE LEAD, THE RIGHT HALF IS ITS SALE. The lead is the
 * Регистрация deal; «Sotuv» is the first seller's deal the same contact opened
 * on or after it — the one the registrar's «Сделка успешна» created — with
 * where it stands now, who holds it and its amount. A lead with no such deal
 * says «sotuvga oʻtmagan», which is the answer for most of them.
 *
 * Both ids open the deal in Bitrix24, where the whole card already is.
 */

export interface LeadFilters {
  readonly source: string
  readonly targetolog: string
  readonly stage: string
  readonly q: string
}

export const EMPTY_FILTERS: LeadFilters = { source: '', targetolog: '', stage: '', q: '' }

export function TargetLeadTable({
  rows,
  status,
  errorMessage,
  onRetry,
  page,
  totalPages,
  totalItems,
  onPage,
  filters,
  onFilters,
  sourceOptions,
  targetologOptions,
  stageOptions,
}: {
  rows: readonly TargetLeadDto[]
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
  page: number
  totalPages: number
  totalItems: number
  onPage: (page: number) => void
  filters: LeadFilters
  onFilters: (next: LeadFilters) => void
  sourceOptions: readonly string[]
  targetologOptions: readonly string[]
  stageOptions: readonly string[]
}) {
  const active = filters.source || filters.targetolog || filters.stage || filters.q

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 px-5">
        <div className="w-full sm:w-64">
          <SearchInput
            value={filters.q}
            onChange={(q) => onFilters({ ...filters, q })}
            placeholder="ID, ism yoki telefon…"
          />
        </div>
        <Picker
          label="Manba"
          value={filters.source}
          options={sourceOptions}
          onChange={(source) => onFilters({ ...filters, source })}
        />
        <Picker
          label="Targetolog"
          value={filters.targetolog}
          options={targetologOptions}
          onChange={(targetolog) => onFilters({ ...filters, targetolog })}
        />
        <Picker
          label="Bosqich"
          value={filters.stage}
          options={stageOptions}
          onChange={(stage) => onFilters({ ...filters, stage })}
        />
        {active && (
          <button
            type="button"
            className="focusable rounded px-1.5 text-[11px] underline-offset-2 hover:underline"
            style={{ color: 'var(--ink-secondary)' }}
            onClick={() => onFilters(EMPTY_FILTERS)}
          >
            Filtrlarni tozalash
          </button>
        )}
      </div>

      <DataTable<TargetLeadDto>
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => `${row.bitrixId ?? row.createdAt}-${row.title}`}
        status={status}
        errorMessage={errorMessage}
        onRetry={onRetry}
        emptyTitle={active ? 'Filtrga mos lead yoʻq' : 'Bu davrda lead yoʻq'}
        emptyBody={
          active
            ? 'Filtrni yumshating yoki davrni kengaytiring.'
            : 'Tanlangan davrda bu manbalardan Регистрация ga hech narsa tushmagan.'
        }
        minWidth={1320}
        maxHeight="65dvh"
        stickyColumns={2}
      />

      <div className="px-5 pb-4">
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems} onPage={onPage} />
      </div>
    </div>
  )
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  // The current choice stays selectable while the options change under it —
  // a link or a click from a table above can pick a value the window lacks.
  const listed = value === '' || options.includes(value)
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      <select
        className="h-8 max-w-[200px] rounded-md border px-2 text-[12px]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface)',
          color: 'var(--ink-primary)',
        }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label} boʻyicha filtr`}
      >
        <option value="">Hammasi</option>
        {!listed && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function DealLink({ id }: { id: string | null }) {
  if (!id) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
  return (
    <a
      href={bitrixDealUrl(id)}
      target="_blank"
      rel="noreferrer"
      className="focusable rounded tabular-nums underline-offset-2 hover:underline"
      style={{ color: 'var(--accent)' }}
      onClick={(event) => event.stopPropagation()}
    >
      {id}
    </a>
  )
}

const CATEGORY_TONE: Readonly<Record<string, string>> = {
  WON: 'var(--status-good)',
  LOST: 'var(--status-critical)',
}

function StageText({ stage, category }: { stage: string; category: string }) {
  const tone = CATEGORY_TONE[category]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: tone ?? 'var(--axis)' }}
      />
      {stage}
    </span>
  )
}

/** Where the sale stands, in the floor's words. */
function saleState(sale: TargetLeadSaleDto): { label: string; tone: string | undefined } {
  if (sale.role === 'REVENUE') {
    if (sale.status === 'WON') return { label: 'Yetkazildi', tone: 'var(--status-good)' }
    if (sale.status === 'LOST') return { label: 'Qaytdi / bekor', tone: 'var(--status-critical)' }
    return { label: 'Yoʻlda', tone: 'var(--series-1)' }
  }
  if (sale.role === 'CONFIRMATION') return { label: 'Tasdiqlashda', tone: 'var(--series-4)' }
  if (sale.status === 'LOST') return { label: 'Sotuvchi yopdi', tone: 'var(--status-critical)' }
  return { label: 'Sotuvchida', tone: undefined }
}

const muted = { color: 'var(--ink-muted)' }

const COLUMNS: readonly Column<TargetLeadDto>[] = [
  {
    key: 'id',
    header: 'ID',
    width: '84px',
    render: (row) => <DealLink id={row.bitrixId} />,
  },
  {
    key: 'who',
    header: 'Mijoz',
    rowHeader: true,
    render: (row) => (
      <span className="flex max-w-[220px] flex-col leading-tight">
        <span className="truncate" title={row.customerName ?? row.title}>
          {row.customerName ?? row.title}
        </span>
        <span className="text-[11px] font-normal tabular-nums" style={muted}>
          {row.phone ?? NO_VALUE}
        </span>
      </span>
    ),
  },
  {
    key: 'created',
    header: 'Kelgan vaqti',
    numeric: true,
    render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span>,
  },
  {
    key: 'source',
    header: 'Manba',
    render: (row) => (
      <span className="flex flex-col leading-tight">
        <span className="whitespace-nowrap">{row.source}</span>
        {row.primarySource && row.primarySource !== row.source && (
          <span className="text-[11px]" style={muted} title="Birlamchi manba">
            birlamchi: {row.primarySource}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'targetolog',
    header: 'Targetolog',
    render: (row) =>
      row.targetolog ? (
        <span className="flex flex-col leading-tight">
          <span className="whitespace-nowrap">{row.targetolog}</span>
          {row.creative && (
            <span className="max-w-[180px] truncate text-[11px]" style={muted} title={row.creative}>
              {row.creative}
            </span>
          )}
        </span>
      ) : (
        <span style={muted}>{row.creative ?? NO_VALUE}</span>
      ),
  },
  {
    key: 'stage',
    header: 'Lead bosqichi',
    render: (row) => (
      <span className="flex flex-col leading-tight">
        <StageText stage={row.stage} category={row.stageCategory} />
        {row.registrar && (
          <span className="max-w-[180px] truncate text-[11px]" style={muted} title={row.registrar}>
            {row.registrar}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'sale',
    header: 'Sotuv',
    render: (row) => {
      if (!row.sale) return <span style={muted}>sotuvga oʻtmagan</span>
      const state = saleState(row.sale)
      return (
        <span className="flex flex-col leading-tight">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: state.tone ?? 'var(--axis)' }}
            />
            <span style={{ color: 'var(--ink-primary)' }}>{state.label}</span>
            <span className="text-[11px]" style={muted}>
              · {row.sale.stage}
            </span>
          </span>
          <span className="max-w-[220px] truncate text-[11px]" style={muted} title={row.sale.seller ?? ''}>
            {row.sale.seller ?? NO_VALUE}
          </span>
        </span>
      )
    },
  },
  {
    key: 'amount',
    header: 'Summa',
    align: 'right',
    numeric: true,
    render: (row) =>
      row.sale && row.sale.amount.amount > 0 ? (
        <span className="whitespace-nowrap" style={{ color: 'var(--ink-primary)' }}>
          {formatUzs(row.sale.amount.amount)}
        </span>
      ) : (
        <span style={muted}>{NO_VALUE}</span>
      ),
  },
  {
    key: 'saleId',
    header: 'Sotuv ID',
    align: 'right',
    render: (row) => (row.sale ? <DealLink id={row.sale.bitrixId} /> : <span style={muted}>{NO_VALUE}</span>),
  },
]
