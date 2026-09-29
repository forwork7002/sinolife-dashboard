import { describe, expect, it } from 'vitest'

import {
  LEAD_CHANNELS,
  NON_AD_CHANNELS,
  type LeadChannel,
  formNameOf,
  formOwner,
  leadChannel,
  nonAdTotal,
} from '@/server/domain/leads/leadSources'
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
    const sets = [v.pages, v.inbound, v.outbound, v.telegram, v.smm, new Set([v.generated])]
    const all = sets.flatMap((s) => [...s])
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('nonAdTotal', () => {
  const B = ['leads', 'success'] as const
  const byChannel = new Map<LeadChannel, Record<(typeof B)[number], number>>(
    LEAD_CHANNELS.map((c, i) => [c, { leads: 10 ** i, success: i }]),
  )

  it('adds inbound, manual, telegram, smm and other — not the ads, not «Исход»', () => {
    expect([...NON_AD_CHANNELS].sort()).toEqual(['inbound', 'manual', 'other', 'smm', 'telegram'])
    const expected = NON_AD_CHANNELS.reduce(
      (acc, c) => ({ leads: acc.leads + byChannel.get(c)!.leads, success: acc.success + byChannel.get(c)!.success }),
      { leads: 0, success: 0 },
    )
    const total = nonAdTotal(byChannel, B)
    expect(total).toEqual(expected)
    // Every channel's lead count is a distinct power of ten, so any of the three excluded ones would show.
    for (const excluded of ['form', 'page', 'outbound'] as const) {
      expect(Math.floor(total.leads / byChannel.get(excluded)!.leads) % 10).toBe(0)
    }
  })

  it('reads a missing channel as zero', () => {
    expect(nonAdTotal(new Map([['telegram', { leads: 3, success: 1 }]]), B)).toEqual({ leads: 3, success: 1 })
    expect(nonAdTotal(new Map(), B)).toEqual({ leads: 0, success: 0 })
  })
})
