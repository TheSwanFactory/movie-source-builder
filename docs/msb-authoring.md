# Authoring Movie Source Bundles

An `.msb` is a ZIP-compatible source bundle whose root contains `msb.json`. The manifest describes the cast, setting, timing, and generation-sized shots. The renderer does not infer how source assets should be combined: authors must provide each shot with the actual image(s) that should initialize that video request, using the role the configured renderer mode accepts.

## The reference rule

There are two different kinds of image reference in an MSB:

- `characters[].reference`, `locations[].reference`, and `props[].reference` identify and package reusable source assets. They document entities, participate in validation and cache keys, and make the bundle inspectable. They are **not automatically composited or sent to a provider**.
- `shots[].references` is an object of **roles** containing the explicit provider input for that particular shot:
  - `identity`: zero to three PNG, JPEG, WebP, or AVIF rasters, typically one per recurring character. Used by reference-to-video renderers such as Veo 3.1 Fast, which upload each one and send them as `image_urls`.
  - `composition`: one optional raster showing the complete intended starting frame. Used by image-to-video renderers, which upload it and send it as `image_url`.
  - `endFrame`: one optional raster for renderers that support declaring an explicit ending frame.

Consequently, listing three characters in `shot.characters` does not make three character reference sheets visible to the provider. Which roles a shot must populate — and how many — depends on the `renderer.mode` in the `.msbc` you render with:

- An `image-to-video` mode (the fal Hailuo, Veo 3.1 Fast, and LTX 2.3 Fast image-to-video profiles) requires exactly one `composition` raster and rejects `identity` or `endFrame`. If a shot contains three characters, that one composition raster must already show those three characters together in the desired setting.
- A `reference-to-video` mode (the Veo 3.1 Fast reference-to-video profile) requires one to three `identity` rasters and rejects `composition` or `endFrame`.

An unsupported role, a missing required role, or an out-of-range count for the configured mode fails validation during plan creation — before credentials, pricing, upload, or generation.

## Recommended source layout

```text
source/
├── msb.json
├── screenplay.md
├── characters/
│   ├── agent-86.png
│   ├── agent-99.png
│   └── agent-13.png
├── locations/
│   └── control-center.png
└── references/
    └── control-center-ensemble.png  # actual image-to-video composition input
```

The individual entity sheets are useful source documentation. Keep each character sheet isolated on the same neutral backdrop with no other characters, props, or story location; keep the location plate empty of characters. This prevents character identity references from leaking a background and prevents location references from leaking a cast. `control-center-ensemble.png` is the separate canonical generation reference for `image-to-video` engines: it intentionally combines every visible character, stable identity marker, prop, and set element in one frame. A `reference-to-video` engine instead uses the individual character sheets directly as `identity` references — no ensemble composition is needed.

## Minimal multi-character example: image-to-video

```json
{
  "formatVersion": "1.1.0",
  "project": { "id": "agent-skit", "title": "Agent Skit" },
  "screenplay": "screenplay.md",
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

Render this with any `image-to-video` engine, e.g. `msbc/fal-hailuo-02-standard.msbc`.

## Minimal multi-character example: reference-to-video

The same cast rendered with `fal-ai/veo3.1/fast/reference-to-video` (`msbc/fal-veo-3.1-fast-reference.msbc`) instead lists each character's own sheet under `identity`, and drops the ensemble composition entirely. Veo 3.1 Fast reference-to-video only supports 8-second shots:

```json
{
  "formatVersion": "1.1.0",
  "project": {
    "id": "agent-skit-reference",
    "title": "Agent Skit (Reference)"
  },
  "screenplay": "screenplay.md",
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
      "duration": 8,
      "characters": ["agent-86", "agent-99"],
      "location": "control-center",
      "dialogue": [],
      "action": "The two puppets address the control room.",
      "camera": "Locked medium two-shot.",
      "references": {
        "identity": ["characters/agent-86.png", "characters/agent-99.png"]
      },
      "continuity": [
        "Agent 86 remains red with badge 86 on camera left",
        "Agent 99 remains blue with badge 99 on camera right",
        "Set the scene at the cardboard control center"
      ]
    }
  ]
}
```

A complete three-character version of this pattern is packaged at [`examples/skit-poc-reference/msb.json`](../examples/skit-poc-reference/msb.json).

## Designing for continuity

Current video requests are independent, regardless of renderer mode. A `continuity` entry is appended to the text prompt; it is guidance, not an identity lock, constraint system, or previous-frame handoff.

For the strongest continuity available with the current fal adapters:

1. **Image-to-video**: design one canonical composition containing all recurring characters and the set; use it — or shot-specific variants derived from it — as the single `composition` reference for every shot.
2. **Reference-to-video**: use the same one to three character identity sheets as `identity` for every shot, so each independent request is anchored to the same source images.
3. Give characters unmistakable, non-overlapping colors, silhouettes, and readable identity markers.
4. Repeat concrete invariants in `continuity`: color, badge, screen position, wardrobe, scale, set layout, and props. Because reference-to-video has no composition image to imply the set, state the location and staging explicitly in `continuity` as well.
5. Keep camera and staging changes modest. Large viewpoint or pose changes give the model more opportunities to redesign characters.
6. Render with `--fresh` after changing a reference or continuity strategy when deliberately discarding prior generated shots.

Uploading consistent identity references (either approach) improves consistency but does not guarantee it, and it is **not the same as cross-shot continuity**. True shot chaining requires renderer support that extracts the final frame (or video context) of one shot and supplies it to the next request; no adapter in this release does that. Evaluate first/last-frame and video-extension endpoints separately before claiming continuity guarantees.

**Reference-to-video and held static poses.** Because reference-to-video has no starting-frame image to anchor a pose — only identity sheets, which typically show a character actively worn upright — it is markedly worse than image-to-video at holding a shot where characters must stay in a specific state (e.g. collapsed and motionless) rather than move. In one paid test, a "hold still, do not rise" shot instead showed the characters standing back up and talking, with an extra hallucinated character. Rewriting the shot so the no-movement constraint was the first sentence of `action` (not buried after scene-setting prose), repeated as a `CRITICAL:`-prefixed `continuity` entry, and paired with an explicit statement that dialogue should read as an unseen voiceover over an unchanging frame, fixed it on retry. If a shot's entire content is "nothing moves," state that constraint first and most emphatically, and budget for at least one retry.

## Preflight checklist

Before spending money on a render, verify all of the following:

- Every shot's `references` only uses roles the configured `renderer.mode` accepts, within its supported count.
- For `image-to-video`: the one `composition` raster shows the complete intended opening composition, not an isolated prop or source sheet, and every recurring character visible in the shot appears in it.
- For `reference-to-video`: every recurring character visible in the shot has its identity sheet listed under `identity`.
- Identity and placement invariants are stated concretely in `continuity`.
- `msb validate` succeeds.
- `msb render --dry-run` reports the expected shots and cost without provider requests.

Pack and inspect the bundle before rendering:

```bash
msb pack path/to/source --out movie.msb
msb validate movie.msb
msb validate movie.msb --config msbc/fal-hailuo-02-standard.msbc
msb inspect movie.msb
msb render movie.msb --dry-run --max-cost 2.00
```

The first validation checks the provider-independent MSB structure and relationships. The configured validation additionally enforces the selected renderer's model, mode, duration, reference-role and count, extension, and file-content requirements. The render pipeline runs this same configured validation before any paid work.
