// Git identity for the hamburger menu line. Values come from the
// virtual:git-version module supplied by vite.config.js. The virtual
// module is re-evaluated when .git/HEAD or .git/logs/HEAD change, so
// `npm run dev` picks up new commits on HMR without a server restart.

import { GIT_SHA, GIT_DATE, BRANCH, BUILD_TIME } from 'virtual:git-version'

export { GIT_SHA, GIT_DATE, BRANCH, BUILD_TIME }

// Compact "YYYY-MM-DD HH:MM" for inline display. Empty if no commit date
// (e.g. non-git build). Full ISO stays in tooltips.
export const GIT_DATE_SHORT = GIT_DATE ? GIT_DATE.slice(0, 16).replace('T', ' ') : ''

// Site root = base URL with the branch subdir stripped. 'main' deploys to
// the base itself, every other branch to base + branch + '/'. Used to
// build cross-branch URLs and fetch the shared branches.json manifest.
const BASE = import.meta.env.BASE_URL
export const SITE_ROOT = BRANCH === 'main' ? BASE : BASE.slice(0, -(BRANCH.length + 1))

export function branchUrl(branch) {
  return branch === 'main' ? SITE_ROOT : SITE_ROOT + branch + '/'
}
