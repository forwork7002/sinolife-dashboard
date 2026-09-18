import { MedalMark } from '@/features/sellers/MedalMark'
import { HIDDEN_IN_ROWS, sortMedals } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto } from '@/lib/api'

/** Qatorda nechta joy. Qolgani CHIZILMAYDI — «+N» yo'q (mijoz qarori, 2026-09-17). */
export const ROW_MEDALS = 3

/**
 * Qator medalining o'lchami, px (klassik taxta spec §1.5: 26–28).
 *
 * 26, 28 EMAS — O'LCHANGAN. Medal progress chizig'i + chase satri balandligida
 * turadi, va qator balandligi o'smasligi SHART. O'sha ikki satr 1920 da
 * 27,9 px (8 + 19,9), 1366 da 26,5 px (8 + 18,5): 28 px medal ikkalasida ham
 * qatorni bo'yiga cho'zardi, 26 px ikkalasiga ham sig'adi.
 * globals.css dagi `.row-medals` balandligi shu songa teng bo'lishi kerak.
 */
export const ROW_MEDAL_SIZE = 26

/**
 * Qatorda chiziladigan medallar: `first-sale` yashirin (100 dan 92 tasida
 * bor), `MEDAL_ORDER` bo'yicha — haqiqiy metall avval — eng ko'pi 3 ta.
 * Taxta qatorning sinfini tanlash uchun ham shuni o'qiydi (medal bormi?),
 * shuning uchun qoida BIR joyda.
 */
export function rowMedalsOf(medals: readonly SellerMedalDto[] | undefined): readonly SellerMedalDto[] {
  return medals ? sortMedals(medals, HIDDEN_IN_ROWS).slice(0, ROW_MEDALS) : []
}

/**
 * Qator medallari (klassik taxta spec §1.5). Sanoq yo'q, dafna yo'q (`seat`
 * hech qachon berilmaydi), «+N» yo'q.
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
  owner,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
  /** The seller's `employeeId` — how the hover card (`MedalTip`) finds this seller's instance. */
  owner?: string
}) {
  const shown = rowMedalsOf(medals)
  if (shown.length === 0) return null
  return (
    <span className="row-medals" data-employee={owner}>
      {shown.map((m) => (
        <MedalMark key={m.code} code={m.code} size={ROW_MEDAL_SIZE} isNew={newKeys?.has(m.code) ?? false} />
      ))}
    </span>
  )
}
