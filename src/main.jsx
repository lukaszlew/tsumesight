import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import './style.css'
import { App } from './app.jsx'
import { loadKv } from './db.js'

// PWA environment redirect: installed PWAs may launch at the wrong base URL
// (e.g. user installed from /dev/ but navigates to /). The prod/dev toggle
// in the hamburger menu saves 'preferredEnv' to localStorage; on startup we
// check whether the current URL matches and redirect if not.
let preferredEnv = localStorage.getItem('preferredEnv')
let isDev = location.pathname.includes('/dev/')
if (preferredEnv === 'dev' && !isDev) {
  location.href = location.pathname.replace(/\/?$/, '/dev/')
} else if (preferredEnv === 'prod' && isDev) {
  location.href = location.pathname.replace(/\/dev\/.*$/, '/')
} else {
  loadKv().then(() => render(<App />, document.getElementById('app')))
}
