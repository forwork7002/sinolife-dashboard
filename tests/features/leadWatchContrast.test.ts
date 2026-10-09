import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LEAD_CHANNELS, LEAD_CHANNEL_ORDER } from '@/lib/leadChannels'

/**
 * «Лид назорати» — WCAG AA, computed rather than eyeballed, for every place
 * the block puts text on a tint: the problem cards (glass, so over every
 * sample of the backdrop, at rest and under the pointer), the header chip
 * (on the bare page), and the drawer's pills, timers and links (on the
 * opaque raised surface). Both themes.
 *
 * It re-reads the tokens — and the cards' own wash and edge — from
 * `globals.css`, so changing a value re-runs the check. The arithmetic is
 * `glassContrast.test.ts`'s, restated as that file restates it: WCAG 2
 * contrast, sRGB compositing, premultiplied oklab mixing.
 *
 * Floors: 4.5 for text, 7 for primary ink, 3 for a mark that is not text (an
 * icon, a pill's dot). `console.table` prints the measured figures so the
 * report can quote them.
 */

/** The stylesheet with its comments taken out: a value quoted in prose is not a declaration. */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first rule written exactly `selector {`. Token blocks hold no nested braces. */
function declarations(selector: string): Map<string, string> {
  const at = CSS.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`${selector} is missing from globals.css`)
  const open = CSS.indexOf('{', at)
  const body = CSS.slice(open + 1, CSS.indexOf('}', open))
  return new Map(
    body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const colon = d.indexOf(':')
        return [d.slice(0, colon).trim(), d.slice(colon + 1).trim().replace(/\s+/g, ' ')] as const
      }),
  )
}

const LIGHT = declarations(':root')
const DARK = declarations(':root:where(:not([data-theme="light"]))')

type Theme = 'light' | 'dark'
const THEMES: readonly Theme[] = ['light', 'dark']

/** A token as the root element computes it: a dark block overrides, a light-only token is inherited. */
function token(theme: Theme, name: string): string {
  const value = (theme === 'dark' ? DARK.get(name) : undefined) ?? LIGHT.get(name)
  if (value === undefined) throw new Error(`${name} is not declared`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  return alias ? token(theme, alias[1]!) : value
}

// --- colour arithmetic ------------------------------------------------------

type Rgb = readonly [number, number, number]
interface Paint {
  readonly rgb: Rgb
  readonly alpha: number
}

/** `#rrggbb` or `rgba(r, g, b, a)` — the only two forms a glass token may take. */
function paint(value: string): Paint {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) as unknown as Rgb, alpha: 1 }
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value.trim())
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) }
  throw new Error(`not a #rrggbb or rgba() colour: ${value}`)
}
const opaque = (theme: Theme, name: string): Rgb => {
  const p = paint(token(theme, name))
  if (p.alpha !== 1) throw new Error(`${name} must be opaque`)
  return p.rgb
}
/** `top` over an opaque `bottom`, blended in sRGB as a browser paints it. */
const over = (top: Paint, bottom: Rgb): Rgb => top.rgb.map((v, i) => v * top.alpha + bottom[i]! * (1 - top.alpha)) as unknown as Rgb
const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/**
 * `color-mix(in oklab, F p, G)` where G may be translucent — premultiplied, as
 * CSS Color 5 interpolates: alpha mixes linearly, and each oklab component is
 * mixed weighted by its own colour's alpha. A filled stat tile is this, with G
 * the glass card.
 */
function mixInOklab(f: Paint, p: number, g: Paint): Paint {
  const lab = ([r, gr, b]: Rgb): Rgb => {
    const [lr, lg, lb] = [toLinear(r), toLinear(gr), toLinear(b)]
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
  }
  const fromLinear = (v: number) => {
    const c = Math.min(1, Math.max(0, v))
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
  }
  const alpha = f.alpha * p + g.alpha * (1 - p)
  const [x, y] = [lab(f.rgb), lab(g.rgb)]
  const [L, A, B] = x.map((v, i) => (v * f.alpha * p + y[i]! * g.alpha * (1 - p)) / alpha)
  const l = (L! + 0.3963377774 * A! + 0.2158037573 * B!) ** 3
  const m = (L! - 0.1055613458 * A! - 0.0638541728 * B!) ** 3
  const s = (L! - 0.0894841775 * A! - 1.291485548 * B!) ** 3
  return {
    rgb: [
      fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ],
    alpha,
  }
}

// --- the backdrop -----------------------------------------------------------

/** --backdrop's pools as their PEAK paint, in the order the stylesheet lists them (the first paints on top). */
function pools(theme: Theme): readonly Paint[] {
  const peaks = [...token(theme, '--backdrop').matchAll(/radial-gradient\([^,]*, (rgba\([^)]*\))/g)].map((m) => paint(m[1]!))
  if (peaks.length !== 4) throw new Error(`--backdrop (${theme}) should paint four pools, found ${peaks.length}`)
  return peaks
}

/** What the backdrop can put behind anything: the bare page, each pool at its peak, each pair at 60%. */
function samples(theme: Theme): readonly { readonly name: string; readonly rgb: Rgb }[] {
  const page = opaque(theme, '--page')
  const all = pools(theme)
  const out = [{ name: 'page', rgb: page }, ...all.map((pool, i) => ({ name: `pool ${i + 1}`, rgb: over(pool, page) }))]
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      // Painted bottom-up: the later-listed pool first, the earlier one over it.
      const lower = { ...all[j]!, alpha: all[j]!.alpha * 0.6 }
      const upper = { ...all[i]!, alpha: all[i]!.alpha * 0.6 }
      out.push({ name: `pools ${i + 1}+${j + 1} at 60%`, rgb: over(upper, over(lower, page)) })
    }
  }
  return out
}


const solid = (theme: Theme, name: string): Paint => ({ rgb: opaque(theme, name), alpha: 1 })
const CLEAR: Paint = { rgb: [0, 0, 0], alpha: 0 }

/** A CSS colour as `leadChannels.ts` and the components write it: a token, or an oklab mix of two. */
function resolve(theme: Theme, value: string): Paint {
  const v = value.trim()
  if (v === 'transparent') return CLEAR
  const variable = /^var\((--[\w-]+)\)$/.exec(v)
  if (variable) return paint(token(theme, variable[1]!))
  const mixed = /^color-mix\(in oklab, (.+) ([\d.]+)%, (.+)\)$/.exec(v)
  if (mixed) return mixInOklab(resolve(theme, mixed[1]!), Number(mixed[2]) / 100, resolve(theme, mixed[3]!))
  return paint(v)
}

/** The worst ratio of an ink on a paint laid over every sample of the backdrop. */
function worstOver(theme: Theme, ink: Paint, layers: (ground: Rgb) => Rgb): { ratio: number; at: string } {
  let result = { ratio: Infinity, at: '' }
  for (const sample of samples(theme)) {
    const ground = layers(sample.rgb)
    const ratio = contrast(over(ink, ground), ground)
    if (ratio < result.ratio) result = { ratio, at: sample.name }
  }
  return result
}

const round = (n: number) => Math.round(n * 100) / 100
const report: Record<string, Record<string, number>> = {}
const note = (row: string, theme: Theme, ratio: number) => {
  report[row] = { ...report[row], [theme]: round(ratio) }
}

/** `.watch-card`'s wash for a tone, as the stylesheet declares it. */
function cardWash(tone: 'good' | 'warning' | 'critical'): number {
  const base = /\.watch-card \{[^}]*--watch-wash: (\d+)%/.exec(CSS)
  const own = new RegExp(`\\.watch-card--${tone} \\{[^}]*--watch-wash: (\\d+)%`).exec(CSS)
  return Number((own ?? base)![1]) / 100
}

describe('a problem card', () => {
  it('is the status washed into the glass card, with a hover that lays the glass wash over it', () => {
    expect(CSS).toMatch(/\.watch-card \{[^}]*background: color-mix\(in oklab, var\(--watch-tone\) var\(--watch-wash\), var\(--glass-card\)\);/)
    expect(CSS).toMatch(/button\.watch-card:hover \{[^}]*linear-gradient\(var\(--glass-hover\), var\(--glass-hover\)\),\s*color-mix\(in oklab, var\(--watch-tone\) var\(--watch-wash\), var\(--glass-card\)\);/)
    for (const tone of ['good', 'warning', 'critical'] as const) expect(cardWash(tone)).toBeGreaterThan(0)
  })

  it('keeps its number, title, sub-line and state word at AA over every sample, at rest and hovered', () => {
    for (const theme of THEMES) {
      for (const tone of ['good', 'warning', 'critical'] as const) {
        const status = `--status-${tone}`
        const card = mixInOklab(solid(theme, status), cardWash(tone), paint(token(theme, '--glass-card')))
        const hover = paint(token(theme, '--glass-hover'))
        const grounds = {
          rest: (ground: Rgb) => over(card, ground),
          hover: (ground: Rgb) => over(hover, over(card, ground)),
        }
        // Text: the number, the title and the sub-line; muted (the chevron) is held as a mark below.
        const inks: (readonly [string, number])[] = [
          ['--ink-primary', 7],
          ['--ink-secondary', 4.5],
          // Only the calm card prints muted text (its title) and its own status as a word.
          ...(tone === 'good' ? [['--ink-muted', 4.5] as const, [status, 4.5] as const] : []),
        ]
        for (const [state, layers] of Object.entries(grounds)) {
          for (const [ink, floor] of inks) {
            const { ratio, at } = worstOver(theme, solid(theme, ink), layers)
            note(`card ${tone} · ${ink} · ${state}`, theme, ratio)
            expect(ratio, `${theme} ${ink} on a ${tone} card (${state}) over ${at}`).toBeGreaterThanOrEqual(floor)
          }
          // The icon and the 3px rule are marks, not text.
          const { ratio, at } = worstOver(theme, solid(theme, status), layers)
          note(`card ${tone} · icon/rule · ${state}`, theme, ratio)
          expect(ratio, `${theme} ${status} mark on a ${tone} card (${state}) over ${at}`).toBeGreaterThanOrEqual(3)
          const chevron = worstOver(theme, solid(theme, '--ink-muted'), layers)
          expect(chevron.ratio, `${theme} chevron on a ${tone} card (${state}) over ${chevron.at}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

describe('the header', () => {
  /*
    The verdict chip sits on the bare page, not on a card: the status as text
    on 12% of itself mixed INTO the glass card — a veil of the status over the
    lit page read 3.98:1 (light, good) — over whatever the backdrop lights. The
    freshness line beside it is secondary ink on the same ground.
  */
  it('keeps the verdict chip and the freshness line at 4.5:1 on the page, over every sample', () => {
    expect(readFileSync(join(process.cwd(), 'src/features/leads/LeadWatch.tsx'), 'utf8')).toMatch(
      /color-mix\(in oklab, \$\{TONE_COLOR\[verdict\.tone\]\} 12%, var\(--glass-card\)\)/,
    )
    for (const theme of THEMES) {
      for (const tone of ['good', 'warning', 'critical'] as const) {
        const status = solid(theme, `--status-${tone}`)
        const chip = mixInOklab(status, 0.12, paint(token(theme, '--glass-card')))
        const { ratio, at } = worstOver(theme, status, (ground) => over(chip, ground))
        note(`header chip ${tone}`, theme, ratio)
        expect(ratio, `${theme} ${tone} chip over ${at}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const ink of ['--ink-secondary', '--ink-muted', '--status-good']) {
        const { ratio, at } = worstOver(theme, solid(theme, ink), (ground) => ground)
        note(`header ${ink} on the page`, theme, ratio)
        // The live dot is a mark; the two inks are text.
        expect(ratio, `${theme} ${ink} over ${at}`).toBeGreaterThanOrEqual(ink === '--status-good' ? 3 : 4.5)
      }
    }
  })
})

describe('the drawer', () => {
  const raised = (theme: Theme) => opaque(theme, '--surface-raised')
  const on = (theme: Theme, ink: Paint, ...layers: Paint[]) => {
    const ground = layers.reduce((under, layer) => over(layer, under), raised(theme))
    return contrast(over(ink, ground), ground)
  }

  it('is opaque: a table never sits on glass', () => {
    expect(CSS).toMatch(/\.watch-drawer \{[^}]*background: var\(--surface-raised\);/)
  })

  it('keeps every channel pill at 4.5:1 for its word and 3:1 for its dot', () => {
    for (const theme of THEMES) {
      for (const channel of LEAD_CHANNEL_ORDER) {
        const spec = LEAD_CHANNELS[channel]
        const wash = resolve(theme, spec.wash)
        const word = on(theme, resolve(theme, spec.text), wash)
        const dot = on(theme, resolve(theme, spec.color), wash)
        note(`pill ${spec.label} · word`, theme, word)
        note(`pill ${spec.label} · dot`, theme, dot)
        expect(word, `${theme} ${spec.label} word`).toBeGreaterThanOrEqual(4.5)
        expect(dot, `${theme} ${spec.label} dot`).toBeGreaterThanOrEqual(3)
        // The solid mark — a bar segment, a legend dot — on the surface, and the ink assigned to it.
        const mark = on(theme, resolve(theme, spec.color))
        const ink = contrast(resolve(theme, spec.ink).rgb, resolve(theme, spec.color).rgb)
        note(`mark ${spec.label} on the surface`, theme, mark)
        note(`ink on solid ${spec.label}`, theme, ink)
        expect(mark, `${theme} ${spec.label} mark`).toBeGreaterThanOrEqual(3)
        expect(ink, `${theme} ink on ${spec.label}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the timers, the count pill, the link and the quiet lines at 4.5:1', () => {
    for (const theme of THEMES) {
      const hover = paint(token(theme, '--glass-hover'))
      const accentInk = resolve(theme, 'color-mix(in oklab, var(--series-1) 80%, var(--ink-primary))')
      const rows: (readonly [string, number, number])[] = [
        ['timer · normal (--ink-primary)', on(theme, solid(theme, '--ink-primary')), 7],
        ['timer · amber (--status-warning)', on(theme, solid(theme, '--status-warning')), 4.5],
        ['timer · red (--status-critical)', on(theme, solid(theme, '--status-critical')), 4.5],
        ['note / ROP line (--ink-muted)', on(theme, solid(theme, '--ink-muted')), 4.5],
        ['«Ochish» link (--accent-ink)', on(theme, accentInk), 4.5],
        ['«Ochish» link, hovered', on(theme, accentInk, hover), 4.5],
        ['chip label (--ink-secondary)', on(theme, solid(theme, '--ink-secondary')), 4.5],
        ['chip label, hovered', on(theme, solid(theme, '--ink-secondary'), hover), 4.5],
        ['chip count on the pressed chip', on(theme, solid(theme, '--ink-muted'), paint(token(theme, '--glass-raised'))), 4.5],
        ['table header (--ink-muted on sunken)', contrast(opaque(theme, '--ink-muted'), opaque(theme, '--surface-sunken')), 4.5],
        ...(['good', 'warning', 'critical'] as const).map((tone) => {
          const status = solid(theme, `--status-${tone}`)
          return [`count pill ${tone}`, on(theme, status, { ...status, alpha: 0.12 }), 4.5] as const
        }),
      ]
      for (const [name, ratio, floor] of rows) {
        note(name, theme, ratio)
        expect(ratio, `${theme} ${name}`).toBeGreaterThanOrEqual(floor)
      }
    }
  })
})

describe('the sidebar badge', () => {
  it('prints its count in the ink measured for the critical fill', () => {
    for (const theme of THEMES) {
      const ratio = contrast(opaque(theme, '--ink-on-series'), opaque(theme, '--status-critical'))
      note('sidebar badge (--ink-on-series on --status-critical)', theme, ratio)
      expect(ratio, theme).toBeGreaterThanOrEqual(4.5)
    }
    const shell = readFileSync(join(process.cwd(), 'src/components/layout/Shell.tsx'), 'utf8')
    expect(shell).toMatch(/background: 'var\(--status-critical\)', color: 'var\(--ink-on-series\)'/)
  })

  it('reports', () => {
    console.table(report)
    expect(Object.keys(report).length).toBeGreaterThan(20)
  })
})
