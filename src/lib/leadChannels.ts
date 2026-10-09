/**
 * The lead channels' identity colours — ONE map, read by the «Лид назорати»
 * pills and by its hourly chart, and here in `lib` so another screen can
 * adopt it instead of picking a fifth blue.
 *
 * Slots, not new colours (docs/DESIGN.md, «Changing a colour — don't»):
 *
 *   Ген лид   --series-1  blue
 *   СММ       --series-7  violet
 *   Входящий  --series-6  green (the palette's olive)
 *   Телеграм  --series-3  teal in light, cyan in dark
 *   Boshqa    --ink-muted neutral — no hue, because it is no one channel
 *
 * `LEAD_CHANNEL_STACK` IS NOT THE READING ORDER, AND THAT IS MEASURED. Blue
 * beside violet is ΔE 2.1 for a protan reader (the dataviz validator, light,
 * on `--surface-raised`), so the two never touch in a stacked bar: blue,
 * green, violet, teal passes every check — CVD worst pair 20.8, normal-vision
 * 29.5, all four ≥ 3:1 on the surface — where the reading order fails two.
 * Dark passes the same order (19.0 / 27.4); its cyan sits above the lightness
 * band, the exception DESIGN.md already records for that slot.
 *
 * `ink` is the text colour ON the solid fill (`--ink-on-series*`, measured per
 * slot in `designTokens.test.ts`). `text` is the channel's colour as TEXT on
 * its own 12% wash — the accent-ink recipe, 80% of the slot into primary ink;
 * `tests/features/leadWatchContrast.test.ts` holds it to 4.5:1 in both themes.
 */
export type LeadChannelKey = 'generated' | 'smm' | 'inbound' | 'telegram' | 'other'

export interface LeadChannelSpec {
  readonly label: string
  /** The mark: a bar segment, a legend dot, a pill's dot. */
  readonly color: string
  /** Text on the solid `color`. */
  readonly ink: string
  /** The pill's wash, over an opaque surface. */
  readonly wash: string
  /** Text on `wash`. */
  readonly text: string
}

const slot = (token: string, ink: string): Omit<LeadChannelSpec, 'label'> => ({
  color: `var(${token})`,
  ink: `var(${ink})`,
  wash: `color-mix(in oklab, var(${token}) 12%, transparent)`,
  text: `color-mix(in oklab, var(${token}) 80%, var(--ink-primary))`,
})

export const LEAD_CHANNELS: Readonly<Record<LeadChannelKey, LeadChannelSpec>> = {
  generated: { label: 'Ген лид', ...slot('--series-1', '--ink-on-series') },
  smm: { label: 'СММ', ...slot('--series-7', '--ink-on-series') },
  inbound: { label: 'Входящий', ...slot('--series-6', '--ink-on-series') },
  telegram: { label: 'Телеграм', ...slot('--series-3', '--ink-on-series-bright') },
  other: {
    label: 'Boshqa',
    color: 'var(--ink-muted)',
    ink: 'var(--ink-on-series)',
    wash: 'var(--glass-well)',
    text: 'var(--ink-secondary)',
  },
}

/** Reading order: the filter chips, the legend, a tooltip's rows. */
export const LEAD_CHANNEL_ORDER: readonly LeadChannelKey[] = ['generated', 'smm', 'inbound', 'telegram', 'other']

/** Bottom to top in a stacked bar — see the header for why it differs. */
export const LEAD_CHANNEL_STACK: readonly LeadChannelKey[] = ['generated', 'inbound', 'smm', 'telegram', 'other']
