---
step: 7
role: producer
---

# Chain a shot (optional)

For a shot that should continue directly from an earlier one (same set, continuous framing, no reason to re-invent the composition), add `"chainFrom": "<earlier-shot-id>"` to it in `msb.json` before packing — `image-to-video` only.

It must still author its own `references.composition`; chaining verifies the predecessor's actual rendered frame against that composition and only promotes the real frame on a close match. Author it to resemble what the predecessor shot is expected to end on. If the predecessor has already been rendered once, extracting its actual last frame and using that as this shot's composition gives the check the best chance of matching.

Skip this step for any shot that doesn't need it — chaining is opt-in per shot.
