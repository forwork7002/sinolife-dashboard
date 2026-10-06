import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ROP_COLORS, ropInk } from '@/features/leads/ropColors'

/**
 * The design system, read the way the browser reads it: as `globals.css`.
 *
 * Nothing in TypeScript can see a token, a keyframe or a theme block, and
 * every failure pinned here is silent on screen — an animation nothing runs
 * ships on every page, a token one dark block forgot paints the light value at
 * night for half the readers, a colour pair below its floor still renders.
 */

/** The stylesheet with its comments taken out: a name quoted in prose is not a rule. */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** `name` as a whole CSS identifier — `pulse` must not be found inside `palette-busy-pulse`. */
const ident = (name: string) => `(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`

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

/** A percentage token or literal, as a fraction. */
const fraction = (value: string) => Number(/^([\d.]+)%$/.exec(value)?.[1] ?? NaN) / 100

/** Every component source under `src/components` and `src/features`, by path. */
const COMPONENTS: ReadonlyMap<string, string> = new Map(
  ['src/components', 'src/features'].flatMap((dir) =>
    (readdirSync(join(process.cwd(), dir), { recursive: true }) as string[])
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => [`${dir}/${file}`, readFileSync(join(process.cwd(), dir, file), 'utf8')] as const),
  ),
)

// --- colour arithmetic: WCAG 2 contrast, sRGB compositing, oklab mixing -----

type Rgb = readonly [number, number, number]

function rgb(value: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!m) throw new Error(`not a #rrggbb colour: ${value}`)
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as unknown as Rgb
}
const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => {
  const c = Math.min(1, Math.max(0, v))
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
/** `top` at `alpha` over an opaque `bottom`, blended in sRGB as a browser paints it. */
const over = (top: Rgb, alpha: number, bottom: Rgb): Rgb =>
  top.map((v, i) => v * alpha + bottom[i]! * (1 - alpha)) as unknown as Rgb
function oklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function fromOklab([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}
/** `color-mix(in oklab, a p, b)` for two opaque colours. */
function mix(a: Rgb, p: number, b: Rgb): Rgb {
  const [x, y] = [oklab(a), oklab(b)]
  return fromOklab(x.map((v, i) => v * p + y[i]! * (1 - p)) as unknown as Rgb)
}

/** An opaque colour as written in the stylesheet or a style prop: a hex, a token, or an oklab mix of two. */
function colour(theme: Theme, value: string): Rgb {
  const v = value.trim()
  const variable = /^var\((--[\w-]+)\)$/.exec(v)
  if (variable) return colour(theme, token(theme, variable[1]!))
  const mixed = /^color-mix\(in oklab, (.+) ([\d.]+)%, (.+)\)$/.exec(v)
  if (mixed) return mix(colour(theme, mixed[1]!), Number(mixed[2]) / 100, colour(theme, mixed[3]!))
  return rgb(v)
}

/**
 * The slots a page may wear as its accent — globals.css «Page identity»:
 * 4 is too light to carry a mark on a grid track, 8 sits 4.1 ΔE from
 * --status-critical. `pageAccent.test.tsx` holds every PageShell to it.
 */
const ACCENT_POOL = [1, 2, 3, 5, 6, 7] as const

describe('the stylesheet ships no animation that nothing runs', () => {
  /*
    `@keyframes pulse` outlived the header dot that used it by five weeks and
    `@keyframes draw` the sparkline by one, each still in the built CSS of
    every page. An animation is only ever started by an `animation` (or
    `animation-name`) declaration, and every one of them lives in this file.
  */
  it('names every @keyframes in an animation declaration', () => {
    const names = [...new Set([...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!))]
    expect(names.length).toBeGreaterThan(10)
    for (const name of names) {
      expect(CSS, name).toMatch(new RegExp(`animation(?:-name)?\\s*:[^;{}]*${ident(name)}`))
    }
  })
})

describe('the accent derivatives follow the page, not :root', () => {
  /*
    A var() inside a custom property is filled in where it is DECLARED. On
    :root alone, --accent-soft / -line / -ink were series-1 on every page while
    PageShell set the page's own --accent inline on `.page-container` — so the
    custom-period chip, /structure's found row and «Rahbar» tag, /rnp's today
    column and /roistat's links were blue beside the page's hue.
  */
  it('declares all three, once, on :root AND on .page-container', () => {
    const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) =>
      /--accent-(soft|line|ink)\s*:/.test(body!),
    )
    expect(rules).toHaveLength(1)
    const [, selectors, body] = rules[0]!
    expect(selectors!.split(',').map((s) => s.trim())).toEqual([':root', '.page-container'])
    for (const name of ['--accent-soft', '--accent-line', '--accent-ink']) {
      expect(body, name).toMatch(new RegExp(`${name}\\s*:\\s*color-mix\\(in oklab, var\\(--accent\\)`))
    }
  })

  /*
    --accent-ink is TEXT (drill links, the today header, the head tag), and
    following the page means it now wears every pool slot rather than only
    slot 1. At the old 88% mix /structure's olive read 4.15:1 in dark.
  */
  it('keeps accent ink at 4.5:1 on its own wash over a card, for every pool slot in both themes', () => {
    const declared = declarations(':root,\n.page-container')
    const inkShare = fraction(/var\(--accent\) ([\d.]+%), var\(--ink-primary\)/.exec(declared.get('--accent-ink')!)![1]!)
    const washShare = fraction(/var\(--accent\) ([\d.]+%), transparent/.exec(declared.get('--accent-soft')!)![1]!)
    for (const theme of THEMES) {
      const card = rgb(token(theme, '--surface-raised'))
      for (const slot of ACCENT_POOL) {
        const accent = rgb(token(theme, `--series-${slot}`))
        const ink = mix(accent, inkShare, rgb(token(theme, '--ink-primary')))
        const wash = over(accent, washShare, card)
        expect(contrast(ink, wash), `${theme} slot ${slot} on its wash`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(ink, card), `${theme} slot ${slot} on the card`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('a series mark on the card', () => {
  /*
    The «koʻk» note claimed every slot cleared 4.7:1 on the dark card and
    3.6:1 on the light page; the tokens gave 3.82 and 2.67. What does hold,
    and what the palette needs for a mark, is 3:1 on the card it is drawn on.
  */
  it('clears the 3:1 a mark needs, for all eight slots in both themes', () => {
    for (const theme of THEMES) {
      for (let slot = 1; slot <= 8; slot += 1) {
        expect(contrast(colour(theme, `var(--series-${slot})`), colour(theme, 'var(--surface-raised)')), `${theme} slot ${slot}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('ink on a series fill', () => {
  /*
    One theme-free #fff was said to clear every slot in both modes. It cleared
    five slots in light and none in dark, and text sat on all of them: the
    bell count, the MultiSelect count, «Yangi versiya», the lead split's
    labels, a payroll rank chip.
  */
  const BRIGHT = new Set([3, 4, 5])

  it('clears 4.5:1 on every slot in both themes, with the ink the slot is assigned', () => {
    for (const theme of THEMES) {
      for (let slot = 1; slot <= 8; slot += 1) {
        const ink = colour(theme, BRIGHT.has(slot) ? 'var(--ink-on-series-bright)' : 'var(--ink-on-series)')
        expect(contrast(ink, colour(theme, `var(--series-${slot})`)), `${theme} slot ${slot}`).toBeGreaterThanOrEqual(4.5)
      }
      // The lead split's «Berilmagan» share is filled with --ink-muted.
      expect(contrast(colour(theme, 'var(--ink-on-series)'), colour(theme, 'var(--ink-muted)')), `${theme} muted`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('pairs every ROP team colour with an ink that clears it, the two mixes included', () => {
    expect(ROP_COLORS).toHaveLength(9)
    for (const theme of THEMES) {
      for (const fill of ROP_COLORS) {
        expect(contrast(colour(theme, ropInk(fill)), colour(theme, fill)), `${theme} ${fill}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('is never a literal white in a component, where no theme can reach it', () => {
    const offenders = [...COMPONENTS].filter(([, source]) =>
      /\btext-white\b|color:\s*['"](#fff(fff)?|white)['"]/i.test(source),
    )
    expect(offenders.map(([file]) => file)).toEqual([])
  })

  /*
    The active rail item and the S mark keep white in both themes: their fills
    are the house's own and do not follow the theme's series steps. The hover
    used to BRIGHTEN the gradient (1.08), which took the label to 4.36:1.
  */
  it('keeps the active rail item on its own theme-free white, above 4.5:1 at rest and under the pointer', () => {
    expect(DARK.has('--ink-on-brand')).toBe(false)
    const active = /\.rail-item\[aria-current='page'\]\s*\{([^}]*)\}/.exec(CSS)![1]!
    const hover = /\.rail-item\[aria-current='page'\]:hover\s*\{([^}]*)\}/.exec(CSS)![1]!
    expect(active).toMatch(/color:\s*var\(--ink-on-brand\)/)
    expect(hover).toMatch(/color:\s*var\(--ink-on-brand\)/)

    const gain = Number(/brightness\(([\d.]+)\)/.exec(hover)?.[1] ?? 1)
    const stops = [...token('light', '--rail-active-bg').matchAll(/#[0-9a-f]{6}/gi)].map((m) => rgb(m[0]))
    expect(stops).toHaveLength(2)
    const white = rgb(token('dark', '--ink-on-brand'))
    for (const stop of stops) {
      expect(contrast(white, stop)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(white, stop.map((v) => Math.min(255, v * gain)) as unknown as Rgb)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('line glow', () => {
  /*
    From 2026-09-28 one unscoped rule gave every line and area the same blue
    halo in dark, whatever it encoded — orange FAKT 1, red refusals, the green
    confirmation rate — while the scoped `.glow-series-1` had no user and the
    FAKT chart's `glow-series-2` matched no rule. Colour follows the entity: a
    mark glows in its own slot or not at all.
  */
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector!.trim(),
    body: body!,
  }))

  it('is never app-wide: a filter on a line or area curve is always scoped by a glow class', () => {
    const curves = rules.filter((r) => /recharts-(line|area)-curve/.test(r.selector) && /filter\s*:/.test(r.body))
    expect(curves.length).toBeGreaterThan(0)
    for (const rule of curves) expect(rule.selector).toMatch(/glow-series-\d/)
  })

  it('has a colour for exactly the slots that opt in, each its own slot, all under the one filter', () => {
    const defined = new Map(
      [...CSS.matchAll(/\.glow-series-(\d)\s*\{\s*--glow-color:\s*var\(--series-(\d)\);\s*\}/g)].map((m) => [m[1]!, m[2]!]),
    )
    for (const [n, slot] of defined) expect(slot, `.glow-series-${n}`).toBe(n)

    const used = new Set([...COMPONENTS.values()].flatMap((source) => [...source.matchAll(/glow-series-(\d)/g)].map((m) => m[1]!)))
    expect([...used].sort()).toEqual([...defined.keys()].sort())

    const glow = rules.find((r) => /drop-shadow\([^;]*var\(--glow-color\)/.test(r.body))
    expect(glow).toBeDefined()
    for (const n of defined.keys()) expect(glow!.selector).toContain(`.glow-series-${n}`)
  })

  it('opts a mark in under the slot its stroke wears, and never a status line', () => {
    let optedIn = 0
    for (const [file, source] of COMPONENTS) {
      for (const [block] of source.matchAll(/<(?:Line|Area)\b[\s\S]*?\/>/g)) {
        const glow = /className="glow-series-(\d)"/.exec(block)
        const stroke = /stroke="var\(--((?:series|status)-[\w-]+)\)"/.exec(block)
        if (glow) optedIn += 1
        if (stroke?.[1]!.startsWith('status-')) expect(glow, `${file}: a status line`).toBeNull()
        if (glow && stroke) expect(stroke[1], file).toBe(`series-${glow[1]}`)
      }
    }
    expect(optedIn).toBeGreaterThanOrEqual(7)
  })

  it('collapses to nothing in light and shows in dark', () => {
    expect(fraction(token('light', '--line-glow-mix'))).toBe(0)
    expect(fraction(token('dark', '--line-glow-mix'))).toBeGreaterThan(0)
  })
})

describe('the two dark blocks', () => {
  /*
    Dark is written twice — the `prefers-color-scheme` block for «Tizim»
    readers and `[data-theme="dark"]` for a forced choice — and the two were
    kept in step by comments alone. One drift already shipped: --kbd-edge was
    missing from the media block, so «Tizim» readers at night got the light
    block's ink mix, a key lit from below.
  */
  it('declare the same tokens with the same values', () => {
    expect(Object.fromEntries(FORCED_DARK)).toEqual(Object.fromEntries(DARK))
    expect(DARK.size).toBeGreaterThan(90)
  })

  it('only override what the light block declares', () => {
    const orphans = [...DARK.keys()].filter((name) => !LIGHT.has(name))
    expect(orphans).toEqual([])
  })
})

describe('muted ink holds 4.5:1 wherever it lands', () => {
  /*
    It carries almost every label, header and hint, so its floor is the floor
    of the whole interface. --grid counts: the palette's active row, a hovered
    filter option and the quiet rank chips put muted text on it (4.47:1 before
    2026-10-06).
  */
  it('on every surface in both themes', () => {
    for (const theme of THEMES) {
      for (const surface of ['--surface-raised', '--page', '--surface', '--surface-sunken', '--grid']) {
        expect(contrast(colour(theme, 'var(--ink-muted)'), colour(theme, `var(${surface})`)), `${theme} ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  /*
    The hero card's bloom pools the page accent under the card's own text.
    It borrowed the aurora's strength, and when the «koʻk» pass raised that to
    22% in dark, muted text on cyan pages read 4.00:1 at the bloom's peak.
  */
  it('on the hero bloom at its peak, for every pool accent', () => {
    for (const theme of THEMES) {
      const bloom = fraction(token(theme, '--hero-bloom-mix'))
      for (const slot of ACCENT_POOL) {
        const ground = over(colour(theme, `var(--series-${slot})`), bloom, colour(theme, 'var(--surface-raised)'))
        expect(contrast(colour(theme, 'var(--ink-muted)'), ground), `${theme} slot ${slot}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  /*
    The title band — the backdrop, the aurora and the grain under PageShell's
    lead line — moved to glassContrast.test.ts with the rest of the
    backdrop's arithmetic when glass went in.
  */
})

describe('floating chrome and modal scrims', () => {
  /*
    --shadow-ambient is the one shadow for anything that floats over the page:
    the float stack in light, an offset-free halo in dark, where a directional
    shadow under a popover reads as a rendering artefact. Only the tooltip,
    the chart tooltip and the palette read it; the dropdowns, the date picker,
    the org chart's panels and the skip link still cast the night's 0.8-black
    directional shadow. And the Users dialog dimmed the page with black, the
    scrim the house rules out (a light app turned into a darker room).
  */
  it('never casts the directional float shadow from a component', () => {
    const offenders = [...COMPONENTS].filter(([, source]) => source.includes('var(--shadow-float)'))
    expect(offenders.map(([file]) => file)).toEqual([])
  })

  it('leaves --shadow-float in the stylesheet only on a selected card, which is not chrome', () => {
    const readers = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector, body]) => /var\(--shadow-float\)/.test(body!) && !selector!.includes(':root'))
      .map(([, selector]) => selector!.trim())
    expect(readers).toEqual(['.org-card[data-selected]'])
  })

  it('dims behind a modal with the page-tinted scrim, never black', () => {
    const black = [...COMPONENTS].filter(([, source]) => /color-mix\(in oklab,\s*black/.test(source))
    expect(black.map(([file]) => file)).toEqual([])
    for (const file of ['src/features/users/UsersPage.tsx', 'src/components/ui/CommandPalette.tsx']) {
      expect(COMPONENTS.get(file), file).toMatch(/className="backdrop-dim /)
    }
  })
})
