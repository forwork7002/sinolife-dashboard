'use client'

import { useEffect, useState } from 'react'

import type { MedalCode } from '@/lib/api'

/**
 * Hook nimani o'qisa, shuni so'raydi: sotuvchi kaliti va medal kodlari.
 * `SellerMedalRowDto` shu shaklga mos keladi; payload'ning boshqa maydonlari
 * bu yerga yetib kelmaydi, ya'ni hook ularga bog'lana olmaydi.
 */
export interface MedalHolder {
  readonly employeeId: string
  readonly medals: readonly { readonly code: MedalCode }[]
}

export type NewMedals = ReadonlyMap<string, ReadonlySet<MedalCode>>

const NONE: NewMedals = new Map()

/**
 * «Yangi» belgisi shuncha yashaydi — animatsiya 400 ms (`medal-mark-new`),
 * qolgani zaxira. Keyin belgi o'chadi, medal joyida qoladi.
 */
export const NEW_MEDAL_MS = 1_000

const keysOf = (rows: ReadonlyMap<string, MedalHolder>): ReadonlySet<string> => {
  const keys = new Set<string>()
  for (const row of rows.values()) for (const m of row.medals) keys.add(`${row.employeeId}:${m.code}`)
  return keys
}

/**
 * Oxirgi yangilanishda paydo bo'lgan medallar — bir marta kattalashib tushadi
 * (`MedalMark isNew`, klassik taxta spec §1.5).
 *
 * OLDINGI PAYLOAD BILAN FARQ. Birinchi (yoki bo'sh xaritadan keyingi birinchi)
 * payload hech narsani «yangi» demaydi — ya'ni sahifa qayta yuklanganda
 * animatsiya yo'q, faqat ochiq turgan televizor ikki payload orasida paydo
 * bo'lgan medalni ko'rsatadi. Manba — server payload'i, brauzer xotirasi emas:
 * ikki televizor bir xil ko'radi.
 *
 * BIR MARTA — VA FAQAT BIR MARTA. Belgi `NEW_MEDAL_MS` dan keyin o'zi o'chadi.
 * Keyingi payload'gacha (10 daqiqa) turganida, shu oraliqda qayta MOUNT
 * bo'lgan har bir medal animatsiyani qaytadan o'ynardi: FAKT 1 / FAKT 2
 * bosilganda sotuvchi o'rindiqdan qatorga o'tadi, har daqiqalik reyting
 * yangilanishi qatorlarni almashtiradi, telefonda ustun `display: none` dan
 * qaytadi — CSS animatsiyasi har safar boshidan boshlanadi.
 *
 * Render vaqtida holatni moslash — React'ning o'z naqshi, effektda setState
 * emas. `rows` memoizatsiya qilingan bo'lishi SHART: identifikatori har
 * renderda o'zgarsa, har render «yangi payload» bo'lib ko'rinadi.
 */
export function useNewMedals(rows: ReadonlyMap<string, MedalHolder>): NewMedals {
  const [snapshot, setSnapshot] = useState<{ rows: ReadonlyMap<string, MedalHolder>; fresh: NewMedals }>(
    () => ({ rows, fresh: NONE }),
  )
  const { fresh: current } = snapshot
  useEffect(() => {
    if (current.size === 0) return
    const timer = setTimeout(() => {
      // Shu orada yangi payload kelgan bo'lsa, uning belgisiga tegilmaydi.
      setSnapshot((s) => (s.fresh === current ? { rows: s.rows, fresh: NONE } : s))
    }, NEW_MEDAL_MS)
    return () => clearTimeout(timer)
  }, [current])
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
