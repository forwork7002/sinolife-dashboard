/**
 * «AI registrator → Boshqaruv → Ish vaqti» (2026-11-04, the owner: «hohlagan
 * vaqtim ish vaqtini oʻzgartiray … hohlagan vaqtim hohlaganimni oʻzgartira
 * olishim kerak»; the same evening: «soat 22:00gacha qilamiz endilikda»).
 *
 * When the agent dials and puts callers through, and the sellers' lunch, in
 * which it does neither. Shared vocabulary, ONE copy: the server checks a save
 * with it (`domain/aiRegistrator/control.ts`), the page checks the form and
 * reads the day's phase with it (`features/aiRegistrator/aiLiveLogic.ts`).
 *
 * THE RULES ARE THE AGENT'S OWN (`ai_registrator/app/hours.py` `check_hours`,
 * d0abf97): a config whose hours break one is refused WHOLE — the sellers and
 * the limits beside it are not applied either (`applyError`). So nothing that
 * breaks one is ever saved:
 *   · «HH:MM», 00:00–23:59;
 *   · start < end — one day, never across midnight;
 *   · lunch both or neither (neither = «tushliksiz»);
 *   · start ≤ lunchStart < lunchEnd ≤ end;
 *   · `days` (2026-11-04, T144, ai_registrator 2bc906f `check_days`) — ISO
 *     weekdays 1 (dushanba) … 7 (yakshanba), at least one; null = every day.
 *     None at all is not a day off but a stop — that is «Toʻxtatish».
 */

export interface WorkHours {
  /** «09:00» — the AI starts dialling, and the sellers' day starts. */
  readonly start: string
  /** «22:00» — the last dial; the server stops the agent once its calls end. */
  readonly end: string
  /** Null with `lunchEnd` — no lunch («tushliksiz»). */
  readonly lunchStart: string | null
  readonly lunchEnd: string | null
  /**
   * The days of the week the agent works, ISO 1 (Monday) … 7 (Sunday). Null or
   * absent — every day (an hours value saved before the days existed reads so).
   * On another day the agent dials nobody and the server's timer keeps it down.
   */
  readonly days?: readonly number[] | null
}

/** ISO weekday → the floor's two letters and the word, Monday first. */
export const WEEKDAYS: readonly { readonly n: number; readonly short: string; readonly long: string }[] = [
  { n: 1, short: 'Du', long: 'dushanba' },
  { n: 2, short: 'Se', long: 'seshanba' },
  { n: 3, short: 'Ch', long: 'chorshanba' },
  { n: 4, short: 'Pa', long: 'payshanba' },
  { n: 5, short: 'Ju', long: 'juma' },
  { n: 6, short: 'Sh', long: 'shanba' },
  { n: 7, short: 'Ya', long: 'yakshanba' },
]

/**
 * The working days as stored and sent: sorted, each once — null for every
 * day (absent, null, or all seven). Anything that is not a weekday is left as
 * it is for `workHoursProblems` to name.
 */
export function normalDays(days: readonly number[] | null | undefined): number[] | null {
  if (days === null || days === undefined) return null
  const out = [...new Set(days)].sort((a, b) => a - b)
  return out.length === 7 && out.every((d, i) => d === i + 1) ? null : out
}

/** Whether the agent works on this ISO weekday. */
export function worksOn(weekday: number, hours: Pick<WorkHours, 'days'>): boolean {
  const days = normalDays(hours.days)
  return days === null || days.includes(weekday)
}

/** «har kuni», «Du–Ju», «Du, Ch, Ju», «Du–Pa, Sh». */
export function daysText(days: readonly number[] | null | undefined): string {
  const list = normalDays(days)
  if (list === null) return 'har kuni'
  if (list.length === 0) return 'hech qaysi kun'
  const short = (n: number) => WEEKDAYS.find((d) => d.n === n)?.short ?? String(n)
  const runs: number[][] = []
  for (const d of list) {
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1] === d - 1) run.push(d)
    else runs.push([d])
  }
  return runs.map((r) => (r.length >= 3 ? `${short(r[0]!)}–${short(r[r.length - 1]!)}` : r.map(short).join(', '))).join(', ')
}

/**
 * What the form starts from before anything is saved, and what the page
 * assumes when neither the agent nor a save says otherwise — the AI server's
 * own .env on 2026-11-04 (09:00–22:00, lunch 12:30–13:30).
 */
export const DEFAULT_WORK_HOURS: WorkHours = { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30' }

/** The agent's `CLOCK` — two-digit hour 00–23, two-digit minute. */
export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** Minutes since midnight of a «HH:MM», or null when it is not one. */
export function clockMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !CLOCK_PATTERN.test(value)) return null
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}

/** Whether there is a lunch: both ends set. */
export function hasLunch(hours: WorkHours): boolean {
  return hours.lunchStart !== null && hours.lunchEnd !== null
}

/**
 * Why the agent would refuse these hours, in the owner's words — empty when
 * they are fine. Every problem named at once, as `controlProblems` does.
 */
export function workHoursProblems(hours: WorkHours): string[] {
  return [...clockProblems(hours), ...dayProblems(hours.days)]
}

function clockProblems(hours: WorkHours): string[] {
  const problems: string[] = []
  const start = clockMinutes(hours.start)
  const end = clockMinutes(hours.end)
  if (start === null) problems.push('Ish boshlanishi SS:DD koʻrinishida boʻlsin (masalan 09:00).')
  if (end === null) problems.push('Ish tugashi SS:DD koʻrinishida boʻlsin (masalan 22:00).')
  if (start !== null && end !== null && start >= end) {
    problems.push('Ish tugashi boshlanishidan keyin boʻlsin — bitta kun ichida, tun oʻtmaydi.')
  }

  const lunchSet = [hours.lunchStart, hours.lunchEnd].filter((v) => v !== null && v !== '').length
  if (lunchSet === 1) {
    problems.push('Tushlikning boshlanishi ham, tugashi ham boʻlsin — yoki «Tushliksiz»ni belgilang.')
    return problems
  }
  if (lunchSet === 0) return problems

  const lunchStart = clockMinutes(hours.lunchStart)
  const lunchEnd = clockMinutes(hours.lunchEnd)
  if (lunchStart === null) problems.push('Tushlik boshlanishi SS:DD koʻrinishida boʻlsin (masalan 12:30).')
  if (lunchEnd === null) problems.push('Tushlik tugashi SS:DD koʻrinishida boʻlsin (masalan 13:30).')
  if (lunchStart === null || lunchEnd === null) return problems
  if (lunchStart >= lunchEnd) problems.push('Tushlik tugashi boshlanishidan keyin boʻlsin.')
  if (start !== null && end !== null && start < end && (lunchStart < start || lunchEnd > end)) {
    problems.push(`Tushlik ish vaqti ichida boʻlsin (${hours.start}–${hours.end}).`)
  }
  return problems
}

/** The agent's `check_days`: whole weekdays 1–7, at least one. Null / absent — every day, fine. */
function dayProblems(days: readonly number[] | null | undefined): string[] {
  if (days === null || days === undefined) return []
  if (!days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return ['Ish kuni 1 (dushanba) dan 7 (yakshanba) gacha boʻlsin.']
  if (days.length === 0) return ['Kamida bitta ish kuni boʻlsin — AIni butunlay toʻxtatish uchun «Toʻxtatish».']
  return []
}

/** «09:00–22:00» */
export function workText(hours: Pick<WorkHours, 'start' | 'end'>): string {
  return `${hours.start}–${hours.end}`
}

/** «12:30–13:30», or «yoʻq» without a lunch. */
export function lunchText(hours: Pick<WorkHours, 'lunchStart' | 'lunchEnd'>): string {
  return hours.lunchStart && hours.lunchEnd ? `${hours.lunchStart}–${hours.lunchEnd}` : 'yoʻq'
}

/** «09:00–22:00, tushlik 12:30–13:30» / «09:00–22:00, tushliksiz» — and «, Du–Ju» when not every day. */
export function hoursText(hours: WorkHours): string {
  const day = hasLunch(hours) ? `${workText(hours)}, tushlik ${lunchText(hours)}` : `${workText(hours)}, tushliksiz`
  return normalDays(hours.days) === null ? day : `${day}, ${daysText(hours.days)}`
}

/** The same values — an empty lunch end and a null one are the same «no lunch», absent days and all seven «every day». */
export function sameHours(a: WorkHours | null, b: WorkHours | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.start === b.start &&
    a.end === b.end &&
    (a.lunchStart || null) === (b.lunchStart || null) &&
    (a.lunchEnd || null) === (b.lunchEnd || null) &&
    String(normalDays(a.days)) === String(normalDays(b.days))
  )
}
