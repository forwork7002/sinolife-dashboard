import { readdirSync, readFileSync } from 'node:fs'
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

describe('floating panels are frosted, and nothing else is blurred', () => {
  /*
    The only surfaces live content moves under — rows under a column filter,
    tiles repainting under a dropdown, the page dimmed under the palette. A
    nearly-opaque fill and an 18px blur, only while open; a browser with no
    backdrop-filter gets the opaque card instead of a see-through 10%.
  */
  it('frosts .glass-float with the float fill and the theme-free frost, opaque where the browser cannot blur', () => {
    const float = rule('.glass-float')
    expect(float).toMatch(/background: var\(--glass-float\)/)
    expect(float).toMatch(/(?<!-webkit-)backdrop-filter: var\(--glass-frost\)/)
    expect(float).toMatch(/-webkit-backdrop-filter: var\(--glass-frost\)/)
    expect(CSS).toMatch(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\.glass-float \{\s*background: var\(--surface-raised\);\s*\}\s*\}/,
    )
    expect(RULES.findIndex((r) => r.selector === '.glass-float')).toBeGreaterThan(RULES.findIndex((r) => r.selector === '.card'))
  })

  it('wears .glass-float on every floating panel, with no surface of its own inline', () => {
    const panels: readonly (readonly [string, RegExp])[] = [
      ['MultiSelect', /role="listbox"[\s\S]*?className="(glass-float [^"]*)"[\s\S]*?style=\{\{([\s\S]*?)\}\}/],
      ['ColumnFilter', /role="dialog"\s+aria-label=\{`\$\{label\} — filtr`\}[\s\S]*?className="(glass-float [^"]*)"[\s\S]*?style=\{\{([\s\S]*?)\}\}/],
    ]
    const controls = source('src/components/ui/Controls.tsx')
    for (const [name, pattern] of panels) {
      const found = pattern.exec(controls)
      expect(found, name).not.toBeNull()
      expect(found![2], name).not.toMatch(/background/)
    }
    const picker = /function PeriodPicker[\s\S]*?className="(glass-float [^"]*)"[\s\S]*?style=\{\{([\s\S]*?)\}\}/.exec(source('src/components/layout/PeriodFilter.tsx'))
    expect(picker?.[2]).not.toMatch(/background/)
    const palette = /aria-label="Buyruqlar oynasi"[\s\S]*?className="(glass-float [^"]*)"[\s\S]*?style=\{\{([\s\S]*?)\}\}/.exec(source('src/components/ui/CommandPalette.tsx'))
    expect(palette?.[2]).not.toMatch(/background/)
    expect(source('src/features/users/UsersPage.tsx')).toMatch(/className="backdrop-dim [^"]*"[\s\S]{0,700}<Card className="glass-float /)
  })

  /*
    Speed: a backdrop-filter is a composited layer and a render pass each
    frame its backdrop changes. Spent on .glass-float alone; the header's
    blur, the scrim's whole-viewport 2px, the org chart's standing 8px and
    the aurora's 70px filter all went in this pass. `none` (the fallback) is
    the one other value allowed.
  */
  it('spends backdrop-filter on .glass-float alone, in the stylesheet and in every component', () => {
    const blurring = RULES.filter((r) => [...r.body.matchAll(/backdrop-filter:\s*([^;]+)/g)].some((m) => m[1]!.trim() !== 'none')).map(
      (r) => r.selector,
    )
    expect(blurring).toEqual(['.glass-float'])
    const tsx = (dir: string) =>
      (readdirSync(join(process.cwd(), dir), { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx')).map((f) => `${dir}/${f}`)
    const offenders = ['src/components', 'src/features', 'src/app'].flatMap(tsx).filter((file) => /backdropFilter|backdrop-filter/.test(source(file)))
    expect(offenders).toEqual([])
    expect(rule('.page-atmosphere::before')).not.toMatch(/filter/)
    expect(rule('.backdrop-dim')).not.toMatch(/filter/)
    expect(rule('.org-float')).toMatch(/background: var\(--surface-raised\)/)
  })

  it('keeps every tooltip opaque: it carries data', () => {
    expect(rule('.tip')).toMatch(/background: var\(--surface-raised\)/)
    expect(source('src/components/charts/chartTooltip.tsx')).toMatch(/background: 'var\(--surface-raised\)'/)
    expect(source('src/features/sellers/MedalTip.tsx')).toMatch(/className="tip medal-tip"/)
  })
})

describe('the controls are glass, at one radius and two heights', () => {
  const button = source('src/components/ui/Button.tsx')
  const controls = source('src/components/ui/Controls.tsx')
  const period = source('src/components/layout/PeriodFilter.tsx')

  /*
    A secondary button is a raised chip of glass; its hover is the glass wash
    laid OVER the fill as an image (an opaque --grid hover read as a hole in
    the pane) and a press sinks it into the well. The danger tint is mixed
    into the glass card, not into nothing — glassContrast.test.ts measures it.
  */
  it('builds the button variants from glass tokens', () => {
    const variant = (name: string) => new RegExp(`${name}: \\[([\\s\\S]*?)\\]\\.join`).exec(button)![1]!
    expect(variant('secondary')).toMatch(/bg-\[var\(--glass-raised\)\]/)
    expect(variant('secondary')).toMatch(/border-\[var\(--glass-edge\)\]/)
    expect(variant('secondary')).toMatch(/shadow-\[var\(--glass-highlight\)\]/)
    expect(variant('secondary')).toMatch(/hover:bg-\[image:linear-gradient\(var\(--glass-hover\),var\(--glass-hover\)\)\]/)
    expect(variant('secondary')).toMatch(/active:bg-\[var\(--glass-well\)\]/)
    expect(variant('ghost')).toMatch(/hover:bg-\[var\(--glass-hover\)\]/)
    expect(variant('danger').match(/var\(--status-critical\)_\d+%,var\(--glass-card\)/g)).toHaveLength(3)
    expect(button).not.toMatch(/var\(--grid\)|var\(--track\)|var\(--surface-raised\)/)
  })

  /*
    One filter row held 28, 30, 32 and 34px controls at 6, 8 and 12px
    corners. Every control now takes the Button's --radius-panel-sm (a chip
    two pixels less inside its well) and is 32px on a desk; the two a phone
    reader thumbs most — the period control and the search box — are 40px
    there. Tracks are the glass well, chips the raised glass.
  */
  it('gives every shared control the one radius token and the desk height of 32px', () => {
    const search = /<input\s+type="search"\s+value=\{local\}[\s\S]*?className=\{`([^`]*)`\}[\s\S]*?style=\{\{([\s\S]*?)\}\}/.exec(controls)!
    expect(search[1]).toMatch(/h-10 .*sm:h-8/)
    expect(search[1]).toMatch(/rounded-\[var\(--radius-panel-sm\)\]/)
    expect(search[2]).toMatch(/var\(--glass-well\)/)

    const trigger = /aria-haspopup="listbox"[\s\S]*?className="([^"]*)"[\s\S]*?style=\{\{([\s\S]*?)\}\}/.exec(controls)!
    expect(trigger[1]).toMatch(/\bh-8\b/)
    expect(trigger[1]).toMatch(/rounded-\[var\(--radius-panel-sm\)\]/)
    expect(trigger[2]).toMatch(/var\(--glass-raised\)/)

    const segmented = /export function SegmentedControl[\s\S]*?className="([^"]*)"\s+style=\{\{ background: 'var\(--glass-well\)' \}\}[\s\S]*?className="([^"]*)"/.exec(controls)!
    expect(segmented[1]).toMatch(/rounded-\[var\(--radius-panel-sm\)\] p-0\.5/)
    expect(segmented[2]).toMatch(/\bh-7\b/)
    expect(segmented[2]).toMatch(/rounded-\[calc\(var\(--radius-panel-sm\)-2px\)\]/)

    const presets = /role="group"\s+aria-label=\{t\.period\.label\}[\s\S]*?className="([^"]*)"/.exec(period)!
    expect(presets[1]).toMatch(/h-9 .*sm:h-7/)
    expect(period).toMatch(/className="flex shrink-0 items-center gap-0\.5 rounded-\[var\(--radius-panel-sm\)\] p-0\.5"\s+style=\{\{ background: 'var\(--glass-well\)' \}\}/)
    const picker = /title=\{t\.period\.pick\}[\s\S]*?className="([^"]*)"/.exec(period)!
    expect(picker[1]).toMatch(/h-10 .*sm:h-8/)
    expect(picker[1]).toMatch(/rounded-\[var\(--radius-panel-sm\)\]/)

    // BrandSwitch, SegmentedControl's twin with a colour dot, sits beside it on every main screen.
    const brand = source('src/features/shared/BrandSwitch.tsx')
    expect(brand).toMatch(/className="flex items-center gap-0\.5 rounded-\[var\(--radius-panel-sm\)\] p-0\.5"\s+style=\{\{ background: 'var\(--glass-well\)' \}\}/)
    expect(brand).toMatch(/className="focusable inline-flex h-7 items-center gap-1\.5 rounded-\[calc\(var\(--radius-panel-sm\)-2px\)\]/)
    expect(brand).toMatch(/background: active \? 'var\(--glass-raised\)' : 'transparent'/)

    // The header's «Yangi versiya» button sits among them at a Button `sm`'s height and corner.
    const version = /Yangi versiya · yangilash/.exec(source('src/components/layout/Shell.tsx'))
    expect(version).not.toBeNull()
    expect(source('src/components/layout/Shell.tsx')).toMatch(/className="focusable inline-flex h-7 items-center rounded-\[var\(--radius-panel-sm\)\][^"]*"[\s\S]{0,300}Yangi versiya/)

    // The retired solid-ink active segment, and the 8px / 6px corners, are gone from both files.
    for (const [name, file] of [['Controls', controls], ['PeriodFilter', period]] as const) {
      expect(file, name).not.toMatch(/background: active \? 'var\(--ink-primary\)'/)
      expect(file, name).not.toMatch(/var\(--grid\)' \}\}|background: 'var\(--grid\)'/)
    }
  })
})

describe('the one transparency fallback', () => {
  const MEDIA = '@media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)'
  const at = CSS.indexOf(`${MEDIA} {`)
  const block = CSS.slice(at, CSS.indexOf('\n}\n', at))
  const overrides = new Map(
    [...(/:root,\s*:root\[data-theme\]\s*\{([^}]*)\}/.exec(block)?.[1] ?? '').matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  )
  const light = /(?:^|\})\s*:root\s*\{([^}]*)\}/.exec(CSS)![1]!
  const translucent = [...light.matchAll(/(--glass-[\w-]+):\s*rgba\(\d+, \d+, \d+, ([\d.]+)\);/g)]
    .filter((m) => Number(m[2]) < 1)
    .map((m) => m[1]!)

  /*
    Reduced transparency, more contrast and forced colours are ONE block, and
    it reaches every glass surface because every glass surface is a token:
    each translucent token points at an opaque twin, the frost is `none`, the
    backdrop goes. A glass token added without a twin here fails.
  */
  it('points every translucent glass token at an opaque twin, and drops the frost and the backdrop', () => {
    expect(at).toBeGreaterThan(-1)
    expect(translucent.length).toBeGreaterThanOrEqual(8)
    for (const name of translucent.filter((n) => n !== '--glass-edge')) {
      expect(overrides.get(name), name).toMatch(/^var\(--(surface|surface-raised|surface-sunken|grid)\)$|^rgba\(0, 0, 0, 0\)$/)
    }
    expect(overrides.get('--glass-frost')).toBe('none')
    expect(overrides.get('--backdrop')).toBe('none')
    expect(Number(overrides.get('--scrim-mix')?.replace('%', ''))).toBeGreaterThan(60)
  })

  it('hides the aurora and the grain, and comes after both dark blocks so it wins over a forced theme', () => {
    expect(block).toMatch(/body::after,\s*\.page-atmosphere::before\s*\{\s*display: none;\s*\}/)
    expect(at).toBeGreaterThan(CSS.indexOf(':root[data-theme="dark"] {'))
    expect(at).toBeGreaterThan(CSS.indexOf(':root:where(:not([data-theme="light"])) {'))
    // The only reduced-transparency / contrast-more rules in the file are this block's.
    expect(CSS.match(/prefers-reduced-transparency|prefers-contrast/g)).toHaveLength(2)
  })

  /*
    A colour in a style prop is a colour the block cannot reach, so glass is
    never written into a component: no rgba, no translucent mix of a surface.
    (global-error.tsx is the exception the house allows: it renders when the
    stylesheet itself may not have loaded, and paints opaque literals.)
  */
  it('is reachable because no component writes a translucent surface of its own', () => {
    const tsx = (dir: string) =>
      (readdirSync(join(process.cwd(), dir), { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx')).map((f) => `${dir}/${f}`)
    const offenders = ['src/components', 'src/features', 'src/app']
      .flatMap(tsx)
      .filter((file) => file !== 'src/app/global-error.tsx')
      .filter((file) => /rgba\(|color-mix\(in oklab, var\(--(surface[\w-]*|page)\) \d+%, transparent\)/.test(source(file)))
    expect(offenders).toEqual([])
  })
})
