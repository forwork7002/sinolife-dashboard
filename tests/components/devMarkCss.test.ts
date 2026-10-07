import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * «developed by Yusuf» — ONCE per page, over the first card's top-right border.
 *
 * PageShell draws it; it used to be a ::after on every card and a page
 * carried two or three (the client: «ikkita boʻlmasin bitta yetadi»). Pinned
 * so a per-card rule does not come back, and so the pages the client named
 * keep their exceptions.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const CSS = read('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('developer mark', () => {
  it('is drawn once, by PageShell, under the header', () => {
    const shell = read('src/features/shared/PageShell.tsx')
    expect(shell).toContain('{devMark && (')
    expect(shell.match(/className="dev-mark /g)).toHaveLength(1)
  })

  it('is no longer a pseudo on every card', () => {
    expect(CSS).not.toContain('developed by Yusuf')
    expect(CSS).toContain('.dev-mark {')
  })

  it('is off where the client said so, and beside the paging on Tasdiqlash', () => {
    for (const page of ['sellers/SellersPage', 'roistat/RoistatPage', 'target/TargetPage', 'reklama/ReklamaPage']) {
      expect(read(`src/features/${page}.tsx`)).toContain('devMark={false}')
    }
    const confirmation = read('src/features/confirmation/ConfirmationPage.tsx')
    expect(confirmation).toContain('devMark={false}')
    expect(confirmation).toContain('aside={<DevMark')
    // Sverka opens on a text line, so its mark sits under that line, over the tiles.
    const sverka = read('src/features/sverka/SverkaPage.tsx')
    expect(sverka).toContain('devMark={false}')
    expect(sverka).toContain('<DevMark className="absolute right-3.5 -bottom-[13px]" />')
  })
})
