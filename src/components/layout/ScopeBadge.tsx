'use client'

import { useEffect, useId, useRef, useState } from 'react'

import {
  isCompanyWideSection,
  isOpenToEveryoneSection,
  readsCompanyWide,
  SECTIONS,
} from '@/lib/sections'
import type { Viewer } from '@/lib/viewer'

/**
 * «Sizga nima koʻrinadi» — a narrowed account told, in words, what it reads.
 *
 * Asked for on 2026-10-19 after Malika's team scope was fixed: «qaysi
 * boʻlimlar, qaysi sotuvchilarni koʻra oladi — shular koʻrinadi deyilishi
 * kerak, oddiygina qilib». An account scoped to its team could see fewer rows
 * than a colleague and had nothing on screen saying why or whose rows they
 * were. The chip names the scope, the panel lists every screen in the rail
 * with how much of it this account reads, and the people its «Oʻz boʻlimi»
 * screens are cut to.
 *
 * Presentation only, like the rail it mirrors: the sections listed are the
 * rail's own (`grantedRoutes` in Shell), the reading per screen is
 * `readsCompanyWide` (the client half of `widenForSection`), and the people are
 * the server's resolved scope (`scopeMembers` on `/meta/filters`). A
 * company-wide account has nothing to be told and gets no chip.
 */

type Member = { readonly id: string; readonly fullName: string }

export function ScopeBadge({
  viewer,
  members,
}: {
  viewer: Viewer
  /** `undefined` while `/meta/filters` is on its way; `null` for an ALL account. */
  members: readonly Member[] | null | undefined
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (viewer.dataScope === 'ALL') return null

  const own = viewer.dataScope === 'OWN'
  const ownLabel = own ? 'Faqat oʻzingiz' : 'Oʻz jamoangiz'
  const count = members?.length
  const screens = SECTIONS.filter(
    (spec) =>
      viewer.sections.includes(spec.id) &&
      (readsCompanyWide(viewer, spec.id) || !isCompanyWideSection(spec.id)),
  ).map((spec) => ({
    id: spec.id,
    label: spec.label,
    wide: readsCompanyWide(viewer, spec.id) || isOpenToEveryoneSection(spec.id),
  }))

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Sizga nima koʻrinadi: ${ownLabel}${count !== undefined && !own ? `, ${count} kishi` : ''}`}
        data-testid="scope-badge"
        className="rail-item focusable flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium whitespace-nowrap"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <TeamGlyph />
        <span className="hidden sm:inline">{ownLabel}</span>
        {!own && count !== undefined && (
          <span
            className="rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Sizga nima koʻrinadi"
          data-testid="scope-panel"
          className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+60px)] z-30 rounded-[var(--radius-panel)] border p-4 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[340px]"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--border-strong)',
            boxShadow: 'var(--shadow-ambient)',
            color: 'var(--ink-primary)',
          }}
        >
          <p className="text-[14px] font-semibold">Sizga nima koʻrinadi</p>
          <p className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            {own
              ? '«Faqat oʻzingiz» yozilgan boʻlimlarda faqat sizning natijangiz chiqadi.'
              : '«Oʻz jamoangiz» yozilgan boʻlimlarda faqat quyidagi xodimlarning natijasi chiqadi.'}
          </p>

          <p
            className="mt-4 text-[11px] font-semibold tracking-wide uppercase"
            style={{ color: 'var(--ink-muted)' }}
          >
            Boʻlimlar
          </p>
          <ul className="mt-1.5 space-y-1" data-testid="scope-sections">
            {screens.map((screen) => (
              <li key={screen.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{screen.label}</span>
                <span
                  className="shrink-0 rounded-full px-2 text-[11px] leading-[20px] font-medium"
                  style={
                    screen.wide
                      ? { background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }
                      : { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }
                  }
                >
                  {screen.wide ? 'Butun kompaniya' : ownLabel}
                </span>
              </li>
            ))}
          </ul>

          {!own && (
            <>
              <p
                className="mt-4 text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: 'var(--ink-muted)' }}
              >
                Jamoangiz{count !== undefined ? ` · ${count} kishi` : ''}
              </p>
              {members === undefined ? (
                <p className="mt-1.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  Yuklanmoqda…
                </p>
              ) : !members || members.length === 0 ? (
                <p className="mt-1.5 text-[12px]" style={{ color: 'var(--status-warning)' }}>
                  Hisobingiz hech bir xodimga bogʻlanmagan — administratorga murojaat qiling.
                </p>
              ) : (
                <ul
                  className="mt-1.5 max-h-[220px] space-y-0.5 overflow-y-auto text-[13px]"
                  data-testid="scope-members"
                >
                  {members.map((member) => (
                    <li key={member.id} className="truncate">
                      {member.fullName}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <p className="mt-4 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            Oʻzgartirish kerak boʻlsa — administratorga murojaat qiling.
          </p>
        </div>
      )}
    </div>
  )
}

function TeamGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19a5.5 5.5 0 0111 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M16 6.5a3 3 0 010 5.9M17.5 19a5.5 5.5 0 00-2-4.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}
