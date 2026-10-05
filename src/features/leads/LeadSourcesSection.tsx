'use client'

import { type ReactNode, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { StatTile } from '@/components/ui/Stat'
import { NO_VALUE, formatDateTime, formatNumber, formatPercent } from '@/lib/format'
import { PRODUCT_LABEL, PRODUCT_TONE, usd } from '@/features/target/targetTheme'
import {
  type DayRow,
  DayCell,
  type Status,
  SlicePicker,
  count,
  money,
  muted,
  pct,
} from '@/features/reklama/reklamaUi'

import type {
  ChannelTileDto,
  DmDayDto,
  DmPageDto,
  FormDayDto,
  FormOwnerDto,
  LeadChannel,
  LeadOutcomeDto,
  LeadSourcesOverviewDto,
  LeadTile,
  SourceRowDto,
} from './leadSourcesApi'

/**
 * «Lid manbalari» — every lead Bitrix24 registered, by where it came from.
 *
 * Three questions, one request (`/leads/overview`), so every table's leads on
 * the period sum to the tiles above it. Their kval is the cohort's — what the
 * period's leads have become by now — while the tiles count kval by the day it
 * was WON, so the two kvals differ and the «Barcha manbalar» hint says so. The
 * ROP cards placed in the slots read their own day. The three tables below
 * share one card, a switch at its top choosing the table:
 *
 *   Targetologlar — each targetolog's lead forms: what Meta counted, what
 *     reached Регистрация, and what that became. «Yetib keldi» low means the
 *     form is not linked to the portal, not that the ads are bad — the week
 *     this was built on had whole campaigns at 0%.
 *   DM sahifalar — people writing to a page («ИИ обработка») against the
 *     page's Регистрация leads.
 *   Barcha manbalar — Регистрация whole, ad or not, so nothing is missing
 *     from the total without the reader being told where it went.
 */

const CHANNEL_LABEL: Readonly<Record<LeadChannel, string>> = {
  form: 'Lid-forma',
  page: 'Reklama sahifasi',
  inbound: 'Kiruvchi qoʻngʻiroq',
  manual: 'Ген лид (qoʻlda)',
  telegram: 'Telegram',
  smm: 'Сммщик',
  other: 'Boshqa',
  outbound: 'Исход (chiquvchi)',
}

/**
 * Where the one-day ROP cards sit among the period's blocks (2026-10-02, the
 * client's placement when «Registratsiya» folded in here): the split under
 * the channel tiles, the seven-day grid above «Targetologlar». («ROP otchet»
 * sat below it until it got its own tab the same day.) `LeadsPage` builds
 * them; this section only places them.
 */
export interface LeadSourcesSlots {
  readonly afterChannels?: ReactNode
  readonly beforeForms?: ReactNode
}

export function LeadSourcesSection({
  data,
  status,
  slots = {},
}: {
  data: LeadSourcesOverviewDto | undefined
  status: Status
  slots?: LeadSourcesSlots
}) {
  return (
    <>
      <FunnelTiles data={data} status={status} />
      <ChannelTiles data={data} status={status} />
      {slots.afterChannels}
      {slots.beforeForms}
      <TablesBlock data={data} status={status} />
    </>
  )
}

// --- tiles ------------------------------------------------------------------

/**
 * The client's headline figures (2026-10-01), in their order: Жами / Янги /
 * Дубль, Квал лидлар сони, Квал %, Квал лид нархи $. The same day on the RNP
 * sheet's «Регистрация» block reads the same numbers — `funnel` says how. Янги
 * is washed green and Дубль red, as the client asked. «Бошка лидлар» stood
 * after Дубль until 2026-10-02: once the channel row covered every lead it
 * equalled «Жами лидлар», and the client had it removed.
 */
export function FunnelTiles({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  const f = data?.funnel
  const shareOfTotal = (n: number) => (f && f.total > 0 ? ` · ${formatPercent((n / f.total) * 100)}` : '')
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          compact
          status={status}
          label="Жами лидлар"
          value={f?.total ?? null}
          unit="count"
          hint="Регистрация — dubllar bilan"
        />
        <StatTile
          compact
          fill="good"
          status={status}
          label="Янги лидлар"
          value={f?.fresh ?? null}
          unit="count"
          hint={f ? `dublsiz${shareOfTotal(f.fresh)}` : undefined}
        />
        <StatTile
          compact
          fill="critical"
          status={status}
          label="Дубль лидлар"
          value={f?.duplicates ?? null}
          unit="count"
          hint={f ? `«Дубликат (лид)» bosqichida${shareOfTotal(f.duplicates)}` : undefined}
        />
        <StatTile
          compact
          status={status}
          label="Квал лидлар сони"
          value={f?.qualified ?? null}
          unit="count"
          hint="«Сделка успешна» — yopilgan kuni"
        />
        <StatTile
          compact
          status={status}
          label="Квал %"
          value={f?.qualifiedPercent ?? null}
          unit="percent"
          hint="квал ÷ янги лидлар"
        />
        <StatTile
          compact
          status={status}
          label="Квал лид нархи $"
          value={f?.costPerQualifiedUsd ?? null}
          unit="usd"
          hint={f ? `Meta byudjeti ${usd(f.spendUsd)} ÷ квал` : undefined}
        />
      </div>
      {data?.importedAt && (
        <p className="text-[11px]" style={muted}>
          Lidlar Bitrix24 dan, Meta lidlari Ads Manager’dan har soatda. Meta oxirgi yangilanishi:{' '}
          {formatDateTime(data.importedAt)}.
        </p>
      )}
    </section>
  )
}

// --- the client's channel tiles ---------------------------------------------

const TILE_LABEL: Readonly<Record<LeadTile, string>> = {
  generated: 'Ген лид',
  inbound: 'Входящий',
  telegram: 'Телеграм',
  aiSmm: 'Сммщик ии',
  web: 'Веб сайт',
  sarafan: 'Сарафан',
  outbound: 'Исход',
  other: 'Boshqa',
}

/** The client's order, as the server's `LEAD_TILES` — kept here too so the loading state can draw labelled tiles. */
const TILES = Object.keys(TILE_LABEL) as LeadTile[]

/**
 * Beneath, outside «Jami» — the server's `LEAD_TILES_APART` (the client,
 * 2026-10-02). One card with a picker between the two, the client's ask.
 */
const TILES_APART = ['outbound', 'other'] as const satisfies readonly LeadTile[]
type ApartTile = (typeof TILES_APART)[number]
const TILES_IN_TOTAL = TILES.filter((t) => !(TILES_APART as readonly LeadTile[]).includes(t))

/** What a tile counts, where its name alone does not say it. */
const TILE_NOTE: Partial<Record<LeadTile, string>> = {
  generated: 'lid-forma + qoʻlda kiritilgan',
  aiSmm: '«ИИ квал сана» shu davrda · faqat Регистрация',
  outbound: 'operatorning chiquvchi qoʻngʻirogʻi',
  other: 'qolgan manbalar: ИИ kval qilmagan reklama sahifalari, Сммщик, Instagram, manbasiz',
}

/**
 * On hover only — the client, 2026-10-05, read «14.09.2026 dan» on the card
 * as the day the count starts; it is only when the portal began the mark.
 */
const TILE_NOTE_TITLE: Partial<Record<LeadTile, string>> = {
  aiSmm: 'Tanlangan davr boʻyicha sanaladi. Portal «ИИ квал сана» maydonini 14.09.2026 dan toʻldiradi — undan oldingi kunlarda 0.',
}

/** «N kval · X%» — kval ÷ new leads, as «Квал %» above; a dash when the channel had no new lead. */
const kvalHint = (t: ChannelTileDto) =>
  `${formatNumber(t.qualified)} kval · ${t.qualifiedPercent === null ? NO_VALUE : formatPercent(t.qualifiedPercent)}`

const note = (text: string, title?: string) => (
  <p className="text-[11px] leading-snug" style={muted} title={title}>
    {text}
  </p>
)

/**
 * «shundan N dubl», quietly — the client, 2026-10-03: a duplicate is counted
 * in the big number and said under it, never left for the reader to guess.
 */
const dublNote = (t: ChannelTileDto | undefined) => {
  const dubl = t ? t.leads - t.fresh : 0
  return dubl > 0 ? note(`shundan ${formatNumber(dubl)} dubl`, '«Дубликат (лид)» bosqichidagi lidlar — katta songa kirgan') : null
}

/**
 * Under «Сммщик ии», quieter still: AI-qualified deals that have already left
 * Регистрация (Первичный отдел, Доставка, …) — the client, 2026-10-03: a
 * repeat of a lead counted before, said as «dubl» but summed nowhere.
 */
const aiElsewhereNote = (n: number) =>
  n > 0 ? (
    <p
      className="text-[10px] leading-snug"
      style={muted}
      title="«ИИ квал сана» shu davrda, lekin bitim Регистрацияdan oʻtib ketgan (Первичный отдел, Доставка …) — avval sanalgan lidning takrori; hech qaysi kartaga va «Jami»ga kirmaydi"
    >
      +{formatNumber(n)} dubl · Первичный / Доставка · sanalmagan
    </p>
  ) : null

const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatNumber(Math.abs(n))}`

/**
 * «+128 → 899 «Жами лидлар»» under «Jami», quietly, with what makes up the
 * difference — the client, 2026-10-02: the row's «Jami» has to visibly meet
 * the headline. The parts are the server's identity (`tiles.toHeadline`), not
 * a remainder taken here, so a label can never name a gap it did not cause.
 */
function headlineNote(data: LeadSourcesOverviewDto): ReactNode {
  const { outbound, other, ai } = data.tiles.toHeadline
  const gap = outbound + other + ai
  // A part that adds nothing is not named.
  const parts = (
    [
      [TILE_LABEL.outbound, outbound],
      [TILE_LABEL.other, other],
      ['ИИ farqi', ai],
    ] as const
  )
    .filter(([, n]) => n !== 0)
    .map(([label, n]) => `${label} ${signed(n)}`)
  return (
    <>
      {note(gap === 0 ? '= «Жами лидлар»' : `${signed(gap)} → ${formatNumber(data.funnel.total)} «Жами лидлар»`)}
      {gap !== 0 &&
        note(
          parts.join(' · '),
          ai !== 0
            ? '«ИИ farqi»: «Сммщик ии» shu davrdagi «ИИ квал сана» boʻyicha sanaladi (Регистрацияdagilar, istalgan kuni kelgan); «Жами лидлар»da esa shu davrda Регистрацияga kelgan ИИ lidlari.'
            : undefined,
        )}
    </>
  )
}

/**
 * The client's lead channels (2026-10-01), one tile each, and their «Jami»
 * (summed on the server, `tiles.total`). A cut of its own that overlaps the
 * tables below on purpose: «Ген лид» holds every lead-form lead
 * («Targetologlar») and «Сммщик ии» every lead the AI qualified, mostly off
 * the DM pages. Every tile is on the wire even at zero, so a quiet channel
 * reads 0. A tile's kval is counted as «Квал лидлар сони» above it — by the
 * day it was WON, over new leads. «Исход» and «Boshqa» share one card
 * beneath, outside «Jami», picked by a filter (the client, 2026-10-02).
 */
export function ChannelTiles({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  const [apart, setApart] = useState<ApartTile>('outbound')
  const byTile = new Map<LeadTile, ChannelTileDto>(data?.tiles.rows.map((r) => [r.tile, r]))
  const total = data?.tiles.total
  const channelTile = (tile: LeadTile, extra?: ReactNode) => {
    const o = byTile.get(tile)
    const text = TILE_NOTE[tile]
    const dubl = dublNote(o)
    return (
      <StatTile
        key={tile}
        compact
        status={status}
        label={TILE_LABEL[tile]}
        value={o?.leads ?? null}
        unit="count"
        hint={o ? kvalHint(o) : undefined}
        context={
          text || extra || dubl ? (
            <>
              {dubl}
              {text && note(text, TILE_NOTE_TITLE[tile])}
              {extra}
            </>
          ) : undefined
        }
      />
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="lead-channel-tiles">
      <h2 id="lead-channel-tiles" className="eyebrow">
        Boshqa kanallar lidlari
      </h2>
      {/* Seven tiles on one row from xl, compact like the headline row above. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {/* The total leads the row (the client's order, 2026-10-01) and wears a
            ring in the page's accent, so the eye finds the sum first. */}
        <div
          className="grid rounded-[var(--radius-panel)]"
          style={{ boxShadow: '0 0 0 1.5px var(--accent-line)' }}
          data-testid="lead-channel-total"
        >
          <StatTile
            status={status}
            compact
            label="Jami"
            value={total?.leads ?? null}
            unit="count"
            hint={total ? kvalHint(total) : undefined}
            context={
              data ? (
                <>
                  {dublNote(total)}
                  {headlineNote(data)}
                </>
              ) : undefined
            }
          />
        </div>
        {TILES_IN_TOTAL.map((t) => channelTile(t, t === 'aiSmm' && data ? aiElsewhereNote(data.tiles.aiElsewhere) : undefined))}
      </div>
      <h3 className="eyebrow" id="lead-channel-apart">
        Jamiga kirmaydi
      </h3>
      {/* The row above's columns, two wide, so the card has room for its picker. */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
        role="group"
        aria-labelledby="lead-channel-apart"
        data-testid="lead-channel-apart"
      >
        <div className="col-span-2 grid">
          {channelTile(
            apart,
            <div className="mt-2">
              <SlicePicker<ApartTile>
                ariaLabel="Jamiga kirmaydigan manba"
                value={apart}
                onChange={setApart}
                options={TILES_APART.map((t) => ({ value: t, label: TILE_LABEL[t] }))}
              />
            </div>,
          )}
        </div>
      </div>
    </section>
  )
}

// --- forms, DM pages and every source: one card, one switch ----------------

type TableView = 'forms' | 'formDays' | 'dm' | 'dmDays' | 'sources'

const TABLE_VIEWS: readonly { value: TableView; label: string }[] = [
  { value: 'forms', label: 'Targetologlar' },
  { value: 'formDays', label: 'Targetologlar · kunlik' },
  { value: 'dm', label: 'DM sahifalar' },
  { value: 'dmDays', label: 'DM sahifalar · kunlik' },
  { value: 'sources', label: 'Barcha manbalar' },
]

/** What one view of the card draws: its heading, an optional picker under it, the table, a footnote. */
interface TableViewParts {
  title: string
  hint: string
  picker?: ReactNode
  footer?: string
  table: ReactNode
}

/**
 * «Targetologlar» and «DM sahifalar», over the period and day by day, and
 * «Barcha manbalar» — five tables in ONE card behind one switch at its top
 * (the client, 2026-10-02: the cards stacked ran the page too long; «Barcha
 * manbalar» joined on 2026-10-03). A day view keeps its own
 * targetolog / page picker; both choices live here, so flipping the switch
 * away and back does not lose them.
 */
export function TablesBlock({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  const [view, setView] = useState<TableView>('forms')
  const [formSlice, setFormSlice] = useState<string>('total')
  const [dmSlice, setDmSlice] = useState<string>('total')
  const parts =
    view === 'forms'
      ? formsView(data, status)
      : view === 'formDays'
        ? formDaysView(data, status, formSlice, setFormSlice)
        : view === 'dm'
          ? dmView(data, status)
          : view === 'dmDays'
            ? dmDaysView(data, status, dmSlice, setDmSlice)
            : sourcesView(data, status)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Card className="min-w-0 p-0">
        <header className="flex min-w-0 flex-col gap-3 px-5 pt-4 pb-3">
          <SlicePicker<TableView> ariaLabel="Targetolog yoki DM jadvali" value={view} onChange={setView} options={TABLE_VIEWS} />
          <div>
            <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
              {parts.title}
            </h3>
            <p className="mt-0.5 text-xs" style={muted}>
              {parts.hint}
            </p>
          </div>
          {parts.picker}
        </header>
        {parts.table}
        {parts.footer && (
          <footer className="px-5 pt-2 pb-4 text-[11px]" style={muted}>
            {parts.footer}
          </footer>
        )}
      </Card>
    </section>
  )
}

// --- forms ------------------------------------------------------------------

const ownerLabel = (o: FormOwnerDto) =>
  o.product === 'Boshqa' ? o.targetolog : `${o.targetolog} · ${PRODUCT_LABEL[o.product]}`

function formsView(data: LeadSourcesOverviewDto | undefined, status: Status): TableViewParts {
  type OwnerRow = { key: string; owner: FormOwnerDto | null; cells: FormTotals }
  const owners = data?.forms.owners ?? []
  const rows: OwnerRow[] =
    data && owners.length > 0
      ? [
          ...owners.map((o) => ({ key: o.key, owner: o, cells: ownerTotals(o) })),
          {
            key: 'total',
            owner: null,
            cells: {
              spendUsd: data.forms.spendUsd,
              metaLeads: data.forms.metaLeads,
              outcome: data.forms.outcome,
              reachPercent: data.totals.formReachPercent,
              costPerLeadUsd: data.forms.outcome.leads > 0 ? data.forms.spendUsd / data.forms.outcome.leads : null,
              costPerSuccessUsd:
                data.forms.outcome.success > 0 ? data.forms.spendUsd / data.forms.outcome.success : null,
            },
          },
        ]
      : []

  return {
    title: 'Targetologlar · lid-forma — davr boʻyicha',
    hint: 'Meta hisoblagan lidlar va shu targetologning CRM-formasi Bitrix24 Регистрация ga ochgan bitimlar — keyin ular nima boʻlgani. Targetolog forma nomidan olinadi («Sinolife (UMAR) 777», «… Eldor»). «Yetib keldi» — Bitrix24 lid ÷ Meta lid; past boʻlsa, Meta formasi Bitrix24 ga ulanmagan boʻlishi mumkin.',
    footer: 'Lid va kval narxi — lid-forma sarfi ÷ Bitrix24 dagi lid (yoki kval). Meta lid narxi «Reklama samarasi» boʻlimida.',
    table: (
      <DataTable<OwnerRow>
        columns={ownerColumns}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        emptyTitle="Bu davrda lid-forma lidi yoʻq"
        minWidth={1260}
        maxHeight="none"
        stickyColumns={1}
        stickyLastRow
      />
    ),
  }
}

function formDaysView(
  data: LeadSourcesOverviewDto | undefined,
  status: Status,
  slice: string,
  onSlice: (slice: string) => void,
): TableViewParts {
  const owners = data?.forms.owners ?? []
  const chosen = owners.find((o) => o.key === slice)
  const days = chosen ? chosen.days : data?.forms.days
  const dayTotal: FormDayDto | undefined = chosen
    ? { date: '', metaLeads: chosen.metaLeads, leads: chosen.outcome.leads, success: chosen.outcome.success }
    : data
      ? { date: '', metaLeads: data.forms.metaLeads, leads: data.forms.outcome.leads, success: data.forms.outcome.success }
      : undefined

  return {
    title: `Targetologlar · kunlik — ${chosen ? ownerLabel(chosen) : 'barcha targetologlar'}`,
    hint: 'Har kun alohida qator, oxirida davr jami. Meta kuni — akkauntning hisobot kuni.',
    picker: (
      <SlicePicker
        ariaLabel="Qaysi targetolog"
        value={chosen ? slice : 'total'}
        onChange={onSlice}
        options={[{ value: 'total', label: 'Jami' }, ...owners.map((o) => ({ value: o.key, label: ownerLabel(o) }))]}
      />
    ),
    table: (
      <DataTable<DayRow<FormDayDto>>
        columns={formDayColumns}
        rows={owners.length > 0 ? dayRowsOf(days, dayTotal) : []}
        rowKey={(r) => r.key}
        status={status}
        emptyTitle="Bu davrda lid-forma lidi yoʻq"
        minWidth={620}
        maxHeight="60dvh"
        stickyColumns={1}
        stickyLastRow
      />
    ),
  }
}

interface FormTotals {
  spendUsd: number
  metaLeads: number
  outcome: LeadOutcomeDto
  reachPercent: number | null
  costPerLeadUsd: number | null
  costPerSuccessUsd: number | null
}

const ownerTotals = (o: FormOwnerDto): FormTotals => ({
  spendUsd: o.spendUsd,
  metaLeads: o.metaLeads,
  outcome: o.outcome,
  reachPercent: o.reachPercent,
  costPerLeadUsd: o.costPerLeadUsd,
  costPerSuccessUsd: o.costPerSuccessUsd,
})

/** Days then the total — `dayRows` in reklamaUi wants the total's own type. */
function dayRowsOf<T extends { date: string }>(days: readonly T[] | undefined, total: T | undefined): DayRow<T>[] {
  if (!days || !total || days.length === 0) return []
  return [...days.map((d) => ({ key: d.date, date: d.date, cells: d })), { key: 'total', date: null, cells: total }]
}

const outcomeColumns = <R,>(pick: (row: R) => LeadOutcomeDto): Column<R>[] => [
  {
    key: 'success',
    header: 'Kval',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(pick(r).success)}</span>,
  },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{pct(pick(r).successPercent)}</span>,
  },
  { key: 'noAnswer', header: 'Недозвон', align: 'right', numeric: true, render: (r) => count(pick(r).noAnswer) },
  { key: 'lowQuality', header: 'Sifatsiz', align: 'right', numeric: true, render: (r) => count(pick(r).lowQuality) },
  { key: 'duplicate', header: 'Dubl', align: 'right', numeric: true, render: (r) => count(pick(r).duplicate) },
  {
    key: 'open',
    header: 'Jarayonda',
    align: 'right',
    numeric: true,
    render: (r) => (pick(r).open === 0 ? <span style={muted}>—</span> : <span style={muted}>{formatNumber(pick(r).open)}</span>),
  },
]

const ownerColumns: readonly Column<{ key: string; owner: FormOwnerDto | null; cells: FormTotals }>[] = [
  {
    key: 'who',
    header: 'Targetolog',
    rowHeader: true,
    render: (r) =>
      r.owner === null ? (
        <span className="eyebrow">Jami</span>
      ) : (
        <span className="flex flex-col leading-tight">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: PRODUCT_TONE[r.owner.product] }} />
            {r.owner.targetolog}
            {r.owner.product !== 'Boshqa' && (
              <span className="text-[11px] font-normal" style={muted}>
                · {PRODUCT_LABEL[r.owner.product]}
              </span>
            )}
          </span>
          <OwnerSources owner={r.owner} />
        </span>
      ),
  },
  { key: 'spend', header: 'Sarf', align: 'right', numeric: true, render: (r) => money(r.cells.spendUsd) },
  { key: 'meta', header: 'Meta lid', align: 'right', numeric: true, render: (r) => count(r.cells.metaLeads) },
  {
    key: 'leads',
    header: 'Bitrix24 lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.cells.outcome.leads)}</span>,
  },
  {
    key: 'reach',
    header: 'Yetib keldi',
    align: 'right',
    numeric: true,
    render: (r) => <Reach value={r.cells.reachPercent} meta={r.cells.metaLeads} />,
  },
  ...outcomeColumns<{ cells: FormTotals }>((r) => r.cells.outcome),
  { key: 'cpl', header: 'Lid narxi', align: 'right', numeric: true, render: (r) => money(r.cells.costPerLeadUsd) },
  {
    key: 'cps',
    header: 'Kval narxi',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{money(r.cells.costPerSuccessUsd)}</span>,
  },
]

/** Forms the portal saw, then the Meta accounts — or which half is missing. */
function OwnerSources({ owner }: { owner: FormOwnerDto }) {
  const forms = owner.forms.length > 0 ? `Forma: ${owner.forms.join(', ')}` : 'Bitrix24 da formasi yoʻq'
  const accounts = owner.accounts.length > 0 ? `Meta: ${owner.accounts.join(', ')}` : 'Meta akkaunti bogʻlanmagan'
  return (
    <>
      <span className="max-w-[300px] truncate text-[11px] font-normal" style={muted} title={forms}>
        {forms}
      </span>
      <span className="max-w-[300px] truncate text-[11px] font-normal" style={muted} title={accounts}>
        {accounts}
      </span>
    </>
  )
}

/** A reach under 60% is the finding this table exists for — it is coloured. */
function Reach({ value, meta }: { value: number | null; meta: number }) {
  if (value === null) return <span style={muted}>{meta === 0 ? '—' : '0%'}</span>
  const low = value < 60
  return (
    <span className="font-medium" style={low ? { color: 'var(--status-warning)' } : undefined}>
      {pct(value)}
    </span>
  )
}

const formDayColumns: readonly Column<DayRow<FormDayDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  { key: 'meta', header: 'Meta lid', align: 'right', numeric: true, render: (r) => count(r.cells.metaLeads) },
  {
    key: 'leads',
    header: 'Bitrix24 lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.cells.leads)}</span>,
  },
  {
    key: 'reach',
    header: 'Yetib keldi',
    align: 'right',
    numeric: true,
    render: (r) => (
      <Reach value={r.cells.metaLeads > 0 ? (r.cells.leads / r.cells.metaLeads) * 100 : null} meta={r.cells.metaLeads} />
    ),
  },
  { key: 'success', header: 'Kval', align: 'right', numeric: true, render: (r) => count(r.cells.success) },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.cells.leads > 0 ? (r.cells.success / r.cells.leads) * 100 : null),
  },
]

// --- DM ---------------------------------------------------------------------

type PageRow = { key: string; page: DmPageDto | null; conversations: number; outcome: LeadOutcomeDto }

function dmView(data: LeadSourcesOverviewDto | undefined, status: Status): TableViewParts {
  const pages = data?.dm.pages ?? []
  const rows: PageRow[] =
    data && pages.length > 0
      ? [
          ...pages.map((p) => ({ key: p.key, page: p, conversations: p.conversations, outcome: p.outcome })),
          { key: 'total', page: null, conversations: data.dm.conversations, outcome: data.dm.outcome },
        ]
      : []

  return {
    title: 'DM sahifalar — davr boʻyicha',
    hint: 'Murojaat — sahifaga Instagram’da yozgan har bir odam (Bitrix24 «ИИ обработка» voronkasi). Lid — shu sahifadan Регистрация ga tushgan bitimlar. Murojaat → lid % — yozganlarning qanchasi lid boʻlib tushgani.',
    table: (
      <DataTable<PageRow>
        columns={pageColumns}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        emptyTitle="Bu davrda murojaat ham, sahifa lidi ham yoʻq"
        minWidth={1080}
        maxHeight="none"
        stickyColumns={1}
        stickyLastRow
      />
    ),
  }
}

function dmDaysView(
  data: LeadSourcesOverviewDto | undefined,
  status: Status,
  slice: string,
  onSlice: (slice: string) => void,
): TableViewParts {
  const pages = data?.dm.pages ?? []
  const chosen = pages.find((p) => p.key === slice)
  const days = chosen ? chosen.days : data?.dm.days
  const dayTotal: DmDayDto | undefined = chosen
    ? { date: '', conversations: chosen.conversations, leads: chosen.outcome.leads, success: chosen.outcome.success }
    : data
      ? { date: '', conversations: data.dm.conversations, leads: data.dm.outcome.leads, success: data.dm.outcome.success }
      : undefined

  return {
    title: `DM sahifalar · kunlik — ${chosen ? chosen.name : 'barcha sahifalar'}`,
    hint: 'Har kun alohida qator, oxirida davr jami.',
    picker: (
      <SlicePicker
        ariaLabel="Qaysi sahifa"
        value={chosen ? slice : 'total'}
        onChange={onSlice}
        options={[{ value: 'total', label: 'Jami' }, ...pages.map((p) => ({ value: p.key, label: p.name }))]}
      />
    ),
    table: (
      <DataTable<DayRow<DmDayDto>>
        columns={dmDayColumns}
        rows={pages.length > 0 ? dayRowsOf(days, dayTotal) : []}
        rowKey={(r) => r.key}
        status={status}
        emptyTitle="Bu davrda murojaat yoʻq"
        minWidth={620}
        maxHeight="60dvh"
        stickyColumns={1}
        stickyLastRow
      />
    ),
  }
}

const pageColumns: readonly Column<PageRow>[] = [
  {
    key: 'page',
    header: 'Sahifa',
    rowHeader: true,
    render: (r) =>
      r.page === null ? (
        <span className="eyebrow">Jami</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: r.page.product ? PRODUCT_TONE[r.page.product] : 'var(--axis)' }}
          />
          {r.page.name}
        </span>
      ),
  },
  { key: 'conversations', header: 'Murojaat', align: 'right', numeric: true, render: (r) => count(r.conversations) },
  {
    key: 'leads',
    header: 'Lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.outcome.leads)}</span>,
  },
  {
    key: 'leadPercent',
    header: 'Murojaat → lid',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.conversations > 0 ? (r.outcome.leads / r.conversations) * 100 : null),
  },
  ...outcomeColumns<{ outcome: LeadOutcomeDto }>((r) => r.outcome),
  {
    key: 'c2s',
    header: 'Murojaat → kval',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.conversations > 0 ? (r.outcome.success / r.conversations) * 100 : null),
  },
]

const dmDayColumns: readonly Column<DayRow<DmDayDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  { key: 'conversations', header: 'Murojaat', align: 'right', numeric: true, render: (r) => count(r.cells.conversations) },
  {
    key: 'leads',
    header: 'Lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.cells.leads)}</span>,
  },
  {
    key: 'leadPercent',
    header: 'Murojaat → lid',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.cells.conversations > 0 ? (r.cells.leads / r.cells.conversations) * 100 : null),
  },
  { key: 'success', header: 'Kval', align: 'right', numeric: true, render: (r) => count(r.cells.success) },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.cells.leads > 0 ? (r.cells.success / r.cells.leads) * 100 : null),
  },
]

// --- every source -----------------------------------------------------------

function sourcesView(data: LeadSourcesOverviewDto | undefined, status: Status): TableViewParts {
  type Row = {
    key: string
    channel: LeadChannel | null
    name: string
    outcome: LeadOutcomeDto
    fakt1Clients: number
    subtotal: boolean
  }
  const rows: Row[] = []
  if (data && data.totals.registration.leads > 0) {
    for (const c of data.channels) {
      if (c.outcome.leads === 0) continue
      rows.push({
        key: `channel|${c.channel}`,
        channel: c.channel,
        name: CHANNEL_LABEL[c.channel],
        outcome: c.outcome,
        fakt1Clients: c.fakt1Clients,
        subtotal: true,
      })
      for (const s of data.sources.filter((x: SourceRowDto) => x.channel === c.channel)) {
        rows.push({ key: s.key, channel: s.channel, name: s.name, outcome: s.outcome, fakt1Clients: s.fakt1Clients, subtotal: false })
      }
    }
    rows.push({
      key: 'total',
      channel: null,
      name: 'Jami',
      outcome: data.totals.registration,
      fakt1Clients: data.totals.fakt1Clients,
      subtotal: true,
    })
  }
  // «Факт1 мижоз» right after Kval %: lead → kval → a client who bought.
  const outcome = outcomeColumns<Row>((r) => r.outcome)
  const afterKval = outcome.findIndex((c) => c.key === 'successPercent') + 1

  return {
    title: 'Barcha manbalar · Регистрация',
    hint: 'Регистрация voronkasiga tushgan har bir bitim — reklamadan boʻlmaganlari ham. Qalin qator — kanal jami, ostida uning manbalari. Kval — shu davrda kelgan lidlardan hozirgacha «Сделка успешна» boʻlganlari; yuqoridagi «Квал лидлар сони» esa davr ichida yopilganlarni sanaydi, shuning uchun ikkisi farq qiladi. Факт1 мижоз — shu lidlarning telefon raqamidan davr ichida, liddan keyin FAKT 1 buyurtma qilgan mijozlar soni (bir raqam — bir mijoz).',
    table: (
      <DataTable<Row>
        columns={[
          {
            key: 'name',
            header: 'Manba',
            rowHeader: true,
            render: (r) =>
              r.channel === null ? (
                <span className="eyebrow">Jami</span>
              ) : r.subtotal ? (
                <span className="font-semibold">{r.name}</span>
              ) : (
                <span className="pl-3">{r.name}</span>
              ),
          },
          {
            key: 'leads',
            header: 'Lid',
            align: 'right',
            numeric: true,
            render: (r) => <span className={r.subtotal ? 'font-semibold' : undefined}>{count(r.outcome.leads)}</span>,
          },
          ...outcome.slice(0, afterKval),
          {
            key: 'fakt1Clients',
            header: 'Факт1 мижоз',
            align: 'right',
            numeric: true,
            render: (r) => <span className={r.subtotal ? 'font-semibold' : 'font-medium'}>{count(r.fakt1Clients)}</span>,
          },
          ...outcome.slice(afterKval),
        ]}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        emptyTitle="Bu davrda Регистрация ga lid tushmagan"
        minWidth={960}
        maxHeight="70dvh"
        stickyColumns={1}
        stickyLastRow
      />
    ),
  }
}
