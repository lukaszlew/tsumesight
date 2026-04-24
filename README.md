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

# 2. Dry-run the refresh: re-fold all other fixtures' events through the
#    current reducer and scoring, and print every field that WOULD
#    change. Writes nothing.
node scripts/refresh-fixture-goldens.mjs

#    EYEBALL THE DRY-RUN OUTPUT before applying:
#    - Does every delta match your rule change's intent?
#    - Any field changing that you didn't expect?
#    - Are the unaffected fixtures really unchanged ("N unchanged")?

# 3. Apply the changes (overwrites scoreEntry fields in place):
node scripts/refresh-fixture-goldens.mjs --apply

# 4. Regenerate Layer A + Layer B snapshots:
npx vitest -u

# 5. Final diff check before committing:
git diff fixtures/
git diff fixtures/__snapshots__/

# 6. Commit.
```

`refresh-fixture-goldens.mjs` only touches recorded-mistake fields; it
leaves `finalMarks`, `submitResults`, `changedGroupsVertices` alone.
If a rule change affects those too, extend the script or regenerate
the source fixtures instead.

## Deployment

Every push to `main` or any `*-deploy` branch triggers a GitHub Pages deploy via `.github/workflows/deploy.yml`. The workflow:

- enumerates live branches matching `^(main|.*-deploy)$` via the GitHub API,
- runs tests and builds each branch in parallel (matrix),
- assembles all builds into one site tree (`main` → site root, other branches → `/<slug>/` where slug is the branch name with `-deploy` stripped),
- writes a `branches.json` manifest at the site root listing every deployed slug,
- uploads the combined tree as a single Pages artifact.

Adding a new deployable branch is zero-config: push `xyz-deploy` and it lands at `https://lukaszlew.github.io/tsumesight/xyz/`. Deleting a `-deploy` branch self-cleans — the next deploy rebuilds the tree from the current branch list and the orphan subdir simply isn't recreated.

In the app, the hamburger menu's **Branch** dropdown fetches the manifest and lets users jump between deployed builds; the choice is saved to `localStorage.preferredBranch` and honored on PWA startup (see `src/main.jsx`). Each build knows its own slug via `VITE_BRANCH`, wired in through `vite.config.js`'s `virtual:git-version` module.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — V4 event-sourced design, module layout, data flow
- [docs/SCORING.md](docs/SCORING.md) — score / stars / cooldown rules and formulas
- [docs/CLEANUPS.md](docs/CLEANUPS.md) — prioritized post-refactor work list
- [docs/GAMIFICATION.md](docs/GAMIFICATION.md) — product vision (engagement loops, retention features) — aspirational, not implemented
