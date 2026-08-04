# Quick Start: Producing a Movie

Two roles, either of which can be a human or an AI:

- **Author** — makes creative calls: writes the script, casts characters,
  reviews whether output matches intent.
- **Producer** — makes it real: turns the script into an MSB, runs the
  pipeline, controls cost.

1. **Author** writes the script: screenplay, characters, shot list, in
   whatever raw form is natural.
2. **Producer** generates or sources one isolated, neutral-backdrop identity
   sheet per character/location/prop — no ensemble, no scene action.
3. **Producer** generates or sources the shot reference images each shot's
   renderer mode will need, citing those identity sheets as constraints: one
   ensemble composition per `image-to-video` shot, or identity sheets for
   `reference-to-video`.
4. **Author** reviews those reference images — both the entity identity
   sheets and the shot images — for identity (nothing added, removed, or
   redesigned) and, for shots, whether a single still can honestly represent
   the action. A shot with more than one beat that matters gets split into
   several sequential shots instead of asking one image to imply motion it
   can't show — which sends the affected shots back to step 3 for their own
   reference images before this review runs again.
5. **Producer** opts any shot into chaining (`chainFrom: <earlier-shot-id>`,
   `image-to-video` only) now, before packing — including shots the Author
   just split off an earlier one. See
   [Reference: shot chaining](#reference-shot-chaining) for what chaining
   verifies at render time.
6. **Producer** packs the bundle: structures the folder, references the
   generated images, and runs `msb pack <folder> --out build/movie.msb`.
7. **Author** reviews look-and-feel on the zero-cost local storyboard, before
   anything paid happens: `msb storyboard build/movie.msb --out
build/storyboard.msbo`, then `msb inspect build/storyboard.msbo` and watch
   the review MP4.
8. **Producer** optionally generates temporary AI timing narration for that
   review, instead of `--timing-voices`' local macOS speech.
9. **Producer** validates and prices the plan: `msb validate
build/movie.msb --config <engine.msbc>`, `msb render build/movie.msb --config
<engine.msbc> --dry-run`.
10. **Author** records sign-off on the reviewed storyboard, hash-bound to the
    exact source: `msb approve build/storyboard.msbo --source
build/movie.msb`. This is a durable record for later audit, not an enforced
    gate — `msb render` does not check it, and nothing today stops a producer
    from rendering without ever running `storyboard` or `approve` at all.
11. **Producer** renders within a cost cap: `msb render build/movie.msb
--config <engine.msbc> --out build/movie.msbo --max-cost 2.00`. As a chained
    shot renders, its predecessor's last frame is tested against its own
    authored composition — a close match promotes the real frame as the actual
    render input, a miss fails the shot rather than silently rendering from the
    stale still.
12. **Author** reviews the finished cut against intent.
13. **Producer** exports the deliverable: `msb export build/movie.msbo --out
build/movie.mp4`.

That's the whole loop. `msb make <bundle.msb> --config <engine.msbc>`
collapses the render and export steps into one command. Everything below is
reference for when a step above needs more than the one-line version.

Every artifact path above is rooted under the gitignored `build/` tree,
never inside a tracked source folder — see
[Prompt architecture](03-prompt-architecture.md) for why that boundary
matters.

Ready-to-use prompts for each numbered step above, tagged Author/Producer, are
the numbered files in [`scripts/prompts/`](../scripts/prompts/README.md) —
that directory's README describes how an orchestrator can drive an Author and
a Producer agent through them end to end.

## Install

```bash
npm install -g movie-source-builder
msb --help
```

Or `npx msb --help` project-local, or build from source with `npm install &&
npm run build && node dist/cli.js --help`.

## The pipeline stages

```text
source folder → Movie Source Bundle (.msb) + Configuration (.msbc) → Builder Output (.msbo) → movie (.mp4)
```

- `.msb` is immutable creative source: structured shots, screenplay,
  characters, locations, props, and reference assets.
- `.msbc` is content-independent engine configuration: renderer provider/model,
  required environment-variable names, and technical output settings. JSON,
  never contains credential values.
- `.msbo` is self-contained builder output: generated scenes and audio,
  rendering notes, hashes, configuration snapshot, costs, status, provenance.
- `.mp4` is a repeatable delivery export; export never calls an AI provider.

Review progresses through checkpoints, each one before spending more:
`storyboard → previz → render → export`. `storyboard` (step 7 above) is
implemented today, and chaining a shot's render to its predecessor's actual
output (step 5 above) is too. `previz` — generating a shot's keyframe with AI
rather than authoring it, then verifying against that instead — is
**proposed, not implemented**; see
[Contributing](CONTRIBUTING.md#shot-chaining-11).

## Reference: authoring a bundle

### The reference rule

- `characters[].reference`, `locations[].reference`, and `props[].reference`
  identify and package reusable source assets. They document entities and
  participate in cache keys, but are **not automatically composited or sent to
  a provider**.
- `shots[].references` is the explicit, role-based provider input for that
  shot: `identity` (0–3 rasters, one per recurring character, for
  reference-to-video renderers), `composition` (one starting-frame raster, for
  image-to-video renderers), `endFrame` (one optional ending-frame raster).

Listing three characters in `shot.characters` does not make three reference
sheets visible to the provider — a path must appear under `references` to be
uploaded. Which roles a shot must populate, and how many, depends on the
`renderer.mode` in the `.msbc`:

- `image-to-video` (fal Hailuo, Veo 3.1 Fast, LTX 2.3 Fast) requires exactly
  one `composition` raster and rejects `identity`/`endFrame`. For a
  multi-character shot, that one raster must already show every character
  together in the desired setting.
- `reference-to-video` (Veo 3.1 Fast reference-to-video) requires one to three
  `identity` rasters and rejects `composition`/`endFrame`.

An unsupported role, a missing required role, or an out-of-range count for the
configured mode fails validation at plan creation, before credentials,
pricing, upload, or generation.

### Source layout

```text
source/
├── msb.json
├── screenplay.md
├── characters/agent-86.png, agent-99.png, ...   # isolated, neutral backdrop, no ensemble
├── locations/control-center.png                  # empty of characters
└── references/control-center-ensemble.png         # image-to-video composition input:
                                                     # every character + set in one frame
```

A `reference-to-video` engine uses the individual character sheets directly as
`identity` — no ensemble composition needed.

### Minimal manifest

```json
{
  "formatVersion": "1.1.0",
  "project": { "id": "agent-skit", "title": "Agent Skit" },
  "characters": [
    {
      "id": "agent-86",
      "name": "Agent 86",
      "description": "Red knit sock puppet with an 86 badge",
      "reference": "characters/agent-86.png"
    },
    {
      "id": "agent-99",
      "name": "Agent 99",
      "description": "Blue knit sock puppet with a 99 badge",
      "reference": "characters/agent-99.png"
    }
  ],
  "locations": [
    {
      "id": "control-center",
      "description": "Cardboard control center",
      "reference": "locations/control-center.png"
    }
  ],
  "props": [],
  "shots": [
    {
      "id": "scene-001-shot-001",
      "duration": 6,
      "characters": ["agent-86", "agent-99"],
      "location": "control-center",
      "dialogue": [],
      "action": "The two puppets address the control room.",
      "camera": "Locked medium two-shot.",
      "references": { "composition": "references/control-center-ensemble.png" },
      "continuity": [
        "Agent 86 remains red with badge 86 on camera left",
        "Agent 99 remains blue with badge 99 on camera right"
      ]
    }
  ]
}
```

Render with any `image-to-video` engine, e.g. `msbc/fal-hailuo-02-standard.msbc`.
For `reference-to-video` (Veo 3.1 Fast, 8-second shots only), drop
`references.composition` for `references.identity: ["characters/agent-86.png", "characters/agent-99.png"]`
instead — see [`examples/skit-poc-reference/msb.json`](../examples/skit-poc-reference/msb.json)
for a complete three-character version.

### Designing for continuity (today's real limits)

Video requests are independent regardless of mode. `continuity` is appended
to the text prompt — it's guidance, not an identity lock or previous-frame
handoff. For `image-to-video`, [shot chaining](#reference-shot-chaining)
(`chainFrom`) now gives a real, if partial, mitigation: a verified real frame
instead of a static authored guess. `reference-to-video` still has nothing —
see [Contributing](CONTRIBUTING.md#shot-chaining-11) for what's proposed
beyond Tier A. In the meantime:

1. Use one canonical `composition` (image-to-video) or the same `identity`
   sheets (reference-to-video) for every shot in a sequence.
2. Give characters unmistakable, non-overlapping colors and identity markers.
3. Repeat concrete invariants in `continuity`: color, badge, screen position,
   wardrobe, scale, set layout, props. Reference-to-video has no composition
   image to imply the set, so state location and staging there too.
4. Keep camera/staging changes modest — large viewpoint shifts give the model
   more room to redesign characters.
5. Reference-to-video is markedly worse at holding a static pose (no
   starting-frame anchor). If a shot's entire content is "nothing moves," state
   that constraint as the first sentence of `action`, repeat it as a
   `CRITICAL:` `continuity` entry, and budget for a retry.

### Preflight checklist

- Every shot's `references` only uses roles the configured `renderer.mode`
  accepts, within its supported count.
- `image-to-video`: the `composition` raster shows the complete opening
  composition with every visible character in it.
- `reference-to-video`: every visible recurring character has an `identity` sheet.
- Identity and placement invariants are stated concretely in `continuity`.
- `msb validate` succeeds; `msb render --dry-run` reports the expected shots
  and cost with zero provider requests.

## Reference: storyboard

`msb storyboard build/movie.msb --out build/storyboard.msbo` validates the
complete bundle and produces one SVG panel per shot, silent timing-audio
tracks, an SVG contact sheet, and a review MP4 via the bundled FFmpeg — zero
network requests. Supplied shot references are displayed as-is; **no
replacement imagery is generated at this stage**. Add `--timing-voices`
(macOS) for disposable system-synthesized speech at each dialogue/narration
time — a timing aid only, never production audio.

`msb approve build/storyboard.msbo --source build/movie.msb` binds approval
to the exact source and generated artifacts; it fails clearly if any byte of
the source — screenplay, dialogue, ordering, timing, references, action,
camera, or continuity — has changed since.

`npm run storyboard:prompts -- build/movie.msb --out storyboard-prompts.json`
generates a deterministic, hashed prompt plan per shot/dialogue event against
an already-packed bundle; add `--check` to reject missing or reused shot
references before storyboard or provider work.

Before packing, the same script also runs directly against a source
directory — `npm run storyboard:prompts -- <source-dir> --out
requests.json` — and emits one request per referenced asset (entity identity
sheets and shot references alike), each tagged `present` or `missing`. Add
`--require-complete` to fail the command if anything a Producer still needs
to generate or source is missing, before running `pack` at all. See
[Prompt architecture](03-prompt-architecture.md#the-reference-image-requestresponse-contract)
for the request shape and the image-generating-agent contract it hands off
to.

## Reference: shot chaining

For `image-to-video` shots, set `chainFrom: <earlier-shot-id>` to chain a shot
to an earlier one in the same manifest (must reference an existing,
strictly-earlier shot; the shot must still author its own
`references.composition` — chaining verifies against it, it doesn't replace
it):

```json
{
  "id": "scene-001-shot-002",
  "chainFrom": "scene-001-shot-001",
  "references": { "composition": "references/scene-001-shot-002.png" }
}
```

At render time, once `scene-001-shot-001` completes, its last frame is
extracted and compared (via ffmpeg's SSIM filter) against
`scene-001-shot-002`'s own authored composition. A close-enough match promotes
the real extracted frame as the actual render input instead of the authored
still; a miss fails the shot with a message naming the shot, predecessor, and
measured score — it never silently falls back to the stale still. `msb render
--dry-run` reports the dependency and cache key with zero provider requests;
`--concurrency` still parallelizes unrelated shots while a chain serializes
against itself.

This is a deterministic pixel/structural-similarity heuristic, not semantic
drift detection — it can tell "this looks like that," not "the scene evolved
the way it was supposed to." It only runs against real (`fal`) renders; the
mock provider never consumes composition images at all, so chained mock shots
wait for ordering but skip the check. There's no automatic retry: a failed
check requires editing the predecessor (or the shot) and rerunning — the
existing resumable/cache-key model already makes that a normal `msb render`,
nothing special. Full design and architectural detail:
[Contributing: shot chaining](CONTRIBUTING.md#shot-chaining-11).

## Reference: previz (proposed — not implemented)

A separate, still-unimplemented enhancement on top of chaining above: instead
of a producer authoring every shot's `composition` by hand, generate it with
AI up front, review the whole sequence as a storyboard, then let chaining
verify against those generated keyframes the same way it already verifies
against authored ones. Chaining does not wait on this — it already works
against whatever composition a shot authors today. Open questions and
architectural notes: [Contributing](CONTRIBUTING.md#shot-chaining-11).

## Reference: render and export

`--dry-run` plans with zero provider requests and reports missing renderer
environment variables without exposing values. `--max-cost <usd>` rejects a
render before new work begins if estimated cost is too high. Cache keys
include the shot, complete engine configuration, and referenced asset hashes;
completed shots are reused across resumed renders, and state is checkpointed
atomically after every shot.

Without `--out`, output goes to a gitignored `build/<msb>-<msbc>/<timestamp>/`.
`--config` defaults to the packaged [`msbc/default.msbc`](../msbc/default.msbc)
(cheapest configured paid engine); use `msbc/mock.msbc` for a provider-free
render. `msb verify-auth [--config ...]` checks declared environment variables
through the renderer adapter without submitting a generation request or
printing credential values.

`msb export build/movie.msbo --out build/movie.mp4` verifies hashes,
normalizes media, never contacts a provider, and rejects incomplete or
tampered output.

Ready-to-use mock, Hailuo 02 Standard, Veo 3.1 Fast, and LTX 2.3 Fast profiles
are documented under [`msbc/README.md`](../msbc/README.md). See
[Adding a provider](02-adding-providers.md) to register a new one.

## Reference: CLI

```text
msb pack <source-dir> --out <bundle.msb>
msb validate <bundle.msb> [--config <config.msbc>]
msb inspect <bundle.msb|config.msbc|output.msbo> [--json]
msb verify-auth [--config <config.msbc>] [--json]
msb storyboard <bundle.msb> --out <storyboard.msbo> [--timing-voices]
msb approve <storyboard.msbo> --source <bundle.msb>
msb render <bundle.msb> [--config <config.msbc>] [--out <output.msbo>] [--dry-run] [--work-dir <path>]
           [--concurrency <n>] [--max-cost <usd>] [--force] [--keep-work-dir]
msb export <output.msbo> --out <movie.mp4> [--force]
msb make <bundle.msb> [--config <config.msbc>] [--out <movie.mp4>] [render options]
```

Exit codes: `0` success, `2` usage, `3` validation, `4` credentials, `5` cost
limit, `6` provider/render, `7` media/export, `130` interrupted.

## Reference: safety and cost controls

Archive reads reject absolute paths, traversal, links, duplicate normalized
entries, oversized entries, excessive entry counts, and excessive expansion.
Credentials are read only from the environment and never stored in source,
configuration, output, reports, caches, or logs. Automated tests use only the
mock renderer and never submit paid requests.

## Example

[`examples/skit-poc`](../examples/skit-poc) — "Agent Autonomy Skit": three
explicitly framed knit sock puppets, one location, timed dialogue, continuity
constraints, three 10-second shots. Demonstrates the ensemble-reference
pattern above.

[`examples/smoke-test.msb`](../examples/smoke-test.msb) — a provider-ready
single-shot bundle for testing engine configurations, see
[`msbc/README.md`](../msbc/README.md).
