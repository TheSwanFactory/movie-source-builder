# Prompt Architecture

[`docs/01-quick-start.md`](01-quick-start.md) is the user-facing walkthrough of
_what_ to run. This document specifies _how the pieces that drive an
autonomous run talk to each other_ — prompts, scripts, humans, agents that can
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
   capable of running `msb` and judging an animatic — including the
   reference implementation, Claude — can do the former, not the latter.
   Image generation must always be reached through an explicit, swappable,
   external capability, never assumed inline.
3. **Validation runs at the earliest moment it can**: `msb ingest` gates
   the canonical screenplay, cast, and references index (`ingestProject`,
   [`src/project.ts`](../src/project.ts)), and shoot planning enforces that
   every asset a shot references exists as a real file inside the project
   folder before credentials, pricing, upload, or generation
   (`planShoot`, [`src/shoot.ts`](../src/shoot.ts)). Path safety forbids any
   reference from resolving outside the project root (`relativePath`,
   [`src/schema.ts`](../src/schema.ts); `resolveInside`,
   [`src/project.ts`](../src/project.ts); `safeName`,
   [`src/archive.ts`](../src/archive.ts)). Every image a shot needs must
   land inside the folder before a shoot runs.
4. **A prompt file's body is the single source of truth for its
   instruction; scripts only assemble context around it.** A script may read
   a prompt file and embed its body (frontmatter stripped) verbatim into a
   generated artifact —
   [`scripts/generate-storyboard-prompts.mjs`](../scripts/generate-storyboard-prompts.mjs)
   already does this for two files (the model-sheet and board templates) —
   but no script or other document may paraphrase or duplicate prompt text;
   the `.md` file is what changes when the instruction changes.
5. **Outputs live inside the project folder by design** (v2 revised the old
   "never inside a tracked source folder" rule — see the
   [impact section](04-msb-format.md#impact-on-v1-assumptions-and-commands)).
   Source and output are distinct, named, top-level parts of one folder:
   takes land in `takes/`, cuts in `cuts/`, and the scaffolded `.gitignore`
   keeps the large regenerable binaries (`takes/*.mp4`, `cuts/`) out of
   version control while everything else stays small, diffable text.
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

| Actor                      | Reads/judges artifacts | Writes text/JSON | Generates raster images                             | Runs `msb`/scripts |
| -------------------------- | ---------------------- | ---------------- | --------------------------------------------------- | ------------------ |
| Human                      | yes                    | yes              | yes (draws, photographs, or operates an image tool) | yes                |
| Non-image-generating agent | yes                    | yes              | **no**                                              | yes                |
| Image-generating agent     | request only           | no               | yes                                                 | no                 |

A **non-image-generating agent** is any agent (the reference case is Claude)
that can read a screenplay, judge an animatic, canonicalize a draft into
`screenplay.json`, author a shot list, and run the `msb` CLI, but has no way
to output new pixels. It can play Author fully. It can play every part of
Producer — create, canonicalize, ingest, shoot, review bookkeeping, cut —
including the canonicalization judgment step
([`scripts/prompts/02-producer-canonicalize-screenplay.md`](../scripts/prompts/02-producer-canonicalize-screenplay.md)),
but the one creative Producer duty it cannot discharge itself is
generating a reference image; it must delegate that, through the contract
below, to an **image-generating agent**: any capability, human or AI, whose
job is exactly "take this request, hand back one file at this path." Which
provider sits behind that role (a fal image model, another vendor's
generator, or a human with a camera) is deliberately unspecified — the
contract is provider-agnostic by design, matching
[the existing wording](01-quick-start.md) "generates _or sources_."

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

The draft and canonical screenplays, model sheets and boards (with their
index), shot lists, the reference-image request plan, takes, shoots,
dailies, the animatic, cuts, and the optional transport archive. Full
lifecycle in the [file-layout table](#artifact-lifecycle-and-file-layout)
below.

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
- **Non-image agent ↔ image-generating agent.** The _only_ sanctioned channel
  between them is the request/response contract below. A non-image agent
  must never ask an image-generating one to "read the screenplay and figure
  out what's needed" — it resolves everything itself and hands over a
  request that needs no further context (assumption 7).
- **Image-generating agent ↔ Artifact.** Writes exactly one raster file to
  the exact `outputPath` given in its request. Nothing else — no metadata
  sidecar, no acknowledgment message. The file's existence at that path _is_
  the response.
- **Author (human or agent) ↔ Artifact.** Reads and judges; never writes a
  raster itself. A rejection of a reference image is expressed by
  invalidating the specific `outputPath`(s) at fault (delete the file, or
  revise the shot in the next shot-list version), so the next run of the
  request-plan generator sees exactly the missing/changed set. A rejection
  of a _take_ is different — takes are write-once, so the verdict is an
  appended dailies entry (`msb circle --reject`), never a deletion (ties
  directly to [revision loop-back](#revision-loop-back)).

## The reference-image request/response contract

**Status: implemented.** The contract itself is unchanged from v1; v2 only
changed where the requests come from and where the responses land.

[`generate-storyboard-prompts.mjs`](../scripts/generate-storyboard-prompts.mjs)
runs against a **project folder** and computes exactly the right shape of
request — a fully-rendered prompt per image (identity constraints, action,
camera, continuity, and the screenplay cues in the shot's span all baked in,
no manual reconstruction needed) plus the output path — reading its
instruction text from
[`04-producer-generate-model-sheets.md`](../scripts/prompts/04-producer-generate-model-sheets.md)
and
[`05-producer-generate-boards.md`](../scripts/prompts/05-producer-generate-boards.md),
per assumption 4. It:

- Reads and validates `msb.json` and `screenplay.json` with the real
  loaders ([`src/project.ts`](../src/project.ts)) — deliberately _without_
  requiring the reference images to exist yet, since requesting them is its
  whole job.
- Emits one request per cast member's `modelSheet`, and — once a shot list
  exists — per shot `composition`/`identity`/`endFrame` reference, each
  `status: "present"` or `"missing"` from an `fs.stat`.
- A `--require-complete` flag fails the command if anything is still
  `"missing"`, for a Producer step to gate on before shooting.

**Request shape** (one entry per referenced asset):

```json
{
  "id": "shot-002",
  "role": "composition",
  "outputPath": "references/t0010.0-triumph.png",
  "status": "missing",
  "prompt": "<05's body, verbatim, plus the rendered entity/action/camera/continuity/cues block>",
  "promptHash": "<sha256 of prompt>",
  "identityAnchors": [
    "references/agent-86.png",
    "references/agent-99.png",
    "references/agent-13.png",
    "references/ai-control-center.png"
  ]
}
```

`role` is `model-sheet` (cast identity sheets, using
[`04-producer-generate-model-sheets.md`](../scripts/prompts/04-producer-generate-model-sheets.md))
or `composition` / `identity` / `endFrame` (shot references, matching
[`ReferenceRole`](../src/render.ts), using
[`05-producer-generate-boards.md`](../scripts/prompts/05-producer-generate-boards.md)).
Model-sheet requests carry an empty `identityAnchors`: they are themselves
the identity anchor, not something anchored to another image.

**Response.** The image-generating agent writes a file at
`<project-folder>/<outputPath>` in one of the accepted raster types
(`image/png`, `image/jpeg`, `image/webp`, `image/avif` —
`RASTER_MEDIA_TYPES`, [`src/render.ts`](../src/render.ts)). That's the entire
response; nothing else is read or expected.

## Artifact lifecycle and file layout

| Artifact                                                      | Produced by                                    | Consumed by                                                           | Lives in                    | Mutability                                                           |
| ------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| Draft screenplay (`drafts/*`)                                 | Author                                         | Producer (canonicalization), audit                                    | `drafts/`                   | Append-only; a revision is a new file, never an edit                 |
| Canonical screenplay (`screenplay.json`)                      | Producer (judgment), gated by `msb ingest`     | Everything downstream; Author confirms via `msb inspect --screenplay` | Project root                | Working set: evolves in place under version control                  |
| Model sheets + boards (`references/*.png`, `references.json`) | Image-generating agent, via the contract above | Author (review), animatic, shot lists, shoots                         | `references/`               | Replaceable at the same `outputPath` until a shoot pins their hashes |
| Reference-image request plan                                  | Script, from the project folder                | Whichever agent fulfills a request                                    | Anywhere (ephemeral)        | Fully regenerable; never hand-edited, never worth committing         |
| Shot list (`shotlists/NNN.json`)                              | Producer                                       | `msb shoot`, `msb cut`                                                | `shotlists/`                | Immutable once any shoot cites it; editing means the next version    |
| Takes (`takes/<shot>.tNN.*`)                                  | `msb shoot`                                    | Dailies review, `msb cut`, chaining                                   | `takes/`                    | Write-once; only explicit `msb gc` ever deletes media                |
| Shoot (`shoots/NNNN-<engine>.json`)                           | `msb shoot`                                    | `msb inspect`, `msb cut`, reuse, `msb gc`                             | `shoots/`                   | Append-only ledger                                                   |
| Dailies observations (`dailies/NNNN.json` + `dailies/NNNN/`)  | Author/agent, `msb note` / `msb circle`        | `msb cut`, `msb gc`, `msb dailies`                                    | `dailies/`                  | Append-only ledger; latest verdict per take wins                     |
| Animatic (`cuts/animatic.mp4`)                                | `msb animatic`                                 | Author (review)                                                       | `cuts/`                     | Deterministic, regenerable                                           |
| Cut (`cuts/<shoot>.mp4`)                                      | `msb cut`                                      | End viewer                                                            | `cuts/`                     | Regenerable from the pool                                            |
| Transport archive (`*.msb`)                                   | `msb pack [--source-only]`                     | Shipping, pinning                                                     | Anywhere outside the folder | Immutable snapshot; never the only copy of anything                  |

Outputs live inside the project folder by design (assumption 5): the
scaffolded `.gitignore` covers `takes/*.mp4` and `cuts/`, so tracked source
and regenerable binaries stay structurally distinct without a separate
`build/` tree.

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

| Piece                                                                    | Status                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Numbered prompts, two-role dispatch, loop-back protocol                  | Implemented ([`scripts/prompts/`](../scripts/prompts/README.md))                                                    |
| Producer canonicalization step (draft → `screenplay.json`, `msb ingest`) | Implemented ([`02-producer-canonicalize-screenplay.md`](../scripts/prompts/02-producer-canonicalize-screenplay.md)) |
| Model-sheet request generation (cast)                                    | Implemented ([`04-producer-generate-model-sheets.md`](../scripts/prompts/04-producer-generate-model-sheets.md))     |
| Board / shot-reference request generation (`--require-complete` gate)    | Implemented (`generate-storyboard-prompts.mjs` against a project folder)                                            |

## Audit checklist

- Every numbered prompt file has `step`/`role` frontmatter and is discoverable by sorting on either (`scripts/prompts/README.md` rule 1).
- No script's source contains prompt instruction text that doesn't also exist, verbatim, in a `scripts/prompts/*.md` file (assumption 4).
- No image-generating agent's request in an implementation is missing `outputPath`, `prompt`, or `identityAnchors` — a request an image-generating agent can't act on without asking a follow-up question is not a clean handoff (assumption 7).
- No `references/**` path in any project file, committed or generated, resolves outside the project root (assumption 3 — already enforced by `relativePath`/`resolveInside`/`safeName`, but worth spot-checking new projects).
- Every review step's rejection path names which `outputPath`(s), shots, or takes are invalidated, not just that something is "wrong" (assumption 6/7).
