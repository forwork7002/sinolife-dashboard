import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * «Shisha» — every ink over every glass surface over every sample of the
 * backdrop, in both themes, read from `globals.css` the way the browser reads it.
 *
 * Glass lets the backdrop's light through, and light is what a light ink loses
 * contrast to in dark (and what darkens the page under a dark ink in light). A
 * glass surface therefore has no single colour: it has one per place on the
 * screen. The samples are the places that matter — the bare page, each pool at
 * its peak, each pair of pools overlapping at 60% — and a floor that holds over
 * all of them holds wherever a card is dragged. Before this pass the floors
 * were measured on one opaque colour per surface, and three had already slipped:
 * light amber under 3:1 off white, light critical at 4.49 on the sunken band,
 * dark critical at 4.32 in the card's sheen.
 *
 * The arithmetic is written out here on purpose — WCAG 2 contrast and sRGB
 * "normal" compositing, which is what the browser paints — rather than borrowed
 * from a package: twelve lines nobody has to trust.
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
const FORCED_DARK = declarations(':root[data-theme="dark"]')

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

/** The surfaces text and marks sit on, as one sample of the backdrop composites them. */
function surfaces(theme: Theme, ground: Rgb): Record<string, Rgb> {
  const card = over(paint(token(theme, '--glass-card')), ground)
  return {
    page: ground,
    'glass card': card,
    'glass card, top sheen': over(paint(token(theme, '--glass-card-top')), card),
    chrome: over(paint(token(theme, '--glass-chrome')), ground),
    'opaque raised': opaque(theme, '--surface-raised'),
    'opaque sunken': opaque(theme, '--surface-sunken'),
  }
}

/**
 * The slots a page may wear as its accent — globals.css «Page identity»:
 * 4 is too light to carry a mark on a grid track, 8 sits 4.1 ΔE from
 * --status-critical. `pageAccent.test.tsx` holds every PageShell to it.
 */
const ACCENT_POOL = [1, 2, 3, 5, 6, 7] as const

const STATUS = ['--status-good', '--status-warning', '--status-critical'] as const
const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--series-${n}`)

/** Every ink with its floor: text-grade inks 4.5 (primary 7), a series mark 3. */
const FLOORS: readonly (readonly [string, number])[] = [
  ['--ink-primary', 7],
  ['--ink-secondary', 4.5],
  ['--ink-muted', 4.5],
  ...STATUS.map((name) => [name, 4.5] as const),
  ...SERIES.map((name) => [name, 3] as const),
]

/** The worst ratio of `ink` over every sample of one surface, and where. */
function worst(theme: Theme, ink: string, surface: (ground: Rgb) => Rgb): { ratio: number; at: string } {
  let result = { ratio: Infinity, at: '' }
  for (const sample of samples(theme)) {
    const ratio = contrast(opaque(theme, ink), surface(sample.rgb))
    if (ratio < result.ratio) result = { ratio, at: sample.name }
  }
  return result
}

describe('the backdrop', () => {
  it('is four pools of literal colour over the page, peaking at a corner, in both themes', () => {
    for (const theme of THEMES) {
      const value = token(theme, '--backdrop')
      expect(value, theme).not.toMatch(/color-mix|var\(/)
      expect(pools(theme).every((pool) => pool.alpha > 0 && pool.alpha < 0.3), theme).toBe(true)
      expect([...value.matchAll(/ at (\d+)% (\d+)%/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['0 0', '100 0', '0 100', '100 100'])
    }
  })

  /*
    `html` paints it, and paints nothing that follows the page accent: html's
    --accent is always :root's series-1, so an accent pool there was one blue
    on every page while the aurora below the title followed the page.
  */
  it('is what html paints over --page, fixed to the window', () => {
    const html = /(?:^|\})\s*html\s*\{([^}]*)\}/.exec(CSS)![1]!
    expect(html).toMatch(/background-color:\s*var\(--page\)/)
    expect(html).toMatch(/background-image:\s*var\(--backdrop\)/)
    expect(html).toMatch(/background-attachment:\s*fixed/)
  })
})

describe('every ink over every surface over every sample of the backdrop', () => {
  for (const theme of THEMES) {
    it(`holds its floor in ${theme}`, () => {
      const failures: string[] = []
      for (const surfaceName of Object.keys(surfaces(theme, [0, 0, 0]))) {
        for (const [ink, floor] of FLOORS) {
          const { ratio, at } = worst(theme, ink, (ground) => surfaces(theme, ground)[surfaceName]!)
          if (ratio < floor) failures.push(`${ink} on ${surfaceName} over ${at}: ${ratio.toFixed(2)} < ${floor}`)
        }
      }
      expect(failures).toEqual([])
    })
  }

  /*
    The opaque card colour is the glass card over the bare page, rounded to a
    hex: a pinned cell, a table's ground or a tooltip inside glass is then the
    same colour as the glass around it wherever the backdrop is unlit.
  */
  it('keeps --surface-raised the glass card composited over the bare page', () => {
    for (const theme of THEMES) {
      const composite = over(paint(token(theme, '--glass-card')), opaque(theme, '--page')).map(Math.round)
      expect(opaque(theme, '--surface-raised'), theme).toEqual(composite)
    }
  })
})

describe('the rest of what glass puts text on', () => {
  /*
    The hero's bloom is the page accent over the glass card, so it lands on
    the backdrop's light as well: at the 16% it had on an opaque card, dark
    critical read 3.71 on a cyan page over the blue pool. Every pool accent,
    every sample.
  */
  it('keeps muted and status text at 4.5:1 on the hero bloom at its peak, for every pool accent', () => {
    for (const theme of THEMES) {
      const bloom = Number(/^([\d.]+)%$/.exec(token(theme, '--hero-bloom-mix'))![1]) / 100
      for (const slot of ACCENT_POOL) {
        const accent = { rgb: opaque(theme, `--series-${slot}`), alpha: bloom }
        for (const ink of ['--ink-muted', ...STATUS]) {
          const { ratio, at } = worst(theme, ink, (ground) => over(accent, over(paint(token(theme, '--glass-card')), ground)))
          expect(ratio, `${theme} ${ink} on slot ${slot} over ${at}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  /*
    A filled stat tile is the status tinted into the glass card
    (`color-mix(in oklab, <status> 12%, var(--glass-card))`, Stat.tsx), and its
    figure is drawn in that same status — the hardest pairing on the tile.
  */
  it('keeps a filled stat tile\'s figure and labels at their floors over every sample', () => {
    const stat = readFileSync(join(process.cwd(), 'src/components/ui/Stat.tsx'), 'utf8')
    const share = Number(/color-mix\(in oklab, \$\{fillColor\} (\d+)%, var\(--glass-card\)\)/.exec(stat)![1]) / 100
    for (const theme of THEMES) {
      for (const status of ['--status-good', '--status-critical']) {
        const tile = mixInOklab({ rgb: opaque(theme, status), alpha: 1 }, share, paint(token(theme, '--glass-card')))
        for (const ink of [status, '--ink-primary', '--ink-secondary', '--ink-muted']) {
          const floor = ink === '--ink-primary' ? 7 : 4.5
          const { ratio, at } = worst(theme, ink, (ground) => over(tile, ground))
          expect(ratio, `${theme} ${ink} on a ${status} tile over ${at}`).toBeGreaterThanOrEqual(floor)
        }
      }
    }
  })

  /*
    The title band: the backdrop, the aurora's accent blob and the grain all
    paint under PageShell's 12px muted lead line. The blob's share is the
    geometry .page-atmosphere::before's comment derives — at most 0.45 of it
    reaches that line — and the grain averages half its opacity of mid-grey.
    The blue pool's corner is right there, which is why dark's aurora came down
    from 22% to 16% when the backdrop went in.
  */
  it('keeps the title band lead line at 4.5:1, for every pool accent', () => {
    const BLOB_SHARE = 0.45
    for (const theme of THEMES) {
      const atmos = Number(/^([\d.]+)%$/.exec(token(theme, '--atmos-mix-accent'))![1]) / 100
      const grain = { rgb: [128, 128, 128] as Rgb, alpha: Number(token(theme, '--grain-alpha')) / 2 }
      for (const slot of ACCENT_POOL) {
        const blob = { rgb: opaque(theme, `--series-${slot}`), alpha: atmos * BLOB_SHARE }
        for (const [ink, floor] of [['--ink-muted', 4.5], ['--ink-secondary', 4.5], ['--ink-primary', 7]] as const) {
          const { ratio, at } = worst(theme, ink, (ground) => over(grain, over(blob, ground)))
          expect(ratio, `${theme} ${ink} on slot ${slot} over ${at}`).toBeGreaterThanOrEqual(floor)
        }
      }
    }
  })

  /*
    A floating panel is frosted, but what it floats over is live content, and
    the worst thing that can pass under 8–10% of see-through is the brightest
    or darkest ink on the screen at full strength — no blur can make the
    backdrop more extreme than that.
  */
  it('keeps text on a floating panel at its floor, whatever passes under it', () => {
    for (const theme of THEMES) {
      const float = paint(token(theme, '--glass-float'))
      expect(float.alpha, theme).toBeGreaterThanOrEqual(0.88)
      const under = [...samples(theme).map((s) => s.rgb), opaque(theme, '--surface-raised'), opaque(theme, '--ink-primary'), opaque(theme, '--ink-secondary')]
      for (const [ink, floor] of FLOORS.filter(([name]) => !name.startsWith('--series'))) {
        for (const ground of under) {
          expect(contrast(opaque(theme, ink), over(float, ground)), `${theme} ${ink}`).toBeGreaterThanOrEqual(floor)
        }
      }
    }
  })

  /*
    A control's labels: inactive segments and an input's text sit in the
    sunken well, the active segment and a secondary button's label on the
    raised chip, a hovered ghost's label in the wash. Status text and marks do
    not sit in any of them, so only the three text inks are held here.
  */
  it('keeps control labels at their floor in the well, on the chip and under the hover wash', () => {
    for (const theme of THEMES) {
      const well = paint(token(theme, '--glass-well'))
      const chip = paint(token(theme, '--glass-raised'))
      const hover = paint(token(theme, '--glass-hover'))
      const grounds = (ground: Rgb) => {
        const s = surfaces(theme, ground)
        return [s.page!, s['glass card']!, s.chrome!]
      }
      const cases: readonly (readonly [string, readonly string[], (g: Rgb) => Rgb])[] = [
        ['well', ['--ink-primary', '--ink-secondary', '--ink-muted'], (g) => over(well, g)],
        ['chip', ['--ink-primary', '--ink-secondary'], (g) => over(chip, g)],
        ['chip in a well', ['--ink-primary', '--ink-secondary'], (g) => over(chip, over(well, g))],
        ['hover', ['--ink-primary'], (g) => over(hover, g)],
      ]
      for (const [name, inks, on] of cases) {
        for (const ink of inks) {
          const floor = ink === '--ink-primary' ? 7 : 4.5
          for (const sample of samples(theme)) {
            for (const ground of grounds(sample.rgb)) {
              expect(contrast(opaque(theme, ink), on(ground)), `${theme} ${ink} on the ${name} over ${sample.name}`).toBeGreaterThanOrEqual(floor)
            }
          }
        }
      }
    }
  })
})

describe('the glass tokens', () => {
  const GLASS = ['--glass-card', '--glass-card-top', '--glass-chrome', '--glass-float', '--glass-well', '--glass-raised', '--glass-hover', '--glass-edge']

  /*
    The floor's television runs an old Chromium that can drop a color-mix
    stop, so a glass colour is a literal per theme — and a translucent one,
    or it is not glass. Both dark blocks carry their own copy: the parity test
    in designTokens.test.ts holds the two to each other.
  */
  it('are literal translucent colours, declared in the light block and in both dark blocks', () => {
    for (const name of GLASS) {
      for (const [block, map] of [['light', LIGHT], ['dark', DARK], ['forced dark', FORCED_DARK]] as const) {
        const value = map.get(name)
        expect(value, `${name} in ${block}`).toMatch(/^rgba\(\d+, \d+, \d+, (0?\.\d+)\)$/)
      }
    }
    for (const name of ['--glass-highlight', '--glass-shadow']) {
      expect(LIGHT.get(name), name).toMatch(/rgba\(/)
      expect(DARK.get(name), name).toMatch(/rgba\(/)
      expect(`${LIGHT.get(name)} ${DARK.get(name)}`, name).not.toMatch(/color-mix/)
    }
  })
})
