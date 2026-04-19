// Git identity for the hamburger menu line. Values come from the
// virtual:git-version module supplied by vite.config.js. The virtual
// module is re-evaluated when .git/HEAD or .git/logs/HEAD change, so
// `npm run dev` picks up new commits on HMR without a server restart.

import { GIT_SHA, GIT_DATE, BUILD_TIME } from 'virtual:git-version'

export { GIT_SHA, GIT_DATE, BUILD_TIME }

// Compact "YYYY-MM-DD HH:MM" for inline display. Empty if no commit date
// (e.g. non-git build). Full ISO stays in tooltips.
export const GIT_DATE_SHORT = GIT_DATE ? GIT_DATE.slice(0, 16).replace('T', ' ') : ''
