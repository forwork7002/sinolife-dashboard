import { formatDateTime, formatTime } from '@/lib/format'

import type { BezkvalBucket, BezkvalClientDto, BezkvalEntryKind, BezkvalStatus } from './leadSplitApi'

/**
 * Which of a day's «Безквал» clients a drill-down lists — the client side of
 * «Bezkval lidlar» and of the month grid's cells. Pure, so the predicates the
 * card's numbers were counted by and the lists behind them are one rule.
 */
export interface BezkvalPick {
  /** The day's Первичный отдел clients instead of its безквал ones. */
  readonly flow?: 'kval'
  /** A team; null with `bucket` — «Регистрация boʻlimida» or «Taqsimlanmagan»; undefined every client. */
  readonly rop?: string | null
  readonly bucket?: BezkvalBucket
  readonly status?: BezkvalStatus
  /** The main deal's kind — the clients column of «Kirim turi». */
  readonly entry?: BezkvalEntryKind
  /** Any deal of this kind — its deals column. */
  readonly anyEntry?: BezkvalEntryKind
  /** The main deal's source; null «Manbasiz»; undefined every source. */
  readonly source?: string | null
  readonly hour?: number
  readonly kind?: 'multiRop' | 'noPhone' | 'dealPhone'
}

/** The kirim's kind as the card counts it — `entryKind` in `server/domain/registration/bezkval.ts`. */
export function dealEntryKind(deal: { readonly entry: 'created' | 'ai'; readonly leadGuard: boolean }): BezkvalEntryKind {
  return deal.entry === 'ai' ? 'ai' : deal.leadGuard ? 'leadGuard' : 'created'
}

export function pickClients(clients: readonly BezkvalClientDto[], pick: BezkvalPick): BezkvalClientDto[] {
  return clients.filter((c) => {
    if (pick.rop !== undefined && c.rop !== pick.rop) return false
    if (pick.bucket !== undefined && c.bucket !== pick.bucket) return false
    if (pick.status !== undefined && c.status !== pick.status) return false
    if (pick.source !== undefined && c.source !== pick.source) return false
    if (pick.hour !== undefined && c.hour !== pick.hour) return false
    if (pick.entry !== undefined && (!c.deals[0] || dealEntryKind(c.deals[0]) !== pick.entry)) return false
    if (pick.anyEntry !== undefined && !c.deals.some((d) => dealEntryKind(d) === pick.anyEntry)) return false
    switch (pick.kind) {
      case 'multiRop':
        return c.multiRop
      case 'noPhone':
        return c.kind === 'contact' || c.kind === 'deal'
      case 'dealPhone':
        return c.kind === 'dealPhone'
      default:
        return true
    }
  })
}

export const UNASSIGNED_LABEL = 'Taqsimlanmagan'
export const REGISTRATION_LABEL = 'Регистрация boʻlimida'

/** The ROP column of a client or a line: the team, else which of the two buckets. */
export function ropLabel(line: { readonly rop: string | null; readonly bucket: BezkvalBucket }): string {
  if (line.rop !== null) return line.rop
  return line.bucket === 'registration' ? REGISTRATION_LABEL : UNASSIGNED_LABEL
}

export const STATUS_LABEL: Readonly<Record<BezkvalStatus, string>> = {
  new: 'Yangi',
  t30: 'Takror 30 kun',
  old: 'Takror eski',
}

export const ENTRY_LABEL: Readonly<Record<BezkvalEntryKind, string>> = {
  created: 'Регистрация’da yaratilgan',
  ai: 'ИИ обработка’dan oʻtgan',
  leadGuard: 'Lead Guard',
}

const BITRIX_DEAL = 'https://obey.bitrix24.kz/crm/deal/details/'

/**
 * The drill-down as rows for Excel (the spec's 6.4): one client a row — the
 * number (last four digits), kirim time, source, ROP, status, the deals that
 * day with a link to each, and the earlier deal that makes a repeat.
 */
export function bezkvalCsvRows(day: string, clients: readonly BezkvalClientDto[]): string[][] {
  const head = ['Sana', 'Telefon', 'Kirim vaqti', 'Kirim turi', 'Manba', 'ROP', 'Holat', 'Sdelkalar soni', 'Sdelkalar', 'Oldingi sdelka', 'Oldingi sdelka sanasi']
  return [
    head,
    ...clients.map((c) => {
      const main = c.deals[0]
      return [
        day,
        c.phone ?? (c.kind === 'contact' ? 'raqamsiz kontakt' : c.kind === 'deal' ? 'kontaktsiz bitim' : ''),
        main ? formatTime(main.at) : '',
        main ? ENTRY_LABEL[dealEntryKind(main)] : '',
        c.source ?? 'Manbasiz',
        ropLabel(c),
        c.status === null ? '' : STATUS_LABEL[c.status],
        String(c.deals.length),
        c.deals.map((d) => (d.id === null ? '—' : `${BITRIX_DEAL}${d.id}/`)).join(' '),
        c.previous?.id ? `${BITRIX_DEAL}${c.previous.id}/` : '',
        c.previous ? formatDateTime(c.previous.at) : '',
      ]
    }),
  ]
}

/** The rows a drill-down prints at first; «Yana» adds this many. */
export const BEZKVAL_ROWS_PER_PAGE = 100
