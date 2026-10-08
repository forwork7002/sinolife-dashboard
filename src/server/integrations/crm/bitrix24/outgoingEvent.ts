import { timingSafeEqual } from 'node:crypto'

/**
 * THE PORTAL'S OWN WORD, THE MOMENT IT HAPPENS — a Bitrix24 OUTGOING webhook.
 *
 * Everything else this app knows about the portal it went and asked for: the
 * incremental pass every tick, the by-id checks every 5 / 30 / 60 minutes,
 * the full walk once a night. So a deal deleted in Bitrix24 stayed on the
 * Tasdiqlash queue for up to seven minutes, or an hour, or a day, depending on
 * how old it was — and the client's rule is «Bitrix24ʼda qanday boʻlsa shunday»
 * (2026-09-24, 2026-10-08, twice).
 *
 * An outgoing webhook turns that around: the portal POSTs to us on
 * `ONCRMDEALADD` / `ONCRMDEALUPDATE` / `ONCRMDEALDELETE`, form-encoded, with
 * the deal's id and the «application token» the portal minted when the
 * webhook was created. The payload names the deal and nothing more; the
 * worker then reads the deal by id (or learns it is gone) through the same
 * provider the rest of the sync uses — the web process still never talks to
 * the CRM.
 *
 * What the portal sends (form-urlencoded, keys verbatim):
 *
 *   event=ONCRMDEALDELETE
 *   event_handler_id=12
 *   data[FIELDS][ID]=1050732
 *   ts=1759900000
 *   auth[domain]=obey.bitrix24.kz
 *   auth[client_endpoint]=https://obey.bitrix24.kz/rest/
 *   auth[server_endpoint]=https://oauth.bitrix.info/rest/
 *   auth[member_id]=…
 *   auth[application_token]=…
 */

/** The three deal events the webhook is meant to be subscribed to, as the portal spells them. */
export const DEAL_EVENTS = ['ONCRMDEALADD', 'ONCRMDEALUPDATE', 'ONCRMDEALDELETE'] as const
export type DealEvent = (typeof DEAL_EVENTS)[number]

export interface OutgoingDealEvent {
  readonly event: DealEvent
  /** The deal's portal id — digits only. */
  readonly externalId: string
  readonly applicationToken: string
  /** `auth[domain]`, as sent; empty when absent. */
  readonly domain: string
}

/**
 * The event out of the request body, or the reason it is not one.
 *
 * `null` for a body that is not a deal event at all — another entity's event
 * the webhook was over-subscribed to, a malformed id, a missing token. Those
 * are answered 200 and dropped: Bitrix24 retries a non-2xx answer and
 * eventually disables a handler that keeps failing, and a contact event is
 * not a failure of ours.
 */
export function parseOutgoingDealEvent(body: string): OutgoingDealEvent | null {
  const params = new URLSearchParams(body)
  const event = (params.get('event') ?? '').toUpperCase()
  if (!(DEAL_EVENTS as readonly string[]).includes(event)) return null
  const externalId = params.get('data[FIELDS][ID]') ?? ''
  if (!/^\d{1,18}$/.test(externalId)) return null
  const applicationToken = params.get('auth[application_token]') ?? ''
  if (applicationToken === '') return null
  return {
    event: event as DealEvent,
    externalId,
    applicationToken,
    domain: params.get('auth[domain]') ?? '',
  }
}

/**
 * Whether the token the portal sent is the one configured — in constant time,
 * so a wrong token's reply says nothing about how wrong it was.
 */
export function tokenMatches(sent: string, expected: string): boolean {
  const a = Buffer.from(sent, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

/**
 * The portal host the incoming webhook URL points at — `obey.bitrix24.kz` out
 * of `https://obey.bitrix24.kz/rest/1/…/`. The outgoing event's `auth[domain]`
 * has to be this host: the token already proves the sender, the domain says
 * the event is about THIS portal's deals and not a second portal somebody
 * pointed at the same handler.
 */
export function portalHost(webhookUrl: string): string | null {
  try {
    return new URL(webhookUrl).host.toLowerCase()
  } catch {
    return null
  }
}
