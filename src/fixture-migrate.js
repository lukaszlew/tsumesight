// Chain of fixture format migrators. Each function takes a fixture at
// version N and returns the same fixture at N+1. `migrate` walks the chain
// to the current SCHEMA_VERSION.
//
// No bumps yet; v1 is the only shape. This file exists so adding a
// migration has a single well-known place and the discipline is explicit.

import { SCHEMA_VERSION } from './fixture-schema.js'

const MIGRATORS = {
  // 1: (f) => ({...f, schemaVersion: 2, /* transform */}),  // example
}

export function migrate(fixture) {
  let v = fixture.schemaVersion ?? 1
  while (v < SCHEMA_VERSION) {
    let fn = MIGRATORS[v]
    if (!fn) throw new Error(`No migrator from fixture schema v${v} to v${v + 1}`)
    fixture = fn(fixture)
    v++
  }
  return fixture
}
