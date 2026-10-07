import { describe, expect, it } from 'vitest'

import type { RegistrationRepository } from '@/server/repositories/registrationRepository'
import { RegistrationService } from '@/server/services/registrationService'

/*
  «Lidlar»'s split cards (`/registration/overview`), polled by every open
  «Lid manbalari» tab and asked again on every brand switch. The month grid's
  day rows — «Безквал» is 31 days of Регистрация deals with subplans per deal
  — are memoised and carry no brand; the split is read fresh, so one saved a
  second ago is on the next read (2026-10-06 audit).
*/
describe('RegistrationService.overview', () => {
  it('reads the grid\'s day rows once for both brands, and the split on every read', async () => {
    const calls = { distributedDays: 0, bezkvalDays: 0, split: 0, previousSplit: 0 }
    const repository = {
      distributedDays: async () => {
        calls.distributedDays++
        return [
          { day: '2026-04-20', rop: 'Sevinch', leads: 5, duplicates: 0 },
          { day: '2026-04-20', rop: 'Asliddin', leads: 3, duplicates: 0 },
        ]
      },
      bezkvalDays: async () => {
        calls.bezkvalDays++
        return []
      },
      split: async () => {
        calls.split++
        return null
      },
      previousSplit: async () => {
        calls.previousSplit++
        return null
      },
    } as unknown as RegistrationRepository
    const service = new RegistrationService(repository, {} as never)
    const base = { day: '2026-04-20', timeZone: 'Asia/Tashkent', canEdit: false }

    const collagen = await service.overview({ ...base, brand: 'Collagen' })
    const zextra = await service.overview({ ...base, brand: 'Zextra' })
    expect(calls).toEqual({ distributedDays: 1, bezkvalDays: 1, split: 2, previousSplit: 2 })
    // Narrowed after the memo: Sevinch's team is Collagen's, Asliddin's Zextra's.
    expect(collagen.total).toBe(5)
    expect(zextra.total).toBe(3)

    // Another day is another question.
    await service.overview({ ...base, day: '2026-04-21' })
    expect(calls.bezkvalDays).toBe(2)
  })
})
