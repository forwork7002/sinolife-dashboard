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
import { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { AnalyticsService } from './analyticsService'
import { InsightsService } from './insightsService'
import { FinanceService } from './financeService'
import { KpiService } from './kpiService'
import { PulseService } from './pulseService'
import { ConcentrationService } from './concentrationService'
import { ResponseService } from './responseService'

export const dealRepository = new DealRepository(prisma)
export const financeRepository = new FinanceRepository(prisma)
export const referenceRepository = new ReferenceRepository(prisma)
export const insightsRepository = new InsightsRepository(prisma)
export const pulseRepository = new PulseRepository(prisma)
export const concentrationRepository = new ConcentrationRepository(prisma)
export const responseRepository = new ResponseRepository(prisma)

export const analyticsService = new AnalyticsService(dealRepository, referenceRepository)
export const financeService = new FinanceService(financeRepository, referenceRepository)
export const kpiService = new KpiService(dealRepository, referenceRepository)
export const insightsService = new InsightsService(insightsRepository)
export const pulseService = new PulseService(pulseRepository)
export const concentrationService = new ConcentrationService(concentrationRepository)
export const responseService = new ResponseService(responseRepository)
