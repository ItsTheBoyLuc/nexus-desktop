/// <reference types="vite/client" />

/** Compile-time flag: true only for `npm run dev:mock`, hard-coded false in Electron builds. */
declare const __NEXUS_MOCK__: boolean

interface Window {
  /** Typed bridge exposed by the preload script (or by the mock bridge in `dev:mock`). */
  nexus: import('../shared/bridge').NexusBridge
}
