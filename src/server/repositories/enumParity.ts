/**
 * Compile-time parity between the domain vocabulary and the database enums.
 *
 * `src/server/domain/types.ts` declares the enum values as plain string unions
 * so the domain layer stays free of Prisma. That duplication is deliberate, but
 * duplication drifts — someone adds a KPI metric to the schema, forgets the
 * union, and the mismatch surfaces months later as a runtime cast that silently
 * mislabels data.
 *
 * The assertions below make that a BUILD failure instead. There is no runtime
 * cost: every symbol here is erased by the compiler.
 *
 * If `npm run typecheck` fails in this file, a Prisma enum and its domain union
 * have gone out of step. Fix the union — do not weaken the assertion.
 */

import type { $Enums } from '@/generated/prisma/client'

import type {
  CallDirectionValue,
  ConfirmStatusValue,
  DataScopeValue,
  DealStatusValue,
  ExternalSourceValue,
  KpiMetricValue,
  KpiPeriodValue,
  KpiStatusValue,
  LogisticsRoleValue,
  PaymentMethodValue,
  PipelineRoleValue,
  RoleValue,
  StageCategoryValue,
  SyncEntityValue,
  SyncModeValue,
  SyncStatusValue,
} from '@/server/domain/types'

/**
 * Resolves to `true` only when A and B are mutually assignable — i.e. exactly
 * the same set of members. A one-directional `extends` check would let the
 * database grow a value the domain has never heard of.
 */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

// Each constant is erased at compile time; the underscore prefix marks it as
// intentionally unused (see the lint config).
const _externalSource: AssertEqual<ExternalSourceValue, $Enums.ExternalSource> = true
const _role: AssertEqual<RoleValue, $Enums.Role> = true
const _dataScope: AssertEqual<DataScopeValue, $Enums.DataScope> = true
const _stageCategory: AssertEqual<StageCategoryValue, $Enums.StageCategory> = true
const _pipelineRole: AssertEqual<PipelineRoleValue, $Enums.PipelineRole> = true
const _logisticsRole: AssertEqual<LogisticsRoleValue, $Enums.LogisticsRole> = true
const _confirmStatus: AssertEqual<ConfirmStatusValue, $Enums.ConfirmStatus> = true
const _callDirection: AssertEqual<CallDirectionValue, $Enums.CallDirection> = true
const _dealStatus: AssertEqual<DealStatusValue, $Enums.DealStatus> = true
const _kpiMetric: AssertEqual<KpiMetricValue, $Enums.KpiMetric> = true
const _kpiPeriod: AssertEqual<KpiPeriodValue, $Enums.KpiPeriod> = true
const _kpiStatus: AssertEqual<KpiStatusValue, $Enums.KpiStatus> = true
const _paymentMethod: AssertEqual<PaymentMethodValue, $Enums.PaymentMethod> = true
const _syncEntity: AssertEqual<SyncEntityValue, $Enums.SyncEntity> = true
const _syncMode: AssertEqual<SyncModeValue, $Enums.SyncMode> = true
const _syncStatus: AssertEqual<SyncStatusValue, $Enums.SyncStatus> = true

export {}
