'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { apiWrite } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

import type { SalesTeamDto, SavePlansBody } from './salesTeamApi'
import { TableCard, muted } from '@/features/reklama/reklamaUi'

/**
 * «Rejalar» — the plans the ROP sheets are measured against, typed in here
 * because nothing in Bitrix24 holds them.
 *
 * ONE TEAM AT A TIME, the team the tables below are showing: its month plan
 * for FAKT 1 and FAKT 2, and each seller's plan for one day. Whole soʻm, with
 * the digits grouped as they are typed so 5000000 cannot be misread as
 * 500000. An emptied field removes that plan — «no plan» is no row, never a
 * plan of zero, which the tables would read as «missed it entirely».
 */
export function PlanEditor({ month, team, onClose }: { month: string; team: SalesTeamDto; onClose: () => void }) {
  const queryClient = useQueryClient()
  const whole = (minor: string | undefined) => (minor ? String(BigInt(minor) / 100n) : '')

  const [fakt1, setFakt1] = useState(whole(team.plan.fakt1?.amountMinor))
  const [fakt2, setFakt2] = useState(whole(team.plan.fakt2?.amountMinor))
  const [sellers, setSellers] = useState<Record<string, string>>(() =>
    Object.fromEntries(team.roster.map((r) => [r.employeeId, whole(r.dayPlan?.amountMinor)])),
  )

  const toNumber = (text: string): number | null => {
    const digits = text.replace(/\D/g, '')
    return digits === '' ? null : Number(digits)
  }

  const save = useMutation({
    mutationFn: () => {
      const body: SavePlansBody = {
        month,
        teams: [{ rop: team.rop, fakt1: toNumber(fakt1), fakt2: toNumber(fakt2) }],
        sellers: team.roster.map((r) => ({ employeeId: r.employeeId, dayPlan: toNumber(sellers[r.employeeId] ?? '') })),
      }
      return apiWrite<{ saved: boolean }>('POST', '/sales-team/plans', body)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales-team'] })
      onClose()
    },
  })

  return (
    <TableCard
      title={`Rejalar — ${team.rop}, ${month}`}
      hint="Soʻmda. Boʻsh qoldirilgan maydon rejani olib tashlaydi."
      footer={
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
          <Button size="sm" onClick={onClose} disabled={save.isPending}>
            Bekor qilish
          </Button>
          {save.isError && (
            <span role="alert" style={{ color: 'var(--status-critical)' }}>
              {save.error instanceof Error ? save.error.message : 'Saqlab boʻlmadi'}
            </span>
          )}
        </span>
      }
    >
      <div className="grid gap-5 px-5 pb-2 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <fieldset className="flex flex-col gap-3">
          <legend className="eyebrow mb-2">Guruh · oylik reja</legend>
          <SomField label="FAKT 1 rejasi" value={fakt1} onChange={setFakt1} />
          <SomField label="FAKT 2 rejasi" value={fakt2} onChange={setFakt2} />
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="eyebrow mb-2">Sotuvchilar · kunlik reja</legend>
          {team.roster.length === 0 ? (
            <p className="text-xs" style={muted}>
              Bu guruhda faol sotuvchi yoʻq.
            </p>
          ) : (
            <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
              {team.roster.map((r) => (
                <SomField
                  key={r.employeeId}
                  label={r.fullName}
                  value={sellers[r.employeeId] ?? ''}
                  onChange={(v) => setSellers((s) => ({ ...s, [r.employeeId]: v }))}
                />
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </TableCard>
  )
}

function SomField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const digits = value.replace(/\D/g, '')
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span className="min-w-0 truncate" style={{ color: 'var(--ink-secondary)' }} title={label}>
        {label}
      </span>
      <input
        inputMode="numeric"
        value={digits === '' ? '' : formatFullUzs(Number(digits))}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 13))}
        placeholder="—"
        className="focusable tabular w-36 shrink-0 rounded-[var(--radius-panel-sm)] border px-2 py-1 text-right text-xs"
        style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
      />
    </label>
  )
}
