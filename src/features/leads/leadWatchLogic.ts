import { LEAD_CHANNEL_ORDER } from '@/lib/leadChannels'
import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'

import type {
  LeadWatchIssueDto,
  LeadWatchRowDto,
  WatchChannel,
  WatchIssueKind,
  WatchSeverity,
} from './leadWatchApi'

/**
 * «Лид назорати» — everything the block decides without drawing: how a wait
 * reads, which card comes first, which chip is alive. Pure, so the rules are
 * tested without a browser (`tests/features/leadWatchLogic.test.ts`).
 */

/** The seven cards, in the client's order — the order inside one severity. */
export const WATCH_KINDS: readonly WatchIssueKind[] = [
  'unassigned',
  'idle',
  'chats',
  'missedCalls',
  'channelStop',
  'uneven',
  'noProject',
]

/** Titles as the floor says them (Russian, as on the portal). */
export const WATCH_TITLE: Readonly<Record<WatchIssueKind, string>> = {
  unassigned: 'Не распределены',
  idle: 'Не обработаны',
  chats: 'Чаты без ответа',
  missedCalls: 'Пропущенные звонки',
  channelStop: 'Канал стоп',
  uneven: 'Неравномерно',
  noProject: 'Без проекта',
}

const SEVERITY_RANK: Readonly<Record<WatchSeverity, number>> = { critical: 0, warn: 1, ok: 2 }

/** A kind the server did not send is a kind with nothing wrong — never a hole in the grid. */
function emptyIssue(kind: WatchIssueKind): LeadWatchIssueDto {
  return {
    kind,
    count: 0,
    severity: 'ok',
    oldestSince: null,
    summary: null,
    byChannel: { generated: 0, smm: 0, inbound: 0, telegram: 0, other: 0 },
    rows: [],
  }
}

/**
 * All seven cards: critical first, then warnings, then the calm ones — and
 * inside each group the client's own order, so a card that changes state
 * moves between groups but never shuffles its neighbours.
 */
export function orderIssues(issues: readonly LeadWatchIssueDto[]): LeadWatchIssueDto[] {
  const byKind = new Map(issues.map((issue) => [issue.kind, issue]))
  return WATCH_KINDS.map((kind, index) => ({ issue: byKind.get(kind) ?? emptyIssue(kind), index }))
    .sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || a.index - b.index)
    .map((entry) => entry.issue)
}

export type WatchTone = 'good' | 'warning' | 'critical'

/** A severity as the status step it wears. */
export function toneOf(severity: WatchSeverity): WatchTone {
  return severity === 'critical' ? 'critical' : severity === 'warn' ? 'warning' : 'good'
}

export const TONE_COLOR: Readonly<Record<WatchTone, string>> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
}

/** Whole minutes from `since` to `now`; null without a start, a clock, or a parsable date. Never negative. */
export function minutesSince(since: string | null, now: number): number | null {
  if (since === null || now <= 0) return null
  const at = Date.parse(since)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.floor((now - at) / 60_000))
}

/** «47 daq», «1 soat 12 daq», «2 soat», «3 kun 4 soat». */
export function formatWait(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes))
  if (whole < 1) return '< 1 daq'
  if (whole < 60) return `${whole} daq`
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (hours < 24) return rest === 0 ? `${hours} soat` : `${hours} soat ${rest} daq`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${days} kun` : `${days} kun ${restHours} soat`
}

/** «hozirgina», «1 daq oldin», «1 soat 5 daq oldin». */
export function formatAgo(minutes: number): string {
  return minutes < 1 ? 'hozirgina' : `${formatWait(minutes)} oldin`
}

interface WaitThresholds {
  readonly warnMin: number
  readonly criticalMin: number
}

/**
 * Where a row's timer turns amber and red: the problem's own two numbers from
 * the settings file, so the timer and the server grade a wait alike. Null for
 * the three problems that are not graded by a wait (a silent channel, an
 * uneven split, an empty «Проект»): they have no pair of their own, and
 * borrowing another card's would paint a timer amber or red by a rule the
 * server never applied to it.
 */
export function waitThresholds(kind: WatchIssueKind): WaitThresholds | null {
  const own = LEAD_WATCH_SETTINGS[kind]
  return 'warnMin' in own && 'criticalMin' in own ? own : null
}

export type WaitTone = 'normal' | 'warning' | 'critical'

/** A timer with no thresholds of its own stays neutral however long it has run. */
export function waitTone(minutes: number, kind: WatchIssueKind): WaitTone {
  const limits = waitThresholds(kind)
  if (limits === null) return 'normal'
  const { warnMin, criticalMin } = limits
  return minutes >= criticalMin ? 'critical' : minutes >= warnMin ? 'warning' : 'normal'
}

/**
 * The small line under a card's number: the server's own sentence when it
 * sent one («1 forma», «2 ROP»), «qayta qilinmagan» for missed calls, else
 * the longest wait. Null when there is nothing true to say.
 */
export function issueSubline(issue: LeadWatchIssueDto, now: number): string | null {
  if (issue.summary !== null && issue.summary !== '') return issue.summary
  if (issue.kind === 'missedCalls') return 'qayta qilinmagan'
  const longest = minutesSince(issue.oldestSince, now)
  return longest === null ? null : `eng uzoq kutayotgan: ${formatWait(longest)}`
}

/** A calm card with nothing behind it opens nothing. */
export function isOpenable(issue: LeadWatchIssueDto): boolean {
  return issue.severity !== 'ok' || issue.rows.length > 0
}

export type ChannelFilter = 'all' | Exclude<WatchChannel, 'other'>

export interface ChannelChip {
  readonly value: ChannelFilter
  readonly label: string
  /** The real count (the server's, even when the rows are capped). */
  readonly count: number
  /** Nothing listed to show under it. */
  readonly disabled: boolean
}

const CHIP_LABEL: Readonly<Record<ChannelFilter, string>> = {
  all: 'Hammasi',
  generated: 'Ген лид',
  smm: 'СММ',
  inbound: 'Входящий',
  telegram: 'Телеграм',
}

/**
 * Hammasi · Ген лид · СММ · Входящий · Телеграм. The number is the server's
 * count; whether the chip can be pressed depends on the rows actually sent,
 * because pressing it filters those. `other` rows have no chip of their own:
 * they are under «Hammasi» only.
 */
export function channelChips(issue: LeadWatchIssueDto): ChannelChip[] {
  const listed = new Map<WatchChannel, number>()
  for (const row of issue.rows) {
    if (row.channel !== null) listed.set(row.channel, (listed.get(row.channel) ?? 0) + 1)
  }
  const channels = LEAD_CHANNEL_ORDER.filter((c): c is Exclude<WatchChannel, 'other'> => c !== 'other')
  return [
    { value: 'all', label: CHIP_LABEL.all, count: issue.count, disabled: issue.rows.length === 0 },
    ...channels.map((channel) => ({
      value: channel,
      label: CHIP_LABEL[channel],
      count: Math.max(issue.byChannel[channel] ?? 0, listed.get(channel) ?? 0),
      disabled: (listed.get(channel) ?? 0) === 0,
    })),
  ]
}

export function filterRows(rows: readonly LeadWatchRowDto[], filter: ChannelFilter): readonly LeadWatchRowDto[] {
  return filter === 'all' ? rows : rows.filter((row) => row.channel === filter)
}

/** Rows drawn at first, and added by each press of «Yana N ta». */
export const ROWS_PER_PAGE = 50

/** How many the next press reveals; 0 when everything is on screen. */
export function nextPageSize(total: number, shown: number): number {
  return Math.max(0, Math.min(ROWS_PER_PAGE, total - shown))
}

export interface WatchVerdict {
  readonly tone: WatchTone
  readonly label: string
}

/** The header chip: the worst thing on the board, counted. */
export function verdictOf(issues: readonly LeadWatchIssueDto[]): WatchVerdict {
  const critical = issues.filter((issue) => issue.severity === 'critical').length
  if (critical > 0) return { tone: 'critical', label: `${critical} ta muhim muammo` }
  const warn = issues.filter((issue) => issue.severity === 'warn').length
  if (warn > 0) return { tone: 'warning', label: `${warn} ta ogohlantirish` }
  return { tone: 'good', label: 'Hammasi joyida' }
}

export interface Freshness {
  readonly live: boolean
  readonly label: string
}

/**
 * «Jonli · 1 daq oldin yangilandi», or «Yangilanmayapti» once the data is
 * older than the settings allow or the request itself is failing. Dated by
 * the oldest feed under the answer, falling back to when it was computed.
 */
export function freshnessOf(
  dto: { readonly dataAsOf: string | null; readonly generatedAt: string },
  now: number,
  failing: boolean,
): Freshness {
  const age = minutesSince(dto.dataAsOf ?? dto.generatedAt, now)
  if (age === null) return { live: !failing, label: failing ? 'Yangilanmayapti' : 'Jonli' }
  if (failing || age > LEAD_WATCH_SETTINGS.staleAfterMin) {
    return { live: false, label: `Yangilanmayapti · oxirgi maʼlumot ${formatAgo(age)}` }
  }
  return { live: true, label: `Jonli · ${formatAgo(age)} yangilandi` }
}

/** «(3) Lidlar» — the tab's title while something is critical; the plain name otherwise. */
export function watchTitle(base: string, critical: number): string {
  return critical > 0 ? `(${critical}) ${base}` : base
}

/** «09:00–10:00» for the bar that starts at `hour`. */
export function hourRange(hour: number): string {
  const pad = (h: number) => String(h % 24).padStart(2, '0')
  return `${pad(hour)}:00–${pad(hour + 1)}:00`
}
