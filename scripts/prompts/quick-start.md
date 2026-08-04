# Canonical quick-start prompts v1

One prompt per step of [Quick Start: Producing a Movie](../../docs/01-quick-start.md). Each is tagged **Author** (creative calls) or **Producer** (makes it real) — either role can be a human or an AI. Hand the matching prompt to whoever/whatever is filling that role at that step.

## 1. Author — write the script

Write the screenplay: characters (name, one-line visual description each), setting(s), and an ordered shot list. For each shot, specify the cast present, the location, the action, camera direction, any dialogue with timing, and continuity notes — what must stay consistent from prior shots (color, badge, wardrobe, screen position). Do not structure this into MSB files or generate reference images yourself; hand the result to the Producer.

## 2. Producer — pack the bundle

Structure the author's screenplay into a Movie Source Bundle: write `msb.json` with `characters`/`locations`/`props`/`shots` matching the schema, gather or generate one reference image per character and location (isolated, neutral backdrop, no ensemble), and one ensemble composition image per `image-to-video` shot (or identity sheets for `reference-to-video`). Then run:

```bash
msb pack <folder> --out movie.msb
```

## 3. Author — review the storyboard

Run:

```bash
msb storyboard movie.msb --out storyboard.msbo
msb inspect storyboard.msbo
```

Watch the review MP4. Check whether cast, setting, shot order, and pacing match intent. Flag any shot whose reference image or continuity notes need revision before anything paid happens.

## 4. Producer — validate and price

Run:

```bash
msb validate movie.msb --config <engine.msbc>
msb render movie.msb --config <engine.msbc> --dry-run
```

Confirm zero validation errors and that the estimated cost is acceptable before proceeding.

## 5. Author — sign off

Run:

```bash
msb approve storyboard.msbo --source movie.msb
```

This records sign-off, hash-bound to the exact source — not an enforced gate (`msb render` doesn't check it). Treat it as your explicit go/no-go checkpoint before real spend.

## 6. Producer — render

Run:

```bash
msb render movie.msb --config <engine.msbc> --out movie.msbo --max-cost <usd>
```

Set `--max-cost` to the dry-run estimate plus a small margin.

## 7. Producer — chain a shot

For a shot that should continue directly from an earlier one (same set, continuous framing, no reason to re-invent the composition), add `"chainFrom": "<earlier-shot-id>"` to it in `msb.json` before packing — `image-to-video` only. It must still author its own `references.composition`; chaining verifies the predecessor's actual rendered frame against that composition and only promotes the real frame on a close match, so author it to resemble what the predecessor shot is expected to end on. If the predecessor has already been rendered once, extracting its actual last frame and using that as this shot's composition gives the check the best chance of matching — see [Reference: shot chaining](../../docs/01-quick-start.md#reference-shot-chaining).

## 8. Author — review the finished cut

Watch the rendered result against original creative intent: identity, continuity, pacing. If a chained shot failed its drift check, decide whether to edit the predecessor, edit the shot's own composition, or drop chaining for that shot and rerun — there is no automatic retry.

## 9. Producer — export

Run:

```bash
msb export movie.msbo --out movie.mp4
```
