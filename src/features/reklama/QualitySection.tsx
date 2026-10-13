'use client'

import { useState } from 'react'

import { SegmentedControl } from '@/components/ui/Controls'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { formatNumber, formatPercent } from '@/lib/format'

import { LeadFormTable } from './LeadFormSection'
import type { LeadBucket, LeadFormDto, QualityBlockDto, QualityCellsDto } from './reklamaApi'
import { type DayRow, DayCell, type Status, TableCard, SlicePicker, count, dayRows, muted, pct } from './reklamaUi'

/**
 * Lead sifati — what each day's Регистрация leads became, the client's sheet
 * of недозвон / некачественный / успешный / дубль, and since 2026-10-13 the
 * same question asked per Meta lead form, as the card's second tab (the user:
 * «ikkisini birlashtirib yubor»). One card, two readings: «Kunlar ·
 * sahifalar» by the day the lead was created and the page it came from;
 * «Formalar · Meta» by the form Meta says the lead filled in.
 *
 * Read live, so a recent day still has leads being worked; they are their own
 * column («Jarayonda») rather than being forced into one of the four, and the
 * sheet's % is успешный over ALL the day's leads, as the sheet divides it.
 * The «Taqsimot» bar draws the five columns of a row as shares of its leads,
 * so a bad day is seen before it is read. Under the table, every stage met
 * and the column it was counted in — the rule, shown, so a stage the client
 * adds tomorrow is visible the day it appears.
 *
 * Checked against the portal on 2026-10-13: 01–13.10, every cell of the
 * «Barcha sahifalar» table equal to Bitrix24's Регистрация deals on these
 * pages (1 446 leads, 286 kval).
 */
const BUCKET_LABEL: Readonly<Record<LeadBucket, string>> = {
  noAnswer: 'Недозвон',
  lowQuality: 'Sifatsiz',
  success: 'Kval (успешный)',
  duplicate: 'Dubl',
  open: 'Jarayonda',
}

/** The bar's order and colour: the outcome a reader hopes for first, the undecided last. */
const BAR: readonly {
  readonly bucket: LeadBucket
  readonly label: string
  readonly tone: string
}[] = [
  { bucket: 'success', label: 'Kval', tone: 'var(--status-good)' },
  { bucket: 'noAnswer', label: 'Недозвон', tone: 'var(--status-warning)' },
  { bucket: 'lowQuality', label: 'Sifatsiz', tone: 'var(--status-critical)' },
  {
    bucket: 'duplicate',
    label: 'Dubl',
    tone: 'color-mix(in oklab, var(--ink-muted) 70%, transparent)',
  },
  { bucket: 'open', label: 'Jarayonda', tone: 'var(--track)' },
]

type Tab = 'days' | 'forms'

export function QualitySection({
  quality,
  forms,
  status,
}: {
  quality: QualityBlockDto | undefined
  forms: readonly LeadFormDto[] | undefined
  status: Status
}) {
  const [tab, setTab] = useState<Tab>('days')
  const [slice, setSlice] = useState<string>('total')

  const pages = quality?.pages ?? []
  const chosen = pages.find((p) => p.key === slice)
  const days = chosen ? chosen.days : quality?.days
  const total = chosen ? chosen.total : quality?.total

  // `w-fit`: the control would otherwise stretch to the card and read as a second page picker.
  const tabs = (
    <div className="w-fit max-w-full overflow-x-auto">
      <SegmentedControl<Tab>
        ariaLabel="Lid sifati qanday oʻqiladi"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'days', label: 'Kunlar · sahifalar' },
          {
            value: 'forms',
            label: `Formalar · Meta${forms && forms.length > 0 ? ` (${formatNumber(forms.length)})` : ''}`,
          },
        ]}
      />
    </div>
  )

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Lid sifati"
        hint="Reklamadan kelgan lidlar hozir qaysi bosqichda turgani: kunlar va sahifalar boʻyicha yoki Meta lid-formalari boʻyicha."
      />

      {tab === 'days' ? (
        <TableCard
          title={`Kunlik — ${chosen ? chosen.name : 'barcha sahifalar'}`}
          hint="Target sahifalaridan Регистрация ga tushgan lidlar, yaratilgan kuni boʻyicha. Kval % — kval ÷ shu kunning barcha lidlari, jadvaldagidek."
          action={
            <div className="flex min-w-0 flex-col gap-2">
              {tabs}
              <span className="eyebrow mt-1">Sahifa</span>
              <SlicePicker
                ariaLabel="Qaysi sahifa"
                value={chosen ? slice : 'total'}
                onChange={setSlice}
                options={[
                  { value: 'total', label: 'Barcha sahifalar' },
                  ...pages.map((p) => ({ value: p.key, label: p.name })),
                ]}
              />
              <BarLegend />
            </div>
          }
          footer={
            quality && quality.stages.length > 0 ? (
              <details>
                <summary className="focusable w-fit cursor-pointer rounded-[var(--radius-panel-sm)]">
                  Qaysi bosqich qaysi ustunga sanaladi
                </summary>
                <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {quality.stages.map((s) => (
                    <li key={s.stage} className="flex justify-between gap-3">
                      <span className="truncate">{s.stage}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        {BUCKET_LABEL[s.bucket]} · {formatNumber(s.leads)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : undefined
          }
        >
          <DataTable<DayRow<QualityCellsDto>>
            columns={columns}
            rows={dayRows(days, total)}
            rowKey={(r) => r.key}
            status={status}
            emptyTitle="Bu davrda lid yoʻq"
            minWidth={880}
            maxHeight="60dvh"
            stickyColumns={1}
            stickyLastRow
          />
        </TableCard>
      ) : (
        <TableCard
          title="Formalar · Meta"
          hint="Facebook lead formalari va ularning holati — sahifa, forma, holat, yaratilgan sana va jami lidlar Facebook’dan har soatda olinadi. Keyingi ustunlar tanlangan davr: forma reklamalarining sarfi, Meta lidi, lid narxi; Lid va keyingi ustunlar — formaning Meta lidi telefon boʻyicha Bitrix24 bitimiga ulangani, Kval — «Сделка успешна», kval narxi = sarf ÷ kval."
          action={tabs}
          footer="Oʻchirilgan forma koʻrsatilmaydi. «Forma aniqlanmagan» — lid-forma reklamasining sarfi, lekin undan hali birorta lid qaysi formadan kelgani oʻqilmagan."
        >
          <LeadFormTable forms={forms} status={status} />
        </TableCard>
      )}
    </section>
  )
}

function BarLegend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={muted}>
      {BAR.map((b) => (
        <span key={b.bucket} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: b.tone }} />
          {b.label}
        </span>
      ))}
    </p>
  )
}

/** A row's five columns as shares of its leads — the same figures as the cells, drawn. */
function ShareBar({ cells }: { cells: QualityCellsDto }) {
  if (cells.leads === 0) return <span style={muted}>—</span>
  const label = BAR.map((b) => `${b.label} ${formatPercent((cells[b.bucket] / cells.leads) * 100)}`).join(', ')
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex h-2 w-full min-w-[120px] overflow-hidden rounded-full"
      style={{ background: 'var(--track)' }}
    >
      {BAR.map((b) =>
        cells[b.bucket] > 0 ? (
          <span
            key={b.bucket}
            style={{
              width: `${(cells[b.bucket] / cells.leads) * 100}%`,
              background: b.tone,
            }}
          />
        ) : null,
      )}
    </span>
  )
}

const bucketColumn = (bucket: LeadBucket): Column<DayRow<QualityCellsDto>> => ({
  key: bucket,
  header: BUCKET_LABEL[bucket],
  align: 'right',
  numeric: true,
  render: (r) => count(r.cells[bucket]),
})

const columns: readonly Column<DayRow<QualityCellsDto>>[] = [
  {
    key: 'date',
    header: 'Kun',
    rowHeader: true,
    render: (r) => <DayCell date={r.date} />,
  },
  bucketColumn('noAnswer'),
  bucketColumn('lowQuality'),
  {
    ...bucketColumn('success'),
    render: (r) => (
      <span className="font-semibold" style={{ color: 'var(--status-good)' }}>
        {count(r.cells.success)}
      </span>
    ),
  },
  bucketColumn('duplicate'),
  {
    ...bucketColumn('open'),
    render: (r) =>
      r.cells.open === 0 ? <span style={muted}>—</span> : <span style={muted}>{formatNumber(r.cells.open)}</span>,
  },
  {
    key: 'leads',
    header: 'Jami lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-semibold">{count(r.cells.leads)}</span>,
  },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{pct(r.cells.successPercent)}</span>,
  },
  {
    key: 'share',
    header: 'Taqsimot',
    width: '22%',
    render: (r) => <ShareBar cells={r.cells} />,
  },
]
