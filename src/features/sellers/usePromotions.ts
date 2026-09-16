'use client'

import { useEffect, useRef, useState } from 'react'

import { LADDER } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalRowDto } from '@/lib/api'

/**
 * Ko'tarilish — jamoat voqeasi. 40-o'rindagi odam o'z gerbining sokin
 * animatsiyasini ko'rmaydi; ustun sarlavhasidagi 8 soniyalik e'lonni hamma
 * ko'radi.
 *
 * IKKI TETIK, VA IKKINCHISI — PRODUCTION'DA ISHLAYDIGANI.
 *
 * 1. `promotedOn === today` — serverning hosila fakti. Sahifa o'sha kuni
 *    ochilganda ko'tarilishni ushlaydi.
 * 2. OLDINGI PAYLOAD BILAN FARQ: `level` (6-darajada `legendaTier`) OSHGAN
 *    sotuvchi — `useNewMedals` medal kodlarini solishtirgani kabi.
 *
 * Ikkinchisi nima uchun kerak: `promotedOn` — NAVBAT KUNI. Kunlik faktlar
 * `insightsRepository.sellerMedalFacts` da `date_trunc(grain, c.queued_at …)`
 * bilan guruhlanadi, ya'ni buyurtma navbatga tushgan kun bo'yicha; FAKT 2 esa
 * bir necha kundan keyin yopiladi. Shuning uchun `promotedOn === today`
 * production'da deyarli hech qachon rost bo'lmaydi va faqat shu tetik bilan
 * marosim jim turardi. Farq tetigini esa sinx pul yetkazilganini ko'rgan
 * paytda payload o'zgaradi — e'lon o'n daqiqa ichida chiqadi. Sana aniqroq
 * bo'lishi uchun yetkazish-kuni statement'i kerak (spec §5, §9).
 *
 * MANBA — SERVER PAYLOAD'I, brauzer xotirasi emas: ikki televizor ham bir xil
 * e'lon qiladi. «Bir marta» — sahifa sessiyasida bir marta (modul darajasidagi
 * `celebrated` to'plami, kaliti `employeeId:level:legendaTier`), ya'ni sahifa
 * qayta yuklansa ham farq tetigi o'zi hech narsa e'lon qilmaydi: birinchi
 * payload'da taqqoslashga hech narsa yo'q.
 *
 * «BIR MARTA» — KO'RINGAN BIR MARTA. Medal oynasi (2026-avgustdan beri) taxta
 * oynasi emas, ya'ni bugun ko'tarilgan odam «Bugun» taxtasida umuman
 * bo'lmasligi mumkin. Shuning uchun `onBoard` — shu ustunda HOZIR chizilgan
 * kalitlar; unda yo'q ko'tarilish na navbatga qo'yiladi, na «nishonlangan»
 * deb belgilanadi, na suratga yoziladi — ya'ni odam taxtaga chiqqan payload'da
 * e'lon qilinadi.
 */
export const PROMOTION_MS = 8_000

export interface Promotion {
  readonly employeeId: string
  readonly level: number
  readonly legendaTier: number
  readonly rankTitle: string
  /** «100 mln», «2 mlrd» — e'londa unvon yonida. */
  readonly thresholdLabel: string
}

const celebrated = new Set<string>()

/** Test seam. */
export function resetCelebrations(): void {
  celebrated.clear()
}

function thresholdLabelOf(level: number, legendaTier: number): string {
  if (level === 6 && legendaTier > 1) return `${legendaTier} mlrd`
  return LADDER[level - 1]?.thresholdLabel ?? ''
}

/** Suratdagi bitta yozuv — narvondagi o'rin. */
interface Rank {
  readonly level: number
  readonly legendaTier: number
}

/**
 * KO'TARILDIMI. 6-darajada narvon tugaydi va o'sish `legendaTier` da davom
 * etadi (Legenda I → Legenda II), shuning uchun taqqoslash ikki bosqichli.
 * Pasayish — ko'tarilish emas; motor darajani pasaytirmaydi, lekin filtr yoki
 * qayta hisob payloadni orqaga surishi mumkin va u e'lon emas.
 */
function rose(before: Rank, now: Rank): boolean {
  if (now.level !== before.level) return now.level > before.level
  return now.level === 6 && now.legendaTier > before.legendaTier
}

export function usePromotions(
  rows: ReadonlyMap<string, SellerMedalRowDto>,
  today: string | null,
  /** Shu ustunda hozir chizilgan kalitlar — memoizatsiya qilingan bo'lishi SHART. */
  onBoard: ReadonlySet<string>,
): Promotion | null {
  const [queue, setQueue] = useState<readonly Promotion[]>([])
  const [current, setCurrent] = useState<Promotion | null>(null)
  /*
    OLDINGI PAYLOAD'DAGI DARAJALAR. `useNewMedals` xuddi shu farqni render
    vaqtida oladi; bu yerda REF va effekt, chunki yonidagi `celebrated.add`
    modul darajasidagi yon ta'sir — React tashlab yuborishi mumkin bo'lgan
    renderda bajarilsa, ko'tarilish «nishonlangan» deb belgilanib e'lon
    butunlay yo'qolardi. `null` — hali bironta payload ko'rilmagan: birinchi
    payload hech kimni ko'tarilgan demaydi.
  */
  const seen = useRef<ReadonlyMap<string, Rank> | null>(null)

  // Yangi payload — hali nishonlanmagan ko'tarilishlar navbatga.
  useEffect(() => {
    const before = seen.current
    const next = new Map(before ?? [])
    const fresh: Promotion[] = []
    for (const row of rows.values()) {
      const rank: Rank = { level: row.level, legendaTier: row.legendaTier }
      const previous = before?.get(row.employeeId)
      const risen = previous !== undefined && rose(previous, rank)
      /*
        MA'LUM CHEGARA, TUZATILMAYDI: `SellerMedalsDto.today` o'n daqiqalik
        server keshida keladi va kesh kaliti vaqtni tashimaydi, ya'ni yarim
        tundan keyin payload o'n daqiqagacha kechagi sanani olib yurishi
        mumkin. Shuning uchun `promotedOn === today` KECHIKIB ishlaydi (eng
        ko'pi bilan o'n daqiqa), lekin hech qachon erta emas.
      */
      const promotedToday = today !== null && row.promotedOn === today
      if ((!risen && !promotedToday) || row.rankTitle === null) {
        next.set(row.employeeId, rank)
        continue
      }
      /*
        TAXTADA YO'Q ODAM SARFLANMAYDI — `celebrated.add` DAN OLDIN. Aks
        holda ko'rinmaydigan e'lon o'z kalitini yoqib yuborardi va o'sha
        odam taxtaga chiqqanda hech qachon tabriklanmasdi.

        VA SURAT HAM SURILMAYDI (`continue` — `next.set` dan oldin). Farq
        tetigi faqat ikki payload ORASIDAGI o'zgarishni ko'radi: surat yangi
        darajani yozib qo'ysa, keyingi payloadda farq qolmasdi va odam
        taxtaga chiqqanda e'lon butunlay yo'qolardi. Narxi — o'sha farq har
        payloadda qayta topiladi (odam taxtada paydo bo'lgunicha), lekin u
        faqat shu tsiklda ko'riladi: `fresh` bo'sh qoladi, hech qanday holat
        yangilanmaydi, hech narsa qayta chizilmaydi.
      */
      if (!onBoard.has(row.employeeId)) continue
      next.set(row.employeeId, rank)
      const key = `${row.employeeId}:${row.level}:${row.legendaTier}`
      if (celebrated.has(key)) continue
      celebrated.add(key)
      fresh.push({
        employeeId: row.employeeId,
        level: row.level,
        legendaTier: row.legendaTier,
        rankTitle: row.rankTitle,
        thresholdLabel: thresholdLabelOf(row.level, row.legendaTier),
      })
    }
    seen.current = next
    /*
      `celebrated` va `seen` — RENDER'DAN TASHQARIDAGI YOZUVLAR, ya'ni bu ish
      effektda turishi SHART (yuqoridagi sharh). Shuning uchun qoida shu yerda
      o'chiriladi, kod emas.
    */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh])
  }, [rows, today, onBoard])

  // Navbatdan bittasi ekranda; bo'shaganda keyingisi.
  useEffect(() => {
    if (current !== null || queue.length === 0) return
    /*
      NAVBAT — JADVAL, `current` — EKRANDAGISI: ikki savol, ikki holat, va
      orasidagi qadam shu. Tashqi tizim yo'q, ya'ni `useSyncExternalStore`
      ham yo'q; narxi — sakkiz soniyada bitta ortiqcha render.
    */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent(queue[0]!)
    setQueue((q) => q.slice(1))
  }, [current, queue])

  // Har e'lon 8 soniya — taymer faqat `current` ga bog'liq, navbat
  // o'zgarganda tozalanib ketmaydi (birinchi yozuvdagi xato shu edi).
  useEffect(() => {
    if (current === null) return
    const id = setTimeout(() => setCurrent(null), PROMOTION_MS)
    return () => clearTimeout(id)
  }, [current])

  return current
}

type NewMedals = ReadonlyMap<string, ReadonlySet<MedalCode>>

const keysOf = (rows: ReadonlyMap<string, SellerMedalRowDto>): ReadonlySet<string> => {
  const keys = new Set<string>()
  for (const row of rows.values()) for (const m of row.medals) keys.add(`${row.employeeId}:${m.code}`)
  return keys
}

/**
 * Oxirgi yangilanishda paydo bo'lgan medallar — bir marta kattalashib tushadi.
 * Oldingi payload bilan farq; birinchi (yoki bo'sh xaritadan keyingi birinchi)
 * payload hech narsani «yangi» demaydi. Render vaqtida holatni moslash —
 * React'ning o'z naqshi, effektda setState emas.
 */
export function useNewMedals(rows: ReadonlyMap<string, SellerMedalRowDto>): NewMedals {
  const [snapshot, setSnapshot] = useState<{ rows: ReadonlyMap<string, SellerMedalRowDto>; fresh: NewMedals }>(
    () => ({ rows, fresh: new Map() }),
  )
  if (snapshot.rows !== rows) {
    const fresh = new Map<string, Set<MedalCode>>()
    if (snapshot.rows.size > 0) {
      const before = keysOf(snapshot.rows)
      for (const row of rows.values()) {
        for (const m of row.medals) {
          if (before.has(`${row.employeeId}:${m.code}`)) continue
          const set = fresh.get(row.employeeId) ?? new Set<MedalCode>()
          set.add(m.code)
          fresh.set(row.employeeId, set)
        }
      }
    }
    setSnapshot({ rows, fresh })
    return fresh
  }
  return snapshot.fresh
}
