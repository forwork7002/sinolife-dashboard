import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * EFIR taxtasining stylesheet faktlari — `theme.test.ts` naqshi: hech biri
 * TypeScript'dan ko'rinmaydi va buzilishi jim. Fayl vazifalar bo'ylab o'sadi.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const from = (marker: string) => {
  const i = CSS.indexOf(marker)
  expect(i, `${marker} yo'q`).toBeGreaterThan(-1)
  return i
}

/** Uchala token bloki: yorug' `:root`, tizim-qorong'i media bloki, majburiy qorong'i. */
const LIGHT = CSS.slice(from(':root {\n  color-scheme: light;'), from('@media (prefers-color-scheme: dark)'))
const SYSTEM_DARK = CSS.slice(from('@media (prefers-color-scheme: dark)'), from(':root[data-theme="dark"]'))
const FORCED_DARK = CSS.slice(from(':root[data-theme="dark"]'), from('@theme inline'))

describe('EFIR tokenlari — uchala blokda', () => {
  it('`--tier-1..6` yorug‘ blokda, yorug‘lik tartibida', () => {
    const light = ['#3a4557', '#4a6085', '#2b86c2', '#2bb1ee', '#8ed3f5', '#c9ecff']
    light.forEach((hex, i) => expect(LIGHT).toContain(`--tier-${i + 1}: ${hex};`))
  })

  it('`--tier-1..6` ikkala qorong‘i blokda bir xil va yorug‘ blokdan boshqa', () => {
    const dark = ['#3f4a5c', '#506480', '#3e8fc4', '#7fd0ff', '#bde8ff', '#f2fbff']
    dark.forEach((hex, i) => {
      expect(SYSTEM_DARK).toContain(`--tier-${i + 1}: ${hex};`)
      expect(FORCED_DARK).toContain(`--tier-${i + 1}: ${hex};`)
      expect(LIGHT).not.toContain(`--tier-${i + 1}: ${hex};`)
    })
  })

  it('oila ORDINAL deb hujjatlashtirilgan — `--seq` uslubida, seriya emas', () => {
    expect(LIGHT).toMatch(/ORDINAL/)
    expect(LIGHT).toMatch(/never a series/i)
  })

  it('nodir medal soyasi: yorug‘da shaffof, qorong‘ida oltin aralashmasi', () => {
    expect(LIGHT).toContain('--glow-rare: transparent;')
    expect(SYSTEM_DARK).toContain('--glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);')
    expect(FORCED_DARK).toContain('--glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);')
  })
})

describe('EFIR shrift shkalasi', () => {
  it('`--tv-xl/l/m/s` 44/24/16/13 `:root` da, 1600 dan tor ekranda 36/20/14/12', () => {
    expect(LIGHT).toContain('--tv-xl: 44px;')
    expect(LIGHT).toContain('--tv-l: 24px;')
    expect(LIGHT).toContain('--tv-m: 16px;')
    expect(LIGHT).toContain('--tv-s: 13px;')
    const narrow = CSS.slice(from('@media (max-width: 1599px) {\n  :root {'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n') + 3)
    for (const line of ['--tv-xl: 36px;', '--tv-l: 20px;', '--tv-m: 14px;', '--tv-s: 12px;']) {
      expect(block).toContain(line)
    }
  })

  it('eski `--tv-name/--tv-money/--tv-small/--tv-seat-*` clamplari yo‘q', () => {
    for (const token of ['--tv-name', '--tv-money', '--tv-small', '--tv-seat-scale', '--tv-seat-name', '--tv-seat-figure']) {
      expect(CSS, token).not.toContain(`${token}:`)
      expect(CSS, token).not.toContain(`var(${token})`)
    }
  })
})
