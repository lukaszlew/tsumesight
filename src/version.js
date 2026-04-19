// Build-time identity surfaced in the hamburger menu. Values are injected
// by vite.config.js via `define:` at build time. The `typeof` guards cover
// environments where the defines aren't substituted (vite dev in some
// paths, tests).

export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const GIT_SHA = typeof __APP_GIT_SHA__ !== 'undefined' ? __APP_GIT_SHA__ : 'dev'
export const GIT_DATE = typeof __APP_GIT_DATE__ !== 'undefined' ? __APP_GIT_DATE__ : ''
export const BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null

// Compact "YYYY-MM-DD HH:MM" for display. Empty string if no commit date
// (e.g. non-git build). The full ISO timestamps live in tooltips.
export const GIT_DATE_SHORT = GIT_DATE ? GIT_DATE.slice(0, 16).replace('T', ' ') : ''
