'use client'

import { PeriodFilter, type PeriodSelection } from '@/components/layout/PeriodFilter'

import { shiftDay, today } from './LeadSplitCards'

/**
 * «ROP otchet»'s window (2026-10-14, the user: «odatiy sahifalardek kun
 * boʻyicha va oy boʻyicha … oraliq boʻyicha ham»): the very control every
 * other page carries — «Bugun · Kecha · Shu oy» and the picker (Kun · Oy ·
 * Oraliq) — held by the page, not the URL, so the sheet's tab keeps its own.
 * The first cut was a Kun | Oy | Oraliq switch beside the field; the user
 * asked for it inside the picker, as elsewhere, the same day.
 */

export type RopWindow = PeriodSelection

/** Mirrors `REPORT_MAX_DAYS` in `app/api/v1/registration/schema.ts`. Nothing checks the mirror. */
export const RANGE_MAX_DAYS = 93

export const TODAY_WINDOW: RopWindow = { preset: 'today' }

/** The days a window asks for, on the Tashkent calendar — a preset read now, so «Bugun» follows midnight. */
export function windowDays(window: RopWindow): { from: string; to: string } {
  const now = today()
  switch (window.preset) {
    case 'yesterday':
      return { from: shiftDay(now, -1), to: shiftDay(now, -1) }
    case 'this_month':
      return { from: `${now.slice(0, 7)}-01`, to: now }
    case 'custom':
      if (window.from && window.to) return { from: window.from, to: window.to }
      return { from: now, to: now }
    default:
      return { from: now, to: now }
  }
}

export function RopWindowPicker({ value, onChange }: { value: RopWindow; onChange: (next: RopWindow) => void }) {
  return <PeriodFilter value={value.preset} from={value.from} to={value.to} onChange={onChange} maxDays={RANGE_MAX_DAYS} />
}
