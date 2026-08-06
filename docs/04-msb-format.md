# MSB Format v2: The Project Folder

**Status: proposed design for [#13](https://github.com/TheSwanFactory/movie-source-builder/issues/13). Nothing here is implemented.**

This document redesigns the `msb`/`msbo` formats around the direction chosen
in #13's discussion: not a patch to the current archive-in, archive-out
pipeline, but a restart. A project is **one folder** that contains the
script, its reference images, the shot lists that divide it into renderable
shots, and every take ever rendered for it — as an append-only, write-once,
inspectable ledger. The single-file archive survives only as a transport
optimization.

There is **no migration and no backward compatibility**: v2 replaces v1
outright. Exactly one real project exists
([`examples/skit-poc`](../examples/skit-poc)), and it gets restructured by
hand; no compatibility code is written or promised.

[`docs/01-quick-start.md`](01-quick-start.md) and
[`docs/03-prompt-architecture.md`](03-prompt-architecture.md) describe the
current (v1) formats; where this design contradicts them, this document is
the intended future and they are the present. The
[impact section](#impact-on-v1-assumptions-and-commands) lists every such
contradiction explicitly.

## Why start over

The v1 pipeline models rendering as a clean, linear, one-way flow:

```text
source folder → pack → .msb → render → .msbo (or throw) → export → .mp4
```

A render's scratch `work` directory is either promoted into the final `.msbo`
on success or left as debris on failure. There is no durable place for the
messy, iterative reality of getting a shot to actually work. The #11 chain
session made the cost concrete:

- $2.40 of failed LTX attempts whose frames were deleted before, or without
  ever, being inspected.
- A real engine-compatibility fact — Veo 3.1 Fast `image-to-video` only
  accepts 6s/8s durations, so it can never render that manifest's 10s
  shots — discovered live, recorded nowhere but a chat transcript.
- A content-fidelity defect (LTX rendering 6 puppets with duplicate badges
  against a `continuity` that specifies exactly 3) whose diagnosis exists
  only in conversation, indistinguishable afterward from a stylistic quibble.

The v1 formats cannot hold any of that, because they were designed around
"one clean attempt, then discard." The three candidate directions in #13 —
retain failed-attempt evidence, track cross-engine compatibility, or unify
both as an append-only attempt ledger — converge once the format itself is a
folder: **evidence retention is just "don't delete the file," and
compatibility knowledge is just "query the ledger."** This design adopts the
unified-history direction (option 3), reframed by the folder-first reset from
#13's discussion.

## Terminology

Film and VFX production already has this vocabulary, and it fits almost
perfectly, so the format uses it instead of inventing its own:

| Term | Meaning here | Provenance |
| --- | --- | --- |
| **script** | the human-authored screenplay text | screenwriting |
| **model sheet** | isolated, neutral-backdrop identity reference for a character/location/prop | animation |
| **board** | a reference still anchored to a moment in the script | storyboarding |
| **shot list** | a versioned division of the script into scenes and shots, with references and prompts | production |
| **shoot** | one renderer invocation against one shot list with one engine | production |
| **take** | one rendered attempt at one shot | on-set; ≈ a "Version" in ShotGrid/ftrack pipelines |
| **dailies** | a review session that records verdicts on takes | post-production |
| **circled take** | a take a reviewer has marked as the keeper | on-set ("circle takes") |
| **animatic** | the zero-cost review movie assembled from boards | animation; replaces v1 "storyboard `.msbo`" |
| **cut** | a deliverable movie assembled from circled takes | editorial; replaces v1 "export" |

The whole retention model in one sentence of that vocabulary: *takes survive
the shoot, dailies happen whenever, circling picks the keeper, the cut
assembles circled takes, and nothing is struck without an explicit decision.*

## Design principles

These play the same role as the design considerations in
[`03-prompt-architecture.md`](03-prompt-architecture.md): a change that
violates one is a design bug, not a detail.

1. **A project is a single folder, containing both source and output.** The
   script, references, shot lists, takes, shoots, dailies, and cuts all live
   under one root. There is no separate build tree holding the only copy of
   anything worth keeping.
2. **The archive is a format optimization, not the format.** A `.msb` file is
   a packed snapshot of (part of) the folder, produced for transport or
   pinning. Every operation works against the folder directly; nothing may
   exist only inside an archive.
3. **Every file is write-once.** Shoots and dailies append new JSON files;
   takes and their media are immutable once written; shot lists are immutable
   once any shoot cites them (editing means writing the next version). No
   file in the folder is ever modified — only added.
4. **A shoot is a link object, not a container.** A shoot is one JSON file
   that *points to* its source (shot list + engine, by hash), the takes it
   reused from earlier shoots, and the new takes it produced. Media is never
   copied between shoots, and a shoot that produced nothing — a failed plan,
   an all-cache-hits rerun — is still a real, cheap ledger entry.
5. **The folder is shallow.** Maximum depth is two levels (`takes/…`,
   `references/…`); structure that v1 expressed as nested directories is
   expressed here as filename convention plus JSON links.
6. **"Latest" is computable, and garbage collection is a choice.** Any script
   can determine the latest shot list, latest complete shoot, and each shot's
   current take from folder contents alone — ordinal filenames, no symlinks,
   no database. Deleting obsolete media is something a script *chooses* to
   do, explicitly, under stated rules — never a side effect of rendering.
7. **Everything machine-read is schema-validated and hash-linked**, exactly
   as v1 already does for archives ([`src/schema.ts`](../src/schema.ts),
   [`src/archive.ts`](../src/archive.ts)): safe relative paths only, nothing
   resolving outside the project root, content hashes wherever one artifact
   cites another.

## Folder layout

```text
my-project/                       # the project folder IS the msb
├── msb.json                      # header: format version, project id/title, cast of entities
├── script.md                     # the script: the creative text itself
├── references/                   # flat: model sheets and boards
│   ├── references.json           # index: kind, subjects, time anchor, provenance
│   ├── agent-86.png              # model sheet (timeless)
│   └── t0016.0-agents-turn.png   # board, anchored at 16.0s into the script
├── shotlists/
│   ├── 001.json                  # immutable once any shoot cites it
│   └── 002.json
├── takes/                        # flat media pool, one file set per take
│   ├── shot-001.t01.mp4
│   ├── shot-001.t01.last.png     # extracted last frame (chaining + evidence)
│   ├── shot-001.t01.notes.md     # reviewer/agent diagnosis, when one exists
│   └── shot-001.t02.mp4
├── shoots/                       # append-only ledger, one JSON per shoot
│   ├── 0001-ltx.json
│   └── 0002-hailuo.json
├── dailies/                      # append-only review ledger
│   └── 0001.json
└── cuts/
    ├── animatic-002.mp4          # zero-cost board assembly for shot list 002
    └── 0002-hailuo.mp4           # deliverable cut of shoot 0002
```

### The script

`script.md` is the screenplay: the human-authored creative source, in
whatever prose form is natural. It is the one file the Author owns outright.
It is not machine-parsed; everything downstream that needs machine-readable
structure (timing, shot boundaries, dialogue events) gets it from a shot
list.

### References: model sheets and boards

`references/` is flat and holds every raster the project uses, in two kinds:

- **Model sheets** — timeless: one isolated, neutral-backdrop sheet per
  character/location/prop (v1's `characters/`/`locations/` images).
- **Boards** — anchored to a moment in the script, named
  `t<seconds, zero-padded>-<slug>.png` (e.g.
  `t0016.0-agents-turn.png`). These replace v1's per-shot composition
  references.

The time anchor is organizational metadata for humans and provenance — it
sorts a listing into story order and records *what moment this image
depicts*. It is **not** a resolution mechanism: shot lists point to specific
files explicitly, never "whichever board is nearest my start time."

`references/references.json` indexes each image: `kind`
(`model-sheet`/`board`), subject entity ids, optional time anchor, and
provenance (which prompt/agent produced it, per the request/response
contract in
[`03-prompt-architecture.md`](03-prompt-architecture.md#the-reference-image-requestresponse-contract)).

### Shot lists

A **shot list** divides the script into scenes and shots, points each shot at
specific references, and carries the render prompts — including
renderer-tuned variants. It is the machine-readable heart of the format,
replacing v1's `msb.json` `shots[]` array. Versions are zero-padded ordinals
(lexicographic order = version order), immutable once any shoot cites them.

```json
{
  "formatVersion": "2.0.0",
  "shotlist": {
    "id": "002",
    "supersedes": "001",
    "createdAt": "2026-08-05T03:10:00Z",
    "note": "split shot-002 into 002a/002b after animatic review"
  },
  "scenes": [
    {
      "id": "scene-001",
      "shots": [
        {
          "id": "shot-001",
          "duration": 10,
          "characters": ["agent-86", "agent-99", "agent-13"],
          "location": "control-center",
          "dialogue": [
            { "character": "agent-86", "text": "Would you believe…", "start": 1.0, "end": 4.0 }
          ],
          "action": "The three puppets address the control room.",
          "camera": "Locked medium three-shot.",
          "references": {
            "composition": "references/t0000.0-control-room.png",
            "identity": []
          },
          "continuity": [
            "EXACTLY three puppets, no more",
            "Agent 86 remains red with badge 86 on camera left"
          ],
          "prompts": {
            "default": null,
            "fal/ltx-2.3-fast": "Exactly three sock puppets — never add background puppets…"
          },
          "chainFrom": null
        }
      ]
    }
  ]
}
```

Shot fields keep their v1 semantics
([`msbManifestSchema`](../src/schema.ts)) with two additions:

- `prompts` — per-engine prompt overrides. `default: null` means "derive the
  prompt from action/camera/continuity as today"; a keyed entry replaces the
  derived prompt for that engine only. This is where "LTX needs to be told,
  forcefully, not to hallucinate extra puppets" lives — versioned with the
  shot list instead of lost in a chat.
- Reference paths point into `references/`, under the same
  safe-relative-path rules as v1.

Engine configuration (`.msbc`) is **unchanged**: it stays a
content-independent file outside the project folder. Every shoot snapshots
the resolved configuration it actually used, so the folder stays
self-explanatory even when the `.msbc` later changes.

### Takes

A **take** is one rendered attempt at one shot. Takes live in the flat
`takes/` pool, named `<shot-id>.t<NN>.<what>`; take numbers are per-shot
monotonic across all shoots (like a slate: shoot 0003 rendering shot-001 for
the third time overall writes `shot-001.t03.*`). A take is at most three
files — media, extracted last frame, and (once someone judges it) notes:

```text
takes/shot-001.t03.mp4
takes/shot-001.t03.last.png
takes/shot-001.t03.notes.md
```

Take *metadata* (cost, request id, chain score, error) lives in the shoot
that created it, so the pool holds only content. `msb inspect --shot
shot-001` joins the pool against the shoot ledger to show every take of a
shot across all engines — the exact "let me look at what actually happened"
query #13 found impossible.

The v1 concept of a disposable `--work-dir` is gone: the pool *is* where
render output lands, failed and succeeded alike, and it is part of the
format.

### Shoots: the first-class run object

A **shoot** is one invocation of the renderer against one shot list with one
engine configuration — and, answering #13's follow-up question directly: yes,
it is a first-class object, and it is *just JSON*. A shoot owns no media. It
links three things: **source** (shot list + engine, by hash), **reused
inputs** (takes from earlier shoots whose cache keys still match), and **new
outputs** (takes it rendered into the pool). Filenames are
`<zero-padded ordinal>-<engine slug>.json`, so lexicographic order is
creation order.

```json
{
  "formatVersion": "2.0.0",
  "shoot": {
    "id": "0002-hailuo",
    "createdAt": "2026-08-05T04:02:11Z",
    "status": "complete"
  },
  "shotlist": { "id": "002", "hash": "sha256-…" },
  "engine": {
    "configName": "fal-hailuo-02-standard",
    "hash": "sha256-…",
    "resolved": { "provider": "fal", "model": "hailuo-02-standard", "mode": "image-to-video" }
  },
  "tool": { "name": "movie-source-builder", "version": "0.7.0" },
  "costs": { "estimated": 1.86, "actual": 0.62 },
  "reused": [
    { "shot": "shot-001", "take": "shot-001.t02", "from": "0001-ltx", "mediaHash": "sha256-…" }
  ],
  "takes": [
    {
      "shot": "shot-002",
      "take": "shot-002.t03",
      "status": "rendered",
      "media": "takes/shot-002.t03.mp4",
      "mediaHash": "sha256-…",
      "lastFrame": "takes/shot-002.t03.last.png",
      "chainScore": 0.91,
      "requestId": "fal-…",
      "cost": 0.62,
      "error": null
    }
  ],
  "findings": [
    {
      "scope": "engine-compatibility",
      "engine": "fal/veo-3.1-fast image-to-video",
      "claim": "supports only 6s/8s durations; shot list 002 has 10s shots",
      "evidence": "plan validation error, verbatim",
      "appliesTo": ["shot-001", "shot-004"]
    }
  ],
  "warnings": []
}
```

What the pure-link shape buys:

- **Zero-copy reuse.** v1's per-shot cache reuse becomes an explicit,
  auditable `reused` link (cache keys — shot definition + engine + asset
  hashes — decide reuse exactly as today). A cut can honestly say "this
  contains takes from shoots 0001 and 0002."
- **Failed plans are first-class evidence.** The Veo duration rejection is a
  complete shoot: `status: "failed"`, zero takes, zero cost, one structured
  finding. Tonight that fact lived in a chat transcript; here it is a
  36-line JSON file any future session finds before spending money.
- **Garbage collection becomes reference counting over JSON.** A take's media
  is reclaimable exactly when no retained shoot links it (rules below) — no
  directory archaeology.
- **Findings are queried, not curated.** `msb inspect <folder> --findings`
  aggregates across all shoots, so cross-engine compatibility knowledge
  (#13 direction 2) falls out of the ledger (#13 direction 3) instead of
  being a second bookkeeping system to keep consistent.

### Dailies: the review ledger

Rendering and judging are different events, often far apart — #13's core
lesson is that the judgment ("6 puppets, duplicate badges — violates the
shot's own continuity, not a style difference") must outlive the moment it
happened. Since takes and shoots are write-once, verdicts get their own
append-only ledger: `dailies/<ordinal>.json`, one file per review session.

```json
{
  "formatVersion": "2.0.0",
  "dailies": { "id": "0001", "at": "2026-08-05T04:20:00Z", "by": "author" },
  "verdicts": [
    { "take": "shot-001.t01", "verdict": "rejected", "notes": "takes/shot-001.t01.notes.md" },
    { "take": "shot-001.t02", "verdict": "circled" }
  ]
}
```

A take's current standing is the latest verdict across all dailies:
**circled** (the keeper for its shot), **rejected**, or unreviewed. An
engine-successful take that fails human review — the 6-puppet case — is
`rendered` in its shoot and `rejected` in dailies, with the reasoning in
`notes.md` sitting beside the exact frames it describes. v1's `msb approve`
becomes a circled verdict (dailies entries are hash-implicating via the take
they name; the take's shoot pins the shot list and engine).

### Cuts

A **cut** assembles one movie from the pool: for each shot in the shot list,
the circled take if one exists, else the newest `rendered`, never-rejected
take. A shot with only rejected or failed takes fails the cut with a message
naming it. Cuts are named for the shoot (or shot list) they realize:
`cuts/0002-hailuo.mp4`. Like v1 `export`, cutting verifies hashes and never
contacts a provider.

The **animatic** is a cut too — assembled from the shot list's boards and
timing with zero network requests (v1's storyboard `.msbo`, renamed to the
standard term and demoted from a separate artifact kind to a deterministic,
regenerable cut: `cuts/animatic-<shotlist>.mp4`). Review verdicts on an
animatic are ordinary dailies entries.

## Latest, retention, and garbage collection

**Latest shot list** — highest ordinal in `shotlists/`. **Latest shoot** —
highest-ordinal shoot with `status: "complete"` (every shot resolved to a
reused or newly rendered take). **Current take per shot** — the cut rule
above. All three are computable from filenames plus JSON, no symlinks, no
database; `msb latest <folder>` prints them.

**Retention policy (what a producer should expect to find).** By default,
*everything is retained indefinitely*: every take's media and last frame,
every shoot, every dailies verdict, every finding. Rendering never deletes
anything. The folder grows with use — that is the point, and the explicit
reversal of v1's lean/throwaway model.

**Garbage collection is opt-in and rule-bound.** `msb gc <folder>` deletes
*take media only* (`.mp4`) — never ledger JSON, notes, or last frames (small,
and they are the chaining/diagnosis evidence). Reclaimable takes are those
that are rejected, or neither circled nor the newest take of their shot nor
linked (as `reused` or new) by the latest complete shoot. `--dry-run` first,
always. After `gc`, the record *that* a take happened, what it cost, its last
frame, and why it was rejected always survive — only the video bytes go.

**Version control.** The folder is git-friendly in layers: everything except
take media and cut movies is small, diffable text worth tracking; the
scaffolded folder ships a `.gitignore` covering `takes/*.mp4` and `cuts/`.
This replaces v1's blanket "outputs never live inside a tracked source
folder" rule — see the impact section below.

## How this answers #13's concrete losses

| #13 loss | v2 mechanism |
| --- | --- |
| Failed LTX frames deleted before/without inspection | Takes land in the durable pool; nothing deletes media but explicit `gc`, which always spares last frames, notes, and the ledger |
| Veo 6s/8s incompatibility known only in a chat transcript | A `failed` shoot with zero takes and one structured `finding`; surfaced by `msb inspect --findings` |
| "6 puppets" defect vs. "engine style difference" distinction lost | `rendered` in the shoot, `rejected` in dailies, reasoning in `notes.md` beside the frames it judges |
| Retry attempts never inspected | Each retry is its own numbered take, reviewable in any later dailies session |
| No way to see history via the CLI | `msb inspect` reports shot lists, shoots, takes, verdicts, findings — `--shot` shows one shot's full history across engines |
| What is retained, for how long | Stated plainly above: everything, indefinitely, unless a human runs `gc` |

## Tradeoffs against the v1 lean model

Made explicit, per #13's acceptance criteria:

- **Retained bytes.** The pool accumulates every take's video. At the #11
  session's scale that is tens to hundreds of MB per exploratory evening —
  real, but small against the dollars the evidence protects, and reclaimable
  via `gc` without losing the ledger.
- **Format complexity.** Five small schemas (header, references index, shot
  list, shoot, dailies) replace two larger ones (`msb.json`, `.msbo`). The
  offsetting simplification is larger: `--work-dir`/`--keep-work-dir`, the
  promote-or-discard dance, the storyboard/render `.msbo` split, the embedded
  approval record, and all migration/compat machinery (there is none) go
  away, and every remaining file is write-once.
- **No migration.** v1 files stop being readable. Accepted deliberately:
  pre-1.0 tool, one project, migrated by hand.

## Impact on v1 assumptions and commands

- **Revises [`03-prompt-architecture.md`](03-prompt-architecture.md)
  assumption 5** ("interim outputs belong in gitignored `build/`, never
  inside a tracked source folder"). In v2, outputs live *inside* the project
  folder by design; the gitignore boundary moves from "the whole build tree"
  to "take media and cuts." The rationale that assumption protected — never
  let generated debris masquerade as creative source — is preserved
  structurally: source and output are distinct, named, top-level parts of
  one folder.
- **Revises assumption 3's timing** (every referenced asset must exist before
  `pack`): validation moves from pack-time to shoot-plan-time, since packing
  is optional. The rule itself — every shot-list-referenced path must exist
  inside the folder, nothing escapes the root — is unchanged.
- **CLI shape** (sketch, not final): `msb shoot <folder> --config
<engine.msbc>` appends a shoot and its takes; `msb animatic <folder>`
  assembles the board cut; `msb dailies <folder>` lists unreviewed takes and
  `msb circle <folder> --take shot-001.t02 [--notes <file>]` /
  `--reject` append verdicts; `msb cut <folder>` assembles the deliverable;
  `msb latest`, `msb gc --dry-run`, `msb inspect [--findings|--shot <id>]`
  as described above; `msb pack <folder> [--source-only]` emits the optional
  transport archive. Exit codes and cost/safety controls (`--dry-run`,
  `--max-cost`, credential handling, mock engine) carry over unchanged.
- **The prompt/orchestration layer** (`scripts/prompts/`) keeps its
  request/response contract verbatim; Producer steps change output
  destinations from `build/…` paths to the project folder, and their command
  names per the sketch above.

## Open questions

1. **Single-writer assumption.** Ordinal shoot ids and per-shot take numbers
   assume one writer per folder. Two simultaneous shoots need advisory
   locking or collision-safe allocation before this ships.
2. **Dailies ledger vs. sidecar verdicts.** A separate `dailies/` ledger
   keeps every file write-once; the alternative (verdict frontmatter inside
   `notes.md`) is one less concept but makes takes mutable. This design
   chooses the ledger — worth revisiting if it proves heavy in practice.
3. **Does the script need machine-readable time markers?** Today the shot
   list is the sole timing authority; boards' time anchors are informal. If
   dialogue timing and board anchors should both refer to one canonical
   timeline, a lightweight timestamp convention inside `script.md` may be
   worth specifying — or may be needless coupling.
4. **Should circling gate the cut?** The cut rule already prefers circled
   takes and refuses rejected ones; whether an entirely-unreviewed shoot may
   be cut at all (v1's `approve` deliberately gated nothing) is undecided.
5. **Findings vocabulary.** `scope: engine-compatibility | content-fidelity`
   covers the known cases; further scopes should emerge from use, not be
   enumerated now.
6. **Where renderer-tuned prompts end and engine config begins.** `prompts`
   keyed by engine slug lives in the shot list (creative content); if
   per-engine *parameters* (guidance scale, seeds) turn out to matter, they
   may belong in the `.msbc` — draw the line once a second real case exists.
