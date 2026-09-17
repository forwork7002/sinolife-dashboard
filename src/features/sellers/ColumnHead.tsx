import type { ReactNode } from 'react'

import type { FaktChoice } from '@/features/sellers/board'
import { FaktSwitch } from '@/features/sellers/FaktSwitch'

/**
 * Kalit yonidagi izoh — lit tugma NIMA ekanini so'z bilan aytadi (EFIR Premium
 * §7, delta 20b). Tor sarlavhada (telefon, 1366 dagi komandalar ustuni) CSS
 * container query uni yashiradi; kalit o'zi qoladi.
 */
const FAKT_HINT = {
  fakt2: { label: 'FAKT 2', meaning: 'yetkazilgan pul' },
  fakt1: { label: 'FAKT 1', meaning: 'tasdiqlangan pul' },
} as const

/**
 * 42 px ustun sarlavhasi (spec §6/§7): nom · soni · izoh · FAKT kaliti. `children`
 * — e'lon (`PromotionBanner`), sarlavha USTIDA absolyut (`.tv-col-head`
 * relative). Kalit faqat taxta tayyor bo'lganda (`count !== null`): bo'sh yoki
 * xato holatda bosadigan narsa yo'q.
 *
 * THE ONE CONTROL ON THIS BOARD, drawn in both headings on purpose — a phone
 * shows one column at a time, so a switch over only one of them would be
 * unreachable from the other. Both press the page's single choice.
 */
export function ColumnHead({
  id,
  title,
  count,
  fakt,
  onFakt,
  children,
}: {
  id: string
  title: string
  /** «100 sotuvchi» / «14 komanda»; null — taxta hali tayyor emas. */
  count: string | null
  fakt: 'fakt1' | 'fakt2'
  onFakt: (choice: FaktChoice) => void
  children?: ReactNode
}) {
  return (
    <header className="tv-col-head">
      <h2 id={`${id}-heading`} className="tv-col-head__title">
        {title}
      </h2>
      {count !== null && <span className="tv-col-head__count">{count}</span>}
      <span className="tv-col-head__spacer" />
      {count !== null && (
        <>
          <span className="tv-col-head__hint">
            <b>{FAKT_HINT[fakt].label}</b> — {FAKT_HINT[fakt].meaning}
          </span>
          <FaktSwitch fakt={fakt} onFakt={onFakt} />
        </>
      )}
      {children}
    </header>
  )
}
