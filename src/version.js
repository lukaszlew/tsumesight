// Build-time identity surfaced in the hamburger menu. Values are injected
// by vite.config.js via `define:` at build time. In `vite dev` and in
// tests the defines are still substituted (vite replaces them in-source),
// but the `typeof` guards cover environments where they aren't.

export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const GIT_SHA = typeof __APP_GIT_SHA__ !== 'undefined' ? __APP_GIT_SHA__ : 'dev'
export const BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null
