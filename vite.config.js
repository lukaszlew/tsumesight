import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import preact from '@preact/preset-vite'
import pkg from './package.json' with { type: 'json' }

function swVersionPlugin() {
  return {
    name: 'sw-version',
    writeBundle({ dir }) {
      let path = `${dir}/sw.js`
      let src = readFileSync(path, 'utf8')
      writeFileSync(path, src.replace('__BUILD_TIME__', Date.now()))
    }
  }
}

// Git identity at build time. Fallbacks if git isn't reachable (e.g. a
// tarball build outside the repo). The `--` disambiguates HEAD as a
// revision — this repo has a `HEAD` file at root that confuses plain
// `git show HEAD` otherwise.
let gitSha = 'nogit'
let gitDate = ''
try {
  gitSha = execSync('git rev-parse --short HEAD').toString().trim()
  gitDate = execSync('git show -s --format=%cI HEAD --').toString().trim()
} catch {}

export default defineConfig({
  plugins: [preact(), swVersionPlugin()],
  base: '/tsumesight/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_GIT_SHA__: JSON.stringify(gitSha),
    __APP_GIT_DATE__: JSON.stringify(gitDate),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
