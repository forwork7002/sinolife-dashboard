'use client'

import type { ReactNode } from 'react'

import { ArrowDownGlyph, ArrowUpGlyph, CheckCircleGlyph, TriangleGlyph } from '@/components/ui/Icons'

/*
  Bitrix24 ↔ MoySklad farqi BUTUN birlikda oʻqiladi. MoySkladʼning qatorlari
  tiyin olib yuradi va jamilar float yigʻindi, shuning uchun bir tiyin yoki float
  shovqini ikki teng raqam yonida «-0» / «+1» qizil boʻlib chiqardi — bir soʻmdan
  (yoki bir donadan) kam farq — farq emas. Bu qoida ProductCompareCard bilan
  kelgan; endi KPIʼning ikkala solishtiruv jadvali uni birga ishlatadi.
*/
export const gapIsZero = (value: number): boolean => Math.round(value) === 0

/**
 * Mos kelmagan qatorning yengil tusi; mos qatorga `undefined` qaytadi — uning
 * oddiy fonini (va hover holatini) tegmay qoldiradi. Rang oʻrnini «critical»
 * ustiga `--surface-raised` ni aralashtirib beradi, shunda PIN qilingan (yopishib
 * turuvchi) nom katagi SHAFFOF emas, QORAMTIR-TINIQ qoladi — telefonda raqamlar
 * uning ostidan oʻtib ketmaydi.
 */
export function rowTint(matched: boolean): string | undefined {
  return matched ? undefined : 'color-mix(in oklab, var(--status-critical) 7%, var(--surface-raised))'
}

/**
 * «Farq» — ishorali raqam emas, BELGI. Mos katak — xotirjam kulrang tире; farq
 * esa tusli hab (pill) boʻlib, yoʻnalishi chizilgan: ▲ MoySkladʼda koʻp,
 * ▼ Bitrix24ʼda koʻp — koʻz farqqa oʻzi tushadi va qaysi tomon ogʻirligini ishorani
 * oʻqimay koʻradi. Rang doim «critical»: farq — qay tomonga qaramasin — farq.
 */
export function DeltaBadge({
  value,
  format,
}: {
  readonly value: number
  readonly format: (v: number) => string
}) {
  const whole = Math.round(value)
  if (whole === 0) {
    return (
      <span className="inline-flex" style={{ color: 'var(--ink-muted)' }} aria-label="farq yoʻq">
        —
      </span>
    )
  }
  const Arrow = whole > 0 ? ArrowUpGlyph : ArrowDownGlyph
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums"
      style={{ background: 'color-mix(in oklab, var(--status-critical) 14%, transparent)', color: 'var(--status-critical)' }}
      aria-label={`farq ${whole > 0 ? '+' : '−'}${format(Math.abs(whole))}`}
    >
      <Arrow size={10} className="shrink-0" />
      {format(Math.abs(whole))}
    </span>
  )
}

/**
 * Brendning sarlavha qatoridagi bir soʻzli hukmi: ostidagi har bir raqam mos
 * kelsa — «mos», ba’zilari kelmasa — «N farq». «good» ga qarshi «critical», uy
 * uslubidagi hab. Koʻz butun jadvalni oʻqimay, brend darajasida xulosani oladi.
 */
export function ReconcileChip({ mismatches }: { readonly mismatches: number }) {
  const matched = mismatches === 0
  const color = matched ? 'var(--status-good)' : 'var(--status-critical)'
  const Glyph = matched ? CheckCircleGlyph : TriangleGlyph
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
      style={{ background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
    >
      <Glyph size={10} className="shrink-0" />
      {matched ? 'mos' : `${mismatches} farq`}
    </span>
  )
}

/**
 * Mos kelmagan tovarning nomi PIN qilingan katakda kichik ogohlantirish belgisini
 * olib yuradi — raqamlar oʻngga surilib ketganda ham koʻzda qoladigan yagona
 * ustun shu. Mos qator esa toza: hech qanday belgi yoʻq, chunki reconciliation
 * jadvalida tinch qolishi kerak boʻlgan narsa — moslik.
 */
export function RowMark({ matched, children }: { readonly matched: boolean; readonly children: ReactNode }) {
  if (matched) return <>{children}</>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex shrink-0" style={{ color: 'var(--status-critical)' }}>
        <TriangleGlyph size={10} />
      </span>
      <span>{children}</span>
    </span>
  )
}
