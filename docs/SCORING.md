# Scoring

Each finished quiz earns points from two sources — **accuracy** and **speed** — that combine into a total and a star count. The rules below are exactly what `src/scoring.js`, `src/session.js`'s `pointsByGroup`, and `src/effects.js:computeFinalizeData` implement.

## Inputs

- `G` — number of scored (changed) groups in the puzzle
- `M` — number of moves in the SGF main line
- `t` — elapsed time (seconds) from puzzle open to finalize
- `mᵢ` — mistakes counted against group `i` across all submits
- `m` — total mistakes = `Σ mᵢ`
- `s[i]` — per-group submit status: `'correct' | 'wrong' | 'missed'`

## What counts as a mistake

Per submit, group `i` contributes `1` to the mistake tally if `s[i] ≠ 'correct'`. Both `'wrong'` (user marked an incorrect liberty count) and `'missed'` (user didn't mark any stone of the group) count equally — no forgiveness.

`mᵢ` is the sum of those 1s for group `i` across every submit; capped in practice at the `maxSubmits` setting (default 3).

## Equations

```
schedule       = [20, 12, 6, 0]                per-group points for mᵢ = 0, 1, 2, 3+
maxAccPoints   = schedule[0] · G = 20·G
maxTimePoints  = 6 + 3·(M + G)                 (seconds)

pointsByGroup[i] = schedule[min(mᵢ, 3)]
accPoints      = Σ pointsByGroup[i]
speedPoints    = max(0, round(maxTimePoints − t))
parScore       = maxAccPoints + maxTimePoints / 2

totalPoints    = accPoints + speedPoints
ratio          = totalPoints / parScore

stars  = 5   if ratio ≥ 1.00 AND m = 0
       = 4   if ratio ≥ 0.75
       = 3   if ratio ≥ 0.50
       = 2   if ratio ≥ 0.25
       = 1   otherwise
```

## Cooldown

After a non-finalizing wrong submit, the Done button is disabled:

```
cooldown (seconds) = 3 · N     where N = number of non-correct groups this submit
```

Emitted only when `N > 0`. The wall clock keeps running during the cooldown — the wait directly costs `speedPoints`.

All-correct submits and force-commit-at-maxSubmits submits finalize the session and don't trigger a cooldown.

## In English

**Accuracy dominates.** Each scored group is worth up to 20 points on a forgiving curve — `20` / `12` / `6` / `0` for `0` / `1` / `2` / `3+` mistakes. The first slip costs only 8 of 20; the second another 6; the third wipes the group out. You get up to 3 Done presses to fix things, so you can only reach the `3+` floor by blowing all three.

**Speed polishes.** The max time window (`6 + 3·(moves + groups)` seconds) is the speed-bonus cliff: you earn the full window in points if you finish instantly, nothing if you reach the window's end, and linearly interpolated in between.

**Stars are measured against a benchmark.** The benchmark is perfect accuracy plus half the max time window — "how much you'd have if you played clean and finished inside the first half of the window." Your ratio of `total / benchmark` drops you through the 4/3/2/1-star tiers. The 5-star trophy requires `ratio ≥ 1.0` *and* zero mistakes, so speed alone can't buy the trophy back — one slip caps you at 4 stars regardless.

**Mistakes hurt twice.** Directly through accuracy points, and indirectly through the Done-button cooldown (3 seconds per non-correct group) that eats your speed bonus while you wait.

## Worked example

3-group puzzle, 5-move sequence, 1 mistake on one group, finish at 20 seconds:

```
schedule       = [20, 12, 6, 0]
maxAccPoints   = 20·3                 = 60
maxTimePoints  = 6 + 3·(5 + 3)        = 30 s
pointsByGroup  = [12, 20, 20]          (one group with mᵢ=1, two perfect)
accPoints      = 12 + 20 + 20         = 52
speedPoints    = max(0, round(30 − 20)) = 10
parScore       = 60 + 30/2            = 75
totalPoints    = 52 + 10              = 62
ratio          = 62 / 75              = 0.83

m > 0 → not eligible for 5★
ratio ≥ 0.75 → 4★ (medal)
```

## Where the numbers are in code

| Quantity | File | Symbol |
|---|---|---|
| Per-group point schedule | `src/config.js` | `pointsByMistakes` |
| Per-group fold | `src/session.js` | `pointsByGroup` |
| Accuracy formula | `src/scoring.js` | `computeAccPoints` |
| Speed formula | `src/scoring.js` | `computeSpeedPoints` |
| Benchmark | `src/scoring.js` | `computeParScore` |
| Star tiers | `src/scoring.js` | `computeStars` |
| Time-window coefficients | `src/config.js` | `cupBaseSec`, `cupPerMoveSec`, `cupPerGroupSec` |
| Finalize assembly | `src/effects.js` | `computeFinalizeData` |
| Cooldown wiring | `src/effects.js` + `src/quiz.jsx` | `sideEffectsFor('submit' non-finalizing)` → `{kind: 'cooldown', seconds: 3·N}` |
