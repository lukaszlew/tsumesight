import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import './style.css'
import { App } from './app.jsx'
import { loadKv } from './db.js'

loadKv().then(() => render(<App />, document.getElementById('app')))
