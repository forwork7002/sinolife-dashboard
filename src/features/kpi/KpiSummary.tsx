'use client'

import { useMemo } from 'react'

import { ArrowDownGlyph, ArrowUpGlyph, CheckCircleGlyph } from '@/components/ui/Icons'
import { figureText, rnpPercent } from '@/features/rnp/rnpFigures'
import { inkOf, mix } from '@/features/shared/sheetGrid'

import { type KpiPair, type KpiSheetLine, type KpiSheetScope, sheetGroups, wholeGap } from './kpiSheetApi'

/**
 * «KPI jadvali»'s first glance (the client, 2026-10-23: «visual darajasida
 * oʻzgacharoq va yaxshiroq»): the month's headline figures for the brand on
 * screen, each as Bitrix24's number with MoySklad's under it and the verdict
 * — «✓ mos» or the gap — before a single row of the sheet is read. Read off
 * the sheet's own block for that brand (`sheetGroups`), so a tile and the
 * «Jami» cell under it are one figure.
 */
export function KpiSummary({ lines, scope }: { readonly lines: readonly KpiSheetLine[]; readonly scope: KpiSheetScope }) {
  const tiles = useMemo(() => {
    const groups = sheetGroups(lines)
    const pair = (key: string) => groups.find((g): g is KpiPair => g.kind === 'pair' && g.key === `${scope}:${key}`) ?? null
    const single = (key: string) => {
      const line = lines.find((l) => l.kind === 'value' && l.key === `${scope}:${key}`)
      return line?.kind === 'value' ? line.total : null
    }
    return {
      fakt1: pair('orders:FAKT1'),
      fakt2: pair('orders:FAKT2'),
      sum1: pair('amount:FAKT1'),
      sum2: pair('amount:FAKT2'),
      nutri1: pair('nutritionist:FAKT1'),
      nutri2: pair('nutritionist:FAKT2'),
      mismatch1: single('mismatch:FAKT1'),
      mismatch2: single('mismatch:FAKT2'),
    }
  }, [lines, scope])

  return (
    <section aria-label="Oy xulosasi" className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible xl:grid-cols-6">
      <PairTile title="Buyurtmalar · FAKT 1" pair={tiles.fakt1} />
      <PairTile title="Buyurtmalar · FAKT 2" pair={tiles.fakt2} />
      <PairTile title="Summa · FAKT 1" pair={tiles.sum1} suffix="soʻm" />
      <PairTile title="Summa · FAKT 2" pair={tiles.sum2} suffix="soʻm" />
      <NutritionTile fakt1={tiles.nutri1} fakt2={tiles.nutri2} />
      <MismatchTile fakt1={tiles.mismatch1} fakt2={tiles.mismatch2} />
    </section>
  )
}

const TILE =
  'relative min-w-[210px] snap-start overflow-hidden rounded-[var(--radius-panel)] border px-3.5 py-3 sm:min-w-0'

function tileStyle(tone: string) {
  return {
    borderColor: mix(tone, 28, 'var(--border)'),
    background: `linear-gradient(160deg, ${mix(tone, 10, 'var(--surface-raised)')}, var(--surface-raised) 70%)`,
  }
}

/** One figure: Bitrix24 big, MoySklad under it, the verdict in the corner. */
function PairTile({ title, pair, suffix }: { title: string; pair: KpiPair | null; suffix?: string }) {
  const gap = pair?.gapTotal === null || pair?.gapTotal === undefined ? 0 : wholeGap(pair.gapTotal, pair.unit)
  const tone = !pair ? 'var(--ink-muted)' : gap === 0 ? 'var(--status-good)' : 'var(--status-critical)'
  return (
    <article className={TILE} style={tileStyle(tone)}>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone }} />
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          {title}
        </h3>
        {pair && <Verdict gap={gap} unit={pair.unit} />}
      </header>
      <p className="tabular mt-1.5 flex items-baseline gap-1.5 text-[19px] leading-tight font-bold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        {pair?.bitrix.total == null ? '—' : figureText(pair.bitrix.total, pair.unit)}
        {suffix && pair && (
          <span className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {suffix}
          </span>
        )}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        <span className="inline-flex items-center gap-1">
          <Dot hue="var(--series-1)" />
          Bitrix24
        </span>
        <span className="inline-flex items-center gap-1">
          <Dot hue="var(--series-3)" />
          MoySklad
          <span className="tabular font-semibold" style={{ color: gap === 0 ? 'var(--ink-secondary)' : 'var(--status-critical)' }}>
            {pair?.moysklad.total == null ? '—' : figureText(pair.moysklad.total, pair.unit)}
          </span>
        </span>
      </p>
      {pair?.match != null && (
        <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
          Moslik: <span className="tabular font-semibold">{pair.match >= 99.995 ? '100%' : rnpPercent(Math.floor(pair.match * 10) / 10)}</span>
        </p>
      )}
    </article>
  )
}

/** «Нутрицолог» — what the two FAKT figures pay at 2 $ an order, on Bitrix24's count. */
function NutritionTile({ fakt1, fakt2 }: { fakt1: KpiPair | null; fakt2: KpiPair | null }) {
  const tone = 'var(--series-7)'
  return (
    <article className={TILE} style={tileStyle(tone)}>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone }} />
      <h3 className="text-[11.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        Нутрицолог · 2 $ buyurtmaga
      </h3>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
        <NutritionRow term="FAKT 1" pair={fakt1} ink={inkOf(tone)} />
        <NutritionRow term="FAKT 2" pair={fakt2} ink={inkOf(tone)} />
      </dl>
    </article>
  )
}

/** The orders whose two sides disagree — the count that sends somebody to the drawer. */
function MismatchTile({ fakt1, fakt2 }: { fakt1: number | null; fakt2: number | null }) {
  const any = (fakt1 ?? 0) + (fakt2 ?? 0) > 0
  const tone = any ? 'var(--status-critical)' : 'var(--status-good)'
  return (
    <article className={TILE} style={tileStyle(tone)}>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone }} />
      <h3 className="text-[11.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        Farqli buyurtmalar
      </h3>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
        <CountRow term="FAKT 1" value={fakt1} />
        <CountRow term="FAKT 2" value={fakt2} />
      </dl>
      <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
        Katakni bosing — buyurtmalar ochiladi
      </p>
    </article>
  )
}

function NutritionRow({ term, pair, ink }: { term: string; pair: KpiPair | null; ink: string }) {
  const off = pair?.moysklad.total != null && pair.bitrix.total != null && wholeGap(pair.moysklad.total - pair.bitrix.total, 'usd') !== 0
  return (
    <>
      <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {term}
      </dt>
      <dd className="tabular text-right text-[16px] font-bold" style={{ color: ink }}>
        {pair?.bitrix.total == null ? '—' : figureText(pair.bitrix.total, 'usd')}
        {off && (
          <span className="ml-1.5 text-[10.5px] font-semibold" style={{ color: 'var(--status-critical)' }}>
            MS {figureText(pair.moysklad.total ?? 0, 'usd')}
          </span>
        )}
      </dd>
    </>
  )
}

function CountRow({ term, value }: { term: string; value: number | null }) {
  return (
    <>
      <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {term}
      </dt>
      <dd className="tabular text-right text-[16px] font-bold" style={{ color: value ? 'var(--status-critical)' : 'var(--status-good)' }}>
        {value === null ? '—' : value === 0 ? 'yoʻq' : `${figureText(value, 'count')} ta`}
      </dd>
    </>
  )
}

function Verdict({ gap, unit }: { gap: number; unit: KpiPair['unit'] }) {
  if (gap === 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ background: mix('var(--status-good)', 16), color: 'var(--status-good)' }}>
        <CheckCircleGlyph size={10} />
        mos
      </span>
    )
  }
  const Arrow = gap > 0 ? ArrowUpGlyph : ArrowDownGlyph
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[10.5px] font-bold"
      style={{ background: mix('var(--status-critical)', 16), color: 'var(--status-critical)' }}
      title={gap > 0 ? 'MoySkladʼda koʻp' : 'Bitrix24ʼda koʻp'}
    >
      <Arrow size={9} className="shrink-0" />
      {figureText(Math.abs(gap), unit)}
    </span>
  )
}

function Dot({ hue }: { hue: string }) {
  return <span aria-hidden="true" className="inline-block size-[6px] rounded-full" style={{ background: hue }} />
}
