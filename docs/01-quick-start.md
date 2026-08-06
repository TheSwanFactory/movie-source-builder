# Quick Start: Producing a Movie

A project is **one folder** — screenplay, references, shot lists, and every
take ever rendered, as an append-only, inspectable ledger. See
[MSB format v2](04-msb-format.md) for the full design; this document is the
walkthrough.

Two roles, either of which can be a human or an AI:

- **Author** — makes creative calls: writes the draft screenplay, owns words
  and timing, reviews whether output matches intent.
- **Producer** — makes it real: canonicalizes the draft, breaks the timeline
  into shots, runs the pipeline, controls cost.

1. **Author** writes the draft screenplay in whatever name and format is
   natural — it is never machine-parsed.
2. **Producer** creates the project around it: `msb create my-movie --draft
screenplay.docx` scaffolds the folder and copies the draft verbatim into
   `drafts/`.
3. **Producer** canonicalizes the draft into `screenplay.json` — cast ids,
   timed cues (point cues for action beats, span cues for dialogue and
   narration), a declared total duration — and fills `msb.json`'s cast. This
   is a judgment task (pacing lines the draft left implicit), not a
   conversion. `msb ingest my-movie` then validates it: unique monotonic
   cues within the duration, no same-speaker overlap, speakers resolving to
   cast, every cast member with a model sheet or flagged as still needing
   one.
4. **Author** confirms the canonical screenplay says what the draft meant —
   against `msb inspect my-movie --screenplay` (readable screenplay text),
   never by reading JSON.
5. **Producer** generates or sources one isolated, neutral-backdrop **model
   sheet** per cast member (`references/agent-86.png`), then **boards** —
   reference stills anchored to cues on the screenplay timeline
   (`references/t0016.0-agents-turn.png`) — indexing each in
   `references/references.json`. `npm run storyboard:prompts -- my-movie`
   emits one clean, hashed request per missing image (see
   [Prompt architecture](03-prompt-architecture.md)).
6. **Author** reviews the model sheets and boards for identity: nothing
   added, removed, or redesigned.
7. **Author** reviews look and feel on the **animatic** — the zero-cost,
   zero-network review movie assembled from timed cues and boards, before
   any shot list exists: `msb animatic my-movie`, then watch
   `cuts/animatic.mp4`.
8. **Producer** writes the shot list, `shotlists/001.json`: a tiling of the
   timeline into contiguous shots with spans, references, continuity, and
   optional per-engine prompt overrides — **no dialogue; it derives from the
   screenplay cues in each shot's span**. Opt shots into chaining
   (`"chainFrom": "shot-001"`, `image-to-video` only) here.
9. **Producer** validates and prices the plan with zero provider requests:
   `msb shoot my-movie --config msbc/fal-ltx-2.3-fast.msbc --dry-run`. A shot
   list that cannot tile onto the engine's duration menu is a plan failure
   with a structured finding, not a mid-shoot surprise.
10. **Author** gives the go/no-go on the reviewed animatic and the dry-run
    estimate before real spend.
11. **Producer** shoots within a cost cap: `msb shoot my-movie --config
<engine.msbc> --max-cost 2.00`. Takes land directly in the `takes/`
    pool (`shot-001.t01.mp4` plus an extracted last frame); the shoot itself
    is one appended JSON in `shoots/` linking source hashes, reused takes,
    new takes, and findings. As a chained shot renders, its predecessor's
    last frame is verified against the shot's own composition board — a
    close match promotes the real frame as the render input, and a drift
    miss re-renders the predecessor as **additional numbered takes** before
    failing.
12. **Author** reviews the dailies: `msb dailies my-movie` lists unreviewed
    takes and past observations; `msb circle my-movie --take shot-001.t02`
    marks the keeper, `--reject` (optionally `--notes review.md`) records
    why a take fails — verdicts are appended to the `dailies/` ledger, and
    the reasoning lands beside the frames it judges as
    `takes/<take>.notes.md`. Anything watched but not yet judged is an
    observation: `msb note my-movie --cut 0002 --span 22-32 --text "final
scene insane" --attach frame.png` parks what was seen (screenshots are
    copied into `dailies/<session>/`), and `msb circle my-movie --animatic`
    approves the animatic itself.
13. **Producer** assembles the deliverable: `msb cut my-movie` picks each
    shot's circled take (else its newest never-rejected rendered take),
    verifies hashes, and writes `cuts/<shoot>.mp4` — never contacting a
    provider.

That's the whole loop. Everything is retained indefinitely by default;
`msb gc my-movie --dry-run` shows what take media an explicit cleanup would
reclaim (never ledger JSON, notes, or last frames). Everything below is
reference for when a step above needs more than the one-line version.

Ready-to-use prompts for the numbered steps, tagged Author/Producer, are the
numbered files in [`scripts/prompts/`](../scripts/prompts/README.md) — that
directory's README describes how an orchestrator can drive an Author and a
Producer agent through them end to end.

## Install

```bash
npm install -g movie-source-builder
msb --help
```

Or `npx msb --help` project-local, or build from source with `npm install &&
npm run build && node dist/cli.js --help`.

## The project folder

```text
my-movie/                         # the project folder IS the msb
├── msb.json                      # header: format version, project id/title, cast
├── drafts/                       # author's screenplay(s), verbatim — never parsed
├── screenplay.json               # canonical timed screenplay — the timeline authority
├── references/                   # flat: model sheets + boards + references.json index
├── shotlists/001.json            # versioned tilings; immutable once any shoot cites them
├── takes/shot-001.t01.mp4        # flat media pool: media, .last.png, .notes.md per take
├── shoots/0001-ltx.json          # append-only ledger: one JSON link object per shoot
├── dailies/0001.json             # append-only review verdicts
└── cuts/                         # animatic.mp4 and deliverable cuts
```

- `.msbc` is content-independent engine configuration (unchanged from v1):
  renderer provider/model/mode, required environment-variable names,
  technical output settings. Never contains credential values.
- `msb pack my-movie [-o my-movie.msb] [--source-only]` emits a transport
  `.msb` archive of the folder — a format optimization for shipping or
  pinning, never the only copy of anything. `--source-only` omits the
  ledgers and outputs (`takes/`, `shoots/`, `dailies/`, `cuts/`).
- The scaffolded folder ships a `.gitignore` covering `takes/*.mp4` and
  `cuts/` — everything else is small, diffable text worth tracking.

## Reference: the canonical screenplay

`screenplay.json` is the timeline authority: scenes of cues with stable ids.
Point cues (`at`) mark action beats; span cues (`span: [start, end]`) carry
dialogue and narration. Dialogue lives here and only here — shot lists never
repeat it, and at shoot time each shot picks up whatever cues fall inside
its span. The screenplay records the draft it canonicalizes (`draft`,
`draftHash`); ingest fails if the draft was edited in place — drafts are
append-only, so a revision is a new file in `drafts/`.

## Reference: model sheets and boards

`references/` is flat and indexed by `references/references.json`:

- **Model sheets** are timeless identity references, one per cast member,
  named for the member (`agent-86.png`).
- **Boards** anchor to a cue (`"anchor": {"cue": "c004", "at": 16, ...}`);
  the `t0016.0-<slug>.png` filename prefix is a human sort convenience,
  cosmetic by construction. Boards drive the animatic and serve as shot
  `composition` references.

### The reference rule

`shots[].references` is the explicit, role-based provider input per shot:
`identity` (1–3 rasters for `reference-to-video` renderers), `composition`
(one starting-frame raster for `image-to-video`), `endFrame` (optional).
Listing three characters in `shot.characters` does not upload three model
sheets — a path must appear under `references` to be sent. An unsupported
role or an out-of-range count for the configured `renderer.mode` fails
validation at plan time, before credentials, pricing, upload, or generation.

## Reference: shot lists and engine compatibility

A shot list tiles the timeline: contiguous, non-overlapping spans covering
`[0, duration]`. Versions are zero-padded ordinals; a shot list is immutable
once any shoot cites it — editing means writing the next version, recording
the screenplay hash it tiles.

Per-engine prompt overrides live in `shots[].prompts`, keyed by engine
config name (e.g. `"fal-ltx-2.3-fast"`) or `provider/model`, with
`"default": null` meaning "derive from action/camera/continuity". The
dialogue derived from the screenplay cues is always appended. This is where
"LTX needs to be told, forcefully, not to hallucinate extra puppets" lives —
versioned with the shot list instead of lost in a chat.

An engine's duration menu (e.g. Veo 3.1 Fast: 6s/8s) constrains what spans a
shot list may use under that engine. `msb shoot` checks this at plan time:
an impossible tiling is recorded as a **failed shoot** with zero takes, zero
cost, and a structured `engine-compatibility` finding —
`msb inspect my-movie --findings` aggregates them across all shoots.

## Reference: shoots, takes, and dailies

A **shoot** is one renderer invocation against one shot list with one
engine: a pure JSON link object recording the shot list and engine hashes, a
snapshot of the resolved configuration, explicit `reused` take links (cache
keys — shot definition + derived cues + asset hashes + engine — decide reuse),
the new takes with their metadata (cost, request id, chain score, error),
findings, and warnings. Media is never copied between shoots.

A **take** is one rendered attempt at one shot: `takes/<shot>.t<NN>.mp4`
plus `.last.png` (chaining and evidence) and, once someone judges it,
`.notes.md`. Take numbers are per-shot monotonic across all shoots. Failed
attempts stay in the pool — nothing deletes media but explicit `gc`.

**Dailies** record verdicts: a take's standing is the latest verdict across
all sessions — circled, rejected, or unreviewed. An engine-successful take
that fails human review is `rendered` in its shoot and `rejected` in
dailies, with the reasoning beside the exact frames it describes.

`msb inspect my-movie --shot shot-001` joins the pool against the shoot
ledger: every take of the shot across all engines, with standing, cost, and
notes. `msb latest my-movie` prints the latest shot list, the latest
complete shoot, and each shot's current take — computable from folder
contents alone.

## Reference: shot chaining

For `image-to-video` shots, set `chainFrom: "<earlier-shot-id>"` in the shot
list (the shot must still author its own `references.composition` — chaining
verifies against it, it doesn't replace it). At shoot time, once the
predecessor completes, its last frame is compared (ffmpeg SSIM) against the
chained shot's composition board. A close match promotes the real frame as
the render input; a miss re-renders the predecessor fresh — **each retry an
additional numbered take in the pool, reviewable in any later dailies
session** — up to 3 total predecessor renders before failing with every
measured score. Whenever any shot chains, `--concurrency` clamps to 1.

This is a pixel/structural-similarity heuristic, not semantic drift
detection. It only runs against real (`fal`) renders; the mock provider
never consumes composition images, so chained mock shots keep ordering but
skip the check.

## Reference: cost and safety controls

- `msb shoot --dry-run` plans, prices (fallback rates), and reports findings
  with zero provider requests and zero writes.
- `--max-cost <usd>` rejects a shoot before new work begins if the live
  estimate is too high; nothing is appended in that case.
- `msb verify-auth [--config ...]` checks declared environment variables
  through the renderer adapter without submitting a generation request or
  printing credential values. `--config` defaults to the packaged
  [`msbc/default.msbc`](../msbc/default.msbc); use `msbc/mock.msbc` for a
  provider-free shoot.
- Archive reads reject absolute paths, traversal, links, duplicate entries,
  and oversized expansion; no path in any project file may resolve outside
  the project root. Credentials are read only from the environment.
  Automated tests use only the mock renderer and never submit paid requests.

## Reference: CLI

```text
msb create <folder> --draft <file>
msb ingest <folder>
msb animatic <folder> [-o <file>]
msb shoot <folder> [--config <engine.msbc>] [--dry-run] [--max-cost <usd>]
          [--concurrency <n>] [--fresh]
msb dailies <folder> [--json]
msb circle <folder> (--take <id> | --animatic) [--reject] [--notes <file>]
           [--text <text>] [--attach <file>...] [--by <name>]
msb note <folder> [--take <id> | --cut <id> [--span <a-b>] | --animatic]
         [--text <text>] [--notes <file>] [--attach <file>...] [--by <name>]
msb cut <folder> [--shoot <id>] [-o <file>]
msb latest <folder> [--json]
msb gc <folder> [--dry-run]
msb inspect <folder|config.msbc> [--json] [--findings] [--shot <id>] [--screenplay]
msb verify-auth [--config <config.msbc>] [--json]
msb pack <folder> [-o <file>] [--source-only]
```

Exit codes: `0` success, `2` usage, `3` validation, `4` credentials, `5` cost
limit.

## Example

[`examples/skit-poc`](../examples/skit-poc) — "Agent Autonomy Skit": three
explicitly framed knit sock puppets, one location, an 11-cue canonical
screenplay over 32 seconds, four boards, and a four-shot chained shot list
with an LTX prompt override.

[`examples/smoke-test`](../examples/smoke-test) and
[`examples/smoke-test-reference`](../examples/smoke-test-reference) —
provider-ready single-shot projects for testing engine configurations
(packed copies ship as `examples/*.msb`), see
[`msbc/README.md`](../msbc/README.md).
