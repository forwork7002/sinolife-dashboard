import { timingSafeEqual } from 'node:crypto'

/**
 * Whether the token a caller sent is the one configured — in constant time,
 * so a wrong token's reply says nothing about how wrong it was; an empty one
 * never matches. Bitrix24's outgoing events and the AI registrator's pushes.
 */
export function tokenMatches(sent: string, expected: string): boolean {
  const a = Buffer.from(sent, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
