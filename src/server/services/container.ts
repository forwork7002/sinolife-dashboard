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
import { WARM_STATEMENT_TIMEOUT_MS, prisma, warmPrisma } from '@/server/db/prisma'
import { logger } from '@/server/logging/logger'
import { DealRepository } from '@/server/repositories/dealRepository'
import { InsightsRepository } from '@/server/repositories/insightsRepository'
import { CohortSnapshotRepository } from '@/server/repositories/cohortSnapshotRepository'
import { MonthScanRepository } from '@/server/repositories/monthScanRepository'
import { PulseRepository } from '@/server/repositories/pulseRepository'
import { ConcentrationRepository } from '@/server/repositories/concentrationRepository'
import { MarketingRepository } from '@/server/repositories/marketingRepository'
import { SearchRepository } from '@/server/repositories/searchRepository'
import { TargetRepository } from '@/server/repositories/targetRepository'
import { LeadCohortRepository } from '@/server/repositories/leadCohortRepository'
import { LeadSourcesRepository } from '@/server/repositories/leadSourcesRepository'
import { LeadWatchRepository } from '@/server/repositories/leadWatchRepository'
import { ReklamaRepository } from '@/server/repositories/reklamaRepository'
import { RegistrationRepository } from '@/server/repositories/registrationRepository'
import { RnpRepository } from '@/server/repositories/rnpRepository'
import { RoistatRepository } from '@/server/repositories/roistatRepository'
import { SverkaRepository } from '@/server/repositories/sverkaRepository'
import { InboundAnalysisRepository } from '@/server/repositories/inboundAnalysisRepository'
import { InboundCallsRepository } from '@/server/repositories/inboundCallsRepository'
import { ScopeRepository } from '@/server/repositories/scopeRepository'
import { CrmEventRepository } from '@/server/repositories/crmEventRepository'
import { AiRegistratorRepository } from '@/server/repositories/aiRegistratorRepository'
import { AlertsService } from '@/server/services/alertsService'
import { SearchService } from '@/server/services/searchService'
import { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { UsdRateRepository } from '@/server/repositories/usdRateRepository'
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
import { LeadWatchService } from './leadWatchService'
import { ReklamaService } from './reklamaService'
import { RegistrationService } from './registrationService'
import { RnpService, warmMonthFakt } from './rnpService'
import { BORROWED_FAKT_MAX_AGE_MS, RoistatService } from './roistatService'
import { SverkaService } from './sverkaService'
import { InboundAnalysisService } from './inboundAnalysisService'
import { InboundCallsService } from './inboundCallsService'
import { AiRegistratorService } from './aiRegistratorService'

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
/** `/api/bitrix24/events` — the portal's outgoing events, queued for the worker. */
export const crmEventRepository = new CrmEventRepository(prisma)
/*
  «AI registrator» (2026-10-22): the voice agent's pushed calls — written by
  `/api/ai-registrator/calls`, read by «Lidlar → AI registrator» beside the
  synced deals they handed over. See aiRegistratorService.ts.
*/
export const aiRegistratorRepository = new AiRegistratorRepository(prisma)
export const aiRegistratorService = new AiRegistratorService(aiRegistratorRepository, env.APP_DEFAULT_CURRENCY)

export const scopeService = new ScopeService(scopeRepository)
export const kpiService = new KpiService(dealRepository, referenceRepository)
/*
  «Mijoz qaytishi» reads the sync worker's stored matrices (`cohort_snapshot`,
  2026-10-24) and builds live only what nobody stored — see insightsService.ts.
*/
export const insightsService = new InsightsService(insightsRepository, {
  reader: new CohortSnapshotRepository(prisma),
  timeZone: env.APP_TIMEZONE,
})
/*
  «Kiruvchi qoʻngʻiroqlar» (2026-10-05) on «Qoʻngʻiroqlar»: inbound callers by
  number, grouped by what the CRM held for them. See inboundCallsService.ts.
*/
const inboundCallsRepository = new InboundCallsRepository(prisma)
export const inboundCallsService = new InboundCallsService(inboundCallsRepository, env.APP_TIMEZONE)
/*
  «Kiruvchi tahlil» (2026-10-22): «Соф янги» and «Қайта мурожат» followed to the
  end, on «Qoʻngʻiroqlar»'s own calls and contacts. See inboundAnalysisService.ts.
*/
export const inboundAnalysisService = new InboundAnalysisService(
  inboundCallsRepository,
  new InboundAnalysisRepository(prisma),
  env.APP_TIMEZONE,
)
export const pulseService = new PulseService(pulseRepository)
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
const cbuUsdRates = sharedCbuUsdRates(new UsdRateRepository(prisma))
export const rnpService = new RnpService(insightsRepository, rnpRepository, reklamaRepository, cbuUsdRates)
/*
  «Roistat» (2026-10-05) — Meta's ad-level rows and the Регистрация lead
  cohort through to Доставка, from its own repository; Meta's campaign-days
  for the money through the reklama repository. See roistatService.ts.
*/
export const roistatService = new RoistatService(
  new RoistatRepository(prisma),
  reklamaRepository,
  cbuUsdRates,
  insightsRepository,
  // The closed months the sync worker stored (`monthScanRefresh.ts`).
  new MonthScanRepository(prisma),
  // The running month's FAKT, from the RNP sheet's warmed memo when it is young enough.
  (month) => warmMonthFakt(month, BORROWED_FAKT_MAX_AGE_MS),
)
/*
  «Registratsiya» (2026-10-01) — the day's handed-out leads per ROP against the
  administrator's split, and «ROP otchet» seller by seller (FAKT from the
  queue cohort, insightsRepository). See registrationService.ts.
*/
const registrationRepository = new RegistrationRepository(prisma)
export const registrationService = new RegistrationService(registrationRepository, insightsRepository)
/*
  «Oyliklar» reads the confirmation cohort's per-seller rating — the same query
  the sellers board reads — and applies the client's pay table to it. It takes
  the repository rather than SellerBoardService on purpose; payrollService's
  own header says why. «Лид сони» is «ROP otchet»'s, so it is declared after
  the registration repository it reads.
*/
export const payrollService = new PayrollService(insightsRepository, registrationRepository, (context, message) =>
  logger.warn(context, message),
)
/*
  «Лид назорати» (2026-10-09) — what is waiting right now on «Lidlar»: today's
  Регистрация leads and the open chats from its own repository, the day's
  inbound calls as «Qoʻngʻiroqlar» reads them, the day's hand-out as «Lidlar
  qanday boʻlinadi» reads it, «Yetib keldi» from «Lid manbalari», and the
  sync's clock for how old it all is. See leadWatchService.ts.
*/
export const leadWatchService = new LeadWatchService(
  new LeadWatchRepository(prisma),
  inboundCallsRepository,
  registrationRepository,
  referenceRepository,
  leadSourcesService,
)
/*
  THE WARMERS' OWN SERVICES (2026-10-28): «RNP jadvali», «Lidlar» and «Лид
  назорати» once more, on the warm lane's one connection (`warmPrisma`,
  prisma.ts) — `instrumentation.ts` warms through these and nothing else
  does. Their memos are process-wide (`processWide`), so what a warm-up
  builds here is the very answer the screens' services above hand out; only
  the connection it was read on differs.
*/
// The lane already allows a minute: a statement asked for no more runs without a transaction of its own there.
const warmInsightsRepository = new InsightsRepository(warmPrisma, WARM_STATEMENT_TIMEOUT_MS)
const warmReklamaRepository = new ReklamaRepository(warmPrisma)
const warmLeadSourcesService = new LeadSourcesService(
  new LeadSourcesRepository(warmPrisma),
  warmReklamaRepository,
  warmInsightsRepository,
)
export const warmServices = {
  rnp: new RnpService(
    warmInsightsRepository,
    new RnpRepository(warmPrisma, WARM_STATEMENT_TIMEOUT_MS),
    warmReklamaRepository,
    cbuUsdRates,
  ),
  leadSources: warmLeadSourcesService,
  // «Kunlar boʻyicha»'s «Shu oy» (`RoistatService.warm`) — its memos are process-wide too.
  roistat: new RoistatService(
    new RoistatRepository(warmPrisma, WARM_STATEMENT_TIMEOUT_MS),
    warmReklamaRepository,
    cbuUsdRates,
    warmInsightsRepository,
    new MonthScanRepository(warmPrisma),
    (month) => warmMonthFakt(month, BORROWED_FAKT_MAX_AGE_MS),
  ),
  leadWatch: new LeadWatchService(
    new LeadWatchRepository(warmPrisma),
    new InboundCallsRepository(warmPrisma),
    new RegistrationRepository(warmPrisma),
    new ReferenceRepository(warmPrisma),
    warmLeadSourcesService,
  ),
  /*
    The month reads that answered 500 on the screens' 20 s pool (2026-10-28):
    «Qoʻngʻiroqlar», «Kiruvchi tahlil», «Reklama samarasi» / «Target tahlili»
    DM — built here (`monthReadsWarmer.ts`) into their process-wide memos.
  */
  insights: new InsightsService(warmInsightsRepository),
  inboundAnalysis: new InboundAnalysisService(
    new InboundCallsRepository(warmPrisma),
    new InboundAnalysisRepository(warmPrisma),
    env.APP_TIMEZONE,
  ),
  reklama: new ReklamaService(warmReklamaRepository),
} as const
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
