import { MedalMark } from '@/features/sellers/MedalMark'
import { HIDDEN_IN_ROWS, sortMedals } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto } from '@/lib/api'

/** Qatorda nechta joy. Qolgani CHIZILMAYDI — «+N» yo'q (mijoz qarori, 2026-09-17). */
export const ROW_MEDALS = 3

/** Qator medalining o'lchami, px (klassik taxta spec §1.5: 26–28). */
export const ROW_MEDAL_SIZE = 28

/**
 * Qator medallari (klassik taxta spec §1.5): `first-sale` yashirin (100 dan
 * 92 tasida bor), `MEDAL_ORDER` bo'yicha — haqiqiy metall avval — eng ko'pi
 * 3 ta. Sanoq yo'q, dafna yo'q (`seat` hech qachon berilmaydi), «+N» yo'q.
 *
 * O'NGDAN CHAPGA (`row-reverse`, CSS): eng nodiri o'ng chetda turadi, ya'ni
 * yuzta qatorning eng qimmat medallari bitta vertikal ustun bo'lib o'qiladi.
 *
 * MEDAL YO'Q — HECH NARSA YO'Q. Chizadigan medal qolmasa konteyner ham
 * chizilmaydi: qator balandligi va ism katagi medalsiz qatorda eski taxtadagi
 * bilan bir xil qolishi kerak, bo'sh quti esa joy egallaydi.
 */
export function RowMedals({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  const shown = sortMedals(medals, HIDDEN_IN_ROWS).slice(0, ROW_MEDALS)
  if (shown.length === 0) return null
  return (
    <span className="row-medals">
      {shown.map((m) => (
        <MedalMark key={m.code} code={m.code} size={ROW_MEDAL_SIZE} isNew={newKeys?.has(m.code) ?? false} />
      ))}
    </span>
  )
}
