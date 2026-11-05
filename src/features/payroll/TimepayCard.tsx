'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SearchInput, SegmentedControl } from '@/components/ui/Controls'
import { Select } from '@/components/ui/Select'
import { type PayrollDto, type TimepayLinkPersonDto, type TimepayLinksDto, apiGet, apiWrite } from '@/lib/api'
import { formatDateTime, formatFullUzs, formatNumber } from '@/lib/format'
import { useServerViewer } from '@/lib/viewer'

/**
 * «Kechikish jarimasi · TimePay» (2026-11-05, the owner: «sotuvchilar
 * oyligida … har bir kechikkan minutiga 1 somdan jarima»). The rule, how
 * fresh TimePay's data is, how many of the sheet's sellers it covers — and
 * the list of who each TimePay (FaceID) person is here. An unlinked seller is
 * fined nothing, so the list is how the fine reaches everybody.
 *
 * The list loads only when opened; the picker opens one row at a time (two
 * hundred names under a hundred rows is not a page). Linking is an
 * administrator's (`canManageUsers`); the server checks it again.
 */
export function TimepayCard({ timepay }: { readonly timepay: PayrollDto['timepay'] | undefined }) {
  const [open, setOpen] = useState(false)
  const covered = timepay ? timepay.linked + timepay.unlinked : 0
  return (
    <ChartCard
      title="Kechikish jarimasi · TimePay"
      hint="Har kechikkan daqiqa uchun 1 soʻm — JAMI maoshdan ayriladi. Kechikish TimePay (FaceID) boʻyicha, faqat ish kunlari (dushanba–shanba); yakshanba, bayram, taʼtil va kelish belgisi yoʻq kun hisoblanmaydi."
      action={
        <Button variant={open ? 'primary' : 'secondary'} size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Yopish' : 'Bogʻlanishlar'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 px-5 pb-5">
        <p className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {timepay === undefined ? (
            '…'
          ) : timepay.syncedAt === null ? (
            'TimePay maʼlumoti hali kelmagan — hozircha hech kimga jarima hisoblanmaydi.'
          ) : (
            <>
              TimePay yangilangan: <b>{formatDateTime(timepay.syncedAt)}</b> · daqiqasiga {formatFullUzs(timepay.perMinute.amount)}.
              Jadvaldagi {formatNumber(covered)} sotuvchidan <b>{formatNumber(timepay.linked)}</b> tasi TimePay bilan bogʻlangan
              {timepay.unlinked > 0 && (
                <>
                  ; <b style={{ color: 'var(--delta-down)' }}>{formatNumber(timepay.unlinked)}</b> tasi bogʻlanmagan — ularga jarima
                  hisoblanmaydi («—»)
                </>
              )}
              .
            </>
          )}
        </p>
        {open && <TimepayLinks />}
      </div>
    </ChartCard>
  )
}

type Show = 'open' | 'all'

function TimepayLinks() {
  const viewer = useServerViewer()
  const canEdit = viewer?.canManageUsers === true
  const [show, setShow] = useState<Show>('open')
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['payroll-timepay'],
    queryFn: ({ signal }) => apiGet<TimepayLinksDto>('/payroll/timepay', {}, signal),
  })
  const data = query.data?.data
  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const people = data?.people ?? []
    return people.filter(
      (p) =>
        (show === 'all' || p.employeeId === null) &&
        (needle === '' ||
          p.fullName.toLowerCase().includes(needle) ||
          (p.employeeName ?? '').toLowerCase().includes(needle) ||
          (p.department ?? '').toLowerCase().includes(needle)),
    )
  }, [data, show, needle])

  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
  if (!data) return <LoadingSkeleton rows={4} />

  const unlinked = data.people.filter((p) => p.employeeId === null).length
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<Show>
          ariaLabel="Kimlar koʻrinsin"
          value={show}
          onChange={setShow}
          options={[
            { value: 'open', label: `Bogʻlanmagan · ${formatNumber(unlinked)}` },
            { value: 'all', label: `Hammasi · ${formatNumber(data.people.length)}` },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki boʻlim…" />
      </div>
      {!canEdit && (
        <p className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          Bogʻlanishni faqat administrator oʻzgartira oladi.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th scope="col" className="border-b px-2 py-1.5 text-left font-semibold" style={{ borderColor: 'var(--border)' }}>
                TimePay
              </th>
              <th scope="col" className="border-b px-2 py-1.5 text-left font-semibold" style={{ borderColor: 'var(--border)' }}>
                Bitrix24 xodimi
              </th>
              <th scope="col" className="w-[1%] border-b px-2 py-1.5 text-right font-semibold" style={{ borderColor: 'var(--border)' }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-4 text-center" style={{ color: 'var(--ink-muted)' }}>
                  {show === 'open' && needle === '' ? 'Hamma bogʻlangan.' : 'Hech kim topilmadi.'}
                </td>
              </tr>
            ) : (
              rows.map((p) => <LinkRow key={p.timepayId} person={p} employees={data.employees} canEdit={canEdit} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const SOURCE_TEXT = { name: 'ism boʻyicha', manual: 'qoʻlda' } as const

function LinkRow({
  person: p,
  employees,
  canEdit,
}: {
  person: TimepayLinkPersonDto
  employees: TimepayLinksDto['employees']
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<string>(p.employeeId ?? p.suggestion?.employeeId ?? '')
  const save = useMutation({
    mutationFn: (employeeId: string | null) => apiWrite<{ saved: boolean }>('POST', '/payroll/timepay', { timepayId: p.timepayId, employeeId }),
    onSuccess: async () => {
      setEditing(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payroll-timepay'] }),
        queryClient.invalidateQueries({ queryKey: ['payroll'] }),
      ])
    },
  })
  const rule = { borderColor: 'var(--border)' }
  return (
    <tr>
      <td className="border-b px-2 py-1.5 align-top" style={rule}>
        <span className="block font-medium" style={{ color: 'var(--ink-primary)' }}>
          {p.fullName}
        </span>
        <span className="block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {[p.department, p.position].filter(Boolean).join(' · ') || '—'}
        </span>
      </td>
      <td className="border-b px-2 py-1.5 align-top" style={rule}>
        {editing ? (
          <span className="flex flex-wrap items-center gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} className="max-w-[300px] min-w-[220px]" aria-label={`${p.fullName} — Bitrix24 xodimi`}>
              <option value="">— hech kim (jarima yoʻq) —</option>
              {p.suggestion && <option value={p.suggestion.employeeId}>★ {p.suggestion.fullName}</option>}
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                  {e.linked && e.id !== p.employeeId ? ' (boshqasiga bogʻlangan)' : ''}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate(pick === '' ? null : pick)}>
              Saqlash
            </Button>
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setEditing(false)}>
              Bekor
            </Button>
            {save.isError && (
              <span className="basis-full text-[11px]" style={{ color: 'var(--delta-down)' }}>
                {(save.error as Error).message}
              </span>
            )}
          </span>
        ) : p.employeeId ? (
          <>
            <span className="block" style={{ color: 'var(--ink-primary)' }}>
              {p.employeeName ?? p.employeeId}
            </span>
            <span className="block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {p.source ? SOURCE_TEXT[p.source] : ''}
              {p.source === 'manual' && p.linkedBy ? ` · ${p.linkedBy}` : ''}
            </span>
          </>
        ) : (
          <>
            <span className="block" style={{ color: 'var(--ink-muted)' }}>
              {p.source === 'manual' ? 'hech kim (qoʻlda)' : 'bogʻlanmagan'}
            </span>
            {p.suggestion && (
              <span className="block text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                ehtimol: {p.suggestion.fullName}
              </span>
            )}
          </>
        )}
      </td>
      <td className="border-b px-2 py-1.5 text-right align-top whitespace-nowrap" style={rule}>
        {canEdit && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {p.employeeId ? 'Oʻzgartirish' : 'Bogʻlash'}
          </Button>
        )}
      </td>
    </tr>
  )
}
