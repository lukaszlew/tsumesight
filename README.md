# TsumeSight

Go reading trainer that plays through SGF game records and quizzes on board state.

https://lukaszlew.github.io/tsumesight/

## Development

```bash
npm install
npm run dev      # start dev server
npm test         # run tests
npm run build    # production build
npm run preview  # preview production build
```

## Contributing test fixtures from your play

Each finalized session the app records an event log + score as an
enriched replay in IndexedDB. You can export these and convert them
into committed test fixtures so they protect against regressions.

```bash
# 1. In the app: hamburger menu → "Export data" → downloads
#    tsumesight-YYYY-MM-DD.zip

# 2. Convert replays → fixture files:
node scripts/zip-to-fixtures.mjs ~/Downloads/tsumesight-YYYY-MM-DD.zip

# 3. Review the new fixture files in fixtures/*.events.json and commit
#    them. Pre-commit: inspect a sample to confirm the shape is what
#    you expect.

git status fixtures/
git add fixtures/<new-files>.events.json
git commit -m "Add fixtures from <brief description>"

# 4. Regenerate snapshots (Layer A + Layer B) for the new fixtures:
npm test -- -u

# 5. Eyeball the new snapshot files under fixtures/__snapshots__/ and
#    commit them in a separate commit.

git add fixtures/__snapshots__/
git commit -m "Snapshot fixtures from <brief description>"
```

Converter notes:

- Replays in the **`v:3` enriched** or **`v:2` verbose** formats round-trip cleanly and become fixtures.
- Legacy **`v:2` compact** replays (pre-2026-04-10 tap-to-cycle UI) and **`v:undefined`** replays are skipped; the converter prints a per-category count at the end.
- Replays that throw when folded through the current session reducer (e.g. older rule where `advance` also activated the exercise) are skipped too.
- Filenames sanitize the SGF name: `CAPTURE RACE (49).sgf` → `capture-race-49--<epoch>.events.json`.

See [docs/ARCHITECTURE.md § Testing strategy](docs/ARCHITECTURE.md) and [`scripts/zip-to-fixtures.mjs`](scripts/zip-to-fixtures.mjs) for the full pipeline.

## Refreshing fixture goldens after a scoring/rule change

When a rule change shifts what the reducer considers a mistake (e.g.
the "forgive one missed group per submit" rule, `FORGIVE_MISSED_PER_SUBMIT`
in `src/session.js`), every fixture whose events triggered the new
case needs its recorded `scoreEntry` refreshed — otherwise Layer A's
goldens cross-check fails.

```bash
# 1. Regenerate canonical fixtures (they recompute goldens at gen time):
node scripts/gen-canonical-fixtures.mjs

# 2. Re-fold all other fixtures' events through the current reducer
#    and overwrite scoreEntry.{mistakes, mistakesByGroup, correct,
#    accuracy, errors} in place. Other goldens are left untouched.
node scripts/refresh-fixture-goldens.mjs

# 3. Regenerate Layer A + Layer B snapshots:
npx vitest -u

# 4. EYEBALL THE DIFF before committing:
git diff fixtures/
git diff fixtures/__snapshots__/
#    - Spot-check one or two affected fixtures.
#    - Does the new scoreEntry match your new rule's intent?
#    - Are unaffected fixtures really unchanged (the script prints
#      "N unchanged" at the end)?

# 5. Commit the rule change, the fixture update, and the snapshot
#    update. Prefer three separate commits: rule, fixture refresh,
#    snapshot regeneration — so review can examine each.
```

`refresh-fixture-goldens.mjs` only touches recorded-mistake fields; it
leaves `finalMarks`, `submitResults`, `changedGroupsVertices` alone.
If a rule change affects those too, extend the script or regenerate
the source fixtures instead.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — V4 event-sourced design, module layout, data flow
- [docs/SCORING.md](docs/SCORING.md) — score / stars / cooldown rules and formulas
- [docs/CLEANUPS.md](docs/CLEANUPS.md) — prioritized post-refactor work list
- [docs/GAMIFICATION.md](docs/GAMIFICATION.md) — product vision (engagement loops, retention features) — aspirational, not implemented
