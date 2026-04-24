import { defineConfig } from 'vite'
import { readFileSync, writeFileSync, watch as fsWatch } from 'fs'
import { execSync } from 'child_process'
import preact from '@preact/preset-vite'

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

// Virtual module supplying git identity to the client. Re-evaluated on
// every module load, so HMR reloads pick up the newest commit
// automatically when .git/HEAD or .git/logs/HEAD changes.
//
// Consume via `import {...} from 'virtual:git-version'`.
function gitVersionPlugin() {
  const VIRTUAL_ID = 'virtual:git-version'
  const RESOLVED = '\0' + VIRTUAL_ID

  function readGitInfo() {
    let sha = 'nogit'
    let date = ''
    try {
      // The `--` disambiguates HEAD as a revision — repo root has a
      // `HEAD` file that otherwise confuses `git show HEAD`.
      sha = execSync('git rev-parse --short HEAD').toString().trim()
      date = execSync('git show -s --format=%cI HEAD --').toString().trim()
    } catch {}
    return { sha, date, buildTime: new Date().toISOString() }
  }

  return {
    name: 'git-version',
    resolveId(id) { if (id === VIRTUAL_ID) return RESOLVED },
    load(id) {
      if (id !== RESOLVED) return
      let { sha, date, buildTime } = readGitInfo()
      return `export const GIT_SHA = ${JSON.stringify(sha)}
export const GIT_DATE = ${JSON.stringify(date)}
export const BUILD_TIME = ${JSON.stringify(buildTime)}
`
    },
    configureServer(server) {
      // .git/HEAD changes on branch switch. .git/logs/HEAD appends an
      // entry on every new commit / amend / reset. Watching both covers
      // common workflows.
      //
      // We use fs.watch directly because vite's server.watcher has
      // '**/.git/**' in its default `ignored` list, so `watcher.add()`
      // calls on paths inside .git/ silently no-op.
      let invalidate = () => {
        let mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      let watchers = []
      for (let p of ['.git/HEAD', '.git/logs/HEAD']) {
        try { watchers.push(fsWatch(p, invalidate)) } catch {}
      }
      server.httpServer?.once('close', () => {
        for (let w of watchers) w.close()
      })
    }
  }
}

export default defineConfig({
  plugins: [preact(), swVersionPlugin(), gitVersionPlugin()],
  base: '/tsumesight/',
})
