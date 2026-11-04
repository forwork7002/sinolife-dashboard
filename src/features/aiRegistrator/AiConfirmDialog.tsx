'use client'

import { type KeyboardEvent, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { inked } from '@/features/aiRegistrator/AiNowPanel'

/**
 * A «Boshqaruv» question before a step that stops calls — «Toʻxtatish»,
 * «TLSʼni yangilash» (T144). The house modal (`.backdrop-dim` scrim,
 * `.glass-float` card, as «+ Yangi hisob»), not `window.confirm`: focus starts
 * on «Bekor qilish» and stays inside, Escape and the scrim cancel, the page
 * holds still.
 */
export function AiConfirmDialog({
  title,
  question,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  note,
  onConfirm,
  onCancel,
}: {
  readonly title: string
  readonly question: string
  readonly confirmLabel: string
  readonly pendingLabel: string
  readonly pending: boolean
  readonly error: string | null
  readonly note: string | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const textId = useId()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('button')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!pending) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="backdrop-dim fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} onKeyDown={onKeyDown} className="w-full max-w-md">
        <Card className="glass-float flex flex-col gap-4 px-5 py-5">
          <h2 id={titleId} className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {title}
          </h2>
          <p id={textId} className="text-[14px] leading-6" style={{ color: 'var(--ink-secondary)' }}>
            {question}
          </p>
          {note && (
            <p className="text-[13px]" style={{ color: inked('var(--status-warning)') }}>
              {note}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[13px]" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={onCancel}>
              Bekor qilish
            </Button>
            <Button variant="danger" disabled={pending} onClick={onConfirm}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}
