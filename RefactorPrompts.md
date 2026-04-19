# Refactor Prompts

Reusable prompts for driving analysis-first refactors with an AI
assistant. Distilled from the TsumeSight state-management refactor that
produced `REFACTOR_SPEC.md` and the cursor-based session model.

## How to use

Pick the prompt that matches the axis of pain (state, UI, or something
else using the shape). Paste into a fresh conversation. Substitute
`[TARGET]` with the module/directory/file you care about. Answer the
punch-list questions at the end of each phase before letting the
assistant continue.

The prompts intentionally slow the assistant down across phases 1–5 so
you shape the target before any code moves. The biggest wins in the
original refactor came from deciding that *broken current behavior is
not worth preserving*, which only emerged during step 5. Don't skip it.

---

## State-management refactor

```
I want to refactor the state management in [TARGET]. I'm confused about
the set of possible states — let's work through it systematically:
analysis first, code later. Walk through the phases below in order.
Don't jump ahead and don't write code until I approve a plan.

1. Map the state space. Read the relevant code and produce a short doc
   listing every state variable (with file:line), possible values, what
   each combination means in the UI, and numbered edges (E1, E2, …) —
   things that look wrong, dual-purpose, implicit, or brittle. Include
   a truth table of "what the user sees" per state combination.

2. Brainstorm redesign options, open mind. Cover the general patterns
   (FSM, discriminated unions, event sourcing, pure reducer, session
   stacks, immutable-engine, signals, etc.) grouped by concern.
   Include counter-ideas to my stated preferences and explicit
   "don't-do" items tagged with why.

3. Analyze fit for this codebase specifically — given its size, stack,
   and the edges from step 1, which options are high- / moderate- /
   low-fit? Reason through each. Don't prescribe yet.

4. Rank by the lens I'll give you (debuggability / obviously-correct /
   future-proofing / performance / whatever). Sketch concrete
   before-and-after code for the top 3–5 ideas, focusing on READ
   sites, not just writes. Show how the next reader would parse each.

5. Discuss behavior, not just code. For each place current behavior is
   arbitrary, inconsistent, or clearly broken, flag it and ask me what
   the target should be. Separate user-facing requirements from
   accidental current behavior. Do not plan to preserve broken
   behavior by default.

6. Plan safety nets at the right weight: tests that pin what must
   NOT change, reference fixtures, a one-shot spike if the model is
   risky. Lightweight only — we're not shipping to external users
   unchanged.

7. Execute in small commits, tests green at each step. Never bundle
   structural and behavioral changes in the same commit.

Rules:
- Phases 1–5 are analysis and discussion; no code.
- Push back on my preferences when they're under- or over-engineered.
- Flag trade-offs where one complexity is moved, not eliminated.
- When a "basic" behavior slips past unit tests, call out why the test
  layer missed it (usually composition lives in untested UI code).
- Keep responses tight. End each phase with a short question list.
```

### Adjustments when reusing

- Swap "state management" for whatever the actual pain is (error
  handling, caching, routing, config).
- Step 4's ranking lens matters a lot. "Debuggability" and "obvious
  correctness" gave very different answers in our case; pick it up
  front.
- Step 5 is where most value comes from. Don't let it be skipped.
- If worried about scope creep, add: "Prefer deleting code over
  adding it. If a new abstraction needs more lines than it removes,
  justify it."

---

## UI refactor

```
I want to refactor the UI of [TARGET]. It feels cluttered / inconsistent /
hard to scan / hard to use. Before changing anything, let's work through
it systematically. Walk through the phases below in order. Don't jump
ahead and don't write code (or CSS) until I approve a plan.

1. Inventory the UI surface. List every distinct view, overlay, popup,
   empty state, error state, and transition. For each: what triggers it,
   what DOM/JSX produces it, file:line, and a one-line description of
   what the user sees. If you can open the app in a browser, verify
   each entry by navigating to it.

2. Walk user flows end-to-end. For each primary task (starting with the
   golden path, then edge cases and error paths), describe the exact
   sequence of interactions and what the user sees at each step. Flag
   friction: broken flows, redundant paths, surprises, dead buttons,
   silent failures, keyboard/touch-only behaviors that don't parity.

3. Inventory UI debt. Group by category:
   - Inconsistency: spacing, typography, copy tone, iconography, button
     affordances, color semantics.
   - Information density: too much / too little / wrong things prominent.
   - Feedback: states that look identical, actions that give no
     confirmation, loading / empty / error states missing or weak.
   - Accessibility: keyboard nav gaps, missing focus rings, no ARIA,
     unreadable contrast, tap targets under ~40px.
   - Responsive: layouts that break at small/large widths or on
     orientation change.
   - Motion: animations that obstruct, missing transitions on meaningful
     state changes, jank.
   Number each issue (U1, U2, …).

4. Brainstorm redesign options, open mind. Cover the general patterns:
   discriminated component unions (Loading|Error|Empty|Ready), design
   token system, headless component library, compound components,
   controlled vs uncontrolled handoffs, shared layout primitives,
   page-level error boundaries, focus management conventions, etc.
   Include counter-ideas to my preferences. Explicit "don't-do" items.

5. Analyze fit for this app specifically — its size, stack, actual user
   pain points from step 3. Don't prescribe a design system if a
   handful of targeted fixes would do.

6. Rank by the lens I'll give you (clarity / speed / accessibility /
   consistency / learnability / delight / mobile-first / whatever).
   For top items, show a before/after: annotated screenshots if you
   have browser access, or component JSX before/after otherwise.
   Focus on what the USER perceives differently, not what the code
   looks like.

7. Discuss behavior, not just visuals. For each place the UX feels
   arbitrary or inconsistent, ask me what the target should be. Is
   the awkward thing a bug or a feature? Don't preserve it by default.
   Flag interactions you'd change regardless of "what looks good" —
   e.g. making a destructive action undoable, or adding a preview
   before commit.

8. Plan safety nets. For UI, that usually means a manual checklist
   (every flow from step 2), not automated tests. Call out what SHOULD
   be verified in a real browser before commit: keyboard paths, touch
   targets, small-screen layout, sound triggers, accessibility. A
   screenshot directory or simple video recording for each major flow
   is cheap insurance.

9. Execute in small commits. Never bundle a visual change with a
   behavior change. Never change copy and layout in the same commit.

Rules:
- Phases 1–7 are analysis and discussion; no code or CSS.
- If you can open the app in a browser, use it to verify claims.
  Otherwise, work from the code plus my verbal description — and
  explicitly note which observations are unverified.
- Push back on my preferences when they're aesthetic over functional.
- Flag accessibility gaps even if I haven't asked; they're not
  optional for new UI.
- Don't propose a new design system without naming the specific
  inconsistencies it would resolve.
- Keep responses tight. End each phase with a short question list.
```

### Key differences from the state-refactor prompt

- **Browser verification replaces code reading** as the primary
  investigation mode when available. UI claims from reading JSX are
  often wrong — padding, spacing, real color, actual touch target
  sizes are CSS-dependent and need to be seen.
- **User flows replace state transitions** as the organizing frame.
- **Accessibility gets its own category.** Easy to overlook, expensive
  to retrofit.
- **Automated tests are weaker.** Manual checklists and screenshots
  are the realistic safety net; don't promise vitest coverage you
  can't deliver.
- **Commit discipline tightens further.** "No visual + behavior in
  the same commit" is the UI analog of "no structural + behavioral."

### UI-specific hazards to watch for

- **Claims without a browser** — the assistant may invent issues from
  reading JSX that don't manifest, or miss issues that only show up at
  a specific viewport.
- **Design-system creep** — it's tempting to propose a full token/
  primitives system when three targeted fixes would do.
- **Aesthetics vs function** — "cleaner looking" isn't the same as
  "easier to use."
- **Copy changes sneak in** — every word reflow is a decision. Split
  commits.
