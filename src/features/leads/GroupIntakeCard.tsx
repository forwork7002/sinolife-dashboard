'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { apiGet, apiWrite } from '@/lib/api'
import { formatDate, formatNumber, formatPercent } from '@/lib/format'

import { DayPicker, today } from './LeadSplitCards'
import type { GroupIntakeDto, GroupIntakeRowDto, SaveGroupIntakeBody } from './leadSplitApi'

/**
 * «Guruhlar · безквал / квал» — the client's daily group report (2026-10-02)
 * on the day the ROP cards share: per registration group the leads it took
 * in («безквал», typed here — Bitrix24 does not know it) and its kval (the
 * /rnp «guruh — квал» count), «Общий» and «Конвер» at the foot. The
 * definitions are in `server/domain/registration/groupIntake.ts`.
 *
 * An empty «безквал» prints a dash, never a zero; a group with no registrar
 * assigned prints a dash for its kval.
 */

const muted = { color: 'var(--ink-muted)' } as const
const th = 'eyebrow border-b px-2 py-2.5 text-right font-[550] whitespace-nowrap sm:px-3'
const td = 'tabular border-b px-2 py-2 text-right whitespace-nowrap sm:px-3'

const dash = <span style={muted}>—</span>
const count = (n: number | null) => (n === null ? dash : n === 0 ? <span style={muted}>0</span> : formatNumber(n))
const conversion = (v: number | null) => (v === null ? dash : formatPercent(v, 1))

export function GroupIntakeCard({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  // The day the form was opened for: another day closes it, so a draft never outlives the figures beside it.
  const [editingDay, setEditingDay] = useState<string | null>(null)
  if (editingDay !== null && editingDay !== day) setEditingDay(null)
  const editing = editingDay === day
  const report = useQuery({
    queryKey: ['registration-groups', day],
    queryFn: ({ signal }) => apiGet<GroupIntakeDto>('/registration/groups', { day }, signal),
    placeholderData: keepPreviousData,
  })
  const data = report.data?.data
  const fresh = data !== undefined && data.day === day && !report.isPlaceholderData

  return (
    <Card className="reveal">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Guruhlar · безквал / квал{data ? ` · ${formatDate(data.day)}` : ''}
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs" style={muted}>
            Безквал — guruhga shu kuni tushgan lidlar, qoʻlda kiritiladi (Bitrix24 lid kval boʻlmaguncha registratorini saqlamaydi). Квал — guruh
            registratorlari ROP larga tarqatgan lidlar, «Лид таркатилган сана» boʻyicha (RNP jadvalidagi «guruh — квал»). Конвер = квал ÷ безквал.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DayPicker day={day} onChange={onDay} />
          {data?.canEdit && !editing && fresh && data.day <= today() && (
            <Button size="sm" variant="primary" onClick={() => setEditingDay(day)}>
              Безквал kiritish
            </Button>
          )}
        </div>
      </header>
      <div className="px-5 pb-5">
        {report.isError && !data ? (
          <ErrorState message={report.error instanceof Error ? report.error.message : undefined} onRetry={() => void report.refetch()} />
        ) : !data ? (
          <LoadingSkeleton rows={8} />
        ) : (
          // A fresh form each time it opens, so the draft starts from the saved numbers.
          <IntakeTable key={editing ? `edit-${data.day}` : 'view'} data={data} editing={editing && fresh} onDone={() => setEditingDay(null)} />
        )}
      </div>
    </Card>
  )
}

function IntakeTable({ data, editing, onDone }: { data: GroupIntakeDto; editing: boolean; onDone: () => void }) {
  const queryClient = useQueryClient()
  // Typed digits per group, frozen when the form opens.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.groups.map((g) => [g.group, g.intake === null ? '' : String(g.intake)])),
  )
  const [initial] = useState(draft)

  const save = useMutation({
    mutationFn: (body: SaveGroupIntakeBody) => apiWrite<{ saved: boolean }>('POST', '/registration/groups', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['registration-groups'] })
      onDone()
    },
  })

  const submit = () => {
    // Only what changed, so an untouched group is not re-stamped.
    const changed = Object.keys(draft).filter((g) => draft[g] !== initial[g])
    if (changed.length === 0) return onDone()
    save.mutate({ day: data.day, rows: changed.map((g) => ({ group: g, leads: draft[g] ? Number(draft[g]) : null })) })
  }

  const input = (g: GroupIntakeRowDto) => (
    <input
      inputMode="numeric"
      aria-label={`${g.group} guruh — безквал`}
      value={draft[g.group] ?? ''}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 5)
        setDraft((d) => ({ ...d, [g.group]: digits }))
      }}
      placeholder="—"
      className="focusable tabular w-20 rounded-[var(--radius-panel-sm)] border px-2 py-1 text-right text-sm"
      style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
    />
  )

  const border = { borderColor: 'var(--border)' }
  const strong = 'color-mix(in oklab, var(--accent) 18%, var(--surface-raised))'

  return (
    <div className="flex flex-col gap-3">
      {editing && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel-sm)] border px-3 py-2"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--accent-soft)' }}
        >
          <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {formatDate(data.day)} kuni har guruhga tushgan lidlar soni. Boʻsh maydon sonni olib tashlaydi.
          </span>
          <span className="flex items-center gap-2">
            {save.isError && (
              <span className="text-xs" role="alert" style={{ color: 'var(--status-critical)' }}>
                {save.error instanceof Error ? save.error.message : 'Saqlab boʻlmadi.'}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
              Bekor qilish
            </Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-[var(--radius-panel-sm)] border" style={border}>
        <table className="w-full min-w-[300px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr style={{ background: 'var(--surface-sunken)' }}>
              <th className="eyebrow border-b px-2 py-2.5 text-left font-[550] whitespace-nowrap sm:px-3" style={border}>
                Guruh
              </th>
              <th className={th} style={border}>
                Безквал
              </th>
              <th className={th} style={border}>
                Квал
              </th>
              <th className={th} style={border}>
                Конвер
              </th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <tr key={g.group}>
                <th scope="row" className="border-b px-2 py-2 text-left font-medium sm:px-3" style={{ ...border, color: 'var(--ink-primary)' }}>
                  <span className="whitespace-nowrap">
                    {g.group}
                    <span className="hidden sm:inline"> guruh</span>
                  </span>
                  {/* Under the name on a phone, so the figures stay on screen. */}
                  <span className="block text-[11px] font-normal sm:ml-2 sm:inline" style={muted}>
                    {g.registrars.length > 0 ? g.registrars.join(', ') : 'registrator biriktirilmagan'}
                  </span>
                </th>
                <td className={td} style={border}>
                  {editing ? input(g) : count(g.intake)}
                </td>
                <td className={td} style={{ ...border, color: 'var(--ink-primary)' }}>
                  {count(g.qualified)}
                </td>
                <td className={td} style={border}>
                  {conversion(g.conversionPercent)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold" style={{ background: strong }}>
              <th scope="row" className="border-b px-2 py-2.5 text-left text-[13px] tracking-[0.04em] uppercase sm:px-3" style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}>
                Общий
              </th>
              <td className={td} style={{ borderColor: 'var(--border-strong)' }}>
                {formatNumber(data.total.intake)}
              </td>
              <td className={td} style={{ borderColor: 'var(--border-strong)' }}>
                {formatNumber(data.total.qualified)}
              </td>
              <td className={td} style={{ borderColor: 'var(--border-strong)' }}>
                {conversion(data.total.conversionPercent)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {data.ungroupedQualified > 0 && (
        <p className="text-xs" style={muted}>
          Guruhsiz registratorlar kvali — {formatNumber(data.ungroupedQualified)} ta (registratori yuqoridagi guruhlarning hech biriga biriktirilmagan yoki
          boʻsh); «Общий» ga kirmaydi.
        </p>
      )}
    </div>
  )
}
