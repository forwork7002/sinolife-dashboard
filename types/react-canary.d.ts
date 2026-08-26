/**
 * React canary typings.
 *
 * `<ViewTransition>` ships in the React canary channel, which is what the Next
 * App Router bundles — `next/dist/compiled/react` here is 19.3.0-canary and
 * exports it. `@types/react` keeps canary declarations in a separate entry that
 * nothing pulls in by default, so without this reference the component exists
 * at runtime and is a type error at build time.
 */
/// <reference types="react/canary" />

export {}
