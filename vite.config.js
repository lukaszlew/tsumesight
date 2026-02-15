import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'fs'
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

export default defineConfig({
  plugins: [preact(), swVersionPlugin()],
  base: '/tsumesight/',
})
