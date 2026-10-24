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
 *
 * ASKED ONLY WHILE SOMEBODY CAN SEE THE ANSWER — 2026-10-24. The minute read
 * ran in hidden tabs too, and went on running after it had found a new
 * version: a dashboard left open for a week behind Bitrix24 asked ten thousand
 * times for a flag nobody was looking at, or that was already up. Now a tick
 * that lands on a hidden tab is skipped, a return to the tab reads at once
 * (that is the moment the reader looks), and the timer stops for good the
 * moment the flag is up — it never goes down again in this tab. The read on
 * mount still happens whatever the visibility: it is what THIS tab is running,
 * and a tab opened in the background that took its first read only when shown
 * would take a deploy in between for its own build.
 */
export function useNewBuildAvailable(pollMs = 60_000): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let mine = true
    let running: string | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisibility)
    }

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
        if (id !== running) {
          setAvailable(true)
          stop()
        }
      } catch {
        // Offline, or something that is not JSON. Say nothing.
      }
    }

    const tick = () => {
      if (document.visibilityState !== 'hidden') void read()
    }
    const start = () => {
      if (timer !== null) clearInterval(timer)
      timer = setInterval(tick, pollMs)
    }
    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      void read()
      // A full period from this read, not a tick a few seconds after it.
      start()
    }

    void read()
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mine = false
      stop()
    }
  }, [pollMs])

  return available
}
