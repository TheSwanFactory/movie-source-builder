---
step: 2
role: producer
---

# Pack the bundle

Structure the author's screenplay into a Movie Source Bundle: write `msb.json` with `characters`/`locations`/`props`/`shots` matching the schema, and gather or generate the reference images each shot's renderer mode will need — one isolated, neutral-backdrop image per character/location (no ensemble), plus one ensemble composition image per `image-to-video` shot, or identity sheets for `reference-to-video`. If generating reference imagery with AI rather than sourcing real photos, use the canonical storyboard image prompt template (`scripts/prompts/storyboard-image.md`) per shot/entity.

Then run:

```bash
msb pack <folder> --out movie.msb
```
