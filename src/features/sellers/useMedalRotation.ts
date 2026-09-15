'use client'

import { useEffect, useMemo, useState } from 'react'

import type { SellerMedalDto } from '@/lib/api'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Qaysi medal «gapirayotgani» — ustunga bitta soat.
 *
 * BIR VAQTDA BITTASI, va bu qaror emas, zarurat. Uch seat bir vaqtda o'z
 * medalini almashtirsa, televizorga qarab turgan odam uchta joyda bir vaqtda
 * o'zgarishni ko'radi va hech birini o'qishga ulgurmaydi. Navbat esa ritm
 * beradi: ekran bir necha daqiqada butun medal alifbosini o'rgatib chiqadi,
 * va aynan shu pastdagi 139 qatorda izohsiz turgan belgilarning javobi.
 *
 * REDUCED MOTION DA TO'XTAYDI va birinchi medal ochiq qoladi — `RecordWall`
 * ning o'z qoidasi. Umuman yo'qotish emas: to'xtagan ekranda ham bitta medal
 * o'zini tanishtirib turadi.
 */
export const MEDAL_ROTATION_MS = 6_000

export interface MedalSlot {
  readonly employeeId: string
  readonly medals: readonly SellerMedalDto[]
}

export function useMedalRotation(
  slots: readonly MedalSlot[],
): { readonly employeeId: string; readonly medal: SellerMedalDto } | null {
  /*
    Navbat — seat emas, MEDAL bo'yicha. Ikki medalli chempion va bitta
    medalli uchinchi o'rin ekranni teng bo'lishsa, ko'proq yutgan odamning
    medallari kamroq ko'rinardi.
  */
  const queue = useMemo(
    () => slots.flatMap((slot) => slot.medals.map((medal) => ({ employeeId: slot.employeeId, medal }))),
    [slots],
  )

  const reduced = useReducedMotion()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (reduced || queue.length < 2) return
    const id = setInterval(() => setTick((t) => t + 1), MEDAL_ROTATION_MS)
    return () => clearInterval(id)
  }, [reduced, queue.length])

  if (queue.length === 0) return null
  // Modul navbat uzunligiga — taxta yangilanib medal soni kamayganda indeks
  // chegaradan chiqmasligi uchun; `tick` o'sishda davom etadi.
  return queue[tick % queue.length]!
}
