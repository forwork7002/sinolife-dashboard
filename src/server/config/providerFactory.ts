/**
 * Provider selection.
 *
 * THE ONLY PLACE `DATA_SOURCE` IS READ.
 *
 * If you find yourself writing `if (dataSource === 'demo')` anywhere else, the
 * abstraction has leaked and the Bitrix24 cutover has just become a rewrite
 * instead of a configuration change. Ask the provider for its capabilities
 * instead, or take a `CrmProvider` as a parameter.
 */

import { DataSource, env } from '@/server/config/env'
import type { CrmProvider } from '@/server/integrations/crm/CrmProvider'
import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { DemoCrmProvider } from '@/server/integrations/crm/demo/DemoCrmProvider'

let cached: CrmProvider | null = null

/**
 * Build the provider named by `DATA_SOURCE`.
 *
 * `env` has already rejected the dangerous configuration — DATA_SOURCE=bitrix24
 * with no webhook URL — so by the time we get here the combination is coherent.
 */
export function createCrmProvider(): CrmProvider {
  switch (env.DATA_SOURCE) {
    case DataSource.Bitrix24:
      return new Bitrix24CrmProvider({
        // Non-null is safe: env.superRefine makes this unreachable when unset.
        webhookUrl: env.BITRIX24_WEBHOOK_URL!,
        rateLimitRps: env.BITRIX24_RATE_LIMIT_RPS,
        requestTimeoutMs: env.BITRIX24_REQUEST_TIMEOUT_MS,
        maxRetries: env.BITRIX24_MAX_RETRIES,
      })

    case DataSource.Demo:
      return new DemoCrmProvider({
        seed: env.DEMO_SEED,
        referenceDate: new Date(),
        currency: env.APP_DEFAULT_CURRENCY,
      })
  }
}

/** Process-wide singleton. The demo provider caches a large dataset. */
export function getCrmProvider(): CrmProvider {
  cached ??= createCrmProvider()
  return cached
}

/** Test seam only. */
export function resetCrmProvider(): void {
  cached = null
}
