/**
 * Stamp this build, so an open tab can tell it is running yesterday's code.
 *
 * A SINGLE-PAGE APP DOES NOT NOTICE A DEPLOY. The dashboard is left open
 * beside Bitrix24 for hours; a deploy replaces the server while that tab goes
 * on running the JavaScript it loaded in the morning, and nothing on screen
 * says so. On 2026-09-14 that was one of the things the client was reading as
 * «yangilash ishlamayapti» — they pressed refresh, the data came back from the
 * same API, and the page they were looking at was still the old one.
 *
 * The stamp is a plain file in `public/`, written before every `next build`
 * and therefore baked into the image. The browser polls it with `no-store`;
 * when the value changes under an open tab, the header offers a reload. No
 * inlined constant, no build-id API, nothing that can disagree with itself:
 * the file the server serves IS the answer.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

mkdirSync('public', { recursive: true })
writeFileSync('public/build-id.json', `${JSON.stringify({ id })}\n`)

console.log(`  build-id ${id}`)
