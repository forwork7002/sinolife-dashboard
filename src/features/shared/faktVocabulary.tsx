'use client'

import type React from 'react'

import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatFullUzs } from '@/lib/format'

/**
 * FAKT 1 and FAKT 2, said the same way on every screen that prints them.
 *
 * TWO SCREENS NAME ONE FACT, SO ONE FILE NAMES IT. Savdo dinamikasi has
 * carried the pair since 2026-09-10; Logistika joined it when its cohort moved
 * onto the confirmation queue, because ЗАКАЗ is FAKT 1 and Успешно is FAKT 2
 * and the client asked for both to appear there too. Retyping the caption, the
 * figure's rendering or the basis paragraph on the second screen is how the
 * two would come to describe one number in two ways — which is exactly the
 * reconciliation the floor uses these figures for.
 *
 * The three exports here were private to `sales/ConfirmationFaktSection.tsx`
 * and moved, not copied.
 */

/** What the caption and the basis note have to say about every FAKT figure. */
export const QUEUE_BASIS = 'Navbatga tushgan sana (C4:NEW) boʻyicha'

/**
 * One headline money figure, with its own loading, failure and null states.
 *
 * Written once because there are several of them on a row now, and a headline
 * that loses its states is a confident number over a failed request.
 */
export function FaktFigure({
  label,
  value,
  hint,
  context,
  status,
}: {
  label: string
  value: number | null
  hint?: string
  context?: React.ReactNode
  status: 'loading' | 'error' | 'ready'
}) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>

      {status === 'loading' ? (
        <div className="skeleton mt-1.5 h-10 w-48" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' || value === null ? (
        <p className="mt-1.5 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        <div className="mt-1.5">
          {/*
            THE SUM, TO THE LAST DIGIT, AND SO NO TOOLTIP. The floor does not
            scan these figures, it reconciles them: against the Тасдиқлаш
            kanban, against the bot's own Telegram totals, against the client's
            published page and — on Logistika — against their own Google Sheet.
            «106 mln» cannot be compared with «106 432 000» without opening a
            tooltip, and this is where that comparison is the whole point.
          */}
          <span
            className="figure-hero figure-hero-sum figure-wrap inline-block"
            style={{ color: 'var(--ink-primary)' }}
          >
            <AnimatedNumber value={value} format={formatFullUzs} duration={900} />
            <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
              soʻm
            </span>
          </span>
        </div>
      )}

      {hint && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
      {context && <div className="mt-1">{context}</div>}
    </div>
  )
}

/**
 * What the cohort's date means, and why FAKT 2 can exceed FAKT 1.
 *
 * The one thing on either screen that stops a coverage figure above 100%
 * reading as a bug: the cohort's date is the day the order ENTERED the queue,
 * not the day it was delivered, and the two facts are siblings rather than a
 * whole and its part.
 */
export function FaktBasisNote() {
  const em = { color: 'var(--ink-secondary)' } as const
  return (
    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
      Bu boʻlimdagi raqamlar <strong style={em}>tasdiqlash navbatiga tushgan sana</strong> (C4:NEW)
      boʻyicha hisoblanadi. <strong style={em}>FAKT 1</strong> —{' '}
      <strong style={em}>Тасдиқланди</strong> va <strong style={em}>Тасдиқланмай чиқди</strong>:
      navbatdan chiqib Доставка ga oʻtgan buyurtmalar puli — mijozga yetib tasdiqlanganlari ham,
      mijozga yetib boʻlmay, lekin baribir joʻnatilganlari ham.{' '}
      <strong style={em}>FAKT 2</strong> — <strong style={em}>Доставланди</strong>: yetkazib
      berilganlari.{' '}
      {/*
        THE TWO ARE SIBLINGS, NOT A WHOLE AND ITS PART, and this sentence is
        the one that has to say so: an order refused in the queue and revived
        afterwards is in FAKT 2 and never in FAKT 1.
      */}
      FAKT 2 — FAKT 1 ning bir qismi emas: navbatda rad etilgan buyurtma keyin tiklanib yetkazilsa
      FAKT 2 ga tushadi-yu, FAKT 1 ga kirmaydi, shuning uchun FAKT 2 baʼzan FAKT 1 dan katta
      boʻlishi mumkin. Iyul oyida joʻnatilib avgustda yetkazilgan buyurtma FAKT 2 ga avgustda emas,
      iyulning oʻzida qoʻshiladi — sana buyurtma navbatga TUSHGAN kunni bildiradi, YETKAZILGAN
      kunni emas. Rad etilgan (Тасдиқланмади), hali navbatda turgan va koʻtarmagan buyurtmalar
      FAKT 1 ga kirmaydi.
    </p>
  )
}
