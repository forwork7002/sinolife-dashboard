import { Crest } from '@/features/sellers/Crest'
import { LADDER } from '@/features/sellers/medalCatalog'

/**
 * Legenda — sotuvchilar ustunining PASTIDA 28 px qator (spec §2): olti gerb,
 * so'z, ostona. Yagona kalit; hamma ma'lumot elementidan kichik va yengil;
 * podium bilan ro'yxat orasida hech qachon emas. Statik.
 *
 * BIR QATORGA SIG'ISHI KERAK, VA SHUNING UCHUN BU YERDA — VA FAQAT BU YERDA —
 * OSTONA QISQA YOZILADI. Spec §1 butun sahifada to'liq so'mni talab qiladi
 * («79 600 000»); mock 1920 da bo'sh sahifa chizadi, ilova esa nav reyki va
 * qobiq to'ldirmasini qo'shadi, ya'ni ustun 1053 px. To'liq so'm bilan kalit
 * ~1154 px so'raydi va ikkinchi qatorga o'raladi — ya'ni narvon cho'qqisi
 * («Legenda») ko'zdan pastga tushadi. `thresholdLabel` («10 mln» … «1 mlrd»)
 * ~100 px qaytaradi va kalit bir qatorda qoladi. Bu KALIT, o'lchov emas:
 * hech bir ma'lumot raqami — o'rindiq, qator, jumla, e'lon — qisqartirilmaydi.
 *
 * Yangi pog'onasi raqamsiz (mock ham shunday chizadi): uning ostonasi
 * «birinchi so'm», ya'ni yozadigan son yo'q. Sarlavha ham yo'q — gerblarning
 * o'zi kalit ekanini aytadi, va «DARAJA» so'zi ~80 px yeydi.
 */
export function TierLegend() {
  return (
    <div className="tv-legend" role="list" aria-label="Daraja legendasi">
      {LADDER.map((rung) => (
        <span key={rung.level} className="legend__rung" role="listitem" data-tier={rung.level}>
          <Crest level={rung.level} legendaTier={rung.level === 6 ? 1 : 0} size="legend" />
          <b>{rung.title}</b>
          {rung.thresholdSom !== null && <i>{rung.thresholdLabel}</i>}
        </span>
      ))}
    </div>
  )
}
