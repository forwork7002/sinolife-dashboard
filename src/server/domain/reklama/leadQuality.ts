/**
 * What became of a lead — the client's «lead sifati» sheet, one bucket each.
 *
 * The sheet has four columns — недозвон, некачественный, успешный, дубль —
 * and they sum to «ЛИД» exactly (01.06.2026: 11 + 3 + 51 + 0 = 65), because a
 * day is written up once its leads are all resolved. Here a day is read live,
 * so a lead still being worked (Сммшик (лид), Обработка, Янги лид) is a fifth
 * bucket, «jarayonda», rather than being forced into one of the four.
 *
 * Read from the Регистрация stage a lead sits in NOW, by name, because the
 * portal's stage ids are per pipeline and its names are the business
 * vocabulary. Measured in the client's export (16.08–15.09.2026, 4 132
 * Регистрация leads): Сделка успешна 1 518, Сммшик (лид) 950, Недозвон 745,
 * Обработка 386, Дубликат 255, Отказ 242, Российский номерлар 24,
 * Пропущенный 6.
 *
 *   success    — WON: the registrar passed it on («Сделка успешна»). «Kval».
 *   duplicate  — «Дубликат». Tested BEFORE the lost rule: a duplicate is
 *                closed as lost, and it is not a bad lead, it is a second copy.
 *   noAnswer   — «Недозвон», «Пропущенный»: nobody picked up.
 *   lowQuality — every other closed-lost stage: «Отказ», «Российский
 *                номерлар» (a number no operator can call), «Некачественный».
 *   open       — still being worked.
 */

export type LeadBucket = 'success' | 'duplicate' | 'noAnswer' | 'lowQuality' | 'open'

export const LEAD_BUCKETS: readonly LeadBucket[] = Object.freeze([
  'noAnswer',
  'lowQuality',
  'success',
  'duplicate',
  'open',
])

const DUPLICATE = /дублик|дубл/i
const NO_ANSWER = /недозвон|пропущ/i
const LOW_QUALITY = /отказ|некачеств|российск|спам/i

/** `status` is the deal's DealStatus: OPEN, WON or LOST. */
export function leadBucket(stageName: string, status: string): LeadBucket {
  if (status === 'WON') return 'success'
  if (DUPLICATE.test(stageName)) return 'duplicate'
  if (NO_ANSWER.test(stageName)) return 'noAnswer'
  if (status === 'LOST' || LOW_QUALITY.test(stageName)) return 'lowQuality'
  return 'open'
}
