import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * «Shisha» — which surfaces are glass, which are opaque, and the rules that
 * keep the two apart, read from the stylesheet and the components that wear
 * them. The colour arithmetic is `glassContrast.test.ts`; this file is the
 * shape: a card is translucent, a table in it is not, and so on.
 */

/** The stylesheet with its comments taken out: a selector quoted in prose is not a rule. */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const source = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

/** Every rule as written: selector list and body. At-rule wrappers are dropped, their rules kept. */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector!.trim().replace(/\s+/g, ' '),
  body: body!.replace(/\s+/g, ' '),
}))

/** The body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const found = RULES.find((r) => r.selector === selector)
  if (!found) throw new Error(`no rule for ${selector}`)
  return found.body
}

describe('cards are glass', () => {
  it('fills .card with the glass token under its sheen, with the glass edge, shadow and lit top', () => {
    const card = rule('.card')
    expect(card).toMatch(/background: linear-gradient\(180deg, var\(--glass-card-top\), transparent 42%\), var\(--glass-card\);/)
    expect(card).toMatch(/border: 1px solid var\(--glass-edge\)/)
    expect(card).toMatch(/box-shadow: var\(--glass-shadow\), var\(--glass-highlight\)/)
  })

  /*
    The hero's rim was a gradient clipped to the border box under a fill
    clipped to the padding box. Under a translucent fill that gradient showed
    through the whole card as a grey veil, so no layer of the hero's
    background may be clipped to the border box, and the brighter top stop is
    an inset shadow.
  */
  it('paints the hero as glass with its bloom, and its rim with a border and an inset line — never a border-box layer', () => {
    const hero = rule('.card-hero')
    expect(hero).toMatch(/var\(--glass-card\);/)
    expect(hero).toMatch(/var\(--hero-bloom-mix\)/)
    expect(hero).not.toMatch(/border-box|padding-box|1px solid transparent/)
    expect(hero).toMatch(/border: 1px solid var\(--edge-hero-bottom\)/)
    expect(hero).toMatch(/inset 0 1px 0 var\(--edge-hero-top\)/)
    // Declared after .card, so a stacked `card card-hero` takes the hero's values.
    expect(RULES.findIndex((r) => r.selector === '.card-hero')).toBeGreaterThan(RULES.findIndex((r) => r.selector === '.card'))
  })

  /*
    A filled StatTile was an opaque tint of the card in a row of glass ones.
    It mixes into the glass token now, so it is as translucent as its
    neighbours — and the transparency fallback reaches it through the token.
  */
  it('tints a filled stat tile into the glass, not into the opaque card', () => {
    const stat = source('src/components/ui/Stat.tsx')
    expect(stat).toMatch(/color-mix\(in oklab, \$\{fillColor\} \d+%, var\(--glass-card\)\)/)
    expect(stat).not.toMatch(/\$\{fillColor\} \d+%, var\(--surface-raised\)/)
  })
})

describe('data never sits on glass', () => {
  /*
    A pinned cell has to be opaque or the cells scrolling under it show
    through; on a glass card the moving cells beside it were the card's
    colour, so a frozen column read as a strip wherever the backdrop was lit.
    Every table in a card is laid on the opaque ground the pinned cells wear.
  */
  it('lays every table in a card or a hero on the opaque raised ground, the sellers board excepted', () => {
    const ground = RULES.find((r) => / table$/.test(r.selector) && /var\(--surface-raised\)/.test(r.body))
    expect(ground?.selector).toBe(':is(.card, .card-hero):not(.tv-col) table')
    expect(ground?.body).toMatch(/background-color: var\(--surface-raised\)/)
    expect(rule('.tcol-sticky')).toMatch(/--pin-ground: var\(--surface-raised\)/)
  })

  it('clips a card holding a table to its own corners, without making it a scroll container', () => {
    expect(rule(':is(.card, .card-hero):not(.tv-col):has(table)')).toMatch(/overflow: clip/)
  })

  /*
    The board's columns are cards that paint their own opaque surface, so the
    glass card rule must lose to them: `.tv-col` comes later at the same weight.
  */
  it('leaves the sellers board opaque: its columns repaint the card in their own surface', () => {
    const tv = rule('.tv-col')
    expect(tv).toMatch(/background: linear-gradient\([^;]*\), var\(--surface-raised\);/)
    expect(tv).not.toMatch(/glass|backdrop-filter/)
    expect(RULES.findIndex((r) => r.selector === '.tv-col')).toBeGreaterThan(RULES.findIndex((r) => r.selector === '.card'))
    expect(source('src/features/sellers/SellersPage.tsx')).toMatch(/tv-col tv-col--\$\{tone\}[^`]*card reveal/)
  })
})

describe('the chrome is glass with no blur', () => {
  const shell = source('src/components/layout/Shell.tsx')
  /** An element's opening tag in Shell.tsx, from `<tag` to its inline style object. */
  const openingTag = (pattern: RegExp) => {
    const found = pattern.exec(shell)
    if (!found) throw new Error(`no match for ${pattern}`)
    return found[0]
  }

  /*
    Nothing ever moves under the header or the rail: the Shell is 100dvh and
    only <main> scrolls. The header's blur(12px) saturate(1.6) blurred a still
    picture — a layer and a pass per frame for no visible difference — and as
    an inline style no media query could take it away from a reader who asked
    for less transparency.
  */
  it('paints header, rail and drawer from classes, keeping only geometry and the transition name inline', () => {
    const header = openingTag(/<header\b[\s\S]*?style=\{\{[\s\S]*?\}\}/)
    const rail = openingTag(/<aside\b[\s\S]*?style=\{\{[\s\S]*?\}\}/)
    const drawer = openingTag(/className="app-drawer[\s\S]*?style=\{\{[\s\S]*?\}\}/)
    expect(header).toMatch(/className="app-header /)
    expect(header).toMatch(/viewTransitionName: 'app-header'/)
    expect(rail).toMatch(/app-rail/)
    expect(rail).toMatch(/viewTransitionName: 'app-sidebar'/)
    for (const [name, tag] of [['header', header], ['rail', rail], ['drawer', drawer]] as const) {
      expect(tag, name).not.toMatch(/background:|backdropFilter|WebkitBackdropFilter|borderColor/)
    }
  })

  it('fills header and rail with the chrome glass and never blurs them', () => {
    const chrome = rule('.app-header, .app-rail')
    expect(chrome).toMatch(/background: var\(--glass-chrome\)/)
    expect(chrome).toMatch(/border-color: var\(--glass-edge\)/)
    expect(chrome).not.toMatch(/backdrop-filter/)
  })

  /*
    The drawer opens over the page, and a translucent panel there showed the
    cards beneath as ghost text through the scrim; it lays the chrome over the
    bare --page, so it is the rail's colour and opaque.
  */
  it('lays the phone drawer\'s chrome over the bare page, so nothing shows through it', () => {
    const drawer = rule('.app-drawer')
    expect(drawer).toMatch(/background: linear-gradient\(var\(--glass-chrome\), var\(--glass-chrome\)\), var\(--page\);/)
    expect(drawer).not.toMatch(/backdrop-filter/)
  })

  it('washes a hovered rail item with the glass hover, not an opaque patch', () => {
    expect(rule('.rail-item:hover')).toMatch(/background: var\(--glass-hover\)/)
  })
})
