import { describe, expect, it } from 'vitest'

import { LEAD_TILES, formNameOf, formOwner, leadChannel, leadTile, targetologOfField } from '@/server/domain/leads/leadSources'
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

  it('reads a title that has no closing quote (deal 1038510, a kval of 01.10)', () => {
    expect(formNameOf('Заполнение CRM-формы "Sinolifecollgen marine')).toBe('Sinolifecollgen marine')
    expect(formNameOf('Заполнение CRM-формы «Zextra Umar 3 ')).toBe('Zextra Umar 3')
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
    // Kamron's accounts are all Zextra — leadBrand's rule — unless the name says collagen.
    expect(formOwner('Kamron 6 etap filt forma 05.07')).toEqual({ targetolog: 'Kamron', product: 'Zextra' })
    expect(formOwner('Kamron-collagen 01.10')).toEqual({ targetolog: 'Kamron', product: 'Collagen' })
  })

  it('is Zextra when the name says so', () => {
    expect(formOwner('Zextra form Eldor')).toEqual({ targetolog: 'Элдор', product: 'Zextra' })
    expect(formOwner('Eldor zextra 10/05')).toEqual({ targetolog: 'Элдор', product: 'Zextra' })
  })

  it('is null for a form that names nobody', () => {
    expect(formOwner('Collagen Marine ген лид')).toBeNull()
    expect(formOwner('New 21 forma')).toBeNull()
  })
})

describe('the AI targetolog and Tursunbek (2026-10-06)', () => {
  it('owns the AI\'s forms and Tursunbek\'s', () => {
    expect(formOwner('AI targetolog · Sinolife AI forma 26.09.2026 17:44')).toEqual({ targetolog: 'AI targetolog', product: 'Collagen' })
    expect(formOwner('Tursunbek-zextra Zextra filtr savol (Tursunbek Targetolog)')).toEqual({ targetolog: 'Tursunbek', product: 'Zextra' })
    // His accounts are all Zextra: a form that names no product is Zextra, as Kamron's.
    expect(formOwner('Tursunbek filtr savol')).toEqual({ targetolog: 'Tursunbek', product: 'Zextra' })
  })

  it('spells the deal field\'s «AI» as the account map does', () => {
    expect(targetologOfField('AI')).toBe('AI targetolog')
    expect(targetologOfField('Umar')).toBe('Umar')
    expect(targetologOfField(null)).toBeNull()
  })

  it('reads a repeat lead\'s «Заполнена CRM-форма» as a form', () => {
    expect(formNameOf('Qayta zayavka (forma akt #4806000) Заполнена CRM-форма "Umar-collagen Collagen (UMAR)"')).toBe('Umar-collagen Collagen (UMAR)')
  })
})

describe('leadChannel', () => {
  const v = LEAD_SOURCE_VOCABULARY

  it('puts a form first, whatever source it was filed under', () => {
    expect(leadChannel('REPEAT_SALE', 'Sinolife (UMAR) 777', v)).toBe('form')
    expect(leadChannel('UC_8NZNYM', 'Sinolife (UMAR) 777', v)).toBe('form') // Телеграмм
    expect(leadChannel('2|TELEGRAM', 'Sinolife (UMAR) 777', v)).toBe('form')
    expect(leadChannel('UC_5JW4YK', 'Sinolife (UMAR) 777', v)).toBe('form') // Сммщик
  })

  // Read off crm.status.list (ENTITY_ID SOURCE) on 2026-09-29.
  it('reads the Telegram sources', () => {
    expect(leadChannel('UC_8NZNYM', null, v)).toBe('telegram') // Телеграмм
    expect(leadChannel('2|TELEGRAM', null, v)).toBe('telegram') // Telegram - Открытая линия
    expect(leadChannel('UC_Z1OF0D', null, v)).toBe('telegram') // sinolif_tg
  })

  it('keeps the Telegram AD pages as pages', () => {
    expect(leadChannel('UC_A4WINR', null, v)).toBe('page') // sinolifeuzb (Telegram)
    expect(leadChannel('UC_U9KZG8', null, v)).toBe('page') // sinolifeofficial (Telegram)
  })

  it('reads the SMM sources', () => {
    expect(leadChannel('UC_5JW4YK', null, v)).toBe('smm') // Сммщик sinolifeuz
    expect(leadChannel('UC_HCZ9YU', null, v)).toBe('smm') // Сммщик sinolife_sedana
  })

  it('reads the ad pages, the calls and hand-typed «Ген лид»', () => {
    expect(leadChannel('UC_1X1J24', null, v)).toBe('page') // sinolifeuz
    expect(leadChannel('38|NEXTBOT', null, v)).toBe('page')
    expect(leadChannel('UC_MWIKOC', null, v)).toBe('page') // collagen.marine — an ad page since 2026-10-02
    expect(leadChannel('CALL', null, v)).toBe('inbound')
    expect(leadChannel('UC_CKXAZS', null, v)).toBe('inbound') // Входящий collagen
    expect(leadChannel('UC_AA84D0', null, v)).toBe('inbound') // Входящий zextra
    expect(leadChannel('UC_KPZA32', null, v)).toBe('outbound') // Исход
    expect(leadChannel('REPEAT_SALE', null, v)).toBe('manual')
  })

  it('files everything else, and no source at all, as other', () => {
    expect(leadChannel('UC_NBCV5K', null, v)).toBe('other') // collagen.sinolife — not an ad page
    for (const id of ['UC_MXY08O', 'WEB', 'WEBFORM', 'RC_GENERATOR', 'BOOKING', 'STORE', 'UC_9SNG04', 'UC_FW4VXY', '13', '3', '7', 'CALLBACK']) {
      expect(leadChannel(id, null, v)).toBe('other')
    }
    expect(leadChannel(null, null, v)).toBe('other')
  })

  it('files no source under two channels', () => {
    const sets = [v.pages, v.inbound, v.outbound, v.telegram, v.smm, v.web, v.sarafan, new Set([v.generated])]
    const all = sets.flatMap((s) => [...s])
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('leadTile', () => {
  const v = LEAD_SOURCE_VOCABULARY

  it('reads the client\'s six channels off the portal\'s sources', () => {
    expect(LEAD_TILES).toEqual(['generated', 'inbound', 'telegram', 'aiSmm', 'web', 'sarafan', 'outbound', 'other'])
    expect(leadTile('REPEAT_SALE', false, v)).toBe('generated') // forms and by hand alike
    expect(leadTile('CALL', false, v)).toBe('inbound')
    expect(leadTile('UC_CKXAZS', false, v)).toBe('inbound') // Входящий collagen
    expect(leadTile('UC_AA84D0', false, v)).toBe('inbound') // Входящий zextra
    expect(leadTile('UC_8NZNYM', false, v)).toBe('telegram')
    expect(leadTile('2|TELEGRAM', false, v)).toBe('telegram')
    expect(leadTile('UC_Z1OF0D', false, v)).toBe('telegram') // sinolif_tg
    expect(leadTile('WEB', false, v)).toBe('web') // Веб-сайт
    // Сарафан маркетинг: the tile reads Ecommerce since 2026-10-05, so in Регистрация it is «Boshqa».
    expect(leadTile('UC_9SNG04', false, v)).toBe('other')
  })

  it('puts every lead the AI qualified on «Сммщик ии», whatever its source', () => {
    expect(leadTile('UC_1X1J24', true, v)).toBe('aiSmm') // sinolifeuz — an ad page
    expect(leadTile('UC_Z1OF0D', true, v)).toBe('aiSmm') // a Telegram chat the AI qualified
    expect(leadTile(null, true, v)).toBe('aiSmm')
    // The mark wins over «Ген лид» too; an AI-qualified «Исход» never occurred (24–30.09), but would count here.
    expect(leadTile('REPEAT_SALE', true, v)).toBe('aiSmm')
    expect(leadTile('UC_KPZA32', true, v)).toBe('aiSmm')
  })

  it('gives «Исход» its own tile and everything else «Boshqa» — every lead has one', () => {
    expect(leadTile('UC_KPZA32', false, v)).toBe('outbound')
    for (const id of ['UC_1X1J24', 'UC_5JW4YK', 'UC_HCZ9YU', 'UC_NBCV5K', 'WEBFORM', 'UC_MXY08O']) {
      expect(leadTile(id, false, v)).toBe('other')
    }
    expect(leadTile(null, false, v)).toBe('other')
  })
})
