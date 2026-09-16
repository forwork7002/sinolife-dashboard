'use client'

import { useEffect, useState } from 'react'

import { LADDER } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalRowDto } from '@/lib/api'

/**
 * Ko'tarilish — jamoat voqeasi. 40-o'rindagi odam o'z lavhasining sokin
 * animatsiyasini ko'rmaydi; ustun sarlavhasidagi 8 soniyalik e'lonni hamma
 * ko'radi. Manba — serverning `promotedOn` hosila fakti, brauzer xotirasi
 * emas: ikki televizor ham bir xil e'lon qiladi, tozalangan brauzer qayta
 * e'lon qilmaydi (sahifa sessiyasida bir marta — modul darajasidagi to'plam).
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

export function usePromotions(
  rows: ReadonlyMap<string, SellerMedalRowDto>,
  today: string | null,
): Promotion | null {
  const [queue, setQueue] = useState<readonly Promotion[]>([])
  const [current, setCurrent] = useState<Promotion | null>(null)

  // Yangi payload — bugungi, hali nishonlanmagan ko'tarilishlar navbatga.
  useEffect(() => {
    if (today === null) return
    const fresh: Promotion[] = []
    for (const row of rows.values()) {
      /*
        MA'LUM CHEGARA, TUZATILMAYDI: `SellerMedalsDto.today` o'n daqiqalik
        server keshida keladi va kesh kaliti vaqtni tashimaydi, ya'ni yarim
        tundan keyin payload o'n daqiqagacha kechagi sanani olib yurishi
        mumkin. Shuning uchun `promotedOn === today` KECHIKIB ishlaydi (eng
        ko'pi bilan o'n daqiqa), lekin hech qachon erta emas.
      */
      if (row.promotedOn !== today || row.rankTitle === null) continue
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
    /*
      `celebrated` — MODUL DARAJASIDAGI YON TA'SIR, ya'ni bu ish effektda
      turishi SHART. `useNewMedals` dagi kabi render vaqtida bajarilsa,
      React tashlab yuborishi mumkin bo'lgan renderda ko'tarilish
      «nishonlangan» deb belgilanib, e'lon butunlay yo'qolardi. Shuning
      uchun qoida shu yerda o'chiriladi, kod emas.
    */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh])
  }, [rows, today])

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
