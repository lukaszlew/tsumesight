import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import './style.css'
import { App } from './app.jsx'

render(<App />, document.getElementById('app'))
