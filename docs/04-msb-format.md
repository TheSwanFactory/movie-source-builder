# MSB Format v2: The Project Folder

**Status: implemented (v0.7.0), resolving [#13](https://github.com/TheSwanFactory/movie-source-builder/issues/13).**

This document is the design of the v2 format, which replaced the v1
archive-in, archive-out pipeline around the direction chosen in #13's
discussion: not a patch, but a restart. A project is **one folder** that contains the
screenplay, its reference images, the shot lists that divide it into
renderable shots, and every take ever rendered for it — as an append-only,
inspectable ledger. The single-file archive survives only as a transport
optimization.

A project begins with the author's screenplay **in whatever name and format
they wrote it**; creating the project copies that draft in verbatim, a
Producer canonicalizes it into the one machine-readable form the rest of the
format hangs off, and ingest validation gates the result. Everything
downstream — boards, shot lists, shoots, cuts — anchors to the canonical
screenplay's timeline.

There is **no migration and no backward compatibility**: v2 replaced v1
outright. Exactly one real project existed
([`examples/skit-poc`](../examples/skit-poc)), and it was restructured by
hand; no compatibility code is written or promised.

[`docs/01-quick-start.md`](01-quick-start.md) and
[`docs/03-prompt-architecture.md`](03-prompt-architecture.md) now describe
the v2 formats this document specified. The
[impact section](#impact-on-v1-assumptions-and-commands) records every place
the redesign contradicted the v1 assumptions those documents used to
describe.

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
perfectly, so the format uses it instead of inventing its own. In
particular, the creative text is always a **screenplay**, never a "script" —
that word is hopelessly overloaded in a repo full of shell scripts,
[`scripts/prompts/`](../scripts/prompts/), and CLI tooling.

| Term                     | Meaning here                                                                                                             | Provenance                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **draft screenplay**     | the author's screenplay, verbatim, in any name and format; never parsed                                                  | screenwriting                                      |
| **canonical screenplay** | the Producer's timed, schema-validated JSON rendering of the draft (`screenplay.json`); the project's timeline authority | this format                                        |
| **model sheet**          | isolated, neutral-backdrop identity reference for a character/location/prop                                              | animation                                          |
| **board**                | a reference still anchored to a moment on the screenplay timeline                                                        | storyboarding                                      |
| **shot list**            | a versioned tiling of the screenplay timeline into shots, with references and prompts                                    | production                                         |
| **shoot**                | one renderer invocation against one shot list with one engine                                                            | production                                         |
| **take**                 | one rendered attempt at one shot                                                                                         | on-set; ≈ a "Version" in ShotGrid/ftrack pipelines |
| **dailies**              | a review session that records verdicts on takes                                                                          | post-production                                    |
| **circled take**         | a take a reviewer has marked as the keeper                                                                               | on-set ("circle takes")                            |
| **animatic**             | the zero-cost review movie assembled from the screenplay and boards                                                      | animation; replaces v1 "storyboard `.msbo`"        |
| **cut**                  | a deliverable movie assembled from circled takes                                                                         | editorial; replaces v1 "export"                    |

The whole retention model in one sentence of that vocabulary: _takes survive
the shoot, dailies happen whenever, circling picks the keeper, the cut
assembles circled takes, and nothing is struck without an explicit decision._

## Design principles

These play the same role as the design considerations in
[`03-prompt-architecture.md`](03-prompt-architecture.md): a change that
violates one is a design bug, not a detail.

1. **A project is a single folder, containing both source and output.** The
   screenplay, references, shot lists, takes, shoots, dailies, and cuts all
   live under one root. There is no separate build tree holding the only
   copy of anything worth keeping.
2. **The archive is a format optimization, not the format.** A `.msb` file is
   a packed snapshot of (part of) the folder, produced for transport or
   pinning. Every operation works against the folder directly; nothing may
   exist only inside an archive.
3. **The draft is sacred; the canonical screenplay is data.** The author's
   draft is copied in verbatim and never machine-read. The canonical
   screenplay is the single machine-readable creative source — JSON,
   schema-validated like every other machine-read file: a Producer writes it
   (a judgment task, not a converter), the Author confirms it says what the
   draft meant against a rendered view, and ingest validation gates its
   form.
4. **The ledger is write-once; the working set is hash-pinned.** Drafts,
   takes, shoots, and dailies are only ever added, never modified. The
   working set (canonical screenplay, references and their index, `msb.json`)
   evolves in place under version control; every shot list records the
   screenplay hash it tiles, and every shoot records the shot list and
   engine hashes it ran, so the ledger always pins exactly what it saw.
   Shot lists are immutable once any shoot cites them — editing means
   writing the next version.
5. **A shoot is a link object, not a container.** A shoot is one JSON file
   that _points to_ its source (shot list + engine, by hash), the takes it
   reused from earlier shoots, and the new takes it produced. Media is never
   copied between shoots, and a shoot that produced nothing — a failed plan,
   an all-cache-hits rerun — is still a real, cheap ledger entry.
6. **The folder is shallow.** Maximum depth is two levels; structure that v1
   expressed as nested directories is expressed here as filename convention
   plus JSON links.
7. **"Latest" is computable, and garbage collection is a choice.** Any script
   can determine the latest shot list, latest complete shoot, and each shot's
   current take from folder contents alone — ordinal filenames, no symlinks,
   no database. Deleting obsolete media is something a script _chooses_ to
   do, explicitly, under stated rules — never a side effect of rendering.
8. **Everything machine-read is schema-validated and hash-linked**, exactly
   as v1 already does for archives ([`src/schema.ts`](../src/schema.ts),
   [`src/archive.ts`](../src/archive.ts)): safe relative paths only, nothing
   resolving outside the project root, content hashes wherever one artifact
   cites another.

## Folder layout

```text
my-project/                       # the project folder IS the msb
├── msb.json                      # header: format version, project id/title, cast, screenplay provenance
├── drafts/                       # author's screenplay(s), verbatim, any name/format — never parsed
│   └── agent-skit-draft.docx
├── screenplay.json               # canonical timed screenplay — the timeline authority
├── references/                   # flat: model sheets and boards
│   ├── references.json           # index: kind, subjects, time anchor, provenance
│   ├── agent-86.png              # model sheet (timeless)
│   └── t0016.0-agents-turn.png   # board, anchored at 16.0s on the screenplay timeline
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
    ├── animatic.mp4              # zero-cost screenplay + boards assembly
    └── 0002-hailuo.mp4           # deliverable cut of shoot 0002
```

## Creating a project: draft → canonical → ingest

`msb create <folder> --draft <file>` scaffolds the layout above and copies
the author's screenplay into `drafts/` **verbatim — whatever its name and
format**. The tool never parses a draft; it is provenance, the thing every
later judgment call can be checked against. An author who revises later adds
a new draft file; drafts are part of the append-only ledger.

**Canonicalization is a Producer step, not a converter.** The Producer
(human or agent) writes `screenplay.json` in the canonical form below,
translating the draft's prose into cast ids, timed cues, and a declared
total duration. This involves real judgment — pacing lines that the draft
left implicit — which is exactly why it is a role's task (with a prompt in
[`scripts/prompts/`](../scripts/prompts/)) and not code. The Author then
confirms the canonical screenplay says what the draft meant — against the
rendered view (`msb inspect --screenplay`), never by reading JSON; that
confirmation is the first review in the project's life.

**Ingest validation is code.** `msb ingest <folder>` validates the canonical
screenplay against its schema plus semantics: cue ids are unique, cues are
monotonic and lie within the declared duration, dialogue spans don't overlap
for the same speaker, every speaker resolves to a cast member in `msb.json`,
and every cast member has a model sheet (or is flagged as still needing
one). Nothing downstream — boards, shot lists, shoots — runs against a
screenplay that hasn't passed ingest. This is v1's pack-time completeness check, moved to the earliest
moment it can actually run.

## The parts

### The canonical screenplay and its timeline

The canonical screenplay is JSON, not marked-up prose. A cue-grammar
markdown was considered and rejected: it would have been the only bespoke
parser in an otherwise entirely schema-driven format (design principle 8),
justifiable only while the canonical screenplay also had to be the
human-readable artifact — a role the verbatim draft already fills. As JSON,
ingest validation is the same schema machinery as every other file, and
every cue is a record that can grow metadata — delivery notes, sound
effects, provenance back to a draft passage — without a grammar change.

```json
{
  "formatVersion": "2.0.0",
  "screenplay": {
    "title": "Agent Autonomy Skit",
    "duration": 32,
    "draft": "drafts/agent-skit-draft.docx",
    "draftHash": "sha256-…"
  },
  "scenes": [
    {
      "id": "scene-001",
      "slug": "control-center",
      "cues": [
        {
          "id": "c001",
          "at": 0,
          "kind": "action",
          "text": "Three sock puppets face the camera in the cardboard control center."
        },
        {
          "id": "c002",
          "span": [1, 4],
          "kind": "dialogue",
          "character": "agent-86",
          "text": "Would you believe… fully autonomous by Friday?"
        },
        {
          "id": "c003",
          "span": [5, 8],
          "kind": "dialogue",
          "character": "agent-99",
          "text": "I'd believe a staging deploy."
        },
        {
          "id": "c004",
          "at": 16,
          "kind": "action",
          "text": "The agents turn to the big screen."
        },
        {
          "id": "c005",
          "span": [26, 31],
          "kind": "dialogue",
          "character": "agent-13",
          "delivery": "from inside the filing cabinet",
          "text": "Nobody ever checks the logs."
        }
      ]
    }
  ]
}
```

Point cues (`at`) mark action beats; span cues (`span`) carry dialogue and
narration. Cues have **stable ids**, and together with the times this makes
the screenplay the **timeline authority** for the whole format:

- **Dialogue lives here and only here.** Shot lists no longer carry dialogue
  at all (v1 duplicated every line's text and timing between `screenplay.md`
  and `msb.json`, synced by hand). At shoot-plan time, each shot picks up
  whatever cues fall inside its span, automatically.
- **Boards anchor to cues, not seconds.** A board's index entry names the
  cue it depicts (`"cue": "c004"`) plus the time and screenplay hash
  captured when it was anchored. Re-pacing the screenplay moves a cue's time
  but not its id, so anchors never rot; the `t0016.0-` filename prefix is a
  human sort convenience, cosmetic by construction. Shot lists still point
  to specific files explicitly — anchors are provenance, not a resolution
  mechanism.
- **The animatic needs no shot list.** Timed cues plus time-anchored boards
  are sufficient to assemble the zero-cost review movie — so the cheap
  look-and-feel checkpoint happens _before_ any framing work, matching real
  production order (boards and animatic first, breakdown after).
- **Pacing is authorial; review is readable.** The Author owns words _and_
  timing — both are creative decisions in a fixed-length piece — but
  confirms them against `msb inspect --screenplay` (the screenplay rendered
  as readable, screenplay-formatted text) and the animatic, never by reading
  JSON. The Producer owns how the timeline is cut into shots.

### References: model sheets and boards

`references/` is flat and holds every raster the project uses, in two kinds:

- **Model sheets** — timeless: one isolated, neutral-backdrop sheet per
  character/location/prop (v1's `characters/`/`locations/` images).
- **Boards** — anchored to a moment on the screenplay timeline, named
  `t<seconds, zero-padded>-<slug>.png`. These replace v1's per-shot
  composition references.

`references/references.json` indexes each image: `kind`
(`model-sheet`/`board`), subject cast ids, the cue anchor (cue id, plus the
time and screenplay hash captured when anchored), and provenance (which
prompt/agent produced it, per the request/response contract in
[`03-prompt-architecture.md`](03-prompt-architecture.md#the-reference-image-requestresponse-contract)).

### Shot lists

A **shot list** tiles the screenplay timeline into shots — contiguous,
non-overlapping spans covering `[0, duration]` — and gives each shot its
references and render prompts, including renderer-tuned variants. Versions
are zero-padded ordinals (lexicographic order = version order), immutable
once any shoot cites them; each records the screenplay hash it tiles.

```json
{
  "formatVersion": "2.0.0",
  "shotlist": {
    "id": "002",
    "supersedes": "001",
    "screenplayHash": "sha256-…",
    "createdAt": "2026-08-05T03:10:00Z",
    "note": "split shot-002 into 002a/002b after animatic review"
  },
  "scenes": [
    {
      "id": "scene-001",
      "shots": [
        {
          "id": "shot-001",
          "span": [0, 10],
          "characters": ["agent-86", "agent-99", "agent-13"],
          "location": "control-center",
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

Relative to v1's `shots[]` ([`msbManifestSchema`](../src/schema.ts)):
`duration` becomes `span` on the screenplay timeline, `dialogue` is gone
(derived from the screenplay's cues within the span), and `prompts` is new —
per-engine prompt overrides, where `default: null` means "derive from
action/camera/continuity as today." This is where "LTX needs to be told,
forcefully, not to hallucinate extra puppets" lives — versioned with the
shot list instead of lost in a chat.

**Engine compatibility becomes tiling validation.** An engine's duration
menu (6s/8s/10s per model) constrains what spans a valid shot list may use
under that engine. "Veo can't render this project" stops being a mid-shoot
discovery and becomes a plan-time check — _no valid tiling exists_ — that
costs nothing and is recorded as a finding.

Engine configuration (`.msbc`) is otherwise **unchanged**: it stays a
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

Take _metadata_ (cost, request id, chain score, error) lives in the shoot
that created it, so the pool holds only content. `msb inspect --shot
shot-001` joins the pool against the shoot ledger to show every take of a
shot across all engines — the exact "let me look at what actually happened"
query #13 found impossible.

The v1 concept of a disposable `--work-dir` is gone: the pool _is_ where
render output lands, failed and succeeded alike, and it is part of the
format.

### Shoots: the first-class run object

A **shoot** is one invocation of the renderer against one shot list with one
engine configuration — and, answering #13's follow-up question directly: yes,
it is a first-class object, and it is _just JSON_. A shoot owns no media. It
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
    "resolved": {
      "provider": "fal",
      "model": "hailuo-02-standard",
      "mode": "image-to-video"
    }
  },
  "tool": { "name": "movie-source-builder", "version": "0.7.0" },
  "costs": { "estimated": 1.86, "actual": 0.62 },
  "reused": [
    {
      "shot": "shot-001",
      "take": "shot-001.t02",
      "from": "0001-ltx",
      "mediaHash": "sha256-…"
    }
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
      "claim": "duration menu is 6s/8s only; no valid tiling for shot list 002's 10s spans",
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
  finding. Tonight that fact lived in a chat transcript; here it is a small
  JSON file any future session finds before spending money.
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
    {
      "take": "shot-001.t01",
      "verdict": "rejected",
      "notes": "takes/shot-001.t01.notes.md"
    },
    { "take": "shot-001.t02", "verdict": "circled" }
  ]
}
```

A take's current standing is the latest verdict across all dailies:
**circled** (the keeper for its shot), **rejected**, or unreviewed. An
engine-successful take that fails human review — the 6-puppet case — is
`rendered` in its shoot and `rejected` in dailies, with the reasoning in
`notes.md` sitting beside the exact frames it describes. v1's `msb approve`
becomes a circled verdict (a dailies entry names a take; the take's shoot
pins the shot list, screenplay, and engine hashes).

### Cuts

A **cut** assembles one movie from the pool: for each shot in the shot list,
the circled take if one exists, else the newest `rendered`, never-rejected
take. A shot with only rejected or failed takes fails the cut with a message
naming it. Cuts are named for the shoot they realize:
`cuts/0002-hailuo.mp4`. Like v1 `export`, cutting verifies hashes and never
contacts a provider.

The **animatic** is a cut too — assembled from the canonical screenplay's
cues and the boards, with zero network requests (v1's storyboard `.msbo`,
renamed to the standard term, demoted to a deterministic regenerable cut,
and — because the screenplay is now timed — available _before any shot list
exists_). Review verdicts on an animatic are ordinary dailies entries.

## Latest, retention, and garbage collection

**Latest shot list** — highest ordinal in `shotlists/`. **Latest shoot** —
highest-ordinal shoot with `status: "complete"` (every shot resolved to a
reused or newly rendered take). **Current take per shot** — the cut rule
above. All three are computable from filenames plus JSON, no symlinks, no
database; `msb latest <folder>` prints them.

**Retention policy (what a producer should expect to find).** By default,
_everything is retained indefinitely_: every draft, every take's media and
last frame, every shoot, every dailies verdict, every finding. Rendering
never deletes anything. The folder grows with use — that is the point, and
the explicit reversal of v1's lean/throwaway model.

**Garbage collection is opt-in and rule-bound.** `msb gc <folder>` deletes
_take media only_ (`.mp4`) — never ledger JSON, notes, or last frames (small,
and they are the chaining/diagnosis evidence). Reclaimable takes are those
that are rejected, or neither circled nor the newest take of their shot nor
linked (as `reused` or new) by the latest complete shoot. `--dry-run` first,
always. After `gc`, the record _that_ a take happened, what it cost, its last
frame, and why it was rejected always survive — only the video bytes go.

**Version control.** The folder is git-friendly in layers: everything except
take media and cut movies is small, diffable text worth tracking; the
scaffolded folder ships a `.gitignore` covering `takes/*.mp4` and `cuts/`.
This replaces v1's blanket "outputs never live inside a tracked source
folder" rule — see the impact section below.

## How this answers #13's concrete losses

| #13 loss                                                          | v2 mechanism                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Failed LTX frames deleted before/without inspection               | Takes land in the durable pool; nothing deletes media but explicit `gc`, which always spares last frames, notes, and the ledger  |
| Veo 6s/8s incompatibility known only in a chat transcript         | Plan-time tiling validation; a `failed` shoot with zero takes and one structured `finding`, surfaced by `msb inspect --findings` |
| "6 puppets" defect vs. "engine style difference" distinction lost | `rendered` in the shoot, `rejected` in dailies, reasoning in `notes.md` beside the frames it judges                              |
| Retry attempts never inspected                                    | Each retry is its own numbered take, reviewable in any later dailies session                                                     |
| No way to see history via the CLI                                 | `msb inspect` reports shot lists, shoots, takes, verdicts, findings — `--shot` shows one shot's full history across engines      |
| What is retained, for how long                                    | Stated plainly above: everything, indefinitely, unless a human runs `gc`                                                         |

## Tradeoffs against the v1 lean model

Made explicit, per #13's acceptance criteria:

- **Retained bytes.** The pool accumulates every take's video. At the #11
  session's scale that is tens to hundreds of MB per exploratory evening —
  real, but small against the dollars the evidence protects, and reclaimable
  via `gc` without losing the ledger.
- **Format complexity.** Six small schemas (header, screenplay, references
  index, shot list, shoot, dailies) replace two larger ones (`msb.json`,
  `.msbo`), with no bespoke grammar anywhere — everything machine-read is
  JSON. The offsetting simplification is larger:
  dialogue duplication between screenplay and manifest,
  `--work-dir`/`--keep-work-dir`, the promote-or-discard dance, the
  storyboard/render `.msbo` split, the embedded approval record, and all
  migration/compat machinery (there is none) go away.
- **No migration.** v1 files stop being readable. Accepted deliberately:
  pre-1.0 tool, one project, restructured by hand.

## Impact on v1 assumptions and commands

- **Revises [`03-prompt-architecture.md`](03-prompt-architecture.md)
  assumption 5** ("interim outputs belong in gitignored `build/`, never
  inside a tracked source folder"). In v2, outputs live _inside_ the project
  folder by design; the gitignore boundary moves from "the whole build tree"
  to "take media and cuts." The rationale that assumption protected — never
  let generated debris masquerade as creative source — is preserved
  structurally: source and output are distinct, named, top-level parts of
  one folder.
- **Revises assumption 3's timing** (every referenced asset must exist before
  `pack`): asset-existence validation moves to shoot-plan time, and
  screenplay/cast validation moves even earlier, to ingest. The rule
  itself — every referenced path must exist inside the folder, nothing
  escapes the root — is unchanged.
- **CLI shape** (sketch, not final): `msb create <folder> --draft <file>`
  scaffolds and copies the draft verbatim; `msb ingest <folder>` validates
  the canonical screenplay; `msb animatic <folder>` assembles the
  screenplay + boards cut; `msb shoot <folder> --config <engine.msbc>`
  appends a shoot and its takes; `msb dailies <folder>` lists unreviewed
  takes and `msb circle <folder> --take shot-001.t02 [--notes <file>]` /
  `--reject` append verdicts; `msb cut <folder>` assembles the deliverable;
  `msb latest`, `msb gc --dry-run`, `msb inspect
[--findings|--shot <id>|--screenplay]` as described above;
  `msb pack <folder> [--source-only]` emits the optional
  transport archive. Exit codes and cost/safety controls (`--dry-run`,
  `--max-cost`, credential handling, mock engine) carry over unchanged.
- **The prompt/orchestration layer** (`scripts/prompts/`) keeps its
  request/response contract verbatim, gains a canonicalization step
  (Producer writes the canonical screenplay; Author confirms fidelity to the
  draft), and Producer steps change output destinations from `build/…` paths
  to the project folder, with command names per the sketch above.

## Caveats and future concerns

None of these blocks the design; recorded so they aren't relitigated:

- **One writer per folder.** Ordinal shoot ids and take numbers assume it;
  concurrent shoots need locking or collision-safe allocation someday.
- **Dailies is a separate ledger** so every ledger file stays write-once;
  revisit only if it proves heavy in practice.
- **Circling doesn't gate the cut** (only rejection blocks a take); making
  review mandatory is a future policy knob, not a format question.
- **Findings scopes** beyond `engine-compatibility`/`content-fidelity`
  should emerge from use, not be enumerated now.
- **Text-based authoring of `screenplay.json`** (timed cues as text, tooling
  emits the JSON) is an input convenience to add on demand, never a second
  source of truth.
- **Per-engine render parameters** (guidance scale, seeds) likely belong in
  the `.msbc`, unlike per-engine _prompts_ (creative, in the shot list) —
  draw the line once a second real case exists.
