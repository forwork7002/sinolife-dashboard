import { describe, expect, it } from 'vitest'

import type * as Client from '@/lib/api'
import type { PayrollBranch } from '@/server/domain/payroll/payrollBranches'
import type { PayrollTableValue } from '@/server/domain/payroll/sellerPayroll'
import type { PayrollDto } from '@/server/services/payrollService'

/**
 * `src/lib/api.ts` restates the payroll DTO by hand — the client may not
 * import server code — and nothing at runtime checks the copy. These are
 * checked by `tsc` (the gate's typecheck reads `tests/**`): drift either way
 * and the tuple below stops type-checking.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const MIRRORED: [
  Same<Client.PayrollBranch, PayrollBranch>,
  Same<Client.PayrollTable, PayrollTableValue>,
  Same<Client.PayrollDto, PayrollDto>,
] = [true, true, true]

describe('the payroll DTO mirror', () => {
  it('is the server DTO, field for field', () => {
    expect(MIRRORED).toEqual([true, true, true])
  })
})
