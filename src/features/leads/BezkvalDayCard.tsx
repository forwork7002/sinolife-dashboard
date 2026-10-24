'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { ArrowUpRightGlyph, MultiplyGlyph } from '@/components/ui/Icons'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet } from '@/lib/api'
import { NO_VALUE, formatDate, formatDateShort, formatDateTime, formatNumber, formatPercent, formatTime } from '@/lib/format'

import { BEZKVAL_ROWS_PER_PAGE, type BezkvalPick, pickClients } from './bezkvalLogic'
import type { BezkvalClientDto, BezkvalClientsDto, BezkvalDayDto } from './leadSplitApi'

/**
 * «Bezkval lidlar» — one day of «Безквал» opened up, as the client's spec of
 * 2026-10-22 lays it out (its 5): «Jami lid», the clients, the new ones in 30
 * days and outright, the repeats and «Tarqatilmagan»; the ROPs with their new
 * and repeat clients; the sources; the hours; the 30 days before. EVERY NUMBER
 * OPENS THE CLIENTS BEHIND IT (`BezkvalDrawer`): one list per day from the
 * server, filtered here by the same predicate the server counted with
 * (`bezkvalLogic.ts`), so a number and its rows cannot disagree.
 *
 * The day is the ROP cards' (`LeadsPage`'s `DayPicker`). The definitions are
 * in `server/domain/registration/bezkval.ts`.
 */

const muted = { color: 'var(--ink-muted)' } as const
const UNASSIGNED = 'Tarqatilmagan'

/** What a drawer is asked to list: a day and a slice of its clients. */
export interface BezkvalDrill {
  readonly day: string
  readonly title: string
  readonly pick: BezkvalPick
}

function useBrandParams(day: string) {
  const { apiParams } = useDashboardFilters()
  return apiParams.brand !== undefined ? { day, brand: apiParams.brand } : { day }
}

export function BezkvalDayCard({ day }: { day: string }) {
  const params = useBrandParams(day)
  const query = useQuery({
    queryKey: ['registration-bezkval', params],
    queryFn: ({ signal }) => apiGet<BezkvalDayDto>('/registration/bezkval', params, signal),
    placeholderData: keepPreviousData,
  })
  const [drill, setDrill] = useState<BezkvalDrill | null>(null)
  const data = query.data?.data
  const open = (title: string, pick: BezkvalPick, at = day) => setDrill({ day: at, title, pick })

  return (
    <ChartCard
      title={`Bezkval lidlar${data ? ` · ${formatDate(data.day)}` : ''}`}
      hint="Jami lid — Регистрация yoki Первичный отдел voronkasida ochilgan (yoki hozir oʻsha yerda turgan) bitimlar. Bezkval — bir kunda bitta telefon raqami = 1 mijoz (kontaktning hamma raqamlari bitta odam). Lead Guard orqali kech kiritilgani lid tushgan kunga yoziladi. Har bir raqamni bosing — orqasidagi mijozlar va bitimlar ochiladi."
    >
      {query.isError && !data ? (
        <ErrorState message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <LoadingSkeleton rows={4} />
      ) : data.computedAt === null ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          Bu kun hali hisoblanmagan — sinxronizatsiya bir necha daqiqada hisoblab chiqadi.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[11px]" style={muted}>
            Hisoblangan: {formatDateTime(data.computedAt)} (bugun va kecha har 10 daqiqada qayta hisoblanadi)
          </p>
          <DayBody data={data} open={open} />
        </>
      )}
      {drill && <BezkvalDrawer drill={drill} onClose={() => setDrill(null)} />}
    </ChartCard>
  )
}

function DayBody({ data, open }: { data: BezkvalDayDto; open: (title: string, pick: BezkvalPick, day?: string) => void }) {
  const noPhone = data.keyKinds.contact + data.keyKinds.deal
  const tiles: { label: string; value: number; note?: string; pick: BezkvalPick | null; tone?: string }[] = [
    { label: 'Jami lid', value: data.total, note: 'bitimlar', pick: {} },
    { label: 'Bezkval', value: data.bezkval, note: 'noyob mijozlar', pick: {}, tone: 'var(--accent-ink)' },
    { label: '30 kunda yangi', value: data.new30, note: pctOf(data.new30, data.bezkval), pick: { kind: 'new30' }, tone: 'var(--status-good)' },
    { label: 'Butunlay yangi', value: data.newEver, note: pctOf(data.newEver, data.bezkval), pick: { kind: 'newEver' }, tone: 'var(--status-good)' },
    { label: 'Takror', value: data.repeat30, note: '30 kun ichida kelgan', pick: { kind: 'repeat30' } },
    { label: UNASSIGNED, value: data.unassigned, note: pctOf(data.unassigned, data.bezkval), pick: { rop: null }, tone: data.unassigned > 0 ? 'var(--status-warning)' : undefined },
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => t.pick && open(t.label, t.pick)}
            className="focusable card flex min-w-0 flex-col items-start px-3 py-3 text-left transition-colors hover:bg-[var(--glass-hover)]"
          >
            <span className="eyebrow">{t.label}</span>
            <span className="tabular mt-1 text-[24px] leading-none font-semibold" style={{ color: t.tone ?? 'var(--ink-primary)' }}>
              {formatNumber(t.value)}
            </span>
            {t.note && (
              <span className="mt-1 text-[11px]" style={muted}>
                {t.note}
              </span>
            )}
          </button>
        ))}
      </div>

      <Notes data={data} noPhone={noPhone} open={open} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <RopTable data={data} open={open} />
        <SourceTable data={data} open={open} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Hours data={data} open={open} />
        <Trend data={data} open={open} />
      </div>
    </div>
  )
}

function pctOf(n: number, of: number): string {
  return of > 0 ? formatPercent((n / of) * 100, 0) : NO_VALUE
}

/** The day's quality notes, each a link to its clients — the spec's checks (its 7), on the screen. */
function Notes({ data, noPhone, open }: { data: BezkvalDayDto; noPhone: number; open: (title: string, pick: BezkvalPick) => void }) {
  const parts: { text: string; pick: BezkvalPick | null }[] = []
  if (data.leadGuard > 0) parts.push({ text: `${formatNumber(data.leadGuard)} ta bitim Lead Guard orqali kech kiritilgan`, pick: { kind: 'leadGuard' } })
  if (data.multiRop > 0) parts.push({ text: `${formatNumber(data.multiRop)} mijoz 2+ ROPʼga tushgan (birinchisiga yozildi)`, pick: { kind: 'multiRop' } })
  if (noPhone > 0) parts.push({ text: `${formatNumber(noPhone)} mijozda telefon raqami yoʻq`, pick: { kind: 'noPhone' } })
  if (data.keyKinds.dealPhone > 0) parts.push({ text: `${formatNumber(data.keyKinds.dealPhone)} mijoz bitimdagi «Телефон ракам» boʻyicha`, pick: null })
  if (data.movedIn > 0) parts.push({ text: `${formatNumber(data.movedIn)} ta bitim boshqa voronkada (ИИ обработка) ochilib Регистрация/Первичка'ga oʻtgan`, pick: null })
  if (data.noBirth > 0) parts.push({ text: `${formatNumber(data.noBirth)} ta bitimning ochilgan voronkasi hali oʻqilmagan — hozirgi voronkasi boʻyicha`, pick: null })
  return (
    <div className="flex flex-col gap-1.5">
      {data.problems.length > 0 && (
        <p className="text-xs font-medium" style={{ color: 'var(--status-critical)' }}>
          Tekshiruv buzildi: {data.problems.join('; ')}
        </p>
      )}
      {parts.length > 0 && (
        <p className="text-xs leading-relaxed" style={muted}>
          {parts.map((p, i) => (
            <span key={p.text}>
              {i > 0 && ' · '}
              {p.pick ? (
                <button type="button" className="focusable underline decoration-dotted underline-offset-2 hover:text-[var(--ink-primary)]" onClick={() => open(p.text, p.pick!)}>
                  {p.text}
                </button>
              ) : (
                p.text
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

const th = 'eyebrow px-2 py-2 text-left font-[550] whitespace-nowrap'
const thR = `${th} text-right`
const td = 'px-2 py-2 whitespace-nowrap'
const tdR = `${td} tabular text-right`

/** A count that opens its clients; a zero is printed quietly and opens nothing. */
function Num({ value, onOpen, strong = false }: { value: number; onOpen: () => void; strong?: boolean }) {
  if (value === 0) return <span style={muted}>0</span>
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`focusable tabular rounded px-1 underline-offset-2 hover:underline ${strong ? 'font-semibold' : ''}`}
      style={{ color: 'var(--ink-primary)' }}
    >
      {formatNumber(value)}
    </button>
  )
}

function RopTable({ data, open }: { data: BezkvalDayDto; open: (title: string, pick: BezkvalPick) => void }) {
  const name = (rop: string | null) => rop ?? UNASSIGNED
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr>
            <th className={th}>ROP</th>
            <th className={thR}>Bezkval</th>
            <th className={thR}>30 kunda yangi</th>
            <th className={thR}>Butunlay yangi</th>
            <th className={thR}>Takror</th>
            <th className={thR}>Ulushi</th>
          </tr>
        </thead>
        <tbody>
          {data.rops
            .filter((r) => r.rop !== null || r.bezkval > 0)
            .map((r) => (
              <tr key={name(r.rop)} className="border-t" style={{ borderColor: 'var(--border)' }}>
                <th scope="row" className={`${td} text-left font-medium`} style={{ color: r.rop === null ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>
                  {name(r.rop)}
                </th>
                <td className={tdR}>
                  <Num strong value={r.bezkval} onOpen={() => open(`${name(r.rop)} · bezkval`, { rop: r.rop })} />
                </td>
                <td className={tdR}>
                  <Num value={r.new30} onOpen={() => open(`${name(r.rop)} · 30 kunda yangi`, { rop: r.rop, kind: 'new30' })} />
                </td>
                <td className={tdR}>
                  <Num value={r.newEver} onOpen={() => open(`${name(r.rop)} · butunlay yangi`, { rop: r.rop, kind: 'newEver' })} />
                </td>
                <td className={tdR}>
                  <Num value={r.repeat30} onOpen={() => open(`${name(r.rop)} · takror`, { rop: r.rop, kind: 'repeat30' })} />
                </td>
                <td className={tdR} style={muted}>
                  {formatPercent(r.sharePct, 1)}
                </td>
              </tr>
            ))}
        </tbody>
        <tfoot>
          <tr className="border-t" style={{ borderColor: 'var(--border-strong)' }}>
            <th scope="row" className={`${td} text-left font-semibold`} style={{ color: 'var(--ink-primary)' }}>
              Jami
            </th>
            <td className={tdR}>
              <Num strong value={data.bezkval} onOpen={() => open('Bezkval', {})} />
            </td>
            <td className={tdR}>
              <Num value={data.new30} onOpen={() => open('30 kunda yangi', { kind: 'new30' })} />
            </td>
            <td className={tdR}>
              <Num value={data.newEver} onOpen={() => open('Butunlay yangi', { kind: 'newEver' })} />
            </td>
            <td className={tdR}>
              <Num value={data.repeat30} onOpen={() => open('Takror', { kind: 'repeat30' })} />
            </td>
            <td className={tdR} style={muted}>
              {data.bezkval > 0 ? '100%' : NO_VALUE}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function SourceTable({ data, open }: { data: BezkvalDayDto; open: (title: string, pick: BezkvalPick) => void }) {
  const name = (s: string | null) => s ?? 'Manbasiz'
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr>
            <th className={th}>Manba</th>
            <th className={thR}>Bezkval</th>
            <th className={thR}>30 kunda yangi</th>
          </tr>
        </thead>
        <tbody>
          {data.sources.map((s) => (
            <tr key={name(s.source)} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <th scope="row" className={`${td} max-w-[14rem] truncate text-left font-normal`} style={{ color: 'var(--ink-primary)' }} title={name(s.source)}>
                {name(s.source)}
              </th>
              <td className={tdR}>
                <Num strong value={s.bezkval} onOpen={() => open(`${name(s.source)} · bezkval`, { source: s.source })} />
              </td>
              <td className={tdR}>
                <Num value={s.new30} onOpen={() => open(`${name(s.source)} · 30 kunda yangi`, { source: s.source, kind: 'new30' })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Hours({ data, open }: { data: BezkvalDayDto; open: (title: string, pick: BezkvalPick) => void }) {
  const max = Math.max(1, ...data.hours)
  return (
    <div>
      <p className="eyebrow mb-2">Soat boʻyicha (mijozning birinchi bitimi)</p>
      <div className="flex h-28 items-end gap-[3px]">
        {data.hours.map((v, h) => (
          <button
            key={h}
            type="button"
            disabled={v === 0}
            onClick={() => open(`${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, { hour: h })}
            title={`${String(h).padStart(2, '0')}:00 — ${formatNumber(v)} mijoz`}
            aria-label={`${h}-soat: ${v} mijoz`}
            className="focusable flex h-full min-w-0 flex-1 flex-col justify-end"
          >
            <span className="block w-full rounded-t-sm" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: 'var(--series-1)' }} />
          </button>
        ))}
      </div>
      <div className="tabular mt-1 flex justify-between text-[10px]" style={muted}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  )
}

function Trend({ data, open }: { data: BezkvalDayDto; open: (title: string, pick: BezkvalPick, day?: string) => void }) {
  const max = Math.max(1, ...data.trend.map((t) => t.total))
  return (
    <div>
      <p className="eyebrow mb-2">
        Oxirgi {data.trend.length} kun: <span style={{ color: 'var(--series-3)' }}>jami lid</span> va{' '}
        <span style={{ color: 'var(--series-1)' }}>bezkval</span>
      </p>
      <div className="flex h-28 items-end gap-[3px]">
        {data.trend.map((t) => (
          <button
            key={t.day}
            type="button"
            disabled={t.bezkval === 0}
            onClick={() => open(`${formatDate(t.day)} · bezkval`, {}, t.day)}
            title={`${formatDate(t.day)}: jami ${formatNumber(t.total)}, bezkval ${formatNumber(t.bezkval)}`}
            aria-label={`${formatDate(t.day)}: jami ${t.total}, bezkval ${t.bezkval}`}
            className="focusable relative flex h-full min-w-0 flex-1 items-end"
          >
            <span className="absolute inset-x-0 bottom-0 rounded-t-sm" style={{ height: `${(t.total / max) * 100}%`, background: 'color-mix(in oklab, var(--series-3) 35%, transparent)' }} />
            <span className="absolute inset-x-[15%] bottom-0 rounded-t-sm" style={{ height: `${(t.bezkval / max) * 100}%`, background: 'var(--series-1)' }} />
          </button>
        ))}
      </div>
      <div className="tabular mt-1 flex justify-between text-[10px]" style={muted}>
        <span>{data.trend[0] ? formatDateShort(data.trend[0].day) : ''}</span>
        <span>{data.trend.at(-1) ? formatDateShort(data.trend.at(-1)!.day) : ''}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The drawer: the clients behind a number.
// ---------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The clients behind a «Безквал» number — their (masked) number, deals with
 * the way to each in Bitrix24, pipeline, source, ROP, new or repeat with the
 * earlier deal that makes it one. The modal discipline is `LeadWatchDrawer`'s:
 * focus trapped, Escape and the scrim close it, the page under it holds still.
 */
export function BezkvalDrawer({ drill, onClose }: { drill: BezkvalDrill; onClose: () => void }) {
  const { apiParams } = useDashboardFilters()
  const params = apiParams.brand !== undefined ? { day: drill.day, brand: apiParams.brand } : { day: drill.day }
  const query = useQuery({
    queryKey: ['registration-bezkval-clients', params],
    queryFn: ({ signal }) => apiGet<BezkvalClientsDto>('/registration/bezkval/clients', params, signal),
  })
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [shown, setShown] = useState(BEZKVAL_ROWS_PER_PAGE)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!first || !last) return
    const at = document.activeElement
    if (event.shiftKey && (at === first || at === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && at === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const clients = query.data ? pickClients(query.data.data.clients, drill.pick) : []
  const deals = clients.reduce((n, c) => n + c.deals.length, 0)
  const visible = clients.slice(0, shown)

  return createPortal(
    <div
      className="backdrop-dim drawer-backdrop-enter fixed inset-0 z-50 flex justify-end"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="watch-drawer watch-drawer-enter flex h-dvh w-full flex-col outline-none sm:w-[760px] sm:max-w-[94vw]"
      >
        <header className="shrink-0 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
                {drill.title}
              </h2>
              <p className="mt-0.5 text-xs" style={muted}>
                {formatDate(drill.day)}
                {query.data && ` · ${formatNumber(clients.length)} mijoz, ${formatNumber(deals)} ta bitim`}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Yopish"
              className="focusable -mt-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-panel-sm)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--glass-hover)] hover:text-[var(--ink-primary)] sm:-mr-1.5 sm:h-9 sm:w-9"
            >
              <MultiplyGlyph size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {query.isError ? (
            <div className="p-5">
              <ErrorState message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />
            </div>
          ) : !query.data ? (
            <div className="p-5">
              <LoadingSkeleton rows={6} />
            </div>
          ) : visible.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm" style={{ color: 'var(--ink-secondary)' }}>
              Bu roʻyxat boʻsh.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {visible.map((c, i) => (
                <ClientRow key={`${c.phone ?? ''}:${c.deals[0]?.id ?? i}`} client={c} />
              ))}
            </ul>
          )}
          {clients.length > shown && (
            <div className="px-4 py-3 sm:px-5">
              <Button variant="secondary" className="h-11 w-full sm:h-8" onClick={() => setShown((n) => n + BEZKVAL_ROWS_PER_PAGE)}>
                Yana {formatNumber(Math.min(BEZKVAL_ROWS_PER_PAGE, clients.length - shown))} ta
              </Button>
            </div>
          )}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      className="inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap"
      style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)`, color: tone }}
    >
      {text}
    </span>
  )
}

function DealLink({ id }: { id: string | null }) {
  if (id === null) return <span style={muted}>{NO_VALUE}</span>
  return (
    <a
      href={bitrixDealUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      className="focusable tabular inline-flex items-center gap-0.5 font-medium text-[var(--accent-ink)] hover:underline"
      aria-label={`Bitim ${id} — Bitrix24 da ochish (yangi oynada)`}
    >
      #{id}
      <ArrowUpRightGlyph size={11} />
    </a>
  )
}

function ClientRow({ client: c }: { client: BezkvalClientDto }) {
  const label = c.phone ?? (c.kind === 'contact' ? 'Raqamsiz kontakt' : 'Kontaktsiz bitim')
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular text-sm font-semibold" style={{ color: c.phone ? 'var(--ink-primary)' : 'var(--ink-muted)' }}>
          {label}
        </span>
        {c.newEver ? (
          <Badge text="Butunlay yangi" tone="var(--status-good)" />
        ) : c.new30 ? (
          <Badge text="30 kunda yangi" tone="var(--status-good)" />
        ) : (
          <Badge text="Takror" tone="var(--status-warning)" />
        )}
        {c.multiRop && <Badge text="2+ ROP" tone="var(--status-critical)" />}
        <span className="text-xs" style={muted}>
          ROP: <span style={{ color: c.rop ? 'var(--ink-primary)' : 'var(--status-warning)' }}>{c.rop ?? UNASSIGNED}</span>
          {' · '}
          {c.deals.length} ta bitim
        </span>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {c.deals.map((d, i) => (
          <li key={d.id ?? i} className="flex flex-wrap items-center gap-x-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            <DealLink id={d.id} />
            <span className="tabular" style={muted}>
              {formatTime(d.at)}
              {d.leadGuard && ' · Lead Guard'}
            </span>
            <span>{d.pipeline ?? NO_VALUE}</span>
            {d.stage && <span style={muted}>· {d.stage}</span>}
            <span style={muted}>· {d.source ?? 'manbasiz'}</span>
            {d.rop && <span style={muted}>· ROP {d.rop}</span>}
          </li>
        ))}
      </ul>
      {c.previous && (
        <p className="mt-1 text-[11.5px]" style={muted}>
          Oldingi bitim: <DealLink id={c.previous.id} /> · {formatDateTime(c.previous.at)} · {c.previous.pipeline ?? NO_VALUE}
        </p>
      )}
    </li>
  )
}
