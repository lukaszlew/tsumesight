import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

// Centralized test config. Previously each test file that needed DOM APIs
// opted in with `// @vitest-environment happy-dom`. Defaulting everyone
// to happy-dom is safe — the pure-data tests don't care which env they run
// in, and the DOM-touching tests now need no preamble.

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'happy-dom',
  },
})
