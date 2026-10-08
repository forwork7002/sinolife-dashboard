/**
 * Service wiring.
 *
 * A deliberately plain module rather than a DI framework: the graph is small,
 * and one place that constructs it is enough. Route handlers import from here
 * instead of building repositories themselves, so swapping an implementation
 * is a one-line change.
 */

import { sharedCbuUsdRates } from '@/server/integrations/cbu/cbuRates'
import { env } from '@/server/config/env'
import { prisma } from '@/server/db/prisma'
import { DealRepository } from '@/server/repositories/dealRepository'
import { InsightsRepository } from '@/server/repositories/insightsRepository'
import { PulseRepository } from '@/server/repositories/pulseRepository'
import { ConcentrationRepository } from '@/server/repositories/concentrationRepository'
import { MarketingRepository } from '@/server/repositories/marketingRepository'
import { SearchRepository } from '@/server/repositories/searchRepository'
import { TargetRepository } from '@/server/repositories/targetRepository'
import { LeadCohortRepository } from '@/server/repositories/leadCohortRepository'
import { LeadSourcesRepository } from '@/server/repositories/leadSourcesRepository'
import { ReklamaRepository } from '@/server/repositories/reklamaRepository'
import { RegistrationRepository } from '@/server/repositories/registrationRepository'
import { RnpRepository } from '@/server/repositories/rnpRepository'
import { RoistatRepository } from '@/server/repositories/roistatRepository'
import { SverkaRepository } from '@/server/repositories/sverkaRepository'
import { InboundCallsRepository } from '@/server/repositories/inboundCallsRepository'
import { ScopeRepository } from '@/server/repositories/scopeRepository'
import { AlertsService } from '@/server/services/alertsService'
import { SearchService } from '@/server/services/searchService'
import { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { InsightsService } from './insightsService'
import { PayrollService } from './payrollService'
import { KpiService } from './kpiService'
import { PulseService } from './pulseService'
import { ConcentrationService } from './concentrationService'
import { SellerBoardService } from './sellerBoardService'
import { ScopeService } from './scopeService'
import { TargetService } from './targetService'
import { LeadCohortService } from './leadCohortService'
import { LeadSourcesService } from './leadSourcesService'
import { ReklamaService } from './reklamaService'
import { RegistrationService } from './registrationService'
import { RnpService } from './rnpService'
import { RoistatService } from './roistatService'
import { SverkaService } from './sverkaService'
import { InboundCallsService } from './inboundCallsService'

const dealRepository = new DealRepository(prisma)
export const referenceRepository = new ReferenceRepository(prisma)
const insightsRepository = new InsightsRepository(prisma)
const pulseRepository = new PulseRepository(prisma)
const concentrationRepository = new ConcentrationRepository(prisma)
/**
 * The Roistat snapshot — only its UZS/USD rate is read, by «Target tahlili».
 *
 * The Roistat importer fills `marketing_snapshot` from the client's published
 * page — Google Sheets plus Meta Ads, not Bitrix24. It shares the Prisma client
 * and nothing else: no CRM repository feeds it.
 */
const marketingRepository = new MarketingRepository(prisma)
const sellerBoardRepository = new SellerBoardRepository(prisma)
const searchRepository = new SearchRepository(prisma)
/**
 * Answers one question and is asked it by `getHandler` on every request: who
 * may this caller read? Kept out of every other service's constructor because
 * it is authorisation, not analytics.
 */
export const scopeRepository = new ScopeRepository(prisma)

export const scopeService = new ScopeService(scopeRepository)
export const kpiService = new KpiService(dealRepository, referenceRepository)
export const insightsService = new InsightsService(insightsRepository)
/*
  «Kiruvchi qoʻngʻiroqlar» (2026-10-05) on «Qoʻngʻiroqlar»: inbound callers by
  number, grouped by what the CRM held for them. See inboundCallsService.ts.
*/
export const inboundCallsService = new InboundCallsService(new InboundCallsRepository(prisma), env.APP_TIMEZONE)
export const pulseService = new PulseService(pulseRepository)
/*
  «Oyliklar» reads the confirmation cohort's per-seller rating — the same query
  the sellers board reads — and applies the client's pay table to it. It takes
  the repository rather than SellerBoardService on purpose; payrollService's
  own header says why.
*/
export const payrollService = new PayrollService(insightsRepository)
export const searchService = new SearchService(searchRepository)
export const alertsService = new AlertsService(insightsRepository, referenceRepository)
export const concentrationService = new ConcentrationService(concentrationRepository)
/*
  «Target tahlili» reads the Bitrix24 leads and the Meta spend through its own
  repository and borrows the Roistat snapshot's UZS rate — side by side, never
  added. See the header of targetService.ts.
*/
const targetRepository = new TargetRepository(prisma)
export const targetService = new TargetService(targetRepository, marketingRepository)

/*
  «Reklama samarasi» — the client's DM, «Отчёт Т» and lead-quality sheets,
  from Meta's campaign grain and the Регистрация leads. See reklamaService.ts.
*/
const reklamaRepository = new ReklamaRepository(prisma)
export const reklamaService = new ReklamaService(reklamaRepository)
/*
  «Lid manbalari» (the first tab of «Lidlar») — every Регистрация lead by
  source, the lead forms per targetolog against Meta's lead count (Meta rows
  through the reklama repository), and the DM pages' «ИИ обработка»
  conversations. «Факт1 мижоз» reads the queue cohort through insightsRepository.
  See leadSourcesService.ts.
*/
export const leadSourcesService = new LeadSourcesService(new LeadSourcesRepository(prisma), reklamaRepository, insightsRepository)
/*
  «RNP jadvali» (2026-09-28) — the client's «СентябрРНП» sheet. FAKT 1 / FAKT 2
  from the queue cohort (insightsRepository), Meta through the reklama
  repository, everything else and the plans from its own. See rnpService.ts.
*/
const rnpRepository = new RnpRepository(prisma)
/*
  ONE bank-rate cache for the two screens that convert dollars, so a day
  read for one is not asked of cbu.uz again for the other — and one for the
  process, so the RNP warmer's bundle and the routes' share it too.
*/
const cbuUsdRates = sharedCbuUsdRates()
export const rnpService = new RnpService(insightsRepository, rnpRepository, reklamaRepository, cbuUsdRates)
/*
  «Roistat» (2026-10-05) — Meta's ad-level rows and the Регистрация lead
  cohort through to Доставка, from its own repository; Meta's campaign-days
  for the money through the reklama repository. See roistatService.ts.
*/
export const roistatService = new RoistatService(new RoistatRepository(prisma), reklamaRepository, cbuUsdRates, insightsRepository)
/*
  «Registratsiya» (2026-10-01) — the day's handed-out leads per ROP against the
  administrator's split, and «ROP otchet» seller by seller (FAKT from the
  queue cohort, insightsRepository). See registrationService.ts.
*/
export const registrationService = new RegistrationService(new RegistrationRepository(prisma), insightsRepository)
/*
  «Lid kogortasi» (a tab of «Lidlar» since 2026-09-25) — arrival → distribution of routed leads. See leadCohortService.ts.
*/
export const leadCohortService = new LeadCohortService(new LeadCohortRepository(prisma))
export const sellerBoardService = new SellerBoardService(sellerBoardRepository, insightsRepository)

/*
  «Sverka» (2026-10-06) — the queue cohort (insightsRepository, so FAKT 1 /
  FAKT 2 are Savdo dinamikasi's) against MoySklad's orders. See sverkaService.ts.
*/
export const sverkaService = new SverkaService(insightsRepository, new SverkaRepository(prisma))
