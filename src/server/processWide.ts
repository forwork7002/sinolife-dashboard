/**
 * One value per server PROCESS, whichever bundle asks for it first.
 *
 * `src/instrumentation.ts` and the route handlers are separate bundles in one
 * Node process, and each loads its own copy of every module it imports, so a
 * module variable is one variable per bundle: the warmers built memos, every
 * few minutes, that no route ever read, and /rnp went cold after every deploy
 * (2026-10-06). A value kept here lives on `globalThis` under
 * `Symbol.for(key)`, which every copy resolves to the same symbol — the first
 * to ask makes it, the others are handed the same one. Keys read
 * `sinolife.<area>.<name>`.
 *
 * Under `next dev` a reloaded module finds the old value too, so whatever was
 * baked into it when it was made (a memo's TTL) needs a server restart.
 */
export function processWide<T>(key: string, make: () => T): T {
  const g = globalThis as unknown as Record<symbol, unknown>
  return (g[Symbol.for(key)] ??= make()) as T
}
