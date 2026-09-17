import type { ReactNode } from 'react'

import type { FaktChoice } from '@/features/sellers/board'
import { FaktSwitch } from '@/features/sellers/FaktSwitch'

/**
 * Kalit yonidagi izoh — lit tugma NIMA ekanini so'z bilan aytadi (EFIR Premium
 * §7, delta 20b). Sig'masa CSS uni butunlay tushiradi (`.tv-col-head__hint-slot`
 * — joyga qarab, belgi soniga qarab emas); kalit o'zi qoladi.
 */
const FAKT_HINT = {
  fakt2: { label: 'FAKT 2', meaning: 'yetkazilgan pul' },
  fakt1: { label: 'FAKT 1', meaning: 'tasdiqlangan pul' },
} as const

/**
 * «bugun **1** sotuvchi savdo qildi · **2** tasi tasdiq kutmoqda» — sanoqdagi
 * raqamlar bir pog'ona yuqori (mock `.phead__n b`). Matn o'zgarmaydi: `<b>`
 * faqat raqam bo'laklarini o'raydi, `textContent` avvalgidek bitta jumla.
 */
function countWithFigures(count: string): ReactNode {
  return count.split(/(\d[\d ]*)/).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))
}

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
      {count !== null && <span className="tv-col-head__count">{countWithFigures(count)}</span>}
      {/* Izoh uyasi — kalitni o'ngga suradigan bo'sh joy ham shu. */}
      <span className="tv-col-head__hint-slot">
        {count !== null && (
          <span className="tv-col-head__hint">
            <b>{FAKT_HINT[fakt].label}</b> — {FAKT_HINT[fakt].meaning}
          </span>
        )}
      </span>
      {count !== null && <FaktSwitch fakt={fakt} onFakt={onFakt} />}
      {children}
    </header>
  )
}
