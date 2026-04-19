// Layer B — DOM snapshot per fixture at the final post-fold state.
//
// Renders <Quiz> via happy-dom, feeds the fixture's event log through
// the initialEvents prop (which also flips autoSolved so side effects
// stay quiet), waits for the finalize useEffect to set the popup, then
// snapshots container.innerHTML.
//
// happy-dom has no real layout engine — clientWidth/Height are 0, so
// the layout effect bails out and <Goban> isn't rendered. That's
// intentional for Layer B: we're covering the orchestrator's shell
// (class-name wiring, conditional JSX, finish popup structure, bottom
// bar button set). Goban internals are covered by render.test.jsx.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/preact'
import { Quiz } from './quiz.jsx'

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures')
const snapshotsDir = path.join(fixturesDir, '__snapshots__')

function loadFixtures() {
  if (!fs.existsSync(fixturesDir)) return []
  return fs.readdirSync(fixturesDir)
    .filter(f => f.endsWith('.events.json'))
    .sort()
    .map(f => ({
      name: f.replace(/\.events\.json$/, ''),
      data: JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8')),
    }))
}

const fixtures = loadFixtures()

const noop = () => {}

describe('Layer B — DOM snapshot per fixture at final state', () => {
  if (fixtures.length === 0) {
    it.skip('no fixtures found', () => {})
    return
  }

  for (let { name, data } of fixtures) {
    it(`${name}: final DOM matches snapshot`, async () => {
      let { container, unmount } = render(
        <Quiz
          sgf={data.sgf.content}
          sgfId={123}
          wasSolved={true}
          restored={true}
          initialEvents={data.events}
          onBack={noop}
          onSolved={noop}
          onProgress={noop}
          onLoadError={noop}
          onNextUnsolved={noop}
          onPrev={noop}
          onNext={noop}
        />
      )
      // Let the finalize useEffect run and setFinishPopup flush.
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))

      await expect(container.innerHTML)
        .toMatchFileSnapshot(path.join(snapshotsDir, `${name}.dom.html`))

      unmount()
    })
  }
})
