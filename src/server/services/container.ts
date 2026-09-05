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
import { ResponseRepository } from '@/server/repositories/responseRepository'
import { FinanceRepository } from '@/server/repositories/financeRepository'
import { MarketingRepository } from '@/server/repositories/marketingRepository'
import { SearchRepository } from '@/server/repositories/searchRepository'
import { ScopeRepository } from '@/server/repositories/scopeRepository'
import { AlertsService } from '@/server/services/alertsService'
import { SearchService } from '@/server/services/searchService'
import { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { AnalyticsService } from './analyticsService'
import { InsightsService } from './insightsService'
import { FinanceService } from './financeService'
import { KpiService } from './kpiService'
import { PulseService } from './pulseService'
import { CommandCentreService } from './commandCentreService'
import { ConcentrationService } from './concentrationService'
import { ResponseService } from './responseService'
import { MarketingService } from './marketingService'
import { SellerBoardService } from './sellerBoardService'
import { ScopeService } from './scopeService'

export const dealRepository = new DealRepository(prisma)
export const financeRepository = new FinanceRepository(prisma)
export const referenceRepository = new ReferenceRepository(prisma)
export const insightsRepository = new InsightsRepository(prisma)
export const pulseRepository = new PulseRepository(prisma)
export const concentrationRepository = new ConcentrationRepository(prisma)
export const responseRepository = new ResponseRepository(prisma)
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
export const analyticsService = new AnalyticsService(dealRepository, referenceRepository)
export const financeService = new FinanceService(financeRepository, referenceRepository)
export const kpiService = new KpiService(dealRepository, referenceRepository)
export const insightsService = new InsightsService(insightsRepository)
export const pulseService = new PulseService(pulseRepository)
export const searchService = new SearchService(searchRepository)
export const alertsService = new AlertsService(insightsRepository, referenceRepository)
export const concentrationService = new ConcentrationService(concentrationRepository)
export const commandCentreService = new CommandCentreService(insightsRepository)
export const responseService = new ResponseService(responseRepository)
export const marketingService = new MarketingService(marketingRepository)
export const sellerBoardService = new SellerBoardService(
  sellerBoardRepository,
  insightsRepository,
  referenceRepository,
)
