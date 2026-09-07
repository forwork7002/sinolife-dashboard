'use client'

import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { setTheme, useTheme, type ThemeChoice } from '@/lib/theme'

/**
 * The whole appearance preference, in words.
 *
 * The header carries a one-press light/dark toggle, which is what somebody
 * flipping the lights actually uses. This is the other half: the place
 * «Tizim» can be picked BACK, and the only place the three states can be seen
 * side by side and named. Without it, one press of the header button would
 * permanently detach the dashboard from a machine set to switch itself at
 * sunset, with nothing on any screen saying that had happened or how to undo
 * it.
 *
 * Last on the page, deliberately. The password and the second factor are
 * credentials — the things somebody navigates here to change — and a colour
 * preference above them would push the routine act below the fold.
 */
const OPTIONS: readonly { readonly value: ThemeChoice; readonly label: string }[] = [
  { value: 'system', label: 'Tizim' },
  { value: 'light', label: 'Yorugʻ' },
  { value: 'dark', label: 'Tungi' },
]

/**
 * What each choice actually does, spelled out under the control.
 *
 * «Tizim» is the one that needs it: a segment labelled with the name of a
 * setting, sitting between two labelled with colours, reads as a third colour
 * rather than as "stop deciding this here".
 */
const EXPLANATION: Record<ThemeChoice, string> = {
  system: 'Qurilma sozlamasiga ergashadi — kechqurun oʻzi qorayadi.',
  light: 'Har doim yorugʻ, qurilma qanday turgan boʻlsa ham.',
  dark: 'Har doim tungi, qurilma qanday turgan boʻlsa ham.',
}

export function AppearanceSection() {
  const choice = useTheme()

  return (
    <Card className="px-5 py-4">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
        Koʻrinish
      </h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
        Tanlov shu brauzerda saqlanadi va boshqa qurilmalarga oʻtmaydi.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={choice}
          options={OPTIONS}
          onChange={setTheme}
          ariaLabel="Koʻrinish rejimi"
        />
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {EXPLANATION[choice]}
        </p>
      </div>
    </Card>
  )
}
