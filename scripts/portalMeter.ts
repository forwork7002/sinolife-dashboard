/**
 * What the portal thinks of us, in one request.
 *
 *     npm run bitrix:meter
 *
 * WHY THIS EXISTS
 * Two portal-wide blocks — 2026-09-14 (`OVERLOAD_LIMIT`, four hours) and
 * 2026-09-16 11:53 (`OVERLOAD_LIMIT`, three entities) — were both diagnosed
 * after the fact, from `sync_log` row counts, because every statement this
 * repository could make about its own load was an estimate made from OUR side
 * of the wire. The portal has been sending the real numbers on every answer
 * since the integration was written and `Bitrix24Response` had no field for
 * them.
 *
 * This asks `profile` — the cheapest method there is, one request, no CRM table
 * touched — and prints what comes back:
 *
 *   • whether the REST API is answering us AT ALL, and with which refusal code
 *     if not (`OVERLOAD_LIMIT` waits itself out; `INVALID_CREDENTIALS` never
 *     will and needs a new webhook)
 *   • `time.operating` — seconds of operating time already billed in the
 *     current basket, against the 480 s Bitrix24 allows per method per ten
 *     minutes
 *   • when that basket empties
 *
 * Safe to run during a block: `profile` is the same method `PortalGate` probes
 * with, and one request into a shut door is what tells you it is shut.
 */
import { config } from 'dotenv'

config()

import { Bitrix24CrmProvider } from '../src/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { classifyRefusal, refusalCode } from '../src/server/integrations/crm/bitrix24/refusal'
import { OPERATING_BUDGET_S } from '../src/server/integrations/crm/bitrix24/portalMeter'

async function main(): Promise<void> {
  const webhookUrl = process.env.BITRIX24_WEBHOOK_URL
  if (!webhookUrl) {
    console.error('BITRIX24_WEBHOOK_URL yoʻq — .env ga qoʻying yoki muhit oʻzgaruvchisi sifating bering.')
    process.exitCode = 1
    return
  }

  const provider = new Bitrix24CrmProvider({ webhookUrl })
  const started = Date.now()

  /*
    `healthCheck`, NOT `probe` — AND THIS SCRIPT GOT IT WRONG ONCE ALREADY.

    `probe()` exists for the gate: it swallows the error and answers a bare
    boolean, because the gate only needs «is the door open». This script needs
    the REASON, and its first version called `probe()` inside a try/catch and
    printed «✓ portal javob berdi» on the strength of nothing having been
    thrown. Measured 2026-09-16 against a webhook the portal answers
    `INVALID_CREDENTIALS`: the diagnostic reported the portal healthy in 508 ms.
    A tool whose entire job is to say whether to wait or to issue a new key
    cannot fail open.
  */
  const health = await provider.healthCheck()

  if (health.ok) {
    console.log(`✓ portal javob berdi (${Date.now() - started} ms)`)
    console.log(`  ${health.detail}`)
  } else {
    const error = health.detail
    const code = refusalCode(error) ?? 'UNKNOWN'
    const kind = classifyRefusal(error)
    console.error(`✗ portal rad etdi — ${code} (${kind ?? 'tasniflanmagan'})`)
    /*
      The advice is the whole point of classifying. A throttle clears on the
      portal's own clock and waiting is exactly right; a credential failure
      never clears, and waiting it out is how 2026-09-15 stayed silent from
      06:10 until somebody happened to look.
    */
    console.error(
      kind === 'CREDENTIAL'
        ? '  → portalda yangi webhook ochib, BITRIX24_WEBHOOK_URL ni yangilash kerak. Kutish yordam bermaydi.'
        : '  → portal oʻzi tiklanadi. Vorker zondlab turadi; hech narsa qilish shart emas.',
    )
    console.error(`  ${error}`)
    process.exitCode = 1
    return
  }

  const operating = provider.meter.operating('scope')
  if (operating === null) {
    /*
      NOT AN ERROR, AND WORTH SAYING OUT LOUD. Bitrix24 omits `time` on some
      plans and on some methods. The meter degrades to admitting every call,
      which is the behaviour this integration had for its whole life — so the
      absence of a gauge is a finding about what we can promise, not a bug.
    */
    console.log('  portal `time.operating` yubormadi — hisoblagich bu portalda ishlamaydi.')
    return
  }

  const pct = Math.round((operating / OPERATING_BUDGET_S) * 100)
  console.log(`  scope savati: ${operating}s / ${OPERATING_BUDGET_S}s (${pct}%)`)

  const { requests, invocations } = provider.meter.stats()
  console.log(`  bu zond: ${requests} soʻrov / ${invocations} chaqiruv`)
}

void main()
