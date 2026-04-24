import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import './style.css'
import { App } from './app.jsx'
import { loadKv } from './db.js'
import { BRANCH, branchUrl } from './version.js'

// PWA environment redirect: installed PWAs may launch at the wrong base URL
// (e.g. user installed from /dev/ but navigates to /). The branch dropdown
// in the hamburger menu saves 'preferredBranch' to localStorage; on startup
// we check whether the current build matches and redirect if not.
// Dev server is exempt — the redirect targets absolute paths that don't
// exist outside of a full Pages deploy.
let preferred = localStorage.getItem('preferredBranch')
if (!import.meta.env.DEV && preferred && preferred !== BRANCH) {
  location.href = branchUrl(preferred)
} else {
  loadKv().then(() => render(<App />, document.getElementById('app')))
}
