'use client'

import { useState } from 'react'

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
 * Render vaqtida holatni moslash — React'ning o'z naqshi, effektda setState
 * emas. `rows` memoizatsiya qilingan bo'lishi SHART: identifikatori har
 * renderda o'zgarsa, har render «yangi payload» bo'lib ko'rinadi.
 */
export function useNewMedals(rows: ReadonlyMap<string, MedalHolder>): NewMedals {
  const [snapshot, setSnapshot] = useState<{ rows: ReadonlyMap<string, MedalHolder>; fresh: NewMedals }>(
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
