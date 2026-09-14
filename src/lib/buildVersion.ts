'use client'

import { useEffect, useState } from 'react'

/**
 * Whether a NEWER build of this dashboard is being served than the one this
 * tab is running.
 *
 * WHY A TAB NEEDS TELLING AT ALL. This is a single-page app: once it has
 * loaded, a deploy replaces the server underneath it and the open tab goes on
 * running the JavaScript it fetched hours ago. Nothing on screen changes, the
 * data keeps arriving from the same API, and the reader — who has been told
 * the numbers refresh by themselves — is looking at an old page with no way to
 * know it. On 2026-09-14 that was one strand of «yangilash ishlamayapti»: five
 * deploys in an afternoon, a dashboard left open beside Bitrix24 the whole
 * time, and a refresh button that could not possibly fix what was wrong.
 *
 * HOW IT KNOWS. `scripts/writeBuildId.mjs` writes `public/build-id.json`
 * before every `next build`, so the value is baked into the image and changes
 * once per deploy and never otherwise. The first read is what THIS tab is
 * running; every later read is what the server is serving now. They differ
 * only after a deploy.
 *
 * `cache: 'no-store'` and a cache-busting query, because the whole point is to
 * defeat exactly the caching that made the tab stale in the first place.
 *
 * A FAILED READ IS NOT A NEW VERSION. Offline, a 404 in development where the
 * file was never written, a proxy returning HTML — all leave the flag false.
 * A reload prompt that appears because the network blinked would train the
 * reader to ignore the one that matters.
 */
export function useNewBuildAvailable(pollMs = 60_000): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let mine = true
    let running: string | null = null

    const read = async () => {
      try {
        const response = await fetch(`/build-id.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return
        const body = (await response.json()) as { id?: unknown }
        const id = typeof body.id === 'string' ? body.id : null
        if (!id || !mine) return

        if (running === null) {
          running = id
          return
        }
        if (id !== running) setAvailable(true)
      } catch {
        // Offline, or something that is not JSON. Say nothing.
      }
    }

    void read()
    const timer = setInterval(() => void read(), pollMs)
    return () => {
      mine = false
      clearInterval(timer)
    }
  }, [pollMs])

  return available
}
