---
step: 8
role: producer
---

# Author the shot list

Write `shotlists/001.json` (or the next ordinal, if revising): a tiling of the screenplay timeline into contiguous, non-overlapping shots covering `[0, duration]`, recording the screenplay hash it tiles. For each shot give the span, cast present, location, action, camera direction, continuity notes, and its `references` — one board as `composition` for `image-to-video` engines, or model sheets as `identity` for `reference-to-video`. Do **not** copy dialogue into shots: it derives automatically from the screenplay cues inside each shot's span.

Choose spans the target engine can render — each engine's duration menu (e.g. Veo 3.1 Fast: 6s/8s) constrains valid tilings, and the next step's dry run reports any impossible tiling as a structured finding.

For a shot that should continue directly from the one before it — same set, continuous framing — add `"chainFrom": "<earlier-shot-id>"` (`image-to-video` only; the shot still authors its own `composition`, which chaining verifies against). Engine-specific prompt lessons belong in `"prompts"` keyed by engine config name, with `"default": null` meaning "derive from action/camera/continuity".

A shot list is immutable once any shoot cites it; revising afterward means writing the next ordinal.
