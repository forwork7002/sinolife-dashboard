/**
 * «Лид назорати» — the wire shapes of `GET /api/v1/leads/watch`, restated for
 * the client. Mirrors `LeadWatchDto` in `src/server/domain/leads/leadWatch.ts`.
 * Nothing checks the mirror — edit both sides.
 */

/** The four channels the client filters by; everything else is `other`. «Исход» is never here. */
export type WatchChannel = 'generated' | 'smm' | 'inbound' | 'telegram' | 'other'
export const WATCH_CHANNELS: readonly WatchChannel[] = ['generated', 'smm', 'inbound', 'telegram', 'other']

export type WatchSeverity = 'ok' | 'warn' | 'critical'

export type WatchIssueKind =
  | 'unassigned'
  | 'idle'
  | 'chats'
  | 'missedCalls'
  | 'channelStop'
  | 'uneven'
  | 'noProject'

export type WatchBrand = 'Collagen' | 'Zextra'

export interface LeadWatchRowDto {
  /** Unique within its issue. */
  readonly key: string
  /** Bitrix24 deal id for the «Ochish» link; null when the row is not a deal (a call with no deal, a form, a ROP). */
  readonly dealId: string | null
  /** The customer's name, else the deal title, a phone number, a form or a ROP. */
  readonly title: string
  readonly channel: WatchChannel | null
  readonly brand: WatchBrand | null
  /** «Ответственный». */
  readonly owner: string | null
  /** «РОП (Первичка)». */
  readonly rop: string | null
  /** ISO instant the waiting counts from; null when the row has no timer (uneven split, arrival rate). */
  readonly since: string | null
  /** One short Uzbek line under the title: the form, the line, «reja 20 · keldi 31». */
  readonly note: string | null
}

export interface LeadWatchIssueDto {
  readonly kind: WatchIssueKind
  /** The real count, even when `rows` is capped. */
  readonly count: number
  readonly severity: WatchSeverity
  /** The longest wait among the rows, ISO; null when nothing waits. */
  readonly oldestSince: string | null
  /** A ready Uzbek sub-line for cards without a timer («1 forma», «2 ROP»); null → the client shows the longest wait. */
  readonly summary: string | null
  readonly byChannel: Readonly<Record<WatchChannel, number>>
  /** Longest waiting first. */
  readonly rows: readonly LeadWatchRowDto[]
}

export interface LeadWatchFlowHourDto {
  /** Tashkent hour the bar starts at: 9 is 09:00–10:00. */
  readonly hour: number
  readonly counts: Readonly<Record<WatchChannel, number>>
  /** The same hour's average over the history days, every channel together. */
  readonly average: number
  /** False for an hour that has not started yet. */
  readonly past: boolean
}

export interface LeadWatchStopDto {
  readonly fromHour: number
  readonly toHour: number
  /** «Ген лид · Umar formasi · 60 daq lead yoʻq». */
  readonly label: string
}

export interface LeadWatchDto {
  /** ISO instant the answer was computed. */
  readonly generatedAt: string
  /** ISO instant of the oldest feed under it (deals sync, calls, chats); null when never synced. */
  readonly dataAsOf: string | null
  /** How many issues are `critical`. */
  readonly critical: number
  readonly issues: readonly LeadWatchIssueDto[]
  readonly flow: {
    readonly hours: readonly LeadWatchFlowHourDto[]
    readonly stops: readonly LeadWatchStopDto[]
  }
}

/** `GET /api/v1/leads/watch/summary` — what the sidebar badge and the tab title need. */
export interface LeadWatchSummaryDto {
  readonly critical: number
}
