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
  _names_; values are read from the environment at call time only.
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

## Shot chaining (#11)

Status: **Tier A is implemented.** Tier B (`first-last-frame-to-video`,
`extend-video`) and previz (AI-generated keyframes) remain proposed, not
implemented. Tracks [#11](../../../issues/11). Builds on the honest continuity
gap documented in
[Designing for continuity](01-quick-start.md#designing-for-continuity-todays-real-limits)
and the deferred follow-up from #4 ("evaluate first/last-frame and
`extend-video` endpoints separately for shot chaining").

### The problem

Every shot renders from the manifest's authored references and prose
`continuity` only. Nothing about a shot's _actual rendered output_ — its last
frame, its motion, whether it drifted from what was planned — ever reaches the
next shot's request. `reference-to-video` has it worst: with no starting-frame
image at all, it has zero visual grounding for mid-story state and leans
entirely on prose to avoid re-inventing the set each shot.

### The model — as actually implemented (Tier A)

The implementation deliberately decouples from previz: a chained shot still
authors its own `references.composition` as normal (that's the "planned"
keyframe to verify against) — it does not require an AI-generated keyframe to
exist first. Previz (below) is a separate, still-unimplemented enhancement
that would let that authored composition itself be AI-generated instead of
producer-drawn; chaining doesn't wait on it.

1. A shot opts in with `chainFrom: <earlier-shot-id>`
   ([`src/schema.ts`](../src/schema.ts)), validated in
   `validateManifestSemantics` ([`src/render.ts`](../src/render.ts)): must
   reference an existing, strictly-earlier shot, not itself, and the shot must
   still author `references.composition` (chaining is a verify-and-promote
   overlay on normal authoring, never a replacement for it). Chaining is
   further restricted to `renderer.mode: "image-to-video"` (checked in
   `validateRendererInputs`, uniformly for `mock` and `fal`) — there's no
   `composition` role to verify against under `reference-to-video`.
2. At render time, once the predecessor shot completes, its last frame is
   extracted (`extractLastFrame`, [`src/chain.ts`](../src/chain.ts)) and
   compared against this shot's own authored composition via ffmpeg's `ssim`
   filter (`compareFrameSimilarity`, same file).
3. Close enough (`CHAIN_SIMILARITY_THRESHOLD`, currently `0.6`) → the real
   extracted frame is uploaded as this shot's actual composition input instead
   of the authored still (`renderFalShot`'s `compositionOverride` parameter),
   and a warning records the promotion and score.
4. Not close enough → the shot (and the render) fails with a clear message
   naming the shot, predecessor, and measured score. **No auto-retry or
   prompt-tweaking is implemented** — a producer edits the predecessor (or the
   threshold) and reruns; the existing resumable/cache-key model already makes
   that a normal `msb render` rerun, not new machinery.

The gate genuinely blocks: a failed comparison throws, which fails the shot
through the same path any other render failure takes — there is no code path
that logs a warning and proceeds anyway.

**Known limitation:** the similarity check is a deterministic pixel/structural
heuristic (SSIM), not semantic drift detection — it cannot tell "the scene
evolved as intended" from "the scene evolved in the wrong way," only "this
looks like that." An AI judge checking the shot's own `continuity[]`
invariants (color, badge, screen position, wardrobe, scale, set layout, props)
instead of raw pixels would be a strictly better check, but was deliberately
deferred to avoid introducing a new paid provider dependency, credentials, and
cost surface for the first implementation (confirmed as the right v1 tradeoff
during design). The mock renderer (`renderMockShot`) never consumes
`references.composition` at all, so the gate is skipped entirely for `mock` —
chained mock shots still wait for their predecessor (ordering is real and
tested), but there is nothing real to compare.

This also implies scenes should be split more finely at key action
transitions: a shorter link between keyframes makes "did this shot drift from
plan" a tighter, more diagnosable signal, instead of one long shot where drift
is already baked in by the time anyone checks.

### Two tiers of render-time mechanism

- **Tier A — implemented, works with existing renderers.** Described above.
  No change to `falModelCapabilities` — every current `image-to-video` entry
  (Hailuo, LTX, Veo image-to-video) already accepts exactly one `composition`
  raster; chaining only changes where that raster comes from. Doesn't help
  `reference-to-video`, which has no `composition` role at all — the mode with
  the worst continuity problem today stays unaddressed by Tier A alone.
- **Tier B — proposed, not implemented. Needs a new fal endpoint per mode:**
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

### The architectural cost — how Tier A actually solved it

The naive plan assumed a chained unit's cache key would need the predecessor's
_actual rendered bytes_ (`mediaHash`), which don't exist until the predecessor
finishes — implying `createPlan` would need to express chained units as
"pending, depends on unit N" rather than a resolved hash. That turned out to
be unnecessary. Since `chainFrom` must point strictly backward, `createPlan`
instead threads a `Map<shotId, cacheKey>` forward while it processes
`manifest.shots` in order, and folds the **predecessor's already-computed cache
key** (not its media) into the chained shot's own hash:
`hash({ shot, refs, engine, chainFrom: predecessorCacheKey })`. This is fully
resolvable at plan time — `msb render --dry-run` needs no special-casing to
report it — and still cascades correctly: if the predecessor's authored
content changes, its cache key changes, which changes the child's, making it
ineligible for reuse. This uses the same "cache key is the identity" model
already governing reuse everywhere else in this codebase, so it doesn't
introduce a new consistency rule.

**Known limitation:** because the dependency is on the predecessor's cache key
rather than its actual bytes, a predecessor that gets _re-rendered_ without any
authored change (e.g. after its cached media was corrupted, or a
non-deterministic provider happens to produce different pixels on retry) does
not cascade to the chained shot — by design, matching how this codebase
already treats provider non-determinism elsewhere (cache-key equality is
authored-identity equality, not byte equality).

Ordering is enforced without rewriting `renderWorker`'s dispatch loop. Rather
than turning the shared racing `nextIndex++` counter into a full
readiness-queue (a much larger, riskier change to well-tested core logic), a
worker that claims a chained unit whose predecessor isn't done yet **polls**
`output.shots[predecessorIndex].status` on a 50ms interval inside its own
claimed slot (`waitForChainPredecessor`) until it sees `"complete"` (or bails
immediately on `"failed"` or a shared `stopped` flag). This correctly
serializes the chain while unrelated shots keep parallelizing under
`--concurrency` — verified in
[`test/render.test.ts`](../test/render.test.ts) by rendering a 3-shot chain
under `concurrency: 3` and confirming the predecessor's `completedAt` never
lags the chained shot's. The one accepted inefficiency: the polling worker's
own slot sits idle while waiting rather than being freed to grab other
unclaimed work — a real but minor cost, not a correctness gap.

Resume already works correctly for free: a chained shot's cache key is a
regular string, so `reusableShots.get(unit.cacheKey)` (unchanged) reuses a
previously-completed chained shot exactly like any other shot, and
`waitForChainPredecessor` observes a reused predecessor's `"complete"` status
immediately rather than hanging (tested explicitly). What is **not** yet
tested is killing a render mid-chain (partway through the predecessor's own
attempt) and resuming — the existing `pending`/`complete`/`failed` status enum
should handle it the same way it already handles any other mid-render
interruption, but this specific interleaving has not been exercised.

`first-last-frame-to-video` (Tier B) needs none of this — it's a schema/adapter
change only, no cross-shot dependency. `extend-video` (Tier B) would still need
all of the above, applied to real media bytes instead of an authored still.

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

See [#11](../../../issues/11) for the authoritative list. Status against Tier A:

- [x] A mechanism is implemented (`chainFrom` + SSIM verify/promote; Tier A
      needed no new `RendererCapabilities` entry — see above for why).
- [x] Chaining is opt-in; an unmodified manifest is unaffected.
- [x] The drift check is a blocking gate with a real effect on control flow —
      a failed comparison throws and fails the shot, it never just warns.
- [x] Cache keys express the predecessor dependency; dry-run reports it without
      provider requests.
- [x] Chained shots serialize against their own chain; unrelated shots still
      parallelize under `--concurrency` (tested).
- [ ] Interrupted mid-chain renders resume without corrupt half-chained state
      — resume-from-a-completed-chain is tested; a kill partway through the
      predecessor's own attempt is not.
- [x] Unit tests cover valid chain, unknown/self/forward-referencing
      `chainFrom`, a shot with no authored composition, chaining under
      `reference-to-video`, cache-key cascade, and reuse/resume — no paid
      provider calls. ("Predecessor not yet complete" is exercised implicitly
      by every chained render; there is no separate test forcing that exact
      window today.)
- [ ] Docs state plainly what is and isn't guaranteed — done for Tier A above;
      still needs the equivalent honesty once Tier B ships.
- [x] A cost-capped manual paid test against real fal Hailuo 02 Standard
      confirmed the gate is a genuine check against live provider output, not
      just mock plumbing: it correctly rejected a real chain with a real
      framing mismatch (similarity 0.299) between independently-authored
      shots, and correctly promoted a real extracted frame (similarity 1.000)
      once shot 2 was authored to match shot 1's actual rendered output. See
      the `CHANGELOG.md` entry for the full account, including the
      non-determinism finding it surfaced. This demonstrates the mechanism
      works, not a controlled A/B comparison against the independent-shot
      baseline's visual output.

### Out of scope

- Automatically chaining every shot without explicit opt-in.
- Automatic prompt-tweaking/retry on a failed drift check — failure just stops
  the render with a clear message; rerunning after a manual edit is a normal
  `msb render`, not new machinery.
- A CLI/config flag to bypass or tune the similarity threshold — currently a
  fixed constant (`CHAIN_SIMILARITY_THRESHOLD` in `src/chain.ts`).
- Claiming cross-shot continuity solved from a single successful manual test.
- Reworking `image-to-video`/`reference-to-video` contracts unrelated to
  chaining.
