'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CSSProperties, type KeyboardEvent, useId, useState } from 'react'

import { apiWrite } from '@/lib/api'

import type { RnpManual, RnpUnit, SaveRnpCostsBody, SaveRnpHeadcountBody, SaveRnpPlanBody } from './rnpApi'
import { formatUsd, rnpNumber, rnpUzs } from './rnpFigures'

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
const MULTI_CELL = 'Bir nechta katak qoʻyildi — bitta katakni nusxalang.'

/**
 * Several cells of a sheet in one field: a TAB between a row's cells, a line
 * break between a column's (2026-10-02). Never read as one number — «5 075 000
 * ⇥ 0» (a cost and its empty neighbour) was saved as 50 750 000.
 */
const SEVERAL_CELLS = /[\t\r\n]/

/**
 * What the field holds, read: '' is null (clear the day); digits alone, or
 * 1–3 digits followed by groups of three that all use ONE separator — a
 * space, a dot or a comma («1.250.000», the way the field shows it;
 * «5 075 000») — are whole soʻm. A non-breaking or narrow space (how a
 * spreadsheet groups a copied figure) is a space; a grouped number starts
 * with a non-zero digit. Anything else is NaN, refused before anything is
 * sent: a minus, a decimal («12.5»), a letter, a misplaced group («1 25 000»
 * is not 125 000) and several cells (`SEVERAL_CELLS`).
 */
export function parseCost(text: string): number | null {
  if (SEVERAL_CELLS.test(text)) return Number.NaN
  const clean = text.replace(/\s/g, ' ').trim()
  if (clean === '') return null
  if (!/^\d+$/.test(clean) && !/^[1-9]\d{0,2}([ .,])\d{3}(\1\d{3})*$/.test(clean)) return Number.NaN
  return Number(clean.replace(/\D/g, ''))
}

/**
 * Several cells on the clipboard — a row's or a column's; the line break a
 * spreadsheet puts after ONE copied cell does not count — as the field keeps
 * them (a TAB between each), so the field refuses them; null for one cell.
 * Taken off the paste itself: a field pastes a line break as a space, and
 * a column's «500 000⏎300 000» would read as one figure, 500 000 300 000.
 */
export function pastedCells(clipboard: string): string | null {
  const cells = clipboard.replace(/[\r\n]+$/, '')
  return SEVERAL_CELLS.test(cells) ? cells.replace(/\r\n|[\r\n]/g, '\t') : null
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
 * ONE separator, dots or spaces, the decimals then after a comma
 * («1.200,5», «1 200,5»); anything else is NaN — a misplaced group, or
 * several cells (`SEVERAL_CELLS`: «8⇥5» is not 85). A grouped number starts
 * with a non-zero digit, so «0.850» is a typo, not 850.
 *
 * The row's own sign may come with it (2026-10-02) — the field shows it
 * («$36.000», «80%») and the client's sheet writes it («16 000$», «0,80$»):
 * one «$» before or after a dollar plan, one «%» after a percent. Not the
 * other row's sign: «80%» in a dollar field is a slip, refused like any typo.
 */
export function parseDecimal(text: string, sign?: '$' | '%'): number | null {
  if (SEVERAL_CELLS.test(text)) return Number.NaN
  const typed = text.replace(/\s/g, ' ').trim()
  if (typed === '') return null
  const clean = (sign === '$' ? typed.replace(/^\$|\$$/, '') : sign === '%' ? typed.replace(/%$/, '') : typed).trim()
  if (/^[1-9]\d{0,2}([ .])\d{3}(\1\d{3})*(,\d{1,2})?$/.test(clean)) return Number(clean.replace(/[ .]/g, '').replace(',', '.'))
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
/**
 * A typed dollar plan with its sign, as the figures beside it read: to the
 * cent under $10 («$0,80», `formatUsd`), else whole or to the typed cent
 * («$36.000», «$12,34») — a field never rounds away what was typed.
 */
function showUsd(v: number): string {
  return Math.abs(v) < 10 ? formatUsd(v) : `$${rnpNumber(Math.round(v * 100) / 100)}`
}

const PLAN: Readonly<Record<RnpUnit, KindSpec>> = {
  uzs: { ...COST, unit: 'reja, soʻm' },
  count: { ...COST, show: (v) => rnpNumber(v), invalid: 'Butun son kiriting, masalan 1.400.', tooBig: 'Juda katta son.', unit: 'reja' },
  // «80.000» is 80 thousand, not 80: a percent past 1 000 is a typo, refused rather than saved.
  // Shown with the sign the figures beside them carry («80%», «$36.000»), and read back with it.
  percent: { parse: (t) => parseDecimal(t, '%'), show: (v) => `${rnpNumber(Math.round(v * 100) / 100)}%`, max: 1000, invalid: 'Son kiriting, masalan 80 yoki 12,5.', tooBig: 'Juda katta foiz — 1 000% dan oshmasin.', unit: 'reja, %', inputMode: 'decimal' },
  usd: { parse: (t) => parseDecimal(t, '$'), show: showUsd, max: 10_000_000, invalid: 'Son kiriting, masalan 36.000 yoki 0,8.', tooBig: 'Juda katta son — 10 mln $ dan oshmasin.', unit: 'reja, $', inputMode: 'decimal' },
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
    // Untouched since the server last filled it: take the server's figure — a refetch may have brought
    // somebody else's save while the field had focus — and send nothing, never the old figure back over it.
    if (text === shown(synced)) {
      setProblem(null)
      setSynced(value)
      setText(shown(value))
      return
    }
    // A sheet's row or column in one field: refused as such, never read as one number.
    if (SEVERAL_CELLS.test(text)) {
      setProblem({ message: MULTI_CELL, text })
      return
    }
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
        onPaste={(e) => {
          const cells = pending ? null : pastedCells(e.clipboardData.getData('text'))
          if (cells === null) return
          // Kept apart and refused at once: pasted as-is, a column's line breaks would become spaces.
          e.preventDefault()
          setText(cells)
          setProblem({ message: MULTI_CELL, text: cells })
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
        // The figure's right edge where a computed one's is: the cell's 2px and these 10px are their `px-3` (18px: the last day's `pr-5`).
        className={`tabular block h-8 w-full min-w-0 rounded-[5px] py-1 pl-2 text-right ${last ? 'pr-[18px]' : 'pr-2.5'} outline-none transition-[opacity,box-shadow] placeholder:text-[var(--ink-muted)] ${pending ? 'opacity-60' : ''}`}
        style={{
          background: wrong ? 'color-mix(in oklab, var(--status-critical) 12%, var(--surface-raised))' : 'var(--surface-raised)',
          color: 'var(--ink-primary)',
          // The focus ring from state: an inline shadow outranks any `focus:` class, so one never showed.
          boxShadow: wrong ? 'inset 0 0 0 2px var(--status-critical)' : focused ? 'inset 0 0 0 2px var(--accent)' : 'inset 0 0 0 1px var(--border-strong)',
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
