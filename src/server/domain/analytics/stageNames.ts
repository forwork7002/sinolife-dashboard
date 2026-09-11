/**
 * Stage names as the portal writes them, and how to read them back.
 *
 * `deal_stage.name` is stored PREFIXED with its funnel — «Доставка · В пути»,
 * not «В пути» — because Bitrix24 stage ids repeat across pipelines
 * (`C6:WON` and `C14:WON` are different stages) and a bare name is ambiguous
 * in a filter list. Anything rendering ONE funnel's stages has to strip it.
 *
 * IT LIVES IN `domain` BECAUSE TWO SERVICES NEED IT. The delivery board on
 * Savdo dinamikasi and the reconciliation table on Logistika both print the
 * portal's own stage names beside the portal's own screen; two copies of this
 * rule is two ways for those two tables to disagree about what a stage is
 * called. Pure, no framework imports — the domain layer's contract.
 */

/** The separator the importer writes: U+00B7 MIDDLE DOT with a space either side. */
const SEPARATOR = ' · '

/**
 * «Доставка · В пути» → «В пути»: one KNOWN prefix removed, or nothing.
 *
 * Matching the row's own pipeline name rather than splitting on the separator
 * is what makes this safe for a stage whose name contains ' · ' itself — the
 * naive `indexOf(' · ')` form would cut such a name in the wrong place, and it
 * is what the Logistika page did in the browser before this moved here.
 */
export function stripPipelinePrefix(stageName: string, pipelineName: string): string {
  const prefix = `${pipelineName}${SEPARATOR}`
  return stageName.startsWith(prefix) ? stageName.slice(prefix.length) : stageName
}

/** The one funnel this dashboard reads stage by stage. */
export const DELIVERY_PIPELINE_NAME = 'Доставка'

/** `stripPipelinePrefix` bound to the Доставка funnel, which is every caller today. */
export function deliveryStageName(stageName: string): string {
  return stripPipelinePrefix(stageName, DELIVERY_PIPELINE_NAME)
}
