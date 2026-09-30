'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { apiWrite } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

import type { RnpCostLine, RnpCostProject, SaveRnpCostsBody } from './rnpApi'

/**
 * A typed P&L cost cell — the ONE exception to «nothing is typed by hand»
 * (the client, 2026-09-30): the five cost lines no system holds (bloggers,
 * nutritionist, brand face, marketing costs, team; rows 411–415 / 438–442)
 * are typed in place, one day at a time, in whole soʻm.
 *
 * IDLE IS A BUTTON, nothing heavier: about three hundred of these sit on the
 * sheet, and only the one being typed in mounts `CostEditor` with its
 * mutation. Click, Enter or F2 opens it.
 *
 * THE EDITOR: Enter or leaving the field saves, Escape puts the figure back,
 * Tab saves and opens the next day. An emptied field clears the day
 * (`value: null`). A typo is refused in place — red, said why, nothing sent.
 * While the save is on its way the typed figure stays, muted; the sheet is
 * refetched (`['rnp-overview']`) so this row, «Маркетинг харажат факт», CAC
 * and the share all recompute, and only then does the editor close. A save
 * the server refuses keeps the typed text, red, with the server's words.
 */
export function CostDayCell({
  month,
  day,
  project,
  line,
  label,
  value,
  display,
  className,
  style,
  title,
  last = false,
}: {
  month: string
  day: string
  project: RnpCostProject
  line: RnpCostLine
  /** «Блогерлар, 21.09» — what the button and the input are called. */
  label: string
  value: number | null
  display: ReactNode
  className: string
  style: CSSProperties
  title?: string
  /** The month's last day: the sheet's wider right edge. */
  last?: boolean
}) {
  const [active, setActive] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Set when the editor closes by the keyboard (Enter, Escape), so focus comes back here.
  const refocus = useRef(false)

  useEffect(() => {
    if (!active && refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [active])

  return (
    <td data-cost-cell="" title={active ? undefined : title} className={`${className} relative p-0`} style={style}>
      {active ? (
        <CostEditor
          month={month}
          day={day}
          project={project}
          line={line}
          label={label}
          value={value}
          last={last}
          onClose={(keyboard) => {
            refocus.current = keyboard
            setActive(false)
          }}
        />
      ) : (
        <button
          ref={button}
          type="button"
          data-cost-edit=""
          aria-label={`${label} — tahrirlash`}
          onClick={() => setActive(true)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault()
              setActive(true)
            }
          }}
          className={`block h-9 w-full cursor-text py-1.5 pl-3 ${last ? 'pr-5' : 'pr-3'} text-right transition-colors hover:bg-[var(--accent-soft)] hover:shadow-[inset_0_0_0_1px_var(--accent-line)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]`}
        >
          {display}
        </button>
      )}
    </td>
  )
}

const MAX_SUM = 1_000_000_000_000
const INVALID = 'Butun musbat son kiriting (soʻm), masalan 1 250 000.'
const TOO_BIG = 'Juda katta son — 1 000 000 000 000 soʻmdan oshmasin.'

/**
 * What the field holds, read: '' is null (clear the day); digits with
 * spaces or commas between the thousands are whole soʻm; anything else —
 * a minus, a decimal, a letter — is NaN, refused before anything is sent.
 */
function parseCost(text: string): number | null {
  const clean = text.replace(/[\s,  ]/g, '')
  if (clean === '') return null
  if (!/^\d+$/.test(clean)) return Number.NaN
  return Number(clean)
}

function CostEditor({
  month,
  day,
  project,
  line,
  label,
  value,
  last,
  onClose,
}: {
  month: string
  day: string
  project: RnpCostProject
  line: RnpCostLine
  label: string
  value: number | null
  last: boolean
  onClose: (keyboard: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState(() => (value === null ? '' : formatFullUzs(value)))
  const [problem, setProblem] = useState<{ message: string; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  // Escape, or a save already under way: the blur that follows must not save (again).
  const settled = useRef(false)
  const messageId = useId()

  const save = useMutation({
    mutationFn: (next: number | null) => {
      const body: SaveRnpCostsBody = { month, cells: [{ day, project, line, value: next }] }
      return apiWrite<{ saved: boolean }>('POST', '/rnp/costs', body)
    },
    // Closed only once the sheet has the new figure, so the cell never flashes the old one.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rnp-overview'] }),
  })

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  /** Save what is typed. False when it was refused in place (a typo) or is already on its way. */
  const commit = (keyboard: boolean): boolean => {
    if (save.isPending || settled.current) return false
    const next = parseCost(text)
    if (next !== null && Number.isNaN(next)) {
      setProblem({ message: INVALID, text })
      return false
    }
    if (next !== null && next > MAX_SUM) {
      setProblem({ message: TOO_BIG, text })
      return false
    }
    // A save the server refused, left as it was: leaving the field does not send it again.
    if (!keyboard && problem !== null && problem.text === text) return false
    settled.current = true
    if (next === value) {
      onClose(keyboard)
      return true
    }
    setProblem(null)
    save.mutate(next, {
      onSuccess: () => onClose(keyboard),
      onError: (error) => {
        settled.current = false
        setProblem({ message: error instanceof Error && error.message ? error.message : 'Saqlab boʻlmadi.', text })
      },
    })
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (save.isPending) return
      settled.current = true
      onClose(true)
    } else if (e.key === 'Tab') {
      // The neighbouring day in the same row, if it can be typed in; otherwise Tab goes on as usual.
      const td = e.currentTarget.closest('td')
      const sibling = e.shiftKey ? td?.previousElementSibling : td?.nextElementSibling
      const next = sibling?.querySelector<HTMLButtonElement>('button[data-cost-edit]') ?? null
      const invalid = Number.isNaN(parseCost(text)) || (parseCost(text) ?? 0) > MAX_SUM
      if (next || invalid) e.preventDefault()
      if (commit(false) && next) next.click()
    }
  }

  const wrong = problem !== null && problem.text === text
  const pending = save.isPending

  return (
    <>
      <input
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} — soʻm`}
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
        onBlur={() => {
          commit(false)
        }}
        className={`tabular block h-9 w-full min-w-0 py-1.5 pl-3 text-right ${last ? 'pr-5' : 'pr-3'} outline-none transition-opacity ${pending ? 'opacity-60' : ''}`}
        style={{
          background: wrong ? 'color-mix(in oklab, var(--status-critical) 12%, var(--surface-raised))' : 'var(--surface-raised)',
          color: 'var(--ink-primary)',
          boxShadow: `inset 0 0 0 2px ${wrong ? 'var(--status-critical)' : 'var(--accent)'}`,
          cursor: pending ? 'progress' : undefined,
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
