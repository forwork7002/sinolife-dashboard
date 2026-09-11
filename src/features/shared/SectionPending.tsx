'use client'

import { Shell } from '@/components/layout/Shell'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/states/States'

/**
 * A granted screen that is deliberately not answering yet.
 *
 * The client paused «Joʻnatish nuqtalari» and «Reklama samarasi» on 2026-09-10
 * — «hozircha api qilmay tur… bitta bitta keyinchalik toʻgʻrilab chiqaman» —
 * so both keep their nav entry and their section grant and neither issues a
 * single request. This is the whole of what those pages render.
 *
 * WHY THE SECTION AND THE LINK STAY. Removing them would take the screens off
 * every account that holds them and off the admin's tick list, so switching one
 * back on later would mean re-granting it to everybody. A reader who clicks the
 * link is owed an answer either way, and «tayyorlanmoqda» is the honest one.
 *
 * NOTHING IS FETCHED HERE ON PURPOSE. The shell's own chrome still loads
 * (`/meta/filters` for the sidebar, `/meta/alerts` for the bell, ⌘K search) —
 * that is the frame every screen sits in, not this screen's data. What does not
 * happen is the screen's own endpoint: no `/insights/dispatch`, no
 * `/marketing/*`, so a paused screen costs the one-core database nothing.
 *
 * `PageShell` is deliberately NOT used: it renders the period control and the
 * filter row, and a window control on a page with nothing reading it is a lie
 * of the same kind Kadrlar tuzilmasi's `period={false}` exists to avoid.
 */
export function SectionPending({ title }: { title: string }) {
  return (
    <Shell>
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <Card className="px-2 py-4">
          <EmptyState
            title={title}
            body="Bu boʻlim tayyorlanmoqda. Maʼlumotlar hozircha yigʻilmayapti."
            hint="Tayyor boʻlgach, shu sahifada koʻrinadi."
          />
        </Card>
      </div>
    </Shell>
  )
}
