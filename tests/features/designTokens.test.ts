import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
