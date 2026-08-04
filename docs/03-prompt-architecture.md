# Prompt Architecture

[`docs/01-quick-start.md`](01-quick-start.md) is the user-facing walkthrough of
*what* to run. This document specifies *how the pieces that drive an
autonomous run talk to each other* — prompts, scripts, humans, agents that can
and can't generate images, and the artifacts that flow between them — for
whoever implements or audits the orchestration layer in
[`scripts/prompts/`](../scripts/prompts/README.md).

## Design considerations and assumptions

These constrain every choice below; a change that violates one should be
treated as a design bug, not a detail to patch around.

1. **Author and Producer are role labels, not agent types.** Either can be a
   human or an AI agent, and which is which can differ step to step within
   one run. Nothing here may assume a specific implementation behind a role.
2. **No agent in this system is assumed to generate images.** Reading and
   judging an existing image (vision) and producing a new one (generation)
   are different capabilities that don't imply each other. Most agents
   capable of running `msb` and judging a storyboard — including the
   reference implementation, Claude — can do the former, not the latter.
   Image generation must always be reached through an explicit, swappable,
   external capability, never assumed inline.
3. **Packing enforces that every referenced asset already exists as a real
   file inside the source directory** (`loadManifestDirectory`,
   [`src/cli.ts`](../src/cli.ts)), and archive safety forbids any reference
   path from pointing outside that directory (`relativePath`,
   [`src/schema.ts`](../src/schema.ts); `safeName`,
   [`src/archive.ts`](../src/archive.ts)). There is no way to defer image
   creation past `pack`, and no way to source an image from outside the
   project's own source folder. Every image a shot needs must land inside
   that folder before `pack` runs.
4. **A prompt file's body is the single source of truth for its
   instruction; scripts only assemble context around it.** A script may read
   a prompt file and embed its body (frontmatter stripped) verbatim into a
   generated artifact —
   [`scripts/generate-storyboard-prompts.mjs`](../scripts/generate-storyboard-prompts.mjs)
   already does this for two files — but no script or other document may
   paraphrase or duplicate prompt text; the `.md` file is what changes when
   the instruction changes.
5. **Interim pipeline outputs (`.msb`, `.msbo`, `.mp4`) belong in the
   gitignored `build/` tree, never inside a tracked source folder.** This is
   already `.gitignore` policy and the CLI's own default
   (`build/<msb>-<msbc>/<timestamp>/` when `--out` is omitted); every prompt
   step that invokes `pack`/`render`/`export` must say so explicitly rather
   than leaving the destination to be guessed.
6. **Revision is not failure.** A review step sending work backward instead
   of approving it is the system working as designed, not an exception path
   ([`scripts/prompts/README.md`](../scripts/prompts/README.md) rule 7). Any
   mechanism here must make "send this back" as first-class as "approve."
7. **A clean handoff is one self-contained request in, one file at a known
   path out.** Whoever fulfills a request should need nothing beyond the
   request itself — no conversation history, no separate briefing, no access
   to the requester's own context.

## The entities

### Actors — things that make decisions or produce content

| Actor | Reads/judges artifacts | Writes text/JSON | Generates raster images | Runs `msb`/scripts |
|---|---|---|---|---|
| Human | yes | yes | yes (draws, photographs, or operates an image tool) | yes |
| Non-image-generating agent | yes | yes | **no** | yes |
| Image-generating agent | request only | no | yes | no |

A **non-image-generating agent** is any agent (the reference case is Claude)
that can read a screenplay, judge a storyboard, edit `msb.json`, and run the
`msb` CLI, but has no way to output new pixels. It can play Author fully. It
can play every mechanical part of Producer — pack, validate, chain, render,
export — but the one creative Producer duty it cannot discharge itself is
generating a reference image; it must delegate that, through the contract
below, to an **image-generating agent**: any capability, human or AI, whose
job is exactly "take this request, hand back one file at this path." Which
provider sits behind that role (a fal image model, another vendor's
generator, or a human with a camera) is deliberately unspecified — the
contract is provider-agnostic by design, matching
[the existing wording](01-quick-start.md) "generates *or sources*."

### Instruments — things that carry instructions or transform artifacts, but don't decide anything

- **Prompts** — the numbered files in [`scripts/prompts/`](../scripts/prompts/).
  Each starts with frontmatter (`step`, `role`) and then the literal
  instruction for that role's agent
  ([protocol](../scripts/prompts/README.md)). A prompt is inert text; it acts
  only once a human or agent reads and follows it.
- **Scripts** — deterministic code with no judgment of its own: the `msb`
  CLI subcommands ([`src/cli.ts`](../src/cli.ts)) and
  [`scripts/generate-storyboard-prompts.mjs`](../scripts/generate-storyboard-prompts.mjs).
  Scripts enforce schema and path-safety rules
  ([`src/schema.ts`](../src/schema.ts), [`src/archive.ts`](../src/archive.ts))
  and are the only entities trusted to do so; an agent proposing a manifest
  edit still has that edit checked by a script (`validate`, `pack`) before it
  can affect anything downstream.

### Artifacts — the data that flows between the above

Screenplay and shot list, entity/shot reference images, the reference-image
request plan, the packed bundle, the storyboard, the approval record, the
rendered bundle, the exported movie. Full lifecycle in the
[file-layout table](#artifact-lifecycle-and-file-layout) below.

## Interaction model

- **Human ↔ Prompt.** A human can read a numbered file directly and act on
  it; no orchestrator required.
- **Agent ↔ Prompt.** An orchestrator hands a numbered file's stripped body,
  verbatim, to whichever persistent agent is on-role for that step
  ([protocol](../scripts/prompts/README.md) rules 2–3). The agent is not
  shown the frontmatter — that's dispatch metadata, not instruction.
- **Script ↔ Prompt.** A script may read a prompt file and embed its body
  into a generated artifact for hashed provenance (assumption 4); prompts
  never read scripts.
- **Non-image agent ↔ image-generating agent.** The *only* sanctioned channel
  between them is the request/response contract below. A non-image agent
  must never ask an image-generating one to "read the screenplay and figure
  out what's needed" — it resolves everything itself and hands over a
  request that needs no further context (assumption 7).
- **Image-generating agent ↔ Artifact.** Writes exactly one raster file to
  the exact `outputPath` given in its request. Nothing else — no metadata
  sidecar, no acknowledgment message. The file's existence at that path *is*
  the response.
- **Author (human or agent) ↔ Artifact.** Reads and judges; never writes a
  raster itself. A rejection is expressed by invalidating the specific
  `outputPath`(s) at fault (delete the file, or — for a split — replace the
  shot(s) in `msb.json`), not by writing a status field anywhere. The next
  run of the request-plan generator sees exactly the missing/changed set
  with no separate approval ledger to keep in sync (ties directly to
  [revision loop-back](#revision-loop-back)).

## The reference-image request/response contract

**Status: proposed, not implemented.** This section specifies the fix for
the gap found auditing this architecture: nothing today lets a non-image
agent hand off image generation with a clean, self-contained request before
a bundle is packed.

**What already exists.**
[`generate-storyboard-prompts.mjs`](../scripts/generate-storyboard-prompts.mjs)
already computes exactly the right shape of request — a fully-rendered
`imagePrompt` per shot (identity constraints, action, camera, and continuity
all baked in from the manifest, no manual reconstruction needed) plus a
`suggestedReference` output path — and reads its instruction text from
[`02-producer-generate-reference-images.md`](../scripts/prompts/02-producer-generate-reference-images.md),
per assumption 4. But it only runs against an already-*packed* `.msb`
(`loadMsb` → `readArchive`), and `pack` refuses to run until those same
images already exist (assumption 3). That's the chicken-and-egg gap: the one
tool that hands out a clean image request can't run until the images it
would request already exist.

**The fix.** Let the same script's `<source>` argument be either a packed
`.msb` (today's behavior, unchanged) or a directory containing `msb.json`
(new). In directory mode:

- Read and validate `msb.json` directly with `msbManifestSchema` and
  `validateManifestSemantics` ([`src/schema.ts`](../src/schema.ts),
  [`src/render.ts`](../src/render.ts) — both already exported), skipping the
  archive read.
- Enumerate every path `referencedAssets(manifest)` returns
  ([`src/render.ts`](../src/render.ts) — already covers screenplay,
  character/location/prop `reference`, and every shot's
  `composition`/`identity`/`endFrame`) and `fs.stat` each one relative to the
  directory instead of looking it up in an archive entry map.
- Emit one request per path, `status: "present"` or `"missing"` based on that
  stat, instead of throwing on the first missing one the way `loadMsb` does
  today.
- A new `--require-complete` flag (directory mode only, distinct from
  today's `--check` — which dedupes reused *shot* references on an
  already-complete bundle and doesn't apply pre-pack) fails the command if
  anything is still `"missing"`, for a Producer step to gate on before moving
  to `pack`.

**Request shape** (one entry per required image):

```json
{
  "id": "scene-001-shot-002a",
  "role": "composition",
  "outputPath": "references/storyboard/scene-001-shot-002a.png",
  "status": "missing",
  "prompt": "<02's body, verbatim, plus the rendered entity/action/camera/continuity block — same construction generate-storyboard-prompts.mjs already does for shots today>",
  "promptHash": "<sha256 of prompt>",
  "identityAnchors": ["characters/agent-86.png", "characters/agent-99.png", "characters/agent-13.png", "locations/ai-control-center.png"]
}
```

`role` is one of `character-reference` / `location-reference` /
`prop-reference` (entity identity sheets) or `composition` / `identity` /
`endFrame` (shot references, matching
[`ReferenceRole`](../src/render.ts)). **Known gap:** only shot-composition
requests have a written instruction template today
([`02-producer-generate-reference-images.md`](../scripts/prompts/02-producer-generate-reference-images.md)).
Entity identity-sheet requests (character/location/prop) need an analogous
template — same identity-preservation rules, different framing (isolated
subject, neutral backdrop, no shot-specific action) — that doesn't exist yet.
Write it as its own numbered-adjacent prompt file when this is implemented;
don't invent its text here.

**Response.** The image-generating agent writes a file at
`<source-directory>/<outputPath>` in one of the accepted raster types
(`image/png`, `image/jpeg`, `image/webp`, `image/avif` —
`RASTER_MEDIA_TYPES`, [`src/render.ts`](../src/render.ts)). That's the entire
response; nothing else is read or expected.

## Artifact lifecycle and file layout

| Artifact | Produced by | Consumed by | Lives in | Mutability |
|---|---|---|---|---|
| Screenplay + shot list (`screenplay.md`, `msb.json` draft) | Author | Producer, review steps | Source folder | Mutable until packed |
| Entity/shot reference images (`characters/*.png`, `locations/*.png`, `references/**/*.png`) | Image-generating agent, via the contract above | Author (review), `msb pack` | Source folder | Replaceable at the same `outputPath` until packed; a rejection just means the file gets overwritten |
| Reference-image request plan | Script, from the raw manifest | Whichever agent fulfills a request | Anywhere (ephemeral) | Fully regenerable; never hand-edited, never worth committing |
| Packed bundle (`*.msb`) | Producer, `msb pack` | `validate`/`storyboard`/`render` | `build/`, or an explicit `--out` — **never inside a tracked source folder** (assumption 5) | Immutable |
| Storyboard (`*.msbo`, `kind: storyboard`) | Producer, `msb storyboard` | Author (review), `msb approve` | `build/` | Immutable; superseded by re-running, not edited |
| Approval record | Author, `msb approve` | Audit trail only — `msb render` does not check it | Embedded in-place in the storyboard `.msbo`'s `storyboard.approval` field | Immutable, hash-bound to the exact source |
| Rendered bundle (`*.msbo`, `kind: render`) | Producer, `msb render` | `msb export` | `build/` | Immutable; resumable/cached per shot |
| Exported movie (`*.mp4`) | Producer, `msb export` | End viewer | `build/`, or wherever delivered | Immutable |

The `examples/` fixtures in this repo are the one place this table's
"source folder" row and "never inside a tracked source folder" rule can be
violated by accident: gitignored pack/render/export output has previously
landed beside the tracked `examples/skit-poc/` source directory (moved into
`build/` as `skit-poc-paid.*` when this was found), easy to mistake for part
of the fixture even though it never was — `git ls-files examples/` only ever
tracked the source folder itself. Any prompt step that packs, renders, or
exports must name `build/` (or omit `--out` for the documented
gitignored default) explicitly, precisely to keep this from recurring.

## Revision loop-back

Already specified in
[`scripts/prompts/README.md`](../scripts/prompts/README.md) rule 7; this
document doesn't redefine it, only notes the mechanical hook it needs: a
review step's "send back" outcome should read as "these `outputPath`s are
now invalid" (assumption 6, and the Author-artifact interaction above), so
that re-running the request-plan generator is sufficient to see what still
needs work — no separate approval-state store to keep consistent with the
files on disk.

## Status summary

| Piece | Status |
|---|---|
| Numbered prompts, two-role dispatch, loop-back protocol | Implemented ([`scripts/prompts/`](../scripts/prompts/README.md)) |
| Shot-composition request generation, post-pack | Implemented (`generate-storyboard-prompts.mjs` against a packed `.msb`) |
| Shot-composition request generation, pre-pack (directory mode, `--require-complete`) | Proposed |
| Entity identity-sheet request generation (character/location/prop) | Proposed; template text not yet written |
| `build/`-only output enforcement in pack/render/export prompt steps | Proposed |

## Audit checklist

- Every numbered prompt file has `step`/`role` frontmatter and is discoverable by sorting on either (`scripts/prompts/README.md` rule 1).
- No script's source contains prompt instruction text that doesn't also exist, verbatim, in a `scripts/prompts/*.md` file (assumption 4).
- No image-generating agent's request in an implementation is missing `outputPath`, `prompt`, or `identityAnchors` — a request an image-generating agent can't act on without asking a follow-up question is not a clean handoff (assumption 7).
- No `references/**` path in any `msb.json`, committed or generated, resolves outside its own source directory (assumption 3 — already enforced by `relativePath`/`safeName`, but worth spot-checking new manifests).
- No prompt step that runs `pack`/`render`/`export`/`make` omits an explicit `build/`-rooted `--out`, or documents relying on the gitignored default (assumption 5).
- Every review step's rejection path names which `outputPath`(s) or manifest entries are invalidated, not just that something is "wrong" (assumption 6/7).
