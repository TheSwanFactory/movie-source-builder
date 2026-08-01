# Authoring Movie Source Bundles

An `.msb` is a ZIP-compatible source bundle whose root contains `msb.json`. The manifest describes the cast, setting, timing, and generation-sized shots. The renderer does not infer how source assets should be combined: authors must provide each shot with the actual image that should initialize that video request.

## The reference rule

There are two different kinds of image reference in an MSB:

- `characters[].reference`, `locations[].reference`, and `props[].reference` identify and package reusable source assets. They document entities, participate in validation and cache keys, and make the bundle inspectable. They are **not automatically composited or sent to an image-to-video provider**.
- `shots[].references` contains the provider input for that particular shot. The current fal adapter requires **exactly one** PNG, JPEG, WebP, or AVIF. It uploads only that image as `image_url`.

Consequently, listing three characters in `shot.characters` does not make three character reference sheets visible to the provider. If a shot contains three characters, its one explicit shot reference must already show those three characters together in the desired setting.

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
    └── control-center-ensemble.png  # actual image-to-video input
```

The individual entity sheets are useful source documentation. `control-center-ensemble.png` is the canonical generation reference: it contains every visible character, stable identity marker, prop, and set element in one frame.

## Minimal multi-character example

```json
{
  "formatVersion": "1.0.0",
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
      "references": ["references/control-center-ensemble.png"],
      "continuity": [
        "Agent 86 remains red with badge 86 on camera left",
        "Agent 99 remains blue with badge 99 on camera right"
      ]
    }
  ]
}
```

## Designing for continuity

Current video requests are independent. A `continuity` entry is appended to the text prompt; it is guidance, not an identity lock, constraint system, or previous-frame handoff.

For the strongest continuity available with the current fal adapter:

1. Design one canonical composition containing all recurring characters and the set.
2. Give characters unmistakable, non-overlapping colors, silhouettes, and readable identity markers.
3. Use that composition—or shot-specific variants derived from it—as the single explicit reference for every shot.
4. Repeat concrete invariants in `continuity`: color, badge, screen position, wardrobe, scale, set layout, and props.
5. Keep camera and staging changes modest. Large viewpoint or pose changes give the model more opportunities to redesign characters.
6. Render with `--fresh` after changing a reference or continuity strategy when deliberately discarding prior generated shots.

This improves consistency but cannot guarantee it. True shot chaining requires renderer support that extracts the final frame of one shot and supplies it to the next request; the current renderer does not do that.

## Preflight checklist

Before spending money on a render, verify all of the following:

- Every paid-provider shot has exactly one explicit raster path in `shot.references`.
- That raster shows the complete intended opening composition, not an isolated prop or source sheet.
- Every recurring character visible in the shot appears in the raster.
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

The first validation checks the provider-independent MSB structure and relationships. The configured validation additionally enforces the selected renderer's model, duration, reference-count, extension, and file-content requirements. The render pipeline runs this same configured validation before any paid work.
