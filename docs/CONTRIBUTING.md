# Contributing

## Repository layout

```text
src/            flat, single-purpose modules: cli.ts, schema.ts, archive.ts,
                render.ts, storyboard.ts, export.ts, paths.ts, index.ts
test/           one *.test.ts per src module, plus e2e.test.ts and
                renderer-contract.test.ts
examples/       distributable sample sources (skit-poc, smoke-test, ...)
msbc/           engine (.msbc) configuration profiles + their own README
schemas/        generated JSON Schemas (npm run build regenerates these)
scripts/        storyboard prompt-plan generation
```

There is no `src/cli/`, `src/schema/`, or similar subdirectory structure —
each concern is one flat file.

## Project invariants

These are enforced by tests and code review, not aspirational:

- No provider secrets are persisted anywhere: not in `.msb`, `.msbc`, `.msbo`,
  reports, caches, or logs. `.msbc` records only required environment-variable
  *names*; values are read from the environment at call time only.
- No paid request occurs in tests, dry-run, `validate`, `inspect`, `storyboard`,
  or `export`. Automated tests use only the mock renderer.
- Input archives are never trusted or extracted without complete
  central-directory entry validation (absolute paths, traversal, links,
  duplicate normalized names, oversized/excessive entries all rejected before
  any payload is read).
- Render state is recoverable and written atomically (temp file + rename) after
  every completed shot.
- A `.msbc` is content-independent: it may describe a renderer engine and
  output settings, but never a project, style, character, voice, shot,
  duration, or credential value. The strict schema rejects anything else.
- No silent fallback behavior. When something can't be validated cleanly
  (an unsupported reference role, a missing predecessor, a drift check that
  fails), the correct response is a clear rejection, not a best-effort guess
  that quietly does something the producer didn't ask for.

## Key technical decisions

**Package and executable identity.** Publish `movie-source-builder` with an
`msb` binary. The repository/package describes the product; the short binary
names the artifact workflow.

**Container handling.** Treat `.msb` and `.msbo` as ZIP containers but validate
all central-directory entries before reading payloads. Treat `.msbc` as a
separately validated JSON configuration. This stays portable and inspectable
while defending against traversal, duplicate, link, and expansion attacks.

**Output lifecycle.** Build output in a work directory with atomic JSON
checkpoints, then package a self-contained `.msbo`. ZIP mutation is poorly
suited to durable incremental state; atomic workspace state gives clean
recovery on interruption.

**Media runtime.** Bundle FFmpeg and keep provider calls outside export. This
gives repeatable installs and re-encoding without cost or credentials, and
means export can never accidentally trigger paid generation.

## Development

```bash
npm run format       # prettier --write
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest run (mock renderer only, no paid requests)
npm run build        # tsc + generate-schemas.mjs
npm run smoke        # node dist/cli.js --help
npm run check        # all of the above, plus schema-drift and smoke-test dry-runs
```

`npm run check` validates and resolves every runnable `.msbc`, dry-runs each
profile against the checked-in smoke-test `.msb`, independently validates
representative `.msb`/`.msbc`/`.msbo` documents against the published JSON
Schemas, exercises the mock `.msb → .msbo → .mp4` pipeline, and rejects stale
generated schemas. This must pass before merge; real fal generation stays an
explicit manual operation requiring credentials, never something CI runs.

## Publishing

Merges to `main` run [`.github/workflows/publish.yml`](../.github/workflows/publish.yml),
which verifies the package and publishes the version in `package.json` when
that version doesn't already exist on npm, using npm trusted publishing through
GitHub OIDC (no long-lived `NPM_TOKEN`). Increment `package.json`'s version
before merging a release that should publish. Trusted publisher configuration:
organization/user `TheSwanFactory`, repository `movie-source-builder`, workflow
filename `publish.yml`, allowed action `npm publish`.

## Proposed: previz & shot chaining (#11)

Status: proposed, not implemented. Tracks [#11](../../../issues/11). Builds on
the honest continuity gap documented in
[Designing for continuity](01-quick-start.md#designing-for-continuity-todays-real-limits)
and the deferred follow-up from #4 ("evaluate first/last-frame and
`extend-video` endpoints separately for shot chaining").

### The problem

Every shot renders from the manifest's authored references and prose
`continuity` only. Nothing about a shot's *actual rendered output* — its last
frame, its motion, whether it drifted from what was planned — ever reaches the
next shot's request. `reference-to-video` has it worst: with no starting-frame
image at all, it has zero visual grounding for mid-story state and leans
entirely on prose to avoid re-inventing the set each shot.

### The model

1. **Previz** generates a keyframe for every shot, up front, before any paid
   video rendering. This is a new dependency, not glue code: no
   image-generation adapter exists in this codebase today —
   `composition`/`identity` are always producer-supplied PNGs (a producer here
   is whoever or whatever makes creative calls: a human, an AI, or some mix —
   the pipeline doesn't care which).
2. Review the full generated sequence as a storyboard — extending the existing
   zero-cost `msb storyboard`/`approve` workflow
   ([`src/storyboard.ts`](../src/storyboard.ts)) to preview generated keyframes
   instead of only whatever reference already exists.
3. Render shot N, extract its last frame (Tier A below) or use the renderer's
   own video-context output (Tier B), and compare it against the
   already-planned keyframe for shot N+1 — not the chain's original keyframe,
   the *next* one, since that's the tighter, more localized test.
4. Close enough → keyframe N+1 is *replaced* with the real frame; shot N+1
   renders from that promoted, ground-truth composition instead of the
   originally-planned one.
5. Not close enough → tweak shot N's prompt and rerun shot N; re-check before
   advancing to N+1.

The gate in steps 3–5 must actually block. A drift check that only logs a
warning while the render proceeds anyway defeats the point — the entire reason
to serialize chained rendering is to *prevent* drift, not to observe it after
the fact once money's already spent on everything downstream. Who performs the
judging (step 3) and who performs the tweaking (step 5) — a human producer or
an AI judge/editor — is a separate question from whether the gate exists; both
roles can be filled by either.

For judging, raw frame similarity is the wrong test — the scene is supposed to
evolve, not stay pixel-identical. What's worth protecting is the shot's own
`continuity[]` invariants (color, badge, screen position, wardrobe, scale, set
layout, props) — concrete things producers are already required to state (see
[Designing for continuity](01-quick-start.md#designing-for-continuity-todays-real-limits)).
An automated judge can check the extracted frame against those specific
invariants and name which one broke, instead of returning a vague similarity
score.

This also implies scenes should be split more finely at key action
transitions: a shorter link between keyframes makes "did this shot drift from
plan" a tighter, more diagnosable signal, instead of one long shot where drift
is already baked in by the time anyone checks.

### Two tiers of render-time mechanism

- **Tier A — works with existing renderers.** After rendering shot N, extract
  its last frame with the already-bundled `ffmpeg-static` and feed it as shot
  N+1's `composition`. No change to `falModelCapabilities` — every current
  `image-to-video` entry (Hailuo, LTX, Veo image-to-video) already accepts
  exactly one `composition` raster; this only changes where that raster comes
  from. Cheapest to build, weakest fidelity (a still, not video context).
  Doesn't help `reference-to-video`, which has no `composition` role at all —
  the mode with the worst continuity problem today stays unaddressed by Tier A
  alone.
- **Tier B — higher-end composition, needs a new fal endpoint per mode:**
  - `fal-ai/veo3.1/fast/first-last-frame-to-video`: `composition` maps to
    `first_frame_url`, `endFrame` to `last_frame_url`, both producer-supplied.
    No cross-shot dependency at all — just a new `RendererCapabilities` entry
    and `.msbc` profile (see [Adding a provider](02-adding-providers.md)). The
    right adapter for a shot that must open and close on specific, known
    compositions (e.g. a "collapsed and motionless" shot that today relies
    purely on `continuity` prose to hold a pose).
  - `fal-ai/veo3.1/fast/extend-video`: `video_url` is shot N's own rendered
    clip — real motion/video context, not a derived still. This is the one the
    issue's "real cross-shot continuity" language is actually about, and it
    carries the full architectural cost below. Its duration is fixed at
    7s/720p by the endpoint, which is not just a capability nuance: `duration`
    is a hardcoded `z.union([z.literal(6), z.literal(8), z.literal(10)])` in
    [`src/schema.ts`](../src/schema.ts) today — 7s cannot be written in a
    manifest at all without a schema change first.

### The architectural cost (Tier A and `extend-video` only)

[`createPlan`](../src/render.ts) derives each `RenderPlanUnit.cacheKey` from
`hash({ shot, refs, engine })` — purely authored inputs, computable before any
request is made. A chained unit's cache key must also depend on its
predecessor's actual output (`mediaHash`), which doesn't exist until the
predecessor finishes rendering:

- `createPlan` must express a chained unit as "pending, depends on unit N" in a
  dry run rather than a resolved hash — `msb render --dry-run` must still
  report the dependency and estimated cost without resolving it, since #11's
  acceptance criteria require dry-run to make no provider requests.
- Invalidating/re-rendering shot N must cascade: every shot chained after it
  needs its cache key recomputed and, if changed, its cached media discarded.
- [`renderMovie`'s `renderWorker`](../src/render.ts) currently pulls the next
  pending index from one shared counter (`nextIndex++`) with no ordering
  constraint between units. A chained unit can't start until its predecessor
  shows `status === "complete"`; the worker loop needs a readiness check
  instead of "next index is free," so unrelated shots keep parallelizing under
  `--concurrency` while chained shots serialize against each other.
- A render interrupted mid-chain must let resume tell "predecessor complete,
  successor not yet attempted" apart from "predecessor itself was mid-attempt"
  — the existing `pending`/`complete`/`failed` status enum probably suffices,
  but the resume path must specifically re-check predecessor completion before
  dispatching a chained unit.

`first-last-frame-to-video` needs none of this — it's a schema/adapter change
only, no cross-shot dependency.

### What this changes about iteration

The old independent-shot model is one-shot: fire a render, walk away, review
the finished cut. A bad shot is cheap to fix in isolation. The chained model
breaks that — a bad shot N poisons everything chained after it, and there's no
way to know whether N's last frame is even a usable starting composition until
it's actually rendered. That pushes toward judging (human or AI) each link
before advancing to the next, not because the tool arbitrarily requires it, but
because skipping the check risks spending real money on shots built on a
broken foundation. This is a property of the dependency itself, not an
artifact of how it happens to be implemented.

### Acceptance criteria

See [#11](../../../issues/11) for the authoritative list. Summarized:

- [ ] At least one Tier A/B mechanism is a registered `RendererCapabilities`
      entry.
- [ ] Chaining is opt-in; an unmodified manifest is unaffected.
- [ ] The drift check is a blocking gate with a real effect on control flow —
      not a warning that can be silently ignored.
- [ ] Cache keys express the predecessor dependency; dry-run reports it without
      provider requests.
- [ ] Chained shots serialize against their own chain; unrelated shots still
      parallelize under `--concurrency`.
- [ ] Interrupted mid-chain renders resume without corrupt half-chained state.
- [ ] Unit tests cover valid chain, missing predecessor, predecessor not yet
      complete, and mixed chained/unchained manifests — no paid provider calls.
- [ ] [`01-quick-start.md`](01-quick-start.md) states plainly what is and isn't
      guaranteed: video-context extension is real continuity; frame handoff is
      a still-image approximation; neither claims to fix identity drift by
      itself.
- [ ] A cost-capped manual re-render of a prior skit shot confirms a measurable
      improvement over the independent-shot baseline.

### Out of scope

- Automatically chaining every shot without explicit opt-in.
- Claiming cross-shot continuity solved from a single successful manual test.
- Reworking `image-to-video`/`reference-to-video` contracts unrelated to
  chaining.
