import { describe, expect, it } from 'vitest'

import { formNameOf, formOwner, leadChannel } from '@/server/domain/leads/leadSources'
import { LEAD_SOURCE_VOCABULARY } from '@/server/integrations/crm/bitrix24/mapping'

/*
  Every title and source here was read off obey.bitrix24.kz for 18–24.09.2026
  through the read-only Bitrix24 MCP — the forms that week, verbatim.
*/

describe('formNameOf', () => {
  it('reads the form out of the title the portal writes', () => {
    expect(formNameOf('Заполнение CRM-формы "Sinolife Collagen - 30.04 Eldor"')).toBe('Sinolife Collagen - 30.04 Eldor')
    expect(formNameOf('Заполнение CRM-формы "Sinolife (UMAR) 777"')).toBe('Sinolife (UMAR) 777')
    expect(formNameOf('Заполнение CRM-формы «Kamron 6 etap filt forma 05.07»')).toBe('Kamron 6 etap filt forma 05.07')
  })

  it('collapses the non-breaking space a targetolog typed', () => {
    expect(formNameOf('Заполнение CRM-формы "Umar Sinolife (UMAR) TEST-1"')).toBe('Umar Sinolife (UMAR) TEST-1')
  })

  it('is null for a deal no form opened', () => {
    expect(formNameOf('Collagen')).toBeNull()
    expect(formNameOf('_baxti__01_00 - sinolifeuz instagram')).toBeNull()
    expect(formNameOf('+998 90 873 37 12 - collagen')).toBeNull()
    expect(formNameOf(null)).toBeNull()
    expect(formNameOf('Заполнение CRM-формы ""')).toBeNull()
  })
})

describe('formOwner', () => {
  it('names the targetolog as META_ACCOUNT_OWNERS spells them', () => {
    expect(formOwner('Sinolife Collagen - 30.04 Eldor')).toEqual({ targetolog: 'Элдор', product: 'Collagen' })
    expect(formOwner('Sinolife (UMAR) 777')).toEqual({ targetolog: 'Umar', product: 'Collagen' })
    expect(formOwner('Kamron 6 etap filt forma 05.07')).toEqual({ targetolog: 'Kamron', product: 'Collagen' })
  })

  it('is Zextra only when the name says so', () => {
    expect(formOwner('Zextra form Eldor')).toEqual({ targetolog: 'Элдор', product: 'Zextra' })
    expect(formOwner('Eldor zextra 10/05')).toEqual({ targetolog: 'Элдор', product: 'Zextra' })
  })

  it('is null for a form that names nobody', () => {
    expect(formOwner('Collagen Marine ген лид')).toBeNull()
    expect(formOwner('New 21 forma')).toBeNull()
  })
})

describe('leadChannel', () => {
  const v = LEAD_SOURCE_VOCABULARY

  it('puts a form first, whatever source it was filed under', () => {
    expect(leadChannel('REPEAT_SALE', 'Sinolife (UMAR) 777', v)).toBe('form')
    expect(leadChannel('UC_8NZNYM', 'Sinolife (UMAR) 777', v)).toBe('form')
  })

  it('reads the ad pages, the calls and hand-typed «Ген лид»', () => {
    expect(leadChannel('UC_1X1J24', null, v)).toBe('page') // sinolifeuz
    expect(leadChannel('38|NEXTBOT', null, v)).toBe('page')
    expect(leadChannel('CALL', null, v)).toBe('inbound')
    expect(leadChannel('UC_CKXAZS', null, v)).toBe('inbound') // Входящий collagen
    expect(leadChannel('UC_KPZA32', null, v)).toBe('outbound') // Исход
    expect(leadChannel('REPEAT_SALE', null, v)).toBe('manual')
  })

  it('files everything else, and no source at all, as other', () => {
    expect(leadChannel('UC_NBCV5K', null, v)).toBe('other') // collagen.sinolife — not an ad page
    expect(leadChannel(null, null, v)).toBe('other')
  })
})
