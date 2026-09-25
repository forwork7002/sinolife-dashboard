/**
 * Service wiring.
 *
 * A deliberately plain module rather than a DI framework: the graph is small,
 * and one place that constructs it is enough. Route handlers import from here
 * instead of building repositories themselves, so swapping an implementation
 * is a one-line change.
 */

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
import { SalesTeamRepository } from '@/server/repositories/salesTeamRepository'
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
import { MarketingService } from './marketingService'
import { SellerBoardService } from './sellerBoardService'
import { ScopeService } from './scopeService'
import { TargetService } from './targetService'
import { LeadCohortService } from './leadCohortService'
import { LeadSourcesService } from './leadSourcesService'
import { ReklamaService } from './reklamaService'
import { SalesTeamService } from './salesTeamService'

export const dealRepository = new DealRepository(prisma)
export const referenceRepository = new ReferenceRepository(prisma)
export const insightsRepository = new InsightsRepository(prisma)
export const pulseRepository = new PulseRepository(prisma)
export const concentrationRepository = new ConcentrationRepository(prisma)
/**
 * The second ledger.
 *
 * Reads `marketing_daily` / `marketing_snapshot`, which the Roistat importer
 * fills from the client's published page — Google Sheets plus Meta Ads, not
 * Bitrix24. It shares the Prisma client and nothing else: no CRM repository
 * feeds it, and its figures are never added to a Bitrix24 total.
 */
export const marketingRepository = new MarketingRepository(prisma)
export const sellerBoardRepository = new SellerBoardRepository(prisma)
export const searchRepository = new SearchRepository(prisma)
/**
 * Answers one question and is asked it by `getHandler` on every request: who
 * may this caller read? Kept out of every other service's constructor because
 * it is authorisation, not analytics.
 */
export const scopeRepository = new ScopeRepository(prisma)

export const scopeService = new ScopeService(scopeRepository)
export const kpiService = new KpiService(dealRepository, referenceRepository)
export const insightsService = new InsightsService(insightsRepository)
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
export const marketingService = new MarketingService(marketingRepository)
/*
  «Target tahlili» reads the Bitrix24 leads through its own repository and the
  ad ledger through `marketingService` — side by side, never added. See the
  header of targetService.ts.
*/
export const targetRepository = new TargetRepository(prisma)
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
  conversations. See leadSourcesService.ts.
*/
export const leadSourcesService = new LeadSourcesService(new LeadSourcesRepository(prisma), reklamaRepository)
/*
  «Sotuv · ROP» (a tab of «Lidlar» since 2026-09-25) — the client's ROP sheets. FAKT 1 / FAKT 2 from the sellers
  board's own cohort (insightsRepository), leads and plans from its own
  repository. See salesTeamService.ts.
*/
export const salesTeamService = new SalesTeamService(insightsRepository, new SalesTeamRepository(prisma))
/*
  «Lid kogortasi» (a tab of «Lidlar» since 2026-09-25) — arrival → distribution of routed leads. See leadCohortService.ts.
*/
export const leadCohortService = new LeadCohortService(new LeadCohortRepository(prisma))
export const sellerBoardService = new SellerBoardService(
  sellerBoardRepository,
  insightsRepository,
  referenceRepository,
)
