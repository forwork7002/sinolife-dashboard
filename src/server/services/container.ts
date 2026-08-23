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
import { FinanceRepository } from '@/server/repositories/financeRepository'
import { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { AnalyticsService } from './analyticsService'
import { FinanceService } from './financeService'
import { KpiService } from './kpiService'

export const dealRepository = new DealRepository(prisma)
export const financeRepository = new FinanceRepository(prisma)
export const referenceRepository = new ReferenceRepository(prisma)

export const analyticsService = new AnalyticsService(dealRepository, referenceRepository)
export const financeService = new FinanceService(financeRepository, referenceRepository)
export const kpiService = new KpiService(dealRepository, referenceRepository)
