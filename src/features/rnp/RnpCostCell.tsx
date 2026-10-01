'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CSSProperties, type KeyboardEvent, useId, useState } from 'react'

import { apiWrite } from '@/lib/api'

import type { RnpManual, RnpUnit, SaveRnpCostsBody, SaveRnpHeadcountBody, SaveRnpPlanBody } from './rnpApi'
import { rnpNumber, rnpUzs } from './rnpFigures'

/** What a typed cell saves: a typed row's day (`RnpManual`), or a typed plan cell (column C, `planInput`). */
export type RnpTyped = RnpManual | { readonly kind: 'plan'; readonly team: string; readonly metric: string; readonly unit: RnpUnit }

/**
 * A typed day cell — the exceptions to «nothing is typed by hand»: the P&L's
 * five cost lines no system holds (bloggers, nutritionist, brand face,
 * marketing costs, team; rows 411–415 / 438–442 — the client, 2026-09-30),
 * in whole soʻm, and each ROP team's «Ходим сони» (2026-10-01), in whole
 * people, typed in place one day at a time — and every plan the sheet types
 * in column C (2026-10-01, `planInput`), in the row's own unit.
 *
 * ALWAYS OPEN, like a spreadsheet (the client: «qo'lda kiritiladigan joylar
 * ochiq tursin»): every day of these rows is a field — click and type, no
 * button to press first. Enter or leaving the field saves, Escape puts the
 * saved figure back, Tab moves on as it does in any form. An emptied field
 * clears the day (`value: null`). A typo is refused in place — red, said
 * why, nothing sent. While the save is on its way the figure stays, muted;
 * the sheet is refetched (`['rnp-overview']`) so this row, «Маркетинг
 * харажат факт», CAC and the share all recompute. A save the server refuses
 * keeps the typed text, red, with the server's words.
 */
export function CostDayCell({
  month,
  day,
  manual,
  label,
  value,
  className,
  style,
  title,
  last = false,
}: {
  month: string
  day: string
  /** What the cell saves under: a cost line's or a team's headcount's day, or a plan. */
  manual: RnpTyped
  /** «Блогерлар, 21.09» — what the field is called. */
  label: string
  value: number | null
  className: string
  style: CSSProperties
  title?: string
  /** The month's last day: the sheet's wider right edge. */
  last?: boolean
}) {
  return (
    <td data-cost-cell="" title={title} className={`${className} relative p-0.5`} style={style}>
      <CostField month={month} day={day} manual={manual} label={label} value={value} last={last} />
    </td>
  )
}

const MAX_SUM = 1_000_000_000_000
const INVALID = 'Butun musbat son kiriting (soʻm), masalan 1.250.000.'
const TOO_BIG = 'Juda katta son — 1 000 000 000 000 soʻmdan oshmasin.'

/**
 * What the field holds, read: '' is null (clear the day); digits with
 * spaces between them, or dots or commas between the thousands, are whole
 * soʻm («1.250.000», the way the field shows it); anything else — a minus,
 * a decimal («12.5»), a letter — is NaN, refused before anything is sent.
 */
function parseCost(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f]/g, ' ').trim()
  if (clean === '') return null
  if (!/^\d[\d .,]*$/.test(clean) || /[.,](?!\d{3}(?:\D|$))/.test(clean)) return Number.NaN
  return Number(clean.replace(/\D/g, ''))
}

/** Whole people: digits only; anything else is NaN, refused before anything is sent. */
function parseHeads(text: string): number | null {
  const clean = text.trim()
  if (clean === '') return null
  return /^\d+$/.test(clean) ? Number(clean) : Number.NaN
}

/**
 * A plan in percent or dollars: up to two decimals after a comma («12,5»,
 * the way the sheet writes them) or a dot («12.5»), thousands grouped by
 * dots («1.200,5»); anything else is NaN.
 */
export function parseDecimal(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f]/g, '').trim()
  if (clean === '') return null
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(clean)) return Number(clean.replaceAll('.', '').replace(',', '.'))
  if (/^\d+([.,]\d{1,2})?$/.test(clean)) return Number(clean.replace(',', '.'))
  return Number.NaN
}

interface KindSpec {
  readonly parse: (text: string) => number | null
  readonly show: (value: number) => string
  readonly max: number
  readonly invalid: string
  readonly tooBig: string
  /** The field's unit, in its accessible name. */
  readonly unit: string
  /** `decimal` where a comma is typed — a phone's numeric pad has none. */
  readonly inputMode: 'numeric' | 'decimal'
}

const COST: KindSpec = { parse: parseCost, show: rnpUzs, max: MAX_SUM, invalid: INVALID, tooBig: TOO_BIG, unit: 'soʻm', inputMode: 'numeric' }
const HEADCOUNT: KindSpec = {
  parse: parseHeads,
  show: (v) => String(v),
  max: 1000,
  invalid: 'Butun son kiriting (kishi), masalan 12.',
  tooBig: 'Juda katta son — 1000 kishidan oshmasin.',
  unit: 'kishi',
  inputMode: 'numeric',
}
const PLAN: Readonly<Record<RnpUnit, KindSpec>> = {
  uzs: { ...COST, unit: 'reja, soʻm' },
  count: { ...COST, show: (v) => rnpNumber(v), invalid: 'Butun son kiriting, masalan 1.400.', tooBig: 'Juda katta son.', unit: 'reja' },
  // «80.000» is 80 thousand, not 80: a percent past 1 000 is a typo, refused rather than saved.
  percent: { parse: parseDecimal, show: (v) => rnpNumber(Math.round(v * 100) / 100), max: 1000, invalid: 'Son kiriting, masalan 80 yoki 12,5.', tooBig: 'Juda katta foiz — 1 000% dan oshmasin.', unit: 'reja, %', inputMode: 'decimal' },
  usd: { parse: parseDecimal, show: (v) => rnpNumber(Math.round(v * 100) / 100), max: 10_000_000, invalid: 'Son kiriting, masalan 36.000 yoki 0,8.', tooBig: 'Juda katta son — 10 mln $ dan oshmasin.', unit: 'reja, $', inputMode: 'decimal' },
}

/** Each kind of typed cell: how it is read, shown, checked and saved. */
function specOf(manual: RnpTyped): KindSpec {
  return manual.kind === 'cost' ? COST : manual.kind === 'headcount' ? HEADCOUNT : PLAN[manual.unit]
}

function request(month: string, day: string, manual: RnpTyped, value: number | null): { path: string; body: SaveRnpCostsBody | SaveRnpHeadcountBody | SaveRnpPlanBody } {
  switch (manual.kind) {
    case 'cost':
      return { path: '/rnp/costs', body: { month, cells: [{ day, project: manual.project, line: manual.line, value }] } }
    case 'headcount':
      return { path: '/rnp/headcount', body: { month, cells: [{ day, rop: manual.rop, value }] } }
    case 'plan':
      return { path: '/rnp/plan', body: { month, cells: [{ team: manual.team, metric: manual.metric, value }] } }
  }
}

function CostField({
  month,
  day,
  manual,
  label,
  value,
  last,
}: {
  month: string
  day: string
  manual: RnpTyped
  label: string
  value: number | null
  last: boolean
}) {
  const queryClient = useQueryClient()
  const kind = specOf(manual)
  const shown = (v: number | null) => (v === null ? '' : kind.show(v))
  const [text, setText] = useState(() => shown(value))
  const [problem, setProblem] = useState<{ message: string; text: string } | null>(null)
  // The figure the field last showed from the server — a refetch that changes it refreshes an untouched field.
  const [synced, setSynced] = useState(value)
  const [focused, setFocused] = useState(false)
  const messageId = useId()
  if (value !== synced && !focused) {
    setSynced(value)
    setText(shown(value))
  }

  const save = useMutation({
    mutationFn: (next: number | null) => {
      const { path, body } = request(month, day, manual, next)
      return apiWrite<{ saved: boolean }>('POST', path, body)
    },
    // Closed only once the sheet has the new figure, so the cell never flashes the old one.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rnp-overview'] }),
  })

  /** Save what is typed, if it changed. Nothing is sent for a typo (refused in place) or while a save is on its way. */
  const commit = (retry: boolean) => {
    if (save.isPending) return
    const next = kind.parse(text)
    if (next !== null && Number.isNaN(next)) {
      setProblem({ message: kind.invalid, text })
      return
    }
    if (next !== null && next > kind.max) {
      setProblem({ message: kind.tooBig, text })
      return
    }
    // A save the server refused, left as it was: leaving the field does not send it again; Enter does.
    if (!retry && problem !== null && problem.text === text) return
    // Unchanged as the field writes it: a 233 333,33 saved elsewhere is not rounded away by a tab-through.
    if (next === value || (next !== null && value !== null && kind.show(next) === kind.show(value))) {
      setProblem(null)
      setText(shown(value))
      return
    }
    setProblem(null)
    save.mutate(next, {
      // Written in full at once, even while the field still has focus.
      onSuccess: () => {
        setSynced(next)
        setText(shown(next))
      },
      onError: (error) => setProblem({ message: error instanceof Error && error.message ? error.message : 'Saqlab boʻlmadi.', text }),
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (save.isPending) return
      setProblem(null)
      setText(shown(value))
    }
  }

  const wrong = problem !== null && problem.text === text
  const pending = save.isPending

  return (
    <>
      <input
        type="text"
        inputMode={kind.inputMode}
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} — ${kind.unit}`}
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? messageId : undefined}
        aria-busy={pending || undefined}
        readOnly={pending}
        value={text}
        title={wrong ? problem.message : undefined}
        onChange={(e) => {
          setText(e.target.value)
        }}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          commit(false)
        }}
        placeholder="—"
        className={`tabular block h-8 w-full min-w-0 rounded-[5px] py-1 pl-2 text-right ${last ? 'pr-4' : 'pr-2'} outline-none transition-[opacity,box-shadow] placeholder:text-[var(--ink-muted)] focus:shadow-[inset_0_0_0_2px_var(--accent)] ${pending ? 'opacity-60' : ''}`}
        style={{
          background: wrong ? 'color-mix(in oklab, var(--status-critical) 12%, var(--surface-raised))' : 'var(--surface-raised)',
          color: 'var(--ink-primary)',
          boxShadow: wrong ? 'inset 0 0 0 2px var(--status-critical)' : 'inset 0 0 0 1px var(--border-strong)',
          cursor: pending ? 'progress' : 'text',
        }}
      />
      {wrong && (
        <span
          id={messageId}
          role="alert"
          className="absolute top-full right-0 z-20 mt-0.5 w-max max-w-[16rem] rounded-[6px] px-2 py-1 text-left text-[11.5px] leading-snug font-medium whitespace-normal shadow-md"
          style={{ background: 'var(--status-critical)', color: 'var(--surface-raised)' }}
        >
          {problem.message}
        </span>
      )}
    </>
  )
}
